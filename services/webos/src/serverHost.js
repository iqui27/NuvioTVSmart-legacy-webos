var fs = require("fs");
var http = require("http");
var path = require("path");
var Module = require("module");
var createImageProxyHandler = require("./imageProxy").createImageProxyHandler;
var createSupabaseProxyHandler = require("./supabaseProxy").createSupabaseProxyHandler;

var SERVICE_ID = "space.nuvio.webos.service";
var PORT_CANDIDATES = require("./constants").PORT_CANDIDATES;
var REQUEST_TIMEOUT_MS = 5000;

function patchWebOsMediaRuntimeCode(code, filename) {
  var source = String(code || "");
  if (!/media-http\.cjs$/i.test(String(filename || ""))) {
    return source;
  }

  // The vendored proxy always passes an https.Agent to node-fetch. node-fetch
  // rejects that agent for http:// destinations, so an otherwise reachable
  // HTTP stream is returned as a generic proxy 500. Keep the custom agent for
  // HTTPS and let node-fetch select its normal HTTP agent for HTTP URLs.
  var proxyAgentTarget = 'agent:httpsAgent,redirect:"manual"';
  var proxyAgentReplacement = 'agent:"https:"===dest.protocol?httpsAgent:null,redirect:"manual"';
  if (source.indexOf(proxyAgentReplacement) < 0 && source.indexOf(proxyAgentTarget) >= 0) {
    source = source.replace(proxyAgentTarget, proxyAgentReplacement);
  }

  // The app-side proxy URL builder encodes each header value once before
  // placing it in the route. The vendored EngineFS HLS rewriter serializes
  // those propagated headers again for every child URL, so normalize one
  // existing URI-encoding layer before serializing them or Referer/Origin
  // values accumulate an extra layer on cross-host requests. Keep this
  // compatibility patch at the webOS bootstrap boundary because the runtime
  // is a generated third-party bundle, not source maintained here.
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
  var targetCount = [helperTarget, childTarget, rootTarget].filter(function (target) {
    return source.indexOf(target) >= 0;
  }).length;

  // Allow a future vendored runtime that already contains an equivalent fix,
  // but fail fast if only part of the known vulnerable shape changed.
  if (targetCount === 0) {
    return source;
  }
  if (targetCount !== 3) {
    throw new Error("Unsupported webOS media runtime proxy layout: " + filename);
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

function loadCommonJsScript(filename) {
  var code = fs.readFileSync(filename, "utf8");
  code = patchWebOsMediaRuntimeCode(code, filename);
  var mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(code, filename);
  return mod.exports;
}

function patchServerRequestRegistration(server, wrapRequestListener) {
  ["on", "addListener", "once", "prependListener"].forEach(function (methodName) {
    if (typeof server[methodName] !== "function") {
      return;
    }
    var original = server[methodName];
    server[methodName] = function (eventName, listener) {
      if (eventName === "request" && typeof listener === "function") {
        return original.call(this, eventName, wrapRequestListener(listener));
      }
      return original.apply(this, arguments);
    };
  });
  return server;
}

function installImageProxyHttpHook() {
  var originalCreateServer = http.createServer;
  var imageProxyHandler = createImageProxyHandler();
  var supabaseProxyHandler = createSupabaseProxyHandler();

  function wrapRequestListener(listener) {
    if (typeof listener !== "function" || listener.__nuvioImageProxyWrapped) {
      return listener;
    }

    var wrapped = function (req, res) {
      if (supabaseProxyHandler(req, res)) {
        return;
      }
      if (imageProxyHandler(req, res)) {
        return;
      }
      return listener.apply(this, arguments);
    };
    wrapped.__nuvioImageProxyWrapped = true;
    return wrapped;
  }

  http.createServer = function () {
    var args = Array.prototype.slice.call(arguments);
    if (typeof args[0] === "function") {
      args[0] = wrapRequestListener(args[0]);
    } else if (typeof args[1] === "function") {
      args[1] = wrapRequestListener(args[1]);
    }
    return patchServerRequestRegistration(
      originalCreateServer.apply(http, args),
      wrapRequestListener
    );
  };

  return function restoreImageProxyHttpHook() {
    http.createServer = originalCreateServer;
  };
}

// The image proxy and the Supabase proxy do not run a server of their own: they
// hook http.createServer and ride on whatever server the EngineFS runtime puts
// up. The runtime is transpiled to ES5 at package time so that Node v0.12.2 on
// webOS TV 4.x can load it, but if it ever fails to boot anyway, losing it
// should cost torrent playback and nothing else — with no server at all it also
// takes down poster proxying and the account/cloud-library proxy that legacy
// webOS depends on. So when the runtime fails we still put up a bare server on
// the same ports, through the same hook, and let the proxies answer.
// probeLocalServer accepts any status below 500 on /settings, which is why the
// placeholder handler answers 404 rather than 5xx.
function startProxyOnlyServer(candidateIndex, onReady) {
  var index = typeof candidateIndex === "number" ? candidateIndex : 0;
  if (index >= PORT_CANDIDATES.length) {
    onReady(new Error("No free port available for the proxy-only server"));
    return;
  }

  var restoreHttpHook = installImageProxyHttpHook();
  var server;
  try {
    server = http.createServer(function (req, res) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "enginefs-runtime-unavailable",
          message:
            "The local media runtime is not available on this platform; " +
            "only the image and account proxies are served."
        })
      );
    });
  } finally {
    restoreHttpHook();
  }

  server.on("error", function () {
    try {
      server.close();
    } catch (ignored) {}
    startProxyOnlyServer(index + 1, onReady);
  });

  server.listen(PORT_CANDIDATES[index], "127.0.0.1", function () {
    onReady(null, PORT_CANDIDATES[index]);
  });
}

