import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";
import { runWebOsToolsBinary } from "./aresCli.mjs";
import babel from "@babel/core";
import { buildWebOsMediaRuntime } from "./webosMediaRuntime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const cacheDir = path.join(rootDir, ".cache");
const stagingDir = path.join(cacheDir, "webos-package");
const appStageDir = path.join(stagingDir, "app");
const serviceStageDir = path.join(stagingDir, "space.nuvio.webos.service");
const pluginServiceStageDir = path.join(stagingDir, "space.nuvio.webos.plugin.service");

const appName = "Nuvio TV";
const webOsServiceId = "space.nuvio.webos.service";
const webOsPluginServiceId = "space.nuvio.webos.plugin.service";
const webOsServiceSourceDir = path.join(rootDir, "services", "webos");
const webOsPluginServiceSourceDir = path.join(rootDir, "services", "webos-plugin");
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

function validateWebOsServiceManifest(serviceManifest, expectedId = webOsServiceId) {
  if (String(serviceManifest?.id || "") !== expectedId) {
    throw new Error(`webOS services.json must use service id ${expectedId}.`);
  }

  const services = Array.isArray(serviceManifest?.services) ? serviceManifest.services : [];
  if (
    !services.length ||
    services.some(
      (service) =>
        !String(service?.name || "").startsWith(`${expectedId}.`) &&
        String(service?.name || "") !== expectedId
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

  return `<!DOCTYPE html>
<html lang="en" class="no-flex-gap no-css-grid no-css-math no-backdrop-filter no-aspect-ratio">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${appName}</title>
  <script src="assets/runtime/legacy-dom-shims.js"></script>
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/components.css" />
</head>
<body>
  <script src="boot-guard.js"></script>
  <script src="core-js.bundle.js" onerror="window.NuvioBootGuard &amp;&amp; window.NuvioBootGuard.scriptFailed(this.src)"></script>
  <script>window.__NUVIO_PLATFORM__ = "webos";</script>
  <script>window.__NUVIO_WEBOS_PLUGIN_SERVICE_ENABLED__ = true; window.__NUVIO_WEBOS_PLUGIN_SERVICE_ID__ = "${webOsPluginServiceId}";</script>
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
  appInfo.services = [webOsServiceId, webOsPluginServiceId];
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

async function stagePluginService() {
  const packageJsonPath = path.join(webOsPluginServiceSourceDir, "package.json");
  const servicesManifestPath = path.join(webOsPluginServiceSourceDir, "services.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const servicesManifest = JSON.parse(await readFile(servicesManifestPath, "utf8"));
  validateWebOsServiceManifest(servicesManifest, webOsPluginServiceId);

  await mkdir(path.join(pluginServiceStageDir, "src"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(pluginServiceStageDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      path.join(pluginServiceStageDir, "services.json"),
      `${JSON.stringify(servicesManifest, null, 2)}\n`,
      "utf8"
    )
  ]);

  // Same treatment as stageService, and for the same reason. Upstream targets
  // `node0.12` here, which reads correctly but is the wrong knob: esbuild has no
  // lowering path for that target and simply refuses, so packaging died with
  // "Transforming destructuring to the configured target environment
  // (node0.12) is not supported yet" on services/plugin-http.cjs. The explicit
  // es2015 + feature-map combination is what actually produces ES5, and the
  // prelude supplies the builtins V8 3.28 lacks.
  const preludeSource = await readFile(
    path.join(webOsServiceSourceDir, "src", "legacyNodePrelude.js"),
    "utf8"
  );

  // esbuild is asked only to BUNDLE here, at a permissive target. It refuses to
  // lower services/plugin-http.cjs to ES5 — the destructuring and default
  // arguments at plugin-http.cjs:434 fail with "not supported yet" under both
  // `node0.12` and `es2015 + overrides`, exactly as the EngineFS runtime did.
  // Babel does the actual lowering afterwards, which is the same division of
  // labour scripts/webosMediaRuntime.mjs settled on.
  const pluginServiceOut = path.join(pluginServiceStageDir, "src", "index.js");
  await build({
    entryPoints: [path.join(webOsPluginServiceSourceDir, "src", "index.js")],
    outfile: pluginServiceOut,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["es2018"],
    external: ["webos-service"],
    logLevel: "silent"
  });

  const bundled = await readFile(pluginServiceOut, "utf8");
  const lowered = await babel.transformAsync(bundled, {
    filename: "webos-plugin-service.js",
    sourceType: "script",
    babelrc: false,
    configFile: false,
    compact: true,
    comments: false,
    generatorOpts: { compact: true },
    presets: [
      [
        "@babel/preset-env",
        {
          targets: { node: compatibilityPolicy.webOsServiceNodeVersion },
          bugfixes: true,
          exclude: ["transform-typeof-symbol"],
          modules: false
        }
      ]
    ]
  });
  await writeFile(pluginServiceOut, `${preludeSource}\n${lowered.code}`, "utf8");

  // Node 0.12 fails to PARSE ES6, so a regression here does not surface as a bad
  // response — the plugin service never registers and every plugin call times
  // out. Fail the build instead.
  await assertServiceBundleIsLegacySafe(pluginServiceOut);
}

async function stagePluginService() {
  const packageJsonPath = path.join(webOsPluginServiceSourceDir, "package.json");
  const servicesManifestPath = path.join(webOsPluginServiceSourceDir, "services.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const servicesManifest = JSON.parse(await readFile(servicesManifestPath, "utf8"));
  validateWebOsServiceManifest(servicesManifest, webOsPluginServiceId);

  await mkdir(path.join(pluginServiceStageDir, "src"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(pluginServiceStageDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      path.join(pluginServiceStageDir, "services.json"),
      `${JSON.stringify(servicesManifest, null, 2)}\n`,
      "utf8"
    )
  ]);

  await build({
    entryPoints: [path.join(webOsPluginServiceSourceDir, "src", "index.js")],
    outfile: path.join(pluginServiceStageDir, "src", "index.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: [`node${compatibilityPolicy.webOsServiceNodeVersion}`],
    external: ["webos-service"],
    logLevel: "silent"
  });
}

async function packageWebOs() {
  await syncVersionFiles();
  await assertDistExists();

  console.log("staging webOS package files...");
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await Promise.all([stageApp(), stageService(), stagePluginService()]);

  console.log("creating webOS IPK...");
  try {
    await runWebOsToolsBinary("ares-package", [
      appStageDir,
      serviceStageDir,
      pluginServiceStageDir,
      "--outdir",
      rootDir
    ]);
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
