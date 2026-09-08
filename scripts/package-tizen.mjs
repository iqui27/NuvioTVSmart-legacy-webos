import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";
import { compatibilityPolicy } from "./compatibilityPolicy.mjs";
import { writeRuntimeEnvScriptFile } from "./envProperties.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const cacheDir = path.join(rootDir, ".cache");
const stagingDir = path.join(cacheDir, "tizen-package");
const signedOutputDir = path.join(cacheDir, "tizen-signed-output");
const requireConfiguredRuntimeEnv = /^(1|true|yes|on)$/i.test(
  String(process.env.NUVIO_REQUIRE_LOCAL_PROPERTIES || "")
);

const appName = "Nuvio TV";
const defaultTizenPackageId = "NuvioTV001";
const defaultTizenAppId = "NuvioTV001.NuvioTV";
const defaultWidgetUri = "https://nuvio.tv";
const tizenEngineFsServiceRelativePath = "services/tizen/enginefs-service.js";
const tizenEngineFsRuntimeDirRelativePath = "services/tizen/runtime";
const tizenPluginServiceRelativePath = "services/tizen/plugin-service.js";
const tizenPluginServiceSupportRelativePath = "services/plugin-http.cjs";

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function normalizeVersion(version) {
  const parts = String(version || "0.0.0")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => String(Number.parseInt(part, 10) || 0));
  while (parts.length < 3) {
    parts.push("0");
  }
  return parts.slice(0, 3).join(".");
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Pedacos de tela carregados sob demanda, emitidos por scripts/build.mjs. Quem
// os busca em runtime e js/runtime/loadScreenChunks.js, entao NADA no index.html
// os referencia — se faltarem, o empacotamento passa e o defeito so aparece na
// TV como uma tela que nunca abre ("Could not open this screen. Try again").
// Foi exatamente o que aconteceu: o code splitting entrou depois deste script e
// o pacote Tizen saiu sem player.chunk.js, entao o video nao reproduzia numa
// Samsung enquanto o mesmo build funcionava no webOS. Listados aqui para o
// empacotamento FALHAR em vez de entregar um pacote incompleto.
const screenChunkFiles = ["player.chunk.js"];

async function assertDistExists() {
  try {
    await access(path.join(distDir, "app.bundle.js"), fsConstants.R_OK);
    for (const chunkFile of screenChunkFiles) {
      await access(path.join(distDir, chunkFile), fsConstants.R_OK);
    }
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }
}

function buildConfigXml({
  appId,
  packageId,
  version,
  includeEngineFsService,
  includePluginService,
  serviceMetadataXml = ""
}) {
  const engineFsServiceId = `${packageId}.EngineFsService`;
  const pluginServiceId = `${packageId}.PluginService`;
  const hasLocalService = includeEngineFsService || includePluginService;
  const serviceFeature = hasLocalService
    ? '  <feature name="http://tizen.org/feature/web.service"/>\n'
    : "";
  const applicationLaunchPrivilege = hasLocalService
    ? '  <tizen:privilege name="http://tizen.org/privilege/application.launch"/>\n'
    : "";
  const serviceMetadata = serviceMetadataXml ? `\n    ${serviceMetadataXml}` : "";
  const engineFsService = includeEngineFsService
    ? `  <tizen:service id="${engineFsServiceId}" type="ui" auto-restart="false" on-boot="false">
    <tizen:content src="${tizenEngineFsServiceRelativePath}"/>${serviceMetadata}
    <tizen:name>Nuvio EngineFS Service</tizen:name>
    <tizen:icon src="icon.png"/>
    <tizen:description>Local torrent streaming service for Nuvio Tizen playback</tizen:description>
    <tizen:category name="http://tizen.org/category/service"/>
  </tizen:service>
`
    : "";
  const pluginService = includePluginService
    ? `  <tizen:service id="${pluginServiceId}" type="ui" auto-restart="false" on-boot="false">
    <tizen:content src="${tizenPluginServiceRelativePath}"/>
    <tizen:name>Nuvio Plugin Network Service</tizen:name>
    <tizen:icon src="icon.png"/>
    <tizen:description>Bounded network service for Nuvio JavaScript plugins</tizen:description>
    <tizen:category name="http://tizen.org/category/service"/>
  </tizen:service>
`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns:tizen="http://tizen.org/ns/widgets" xmlns="http://www.w3.org/ns/widgets" id="${defaultWidgetUri}" version="${version}" viewmodes="maximized">
  <access origin="*" subdomains="true"/>
  <tizen:application id="${appId}" package="${packageId}" required_version="${compatibilityPolicy.tizenRequiredVersion}"/>
  <author href="${defaultWidgetUri}">Nuvio</author>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
${serviceFeature}  <icon src="icon.png"/>
  <name>${appName}</name>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
${applicationLaunchPrivilege}  <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
${engineFsService}${pluginService}  <tizen:profile name="tv-samsung"/>
  <tizen:setting screen-orientation="landscape" context-menu="enable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`;
}

