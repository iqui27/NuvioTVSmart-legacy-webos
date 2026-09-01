import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";
import { runWebOsToolsBinary } from "./aresCli.mjs";
import { buildWebOsMediaRuntime } from "./webosMediaRuntime.mjs";
import postcss from "postcss";
import { uiScalePlugin } from "./uiScalePlugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const cacheDir = path.join(rootDir, ".cache");
const stagingDir = path.join(cacheDir, "webos-package");
const appStageDir = path.join(stagingDir, "app");
const serviceStageDir = path.join(stagingDir, "space.nuvio.webos.service");

/*
 * ISSUE #1 (lijovklm, webOS 3.4): a graphics plane do web app pode ser 1280x720 (painel
 * FHD) ou 1920x1080 (UHD), e NAO da para saber qual no build -- nem o appinfo nem o meta
 * viewport forcam uma delas (ambos medidos inertes). Como o CSS desta variante nasce com
 * os px congelados em 1920 (Chromium 38 nao tem var()/clamp()), numa plane de 720 o layout
 * fica 1,5x a tela e o overflow corta: o sintoma relatado.
 *
 * Entao o pacote leva as DUAS folhas -- a de 1920 e uma copia com os px a 2/3 -- e o
 * index.html escolhe pelo innerWidth real no boot. Escalar em runtime (transform/zoom) nao
 * serve: o dist mistura px com vw/vh, e vw/vh resolvem contra a viewport, nao contra o
 * elemento escalado, entao o frame e o conteudo andariam em ritmos diferentes.
 */
const LEGACY_SCALED_SUFFIX = "-720";
const LEGACY_SCALE = 2 / 3;
const LEGACY_SCALED_SHEETS = ["css/base.css", "css/components.css"];
// Acima disto o app usa a folha de 1920. 1366 e 1280 caem na de 720; 1920 fica de fora.
const LEGACY_SCALE_MAX_WIDTH = 1600;

function scaledSheetName(href) {
  return href.replace(/\.css$/, `${LEGACY_SCALED_SUFFIX}.css`);
}

/*
 * Gera a variante 720 a partir do CSS de 1920 JA construido, reusando o mesmo
 * uiScalePlugin do build (com o mesmo skip-list) em vez de reimplementar a regra aqui.
 */
async function writeLegacyScaledStylesheets(stageDir) {
  if (compatibilityPolicy.webOsChromiumVersion >= 49) {
    return [];
  }
  const written = [];
  for (const href of LEGACY_SCALED_SHEETS) {
    const sourcePath = path.join(stageDir, href);
    if (!(await pathExists(sourcePath))) {
      throw new Error(`webOS legacy scaling expected ${href} in the staged app.`);
    }
    const source = await readFile(sourcePath, "utf8");
    const result = await postcss([uiScalePlugin(LEGACY_SCALE)]).process(source, {
      from: sourcePath,
      to: sourcePath
    });
    const targetName = scaledSheetName(href);
    await writeFile(path.join(stageDir, targetName), result.css, "utf8");
    written.push(targetName);
  }
  return written;
}

const appName = "Nuvio TV";
const webOsServiceId = "space.nuvio.webos.service";
const webOsServiceSourceDir = path.join(rootDir, "services", "webos");
const webOsRuntimeScriptPath = "assets/libs/webOSTV.js";

// On-demand screen chunks emitted by scripts/build.mjs. They are fetched at
// runtime by js/runtime/loadScreenChunks.js, so nothing in index.html
// references them and a missing file would only show up on the TV as a screen
// that never opens. Named explicitly here so packaging fails instead.
const screenChunkFiles = ["player.chunk.js"];

// Build metadata, useful on a workstation and dead weight on a TV.
const distDevelopmentOnlyFiles = ["app.bundle.meta.json", "player.chunk.js.meta.json"];

