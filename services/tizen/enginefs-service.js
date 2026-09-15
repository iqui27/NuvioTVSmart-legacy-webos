/* global module, require, process */
"use strict";

var SERVICE_TAG = "[Nuvio Tizen EngineFS]";
var started = false;

function log() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(SERVICE_TAG);
  console.log.apply(console, args);
}

function warn() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift(SERVICE_TAG);
  console.warn.apply(console, args);
}

function patchTizenMediaRuntimeCode(code, filename) {
  var source = String(code || "");
  if (!/media-http\.cjs$/i.test(String(filename || ""))) {
    return source;
  }

  // The app-side proxy URL builder encodes each header value once before
  // placing it in the route. The vendored EngineFS HLS rewriter serializes
  // those propagated headers again for every child URL, so normalize one
  // existing URI-encoding layer before serializing them or Referer/Origin
  // values accumulate an extra layer on cross-host requests.
  // The same runtime also concatenates url.parse(...).search while rewriting
  // absolute media URLs. Node's legacy parser returns null for a URL without
  // a query string, so that concatenation produces a literal `null` suffix
  // (for example, `segment.tsnull`) and sends malformed HLS segment URLs.
  if (
    source.indexOf("function encodeProxyHeaderString(") >= 0 &&
    source.indexOf("decodeURIComponent(parsed[1])") >= 0 &&
    source.indexOf('lineUrl.pathname+(lineUrl.search||"")') >= 0 &&
    source.indexOf('urlJoin([virtualRoot,lineUrl.pathname])+(lineUrl.search||"")') >= 0
  ) {
    return source;
  }

  var helperTarget =
    'function parseHeaderString(headerString){var headerArray=headerString.split(":");return[headerArray.shift(),headerArray.join(":")]}function urlJoin(segments){';
  var childTarget = '"/proxy/"+querystring.stringify(newOpts)+lineUrl.pathname+lineUrl.search';
  var sameHostTarget = "urlJoin([virtualRoot,lineUrl.pathname])+lineUrl.search";
  var rootTarget =
    '"/"+querystring.stringify(opts);result.body.pipe(getParserStream(virtualRoot,dest))';
  var targetCount = [helperTarget, childTarget, sameHostTarget, rootTarget].filter(
    function (target) {
      return source.indexOf(target) >= 0;
    }
  ).length;

  // A future vendored runtime may already contain an equivalent fix. Fail
  // fast only if a known vulnerable layout was changed partially.
  if (targetCount === 0) {
    return source;
  }
  if (targetCount !== 4) {
    throw new Error("Unsupported Tizen media runtime proxy layout: " + filename);
  }

  var helperReplacement =
    'function parseHeaderString(headerString){var headerArray=headerString.split(":");return[headerArray.shift(),headerArray.join(":")]}function encodeProxyHeaderString(headerString){var parsed=parseHeaderString(headerString);try{parsed[1]=decodeURIComponent(parsed[1])}catch(_){ }return parsed[0]+":"+encodeURIComponent(parsed[1])}function stringifyProxyOptions(options,cfgOpts){var serialized=Object.assign({},options);serialized[cfgOpts.DestinationHeader]=ensureArray(serialized[cfgOpts.DestinationHeader]).map(encodeProxyHeaderString);return querystring.stringify(serialized)}function urlJoin(segments){';
  source = source.replace(helperTarget, helperReplacement);
  source = source.replace(
    childTarget,
    '"/proxy/"+stringifyProxyOptions(newOpts,cfgOpts)+lineUrl.pathname+(lineUrl.search||"")'
  );
  source = source.replace(
    sameHostTarget,
    'urlJoin([virtualRoot,lineUrl.pathname])+(lineUrl.search||"")'
  );
  source = source.replace(
    rootTarget,
    '"/"+stringifyProxyOptions(opts,cfgOpts);result.body.pipe(getParserStream(virtualRoot,dest))'
  );

  return source;
}