/*
 * EngineFS is part of the supported TV application, including the Store
 * package. Do not silently publish a Store build without the local service:
 * that would make P2P disappear from otherwise capable Tizen TVs.
 *
 * Optional service metadata is still accepted for a Seller Office request,
 * but it is never invented or required by this package script.
 */
function validateStoreServiceOptions({
  includeEngineFsService,
  includePluginService,
  storeBuild,
  serviceMetadataXml
}) {
  if (storeBuild && !includeEngineFsService) {
    throw new Error(
      "Tizen Store packaging must include the local EngineFS service so supported TVs retain torrent/P2P playback. " +
        "Remove --no-enginefs-service and do not set TIZEN_INCLUDE_ENGINEFS_SERVICE=false."
    );
  }

  if (storeBuild && !includePluginService) {
    throw new Error(
      "Tizen Store packaging must include the local Plugin Network service so JS plugins fail closed only on unsupported TVs. " +
        "Remove --no-plugin-service and do not set TIZEN_INCLUDE_PLUGIN_SERVICE=false."
    );
  }

  if (serviceMetadataXml && !/^<tizen:metadata\b[\s\S]*\/>$/.test(serviceMetadataXml)) {
    throw new Error(
      "TIZEN_SERVICE_METADATA_XML must contain one self-closing <tizen:metadata .../> element."
    );
  }
}

function buildIndexHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="no-flex-gap no-css-grid no-css-math no-backdrop-filter no-aspect-ratio">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${appName}</title>
  <script src="$WEBAPIS/webapis/webapis.js"></script>
  <script src="assets/runtime/legacy-features.js"></script>
  <script src="assets/runtime/legacy-dom-shims.js"></script>
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/layout.css" />
  <link rel="stylesheet" href="css/components.css" />
  <link rel="stylesheet" href="css/themes.css" />
</head>
<body>
  <script src="boot-guard.js"></script>
  <script src="core-js.bundle.js" onerror="window.NuvioBootGuard &amp;&amp; window.NuvioBootGuard.scriptFailed(this.src)"></script>
  <script defer src="main.js" onerror="window.NuvioBootGuard &amp;&amp; window.NuvioBootGuard.scriptFailed(this.src)"></script>
</body>
</html>
`;
}

function buildMainJs({ packageId, includeEngineFsService, includePluginService }) {
  const engineFsServiceId = `${packageId}.EngineFsService`;
  const pluginServiceId = `${packageId}.PluginService`;
  const configuredServiceId = includeEngineFsService ? engineFsServiceId : "";
  const configuredPluginServiceId = includePluginService ? pluginServiceId : "";
  const compatibilityOptions = JSON.stringify({
    platform: "tizen",
    minVersion: Number.parseInt(compatibilityPolicy.tizenRequiredVersion, 10),
    minChrome: compatibilityPolicy.chromiumVersion,
    requiredLabel: `Samsung Tizen ${compatibilityPolicy.tizenRequiredVersion}+ · Chromium ${compatibilityPolicy.chromiumVersion}+ (${compatibilityPolicy.tizenSupportYear}+)`
  });
  return `window.__NUVIO_PLATFORM__ = "tizen";
window.__NUVIO_TIZEN_ENGINEFS_SERVICE_ENABLED__ = ${includeEngineFsService};
window.__NUVIO_TIZEN_ENGINEFS_SERVICE_ID__ = ${JSON.stringify(configuredServiceId)};
window.__NUVIO_TIZEN_PLUGIN_SERVICE_ENABLED__ = ${includePluginService};
window.__NUVIO_TIZEN_PLUGIN_SERVICE_ID__ = ${JSON.stringify(configuredPluginServiceId)};

var tvInput = window.tizen && window.tizen.tvinputdevice;
if (tvInput && typeof tvInput.registerKey === "function") {
  [
    "Back",
    "Return",
    "MediaPlay",
    "MediaPause",
    "MediaPlayPause",
    "MediaStop",
    "MediaFastForward",
    "MediaRewind",
    "MediaTrackPrevious",
    "MediaTrackNext"
  ].forEach(function registerKey(keyName) {
    try {
      tvInput.registerKey(keyName);
    } catch (_) {}
  });
}