// EngineFS keeps its torrent cache under os.tmpdir(), and on every
// engine-created event it walks that directory and unlinks whatever does not
// belong to a live engine. On a TV /tmp is the system scratch directory, so the
// stock configuration makes the first torrent delete the platform's own files
// (thumbnails, EPG databases, upload spools) — most attempts fail on
// permissions, the ones that succeed do real damage. Node resolves os.tmpdir()
// from TMPDIR/TMP/TEMP, so pointing those at an app-owned directory before the
// runtime loads keeps the sweep inside our own sandbox.
function redirectRuntimeTempDir(runtimePath) {
  var serviceRoot = path.dirname(path.dirname(runtimePath));
  var appPath = path.join(serviceRoot, ".nuvio-media-server");
  var tempPath = path.join(appPath, "tmp");

  try {
    [appPath, tempPath].forEach(function (directory) {
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, 493);
      }
    });
  } catch (error) {
    console.error(
      "[" + SERVICE_ID + "] could not create the runtime temp directory " + tempPath + ":",
      error
    );
    return null;
  }

  process.env.TMPDIR = tempPath;
  process.env.TMP = tempPath;
  process.env.TEMP = tempPath;
  process.env.APP_PATH = appPath;
  return tempPath;
}

function bootLocalRuntime(runtimePath) {
  redirectRuntimeTempDir(runtimePath);

  // The hook stays installed for the life of the process on the EngineFS path.
  // Restoring it once the module body finished evaluating looked tidy but was
  // wrong: EngineFS probes for ffmpeg binaries before it listens, so it calls
  // http.createServer from a callback, long after require() returned. The
  // unhooked server then answered the account and image proxy paths with
  // express's own "Cannot POST /supabase-proxy" 404, which reads to the app as
  // every addon and debrid login failing.
  var restoreHttpHook = installImageProxyHttpHook();
  try {
    loadCommonJsScript(runtimePath);
    return { mode: "enginefs", runtimeError: null };
  } catch (error) {
    restoreHttpHook();
    console.error(
      "[" + SERVICE_ID + "] local media runtime failed to load; falling back to proxy-only:",
      error
    );
    startProxyOnlyServer(0, function (listenError, port) {
      if (listenError) {
        console.error("[" + SERVICE_ID + "] proxy-only server failed to listen:", listenError);
        return;
      }
      console.log("[" + SERVICE_ID + "] proxy-only server listening on 127.0.0.1:" + port);
    });
    return {
      mode: "proxy-only",
      runtimeError: {
        message: String(error && error.message ? error.message : error),
        stack: String(error && error.stack ? error.stack : "")
      }
    };
  }
}