async function assertDistExists() {
  try {
    await access(path.join(distDir, "app.bundle.js"), fsConstants.R_OK);
    await access(path.join(distDir, "appinfo.json"), fsConstants.R_OK);
    for (const chunkFile of screenChunkFiles) {
      await access(path.join(distDir, chunkFile), fsConstants.R_OK);
    }
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function validateWebOsAppInfo(appInfo) {
  const requiredFields = ["id", "title", "type", "main", "icon", "version"];
  const missingField = requiredFields.find((field) => !String(appInfo?.[field] || "").trim());
  if (missingField) {
    throw new Error(`webOS appinfo.json is missing required field: ${missingField}`);
  }

  if (Object.prototype.hasOwnProperty.call(appInfo, "requiredVersion")) {
    throw new Error(
      "webOS appinfo.json contains unsupported requiredVersion metadata. " +
        "The app runtime compatibility gate is maintained in scripts/compatibilityPolicy.mjs."
    );
  }

  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(appInfo.iconColor || ""))) {
    throw new Error("webOS appinfo.json requires a valid iconColor in #RRGGBB or #RRGGBBAA form.");
  }

  if (String(appInfo.title).length > 20) {
    throw new Error("webOS appinfo.json title must be 20 characters or fewer.");
  }
  if (String(appInfo.appDescription || "").length > 60) {
    throw new Error("webOS appinfo.json appDescription must be 60 characters or fewer.");
  }

  const appId = String(appInfo.id);
  const services = Array.isArray(appInfo.services) ? appInfo.services : [];
  if (services.some((serviceId) => !String(serviceId).startsWith(`${appId}.`))) {
    throw new Error("webOS service IDs must begin with the application ID followed by a dot.");
  }
}

async function validatePngDimensions(filePath, expectedWidth, expectedHeight, label) {
  const image = await readFile(filePath);
  const isPng =
    image.length >= 24 &&
    image.readUInt32BE(0) === 0x89504e47 &&
    image.readUInt32BE(4) === 0x0d0a1a0a;
  if (
    !isPng ||
    image.readUInt32BE(16) !== expectedWidth ||
    image.readUInt32BE(20) !== expectedHeight
  ) {
    throw new Error(
      `${label} must be a PNG of exactly ${expectedWidth}x${expectedHeight}: ${filePath}`
    );
  }
}

async function validateOpaquePng(filePath, label) {
  const image = await readFile(filePath);
  const isPng =
    image.length >= 26 &&
    image.readUInt32BE(0) === 0x89504e47 &&
    image.readUInt32BE(4) === 0x0d0a1a0a;
  const colorType = isPng ? image.readUInt8(25) : -1;
  if (!isPng || colorType === 4 || colorType === 6) {
    throw new Error(`${label} must use an opaque PNG color type: ${filePath}`);
  }

  let offset = 8;
  while (offset + 12 <= image.length) {
    const chunkLength = image.readUInt32BE(offset);
    const chunkType = image.toString("ascii", offset + 4, offset + 8);
    if (chunkType === "tRNS") {
      throw new Error(`${label} must not contain a transparency chunk: ${filePath}`);
    }
    offset += chunkLength + 12;
  }
}

function validateWebOsServiceManifest(serviceManifest) {
  if (String(serviceManifest?.id || "") !== webOsServiceId) {
    throw new Error(`webOS services.json must use service id ${webOsServiceId}.`);
  }

  const services = Array.isArray(serviceManifest?.services) ? serviceManifest.services : [];
  if (
    !services.length ||
    services.some(
      (service) =>
        !String(service?.name || "").startsWith(`${webOsServiceId}.`) &&
        String(service?.name || "") !== webOsServiceId
    )
  ) {
    throw new Error(
      "Every webOS services.json service name must begin with the application service ID."
    );
  }
}

async function resolveWebOsScriptPath(targetDir) {
  const webOsScriptPath = path.join(targetDir, webOsRuntimeScriptPath);
  if (!(await pathExists(webOsScriptPath))) {
    return "";
  }

  return webOsRuntimeScriptPath;
}