function loadScript(src) {
  var script = document.createElement("script");
  script.async = false;
  script.src = src;
  script.defer = false;
  script.onerror = function handleStartupScriptError() {
    if (window.NuvioBootGuard) {
      window.NuvioBootGuard.scriptFailed(src);
    }
  };
  if (window.NuvioBootGuard) {
    window.NuvioBootGuard.stage("Loading " + src);
  }
  document.body.appendChild(script);
}

function startNuvioApp() {
  loadScript("nuvio.env.js");
  loadScript("assets/libs/qrcode-generator.js");
  loadScript("app.bundle.js");
}

if (window.NuvioBootGuard && typeof window.NuvioBootGuard.runCompatibilityGate === "function") {
  window.NuvioBootGuard.runCompatibilityGate(${compatibilityOptions}, startNuvioApp);
} else {
  startNuvioApp();
}
`;
}

async function stageTizenEngineFsService() {
  const serviceDir = path.join(stagingDir, "services", "tizen");
  await mkdir(serviceDir, { recursive: true });
  await Promise.all([
    cp(
      path.join(rootDir, "services", "tizen", "enginefs-service.js"),
      path.join(stagingDir, tizenEngineFsServiceRelativePath)
    ),
    cp(
      path.join(rootDir, "services", "tizen", "runtime"),
      path.join(stagingDir, tizenEngineFsRuntimeDirRelativePath),
      { recursive: true }
    )
  ]);
  // The source runtime keeps a small alias so it can be tested in-place. A
  // Tizen package must contain the actual parser because the webOS source tree
  // is not part of the WGT.
  await cp(
    path.join(rootDir, "services", "webos", "src", "bitmapSubtitles.js"),
    path.join(
      stagingDir,
      `${tizenEngineFsRuntimeDirRelativePath}/embedded-text-subtitle-parser.cjs`
    )
  );
}

async function stageTizenPluginService() {
  await Promise.all([
    cp(
      path.join(rootDir, tizenPluginServiceRelativePath),
      path.join(stagingDir, tizenPluginServiceRelativePath)
    ),
    cp(
      path.join(rootDir, "services", "plugin-http.cjs"),
      path.join(stagingDir, tizenPluginServiceSupportRelativePath)
    )
  ]);
}

async function copyDistFolder(folderName) {
  const source = path.join(distDir, folderName);
  if (!(await pathExists(source))) {
    return;
  }
  await cp(source, path.join(stagingDir, folderName), { recursive: true });
}

async function stagePackage({
  appId,
  packageId,
  version,
  envSourcePath,
  includeEngineFsService,
  includePluginService,
  serviceMetadataXml
}) {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  await Promise.all([
    copyDistFolder("assets"),
    copyDistFolder("css"),
    copyDistFolder("res"),
    cp(path.join(distDir, "app.bundle.js"), path.join(stagingDir, "app.bundle.js")),
    ...screenChunkFiles.map((chunkFile) =>
      cp(path.join(distDir, chunkFile), path.join(stagingDir, chunkFile))
    ),
    cp(path.join(distDir, "core-js.bundle.js"), path.join(stagingDir, "core-js.bundle.js")),
    cp(path.join(distDir, "boot-guard.js"), path.join(stagingDir, "boot-guard.js")),
    cp(path.join(distDir, "youtube-proxy.html"), path.join(stagingDir, "youtube-proxy.html")),
    cp(path.join(rootDir, "assets", "images", "tizenIcon.png"), path.join(stagingDir, "icon.png")),
    writeFile(
      path.join(stagingDir, "config.xml"),
      buildConfigXml({
        appId,
        packageId,
        version,
        includeEngineFsService,
        includePluginService,
        serviceMetadataXml
      }),
      "utf8"
    ),
    writeFile(path.join(stagingDir, "index.html"), buildIndexHtml(), "utf8"),
    writeFile(
      path.join(stagingDir, "main.js"),
      buildMainJs({ packageId, includeEngineFsService, includePluginService }),
      "utf8"
    )
  ]);
  if (includeEngineFsService) {
    await stageTizenEngineFsService();
  }
  if (includePluginService) {
    await stageTizenPluginService();
  }

  if (envSourcePath) {
    await writeRuntimeEnvScriptFile(path.join(stagingDir, "nuvio.env.js"), {
      rootDir,
      sourcePath: envSourcePath
    });
  } else {
    await cp(path.join(distDir, "nuvio.env.js"), path.join(stagingDir, "nuvio.env.js"));
  }

  if (await pathExists(path.join(distDir, "app.bundle.js.map"))) {
    await cp(path.join(distDir, "app.bundle.js.map"), path.join(stagingDir, "app.bundle.js.map"));
  }
}

async function addDirectoryToZip(zip, dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, fullPath, baseDir);
    } else if (entry.isFile()) {
      zip.file(relativePath, await readFile(fullPath));
    }
  }
}

function parseArgs(argv) {
  const storeBuild = isTruthy(process.env.TIZEN_STORE_BUILD);
  const configuredIncludeService = process.env.TIZEN_INCLUDE_ENGINEFS_SERVICE;
  const configuredIncludePluginService = process.env.TIZEN_INCLUDE_PLUGIN_SERVICE;
  const options = {
    outDir: rootDir,
    appId: process.env.TIZEN_APP_ID || defaultTizenAppId,
    packageId: process.env.TIZEN_PACKAGE_ID || defaultTizenPackageId,
    envSourcePath: process.env.TIZEN_ENV_SOURCE || "",
    storeBuild,
    includeEngineFsService:
      configuredIncludeService == null ? true : isTruthy(configuredIncludeService),
    includePluginService:
      configuredIncludePluginService == null ? true : isTruthy(configuredIncludePluginService),
    signingProfile: process.env.TIZEN_SECURITY_PROFILE || "",
    tizenCli: process.env.TIZEN_CLI || "tizen",
    serviceMetadataXml: String(process.env.TIZEN_SERVICE_METADATA_XML || "").trim()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--outdir") {
      options.outDir = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--app-id") {
      options.appId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--package-id") {
      options.packageId = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--env-source") {
      options.envSourcePath = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--store") {
      options.storeBuild = true;
    } else if (arg === "--include-enginefs-service") {
      options.includeEngineFsService = true;
    } else if (arg === "--no-enginefs-service") {
      options.includeEngineFsService = false;
    } else if (arg === "--include-plugin-service") {
      options.includePluginService = true;
    } else if (arg === "--no-plugin-service") {
      options.includePluginService = false;
    } else if (arg === "--sign-profile") {
      options.signingProfile = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--tizen-cli") {
      options.tizenCli = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--service-metadata") {
      options.serviceMetadataXml = String(argv[index + 1] || "").trim();
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.appId || !options.packageId) {
    throw new Error("Tizen app id and package id are required.");
  }

  if (options.storeBuild && !options.signingProfile) {
    throw new Error(
      "Tizen Store packaging requires an official Tizen security profile. " +
        "Provide TIZEN_SECURITY_PROFILE or --sign-profile."
    );
  }

  validateStoreServiceOptions(options);

  return options;
}

function runCommand(command, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Tizen CLI not found at "${command}". Install Tizen Studio/Web CLI on the packaging runner or set TIZEN_CLI to its executable path.`
          )
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const details = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      reject(new Error(`Tizen CLI package command failed with exit code ${code}. ${details}`));
    });
  });
}