function requestLocalHttp(port, pathname, options, callback) {
  var requestOptions = options || {};
  var body = requestOptions.body || null;
  var headers = Object.assign({}, requestOptions.headers || {});
  var maxBodyBytes = Number(requestOptions.maxBodyBytes || 0) || 0;
  var timeoutMs = Number(requestOptions.timeoutMs || REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS;
  var encoding = requestOptions.encoding === null ? null : requestOptions.encoding || "utf8";

  if (body && !headers["Content-Length"] && !headers["content-length"]) {
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  var req = http.request(
    {
      host: "127.0.0.1",
      port: port,
      path: pathname,
      method: requestOptions.method || "GET",
      headers: headers
    },
    function (res) {
      var chunks = [];
      var bodyBytes = 0;
      if (encoding) {
        res.setEncoding(encoding);
      }
      res.on("data", function (chunk) {
        var chunkBytes = encoding ? Buffer.byteLength(chunk) : chunk.length;
        bodyBytes += chunkBytes;
        if (!maxBodyBytes || bodyBytes <= maxBodyBytes) {
          chunks.push(chunk);
        }
      });
      res.on("end", function () {
        var responseBody = encoding ? chunks.join("") : Buffer.concat(chunks);
        callback(null, {
          port: port,
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          body: responseBody,
          bodyBytes: bodyBytes,
          bodyTruncated: Boolean(maxBodyBytes && bodyBytes > maxBodyBytes)
        });
      });
    }
  );

  req.setTimeout(timeoutMs, function () {
    req.destroy(new Error("Local media request timed out after " + timeoutMs + "ms"));
  });

  req.on("error", function (error) {
    callback(error);
  });

  if (body) {
    req.write(body);
  }
  req.end();
}

function requestLocalPath(port, pathname, callback) {
  requestLocalHttp(port, pathname, {}, callback);
}

function probeLocalServer(callback, index) {
  var candidateIndex = typeof index === "number" ? index : 0;
  if (candidateIndex >= PORT_CANDIDATES.length) {
    callback(null, null);
    return;
  }

  var port = PORT_CANDIDATES[candidateIndex];
  requestLocalPath(port, "/settings", function (error, result) {
    if (!error && result && result.statusCode >= 200 && result.statusCode < 500) {
      callback(null, result);
      return;
    }
    probeLocalServer(callback, candidateIndex + 1);
  });
}

function requestActiveServerPath(pathname, callback) {
  requestActiveServerHttp(pathname, {}, callback);
}

function requestActiveServerHttp(pathname, options, callback) {
  probeLocalServer(function (error, status) {
    if (error) {
      callback(error);
      return;
    }

    if (!status || !status.port) {
      callback(new Error("Local media server unavailable"));
      return;
    }

    requestLocalHttp(status.port, pathname, options, callback);
  });
}

module.exports = {
  SERVICE_ID: SERVICE_ID,
  PORT_CANDIDATES: PORT_CANDIDATES,
  bootLocalRuntime: bootLocalRuntime,
  probeLocalServer: probeLocalServer,
  requestLocalHttp: requestLocalHttp,
  requestActiveServerHttp: requestActiveServerHttp,
  requestActiveServerPath: requestActiveServerPath,
  patchWebOsMediaRuntimeCode: patchWebOsMediaRuntimeCode
};