/*
 * Everything in this document is a serialized, blocking file:// request, so what
 * is absent matters as much as what is present. Deliberately dropped:
 *
 * - css/layout.css and css/themes.css: 0 bytes at source, two round trips for
 *   nothing.
 * - assets/runtime/legacy-features.js: on this TV it only adds the five `no-*`
 *   classes, and they are already in the <html class> below — its feature probes
 *   are gated behind ?modernFeatures=1 and never run here. (The browser and
 *   Tizen documents still load it; they do not hardcode the classes.)
 * - assets/libs/qrcode-generator.js: 59 KB, unminified, needed by three screens.
 *   js/core/qr/qrCodeGenerator.js now loads it on first use.
 */
function buildWebOsIndexHtml({ webOsScriptPath = "" } = {}) {
  const webOsScriptTag = webOsScriptPath ? `  <script src="${webOsScriptPath}"></script>\n` : "";
  const compatibilityOptions = JSON.stringify({
    platform: "webos",
    minVersion: Number.parseInt(compatibilityPolicy.webOsRequiredVersion, 10),
    minChrome: compatibilityPolicy.webOsChromiumVersion,
    requiredLabel: `LG webOS ${compatibilityPolicy.webOsRequiredVersion}+ · Chromium ${compatibilityPolicy.webOsChromiumVersion}+ (${compatibilityPolicy.webOsSupportYear}+)`
  });

  // ISSUE #1: o meta viewport NAO altera a app resolution no webOS -- ela vem da
  // plataforma. Medido nas duas pontas: forcar 1920 nao corrigiu o crop do lijovklm
  // (exp22/exp23) e forcar 1280 na C9 deixou innerWidth em 1920 do mesmo jeito. No
  // Tizen o meta funciona, e foi o que enganou. Fica device-width, que e neutro; quem
  // resolve o tamanho e a escolha de folha por innerWidth logo abaixo.
  const viewportContent = "width=device-width, initial-scale=1.0";

  // Overlay de diagnostico opcional (NUVIO_DIAG_OVERLAY=1 no build). Existe porque
  // o testador de webOS 3 (lijovklm, issue #1) nao tem console e instala por dev
  // manager, entao nao ha como ler innerWidth/devicePixelRatio de outro jeito. Este
  // bloco desenha esses valores num canto, atualizando sozinho, para ele fotografar.
  // Nunca entra num build normal: so quando a env esta setada.
  // ISSUE #1: no motor antigo o par de folhas e escolhido no boot pelo innerWidth real
  // (ver writeLegacyScaledStylesheets). document.write durante o parse do head e sincrono,
  // entao a folha certa entra antes do primeiro paint -- sem flash de layout errado.
  const stylesheetTags =
    compatibilityPolicy.webOsChromiumVersion < 49
      ? `  <script>
    (function () {
      var largura = window.innerWidth || screen.width || 1920;
      var sufixo = largura <= ${LEGACY_SCALE_MAX_WIDTH} ? "${LEGACY_SCALED_SUFFIX}" : "";
      window.__NUVIO_UI_PLANE__ = { largura: largura, sufixo: sufixo };
      var folhas = ${JSON.stringify(LEGACY_SCALED_SHEETS)};
      for (var i = 0; i < folhas.length; i++) {
        document.write(
          '<link rel="stylesheet" href="' + folhas[i].replace(/\\.css$/, sufixo + ".css") + '">'
        );
      }
    })();
  </script>`
      : LEGACY_SCALED_SHEETS.map((href) => `  <link rel="stylesheet" href="${href}" />`).join("\n");

  const diagOverlay = process.env.NUVIO_DIAG_OVERLAY
    ? `  <script>(function(){function f(){var vv=window.visualViewport;return 'iw='+window.innerWidth+' ih='+window.innerHeight+'\\ndpr='+window.devicePixelRatio+'\\nscreen='+screen.width+'x'+screen.height+'\\nclientWxH='+document.documentElement.clientWidth+'x'+document.documentElement.clientHeight+(vv?('\\nvisualVP='+Math.round(vv.width)+'x'+Math.round(vv.height)):'')+'\\ncss='+((window.__NUVIO_UI_PLANE__&&window.__NUVIO_UI_PLANE__.sufixo)?'720':'1920');}function d(){var e=document.getElementById('__nvdiag');if(!e){e=document.createElement('div');e.id='__nvdiag';e.style.cssText='position:fixed;top:0;left:0;z-index:2147483647;background:rgba(0,0,0,0.88);color:#0f0;font-family:monospace;font-size:34px;line-height:1.35;padding:16px 22px;white-space:pre;border:3px solid #0f0';(document.body||document.documentElement).appendChild(e);}e.textContent='NUVIO DIAG\\n'+f();}if(document.body){d();}document.addEventListener('DOMContentLoaded',d);setInterval(d,700);})();</script>\n`
    : "";

  return `<!DOCTYPE html>
<html lang="en" class="no-flex-gap no-css-grid no-css-math no-backdrop-filter no-aspect-ratio">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="${viewportContent}" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${appName}</title>
  <script src="assets/runtime/legacy-dom-shims.js"></script>
${stylesheetTags}
</head>
<body>
${diagOverlay}  <script src="boot-guard.js"></script>
  <script src="core-js.bundle.js" onerror="window.NuvioBootGuard &amp;&amp; window.NuvioBootGuard.scriptFailed(this.src)"></script>
  <script>window.__NUVIO_PLATFORM__ = "webos";</script>
  <script src="nuvio.env.js"></script>
${webOsScriptTag}  <script>
    window.NuvioBootGuard.runCompatibilityGate(${compatibilityOptions}, function startNuvioApp() {
      window.NuvioBootGuard.loadScript("app.bundle.js");
    });
  </script>
</body>
</html>
`;
}