async function findWgtFiles(directory) {
  if (!(await pathExists(directory))) {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".wgt"))
    .map((entry) => path.join(directory, entry.name));
}

async function assertSignedTizenPackage(
  outputPath,
  { requireEngineFsService = false, requirePluginService = false } = {}
) {
  const zip = await JSZip.loadAsync(await readFile(outputPath));
  const requiredFiles = ["config.xml", "author-signature.xml", "signature1.xml"];
  for (const fileName of requiredFiles) {
    const entry = zip.file(fileName);
    if (!entry) {
      throw new Error(`Signed Tizen WGT is missing required ${fileName}.`);
    }
  }

  const configXml = await zip.file("config.xml").async("string");
  if (/auto-restart\s*=\s*["']true["']/i.test(configXml)) {
    throw new Error(
      'Tizen WGT contains auto-restart="true", which is not allowed for Store submission.'
    );
  }
  if (/on-boot\s*=\s*["']true["']/i.test(configXml)) {
    throw new Error(
      'Tizen WGT contains on-boot="true", which is not allowed for Store submission.'
    );
  }

  if (requireEngineFsService) {
    const requiredServiceEntries = [
      tizenEngineFsServiceRelativePath,
      `${tizenEngineFsRuntimeDirRelativePath}/media-http.cjs`,
      `${tizenEngineFsRuntimeDirRelativePath}/tx3g-subtitle-parser.cjs`,
      `${tizenEngineFsRuntimeDirRelativePath}/tx3g-subtitle-service.cjs`,
      `${tizenEngineFsRuntimeDirRelativePath}/embedded-text-subtitle-parser.cjs`
    ];
    const missingServiceEntry = requiredServiceEntries.find((fileName) => !zip.file(fileName));
    if (missingServiceEntry) {
      throw new Error(
        `Store Tizen WGT is missing the EngineFS service file ${missingServiceEntry}.`
      );
    }
    const missingManifestEntry = [
      /<feature\s+name=["']http:\/\/tizen\.org\/feature\/web\.service["']/i,
      /<tizen:privilege\s+name=["']http:\/\/tizen\.org\/privilege\/application\.launch["']/i,
      /<tizen:service\b[\s\S]*?<tizen:content\s+src=["']services\/tizen\/enginefs-service\.js["']/i
    ].find((pattern) => !pattern.test(configXml));
    if (missingManifestEntry) {
      throw new Error(
        "Store Tizen WGT is missing the manifest entries required for the local EngineFS service."
      );
    }
  }
  if (requirePluginService) {
    const requiredServiceEntries = [
      tizenPluginServiceRelativePath,
      tizenPluginServiceSupportRelativePath
    ];
    const missingServiceEntry = requiredServiceEntries.find((fileName) => !zip.file(fileName));
    if (missingServiceEntry) {
      throw new Error(`Store Tizen WGT is missing the Plugin service file ${missingServiceEntry}.`);
    }
    const missingManifestEntry = [
      /<tizen:service\b[\s\S]*?<tizen:content\s+src=["']services\/tizen\/plugin-service\.js["']/i,
      /<tizen:privilege\s+name=["']http:\/\/tizen\.org\/privilege\/application\.launch["']/i
    ].find((pattern) => !pattern.test(configXml));
    if (missingManifestEntry) {
      throw new Error(
        "Store Tizen WGT is missing the manifest entries required for the Plugin service."
      );
    }
  }
}

async function packageWithOfficialTizenCli({
  outputPath,
  signingProfile,
  tizenCli,
  requireEngineFsService,
  requirePluginService
}) {
  await rm(signedOutputDir, { recursive: true, force: true });
  await mkdir(signedOutputDir, { recursive: true });
  await runCommand(tizenCli, ["package", "-t", "wgt", "-s", signingProfile, "--", stagingDir], {
    cwd: signedOutputDir
  });

  const candidates = [
    ...(await findWgtFiles(signedOutputDir)),
    ...(await findWgtFiles(stagingDir))
  ];
  if (candidates.length === 0) {
    throw new Error(
      `Tizen CLI completed without producing a WGT in ${signedOutputDir}. Check the installed CLI version and security profile.`
    );
  }

  const [signedPackagePath] = candidates;
  await cp(signedPackagePath, outputPath);
  await assertSignedTizenPackage(outputPath, { requireEngineFsService, requirePluginService });
}

async function packageTizen() {
  const options = parseArgs(process.argv.slice(2));
  if (requireConfiguredRuntimeEnv && !options.envSourcePath) {
    options.envSourcePath = path.join(rootDir, "local.properties");
  }
  if (requireConfiguredRuntimeEnv && !(await pathExists(options.envSourcePath))) {
    throw new Error(
      "Configured runtime env is required for Tizen packaging. Provide local.properties or --env-source."
    );
  }

  await syncVersionFiles();
  await assertDistExists();

  const { version: rawVersion } = await readAppMetadata();
  const version = normalizeVersion(rawVersion);
  await stagePackage({ ...options, version });

  await mkdir(options.outDir, { recursive: true });
  const outputPath = path.join(options.outDir, `${options.packageId}_${version}.wgt`);
  await rm(outputPath, { force: true });

  if (options.storeBuild) {
    await packageWithOfficialTizenCli({
      outputPath,
      signingProfile: options.signingProfile,
      tizenCli: options.tizenCli,
      requireEngineFsService: options.storeBuild,
      requirePluginService: options.storeBuild
    });
  } else {
    const zip = new JSZip();
    await addDirectoryToZip(zip, stagingDir);
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE"
    });
    await writeFile(outputPath, buffer);
  }

  console.log(`Tizen WGT created: ${outputPath}`);
  console.log(`Tizen application id: ${options.appId}`);
  console.log(`Tizen package id: ${options.packageId}`);
  console.log(
    `Tizen package profile: ${options.storeBuild ? "official Store-signed" : "development (unsigned)"}`
  );
  console.log(`Tizen EngineFS service packaged: ${options.includeEngineFsService ? "yes" : "no"}`);
  console.log(`Tizen Plugin service packaged: ${options.includePluginService ? "yes" : "no"}`);
  console.log(
    `Runtime env bundled from: ${options.envSourcePath || path.join(distDir, "nuvio.env.js")}`
  );
}

try {
  await packageTizen();
} catch (error) {
  console.error("\nTizen packaging failed:");
  console.error(error);
  process.exit(1);
}