function loadTizenMediaRuntime() {
  // Tizen's Web Service runtime exposes CommonJS, but older firmware builds
  // may not expose Node's Module loader helpers. Keep the original require()
  // path as a compatibility fallback for those runtimes.
  var runtimeFs;
  var runtimePath;
  var RuntimeModule;
  try {
    runtimeFs = require("fs");
    runtimePath = require("path");
    RuntimeModule = require("module");
  } catch (_) {
    return require("./runtime/media-http.cjs");
  }

  if (
    !runtimeFs ||
    typeof runtimeFs.readFileSync !== "function" ||
    !runtimePath ||
    typeof runtimePath.join !== "function" ||
    !RuntimeModule ||
    typeof RuntimeModule !== "function" ||
    typeof RuntimeModule._nodeModulePaths !== "function"
  ) {
    return require("./runtime/media-http.cjs");
  }

  var filename = runtimePath.join(__dirname, "runtime", "media-http.cjs");
  var source = runtimeFs.readFileSync(filename, "utf8");
  var mod = new RuntimeModule(filename, module);
  mod.filename = filename;
  mod.paths = RuntimeModule._nodeModulePaths(runtimePath.dirname(filename));
  mod._compile(patchTizenMediaRuntimeCode(source, filename), filename);
  return mod.exports;
}

function probeNodeRuntime() {
  var requiredModules = [
    "fs",
    "http",
    "net",
    "dgram",
    "stream",
    "events",
    "path",
    "url",
    "crypto",
    "buffer"
  ];
  var missing = [];
  requiredModules.forEach(function (moduleName) {
    try {
      require(moduleName);
    } catch (error) {
      missing.push(moduleName + ": " + (error && error.message ? error.message : String(error)));
    }
  });
  if (missing.length) {
    throw new Error("Missing Node-compatible modules: " + missing.join("; "));
  }

  var http = require("http");
  var net = require("net");
  var dgram = require("dgram");
  if (typeof http.createServer !== "function") {
    throw new Error("http.createServer is unavailable");
  }
  if (typeof net.createServer !== "function") {
    throw new Error("net.createServer is unavailable");
  }
  if (typeof dgram.createSocket !== "function") {
    throw new Error("dgram.createSocket is unavailable");
  }
}

function configureRuntimeEnv() {
  process.argv = Array.isArray(process.argv)
    ? process.argv
    : ["nuvio-enginefs-service", "runtime/media-http.cjs"];
  process.env = process.env || {};
  if (!process.env.HOME) {
    try {
      process.env.HOME = process.cwd ? process.cwd() : ".";
    } catch (_) {
      process.env.HOME = ".";
    }
  }
  try {
    if (!process.execPath) {
      process.execPath = process.env.HOME;
    }
  } catch (_) {
    // Some runtimes may expose process.execPath as read-only.
  }
  process.env.PORT = process.env.PORT || "2710";
  process.env.NO_CORS = "1";
  process.env.NO_HTTPS_SERVER = "1";
  process.env.HLS_V2_DISABLED = "1";
  process.env.CASTING_DISABLED = "1";
  process.env.LOCAL_ADDON_DISABLED = "1";
  process.env.NO_NETWORK_INTERFACES = process.env.NO_NETWORK_INTERFACES || "";
}

function startEngineFsRuntime() {
  if (started) {
    log("start ignored; runtime already requested");
    return;
  }
  probeNodeRuntime();
  configureRuntimeEnv();
  started = true;
  loadTizenMediaRuntime();
  diagnostic("EngineFS runtime module loaded", { port: process.env.PORT });
  // AVPlay can expose text tracks without rendering them. Keep the fallback
  // extractors beside the existing runtime so Tizen 4+ devices with the
  // packaged web service can render supported timed text through the app HTML
  // overlay. Devices that cannot start the service retain native fallback.
  require("./runtime/tx3g-subtitle-service.cjs").start();
}

function requestRemoveAll() {
  try {
    var http = require("http");
    var port = Number(process.env.PORT || 2710) || 2710;
    http
      .get("http://127.0.0.1:" + port + "/removeAll", function (response) {
        response.resume();
      })
      .on("error", function () {});
  } catch (_) {
    // Service shutdown cleanup is best-effort.
  }
}

module.exports.onStart = function () {
  try {
    startEngineFsRuntime();
  } catch (error) {
    started = false;
    warn("local EngineFS runtime failed to start", error && error.stack ? error.stack : error);
  }
};

function stopEngineFsRuntime() {
  log("stopping local EngineFS runtime");
  try {
    require("./runtime/tx3g-subtitle-service.cjs").stop();
  } catch (_) {}
  requestRemoveAll();
}

// onExit is the documented Tizen Web Service lifecycle callback. Keep onStop
// as a harmless compatibility alias for older service runtimes.
module.exports.onExit = stopEngineFsRuntime;
module.exports.onStop = stopEngineFsRuntime;