/*
 * The strings.xml files under the res/values directories are the pre-build
 * source for the locale bundles in res/i18n. Both were being shipped, which put
 * ~5.4 MB of XML in the package that nothing reads: the runtime prefers the
 * JSON, and a parity check on device confirmed all 2,814 keys match exactly for
 * the active locale. Keep the JSON, drop the XML. The XML fallback stays in
 * js/i18n/index.js for the browser and Tizen builds, which still ship it.
 */
async function pruneRedundantLocaleXml() {
  const resDir = path.join(appStageDir, "res");
  const bundleDir = path.join(resDir, "i18n");

  if (!(await pathExists(bundleDir))) {
    throw new Error(
      "No precompiled locale bundles in res/i18n; refusing to drop the strings.xml " +
        "fallback. Check buildI18nBundles in scripts/build.mjs."
    );
  }

  const entries = await readdir(resDir, { withFileTypes: true });
  const localeDirs = entries.filter(
    (entry) => entry.isDirectory() && /^values(-|$)/.test(entry.name)
  );
  const bundles = new Set(
    (await readdir(bundleDir))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5))
  );

  for (const dir of localeDirs) {
    const locale = dir.name === "values" ? "en" : dir.name.replace(/^values-/, "");
    if (!bundles.has(locale)) {
      throw new Error(
        `res/${dir.name} has no precompiled bundle (expected res/i18n/${locale}.json); ` +
          "keeping the XML would be the only way to serve it."
      );
    }
    await rm(path.join(resDir, dir.name), { recursive: true, force: true });
  }

  return { removed: localeDirs.length, kept: bundles.size };
}

async function stageApp() {
  const { version } = await readAppMetadata();
  await cp(distDir, appStageDir, { recursive: true });

  // Fail loudly here rather than shipping a package where the player route
  // silently refuses to open.
  for (const chunkFile of screenChunkFiles) {
    if (!(await pathExists(path.join(appStageDir, chunkFile)))) {
      throw new Error(`Screen chunk ${chunkFile} is missing from the webOS package.`);
    }
  }
  await Promise.all(
    distDevelopmentOnlyFiles.map((fileName) =>
      rm(path.join(appStageDir, fileName), { force: true })
    )
  );

  const scaledSheets = await writeLegacyScaledStylesheets(appStageDir);
  if (scaledSheets.length) {
    console.log(`variante 720 do CSS gerada: ${scaledSheets.join(", ")}`);
  }

  const prunedLocales = await pruneRedundantLocaleXml();
  console.log(
    `dropped ${prunedLocales.removed} strings.xml locale directories ` +
      `(${prunedLocales.kept} precompiled bundles kept)`
  );

  const appInfoPath = path.join(appStageDir, "appinfo.json");
  const appInfo = JSON.parse(await readFile(appInfoPath, "utf8"));
  appInfo.title = appName;
  appInfo.version = version;
  appInfo.icon = "icon.png";
  appInfo.largeIcon = "largeIcon.png";
  appInfo.services = [webOsServiceId];
  // ISSUE #1: o resolution do appinfo NAO decide sozinho a graphics plane. Medido na
  // C9 (webOS 4.10, painel UHD): declarar 1280x720 aqui deixou innerWidth em 1920 do
  // mesmo jeito. Em painel FHD a plane e travada em 720 e o 1920 e que nao vale. Como
  // nenhum dos dois valores serve para as duas TVs, o appinfo fica no padrao 1920x1080
  // e quem decide o tamanho do CSS e a deteccao de innerWidth em runtime (index.html).
  validateWebOsAppInfo(appInfo);
  await writeFile(appInfoPath, `${JSON.stringify(appInfo, null, 2)}\n`, "utf8");

  await Promise.all([
    validatePngDimensions(
      path.join(rootDir, "assets", "images", "icon.png"),
      80,
      80,
      "webOS small icon"
    ),
    validatePngDimensions(
      path.join(rootDir, "assets", "images", "largeIcon.png"),
      130,
      130,
      "webOS large icon"
    ),
    validateOpaquePng(path.join(rootDir, "assets", "images", "icon.png"), "webOS small icon"),
    validateOpaquePng(path.join(rootDir, "assets", "images", "largeIcon.png"), "webOS large icon"),
    validatePngDimensions(
      path.join(rootDir, "assets", "images", "splash.png"),
      1920,
      1080,
      "webOS splash image"
    ),
    cp(path.join(rootDir, "assets", "images", "icon.png"), path.join(appStageDir, "icon.png")),
    cp(
      path.join(rootDir, "assets", "images", "largeIcon.png"),
      path.join(appStageDir, "largeIcon.png")
    ),
    cp(path.join(rootDir, "assets", "images", "splash.png"), path.join(appStageDir, "splash.png"))
  ]);

  const webOsScriptPath = await resolveWebOsScriptPath(appStageDir);
  await writeFile(
    path.join(appStageDir, "index.html"),
    buildWebOsIndexHtml({ webOsScriptPath }),
    "utf8"
  );
}

async function stageService() {
  const packageJsonPath = path.join(webOsServiceSourceDir, "package.json");
  const servicesManifestPath = path.join(webOsServiceSourceDir, "services.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const servicesManifest = JSON.parse(await readFile(servicesManifestPath, "utf8"));
  validateWebOsServiceManifest(servicesManifest);

  await mkdir(path.join(serviceStageDir, "src"), { recursive: true });
  await mkdir(path.join(serviceStageDir, "runtime"), { recursive: true });

  await Promise.all([
    writeFile(
      path.join(serviceStageDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      path.join(serviceStageDir, "services.json"),
      `${JSON.stringify(servicesManifest, null, 2)}\n`,
      "utf8"
    ),
    buildWebOsMediaRuntime({
      sourcePath: path.join(webOsServiceSourceDir, "runtime", "media-http.cjs"),
      outputPath: path.join(serviceStageDir, "runtime", "media-http.cjs"),
      cacheDir: path.join(cacheDir, "webos-media-runtime")
    }).then(function reportMediaRuntime(result) {
      console.log(
        `media runtime transpiled to ES5 for Node ${compatibilityPolicy.webOsServiceNodeVersion}` +
          ` (${Math.round(result.bytes / 1024)} KB${result.cached ? ", cached" : ""})`
      );
    })
  ]);

  // The prelude installs the ES6+ builtins Node 0.12 lacks. It has to run
  // before any module body, and it patches globals, so the media runtime that
  // serverHost.js later loads through Module._compile inherits the same fixes.
  const preludeSource = await readFile(
    path.join(webOsServiceSourceDir, "src", "legacyNodePrelude.js"),
    "utf8"
  );

  await build({
    entryPoints: [path.join(webOsServiceSourceDir, "src", "index.js")],
    outfile: path.join(serviceStageDir, "src", "index.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: [compatibilityPolicy.webOsServiceSyntax.target],
    supported: { ...compatibilityPolicy.webOsServiceSyntax.supported },
    banner: { js: preludeSource },
    external: ["webos-service"],
    logLevel: "silent"
  });

  await assertServiceBundleIsLegacySafe(path.join(serviceStageDir, "src", "index.js"));
}

// Node 0.12 fails to *parse* ES6 syntax, so a regression here does not surface
// as a bad response — the whole service never registers and every Luna command
// times out. Fail the build instead.
async function assertServiceBundleIsLegacySafe(bundlePath) {
  const raw = await readFile(bundlePath, "utf8");
  // Comments are not code: prose about `Buffer.from` or an arrow in a diagram
  // would otherwise fail the build. This is a smoke test, not a parser.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
  const offenders = [
    ["arrow function", /=>/],
    ["const declaration", /(^|[^.\w])const\s/],
    ["let declaration", /(^|[^.\w])let\s/],
    ["class declaration", /(^|[^.\w])class\s+[A-Za-z_$]/],
    ["template literal", /`/]
  ].filter(([, pattern]) => pattern.test(source));

  if (offenders.length) {
    throw new Error(
      `webOS service bundle contains syntax Node ${compatibilityPolicy.webOsServiceNodeVersion} ` +
        `cannot parse: ${offenders.map(([name]) => name).join(", ")}.`
    );
  }
}

async function packageWebOs() {
  await syncVersionFiles();
  await assertDistExists();

  console.log("staging webOS package files...");
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await Promise.all([stageApp(), stageService()]);

  console.log("creating webOS IPK...");
  try {
    await runWebOsToolsBinary("ares-package", [appStageDir, serviceStageDir, "--outdir", rootDir]);
  } catch (error) {
    const { version } = await readAppMetadata();
    const expectedIpk = path.join(rootDir, `space.nuvio.webos_${version}_all.ipk`);
    if (await pathExists(expectedIpk)) {
      console.warn(
        `ares-package exited with an error, but ${expectedIpk} was created successfully. Continuing.`
      );
    } else {
      throw error;
    }
  }
}

/**
 * ares-package names the artifact from the appinfo id and version. A distributable
 * build wants a name a human can read in a downloads folder, so it is renamed
 * afterwards instead of by faking the app id.
 *
 * NUVIO_IPK_NAME overrides it. Note it changes the FILENAME only — appinfo.json
 * still declares the real version, which is what the TV installs and what the
 * in-app update check compares against.
 */
async function renameIpk() {
  const requested = String(process.env.NUVIO_IPK_NAME || "").trim();
  if (!requested) {
    return;
  }
  const { version } = await readAppMetadata();
  const source = path.join(rootDir, `space.nuvio.webos_${version}_all.ipk`);
  if (!(await pathExists(source))) {
    console.warn(`skipping rename: ${source} not found`);
    return;
  }
  const target = path.join(rootDir, requested.endsWith(".ipk") ? requested : `${requested}.ipk`);
  await rename(source, target);
  console.log(`IPK renomeado para: ${path.basename(target)}`);
}

try {
  await packageWebOs();
  await renameIpk();
} catch (error) {
  console.error("\nwebOS packaging failed:");
  console.error(error);
  process.exit(1);
}
