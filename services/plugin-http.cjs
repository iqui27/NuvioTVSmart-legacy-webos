var http = require("http");
var https = null;
var dns = null;
var net = null;
var urlModule = null;
var zlib = null;

function loadRuntimeModule(name) {
  return require(name);
}

function getUrlModule() {
  if (!urlModule) urlModule = loadRuntimeModule("url");
  return urlModule;
}

function getNetModule() {
  if (!net) net = loadRuntimeModule("net");
  return net;
}

function getDnsModule() {
  if (!dns) dns = loadRuntimeModule("dns");
  return dns;
}

function getHttpsModule() {
  if (!https) https = loadRuntimeModule("https");
  return https;
}

function getZlibModule() {
  if (!zlib) zlib = loadRuntimeModule("zlib");
  return zlib;
}

var MAX_REQUEST_BYTES = 1024 * 1024;
var MAX_SERVICE_REQUEST_BYTES = MAX_REQUEST_BYTES + 64 * 1024;
var DEFAULT_RESPONSE_BYTES = 1024 * 1024;
var MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
var MAX_WIRE_RESPONSE_BYTES = 4 * 1024 * 1024;
var MAX_REDIRECTS = 20;
var DEFAULT_TIMEOUT_MS = 30000;
var PLUGIN_PROTOCOL_VERSION = 1;
var MAX_ACTIVE_REQUESTS = 8;
var MAX_REQUESTS_PER_SCRAPER_PER_MINUTE = 60;
var CIRCUIT_FAILURE_LIMIT = 3;
var CIRCUIT_OPEN_MS = 30000;

function parseUrl(value) {
  var parsed;
  try {
    parsed = new (getUrlModule().URL)(String(value || ""));
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}

function normalizeHeaders(headers) {
  var result = {};
  Object.keys(headers || {}).forEach(function (key) {
    var name = String(key || "");
    var lower = name.toLowerCase();
    var value = headers[key];
    if (!name || value == null || lower === "accept-encoding") return;
    result[name] = String(value);
  });
  if (
    !Object.keys(result).some(function (key) {
      return key === "User-Agent";
    })
  ) {
    result["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  }
  return result;
}

function headerValue(headers, wantedName) {
  var wanted = String(wantedName || "").toLowerCase();
  var key = Object.keys(headers || {}).find(function (name) {
    return String(name).toLowerCase() === wanted;
  });
  return key ? headers[key] : null;
}

function hasHeader(headers, wantedName) {
  var wanted = String(wantedName || "").toLowerCase();
  return Object.keys(headers || {}).some(function (name) {
    return String(name).toLowerCase() === wanted;
  });
}

function removeHeader(headers, wantedName) {
  var wanted = String(wantedName || "").toLowerCase();
  Object.keys(headers || {}).forEach(function (name) {
    if (String(name).toLowerCase() === wanted) delete headers[name];
  });
}

function validatePayload(payload) {
  var parsed = parseUrl(payload && payload.url);
  if (!parsed)
    return {
      ok: false,
      error: "Only valid HTTP(S) URLs are allowed"
    };
  var requestedMethod = String((payload && payload.method) || "GET").toUpperCase();
  var method = ["POST", "PUT", "DELETE"].indexOf(requestedMethod) >= 0 ? requestedMethod : "GET";
  var body = typeof (payload && payload.body) === "string" ? payload.body : "";
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES)
    return { ok: false, error: "Request body exceeds the plugin quota" };
  var headers = normalizeHeaders(payload && payload.headers);
  // Android's OkHttp RequestBody supplies these defaults when a plugin does
  // not provide Content-Type. Keep the exact media types and do not append a
  // charset, because some providers include the value in a signature.
  if (!headerValue(headers, "Content-Type")) {
    if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (method === "PUT") headers["Content-Type"] = "application/json";
  }
  return {
    ok: true,
    url: parsed.toString(),
    method: method,
    headers: headers,
    body: body,
    requestId: String((payload && payload.requestId) || "").slice(0, 128),
    executionId: String((payload && payload.executionId) || "").slice(0, 128),
    profileId: String((payload && payload.profileId) || "").slice(0, 64),
    repositoryId: String((payload && payload.repositoryId) || "").slice(0, 128),
    scraperId: String((payload && payload.scraperId) || "").slice(0, 128),
    maxResponseBytes: Math.max(
      1,
      Math.min(
        MAX_RESPONSE_BYTES,
        Number(payload && (payload.maxResponseBytes || payload.maxBodyBytes)) ||
          DEFAULT_RESPONSE_BYTES
      )
    ),
    timeoutMs: Math.max(
      1000,
      Math.min(DEFAULT_TIMEOUT_MS, Number(payload && payload.timeoutMs) || DEFAULT_TIMEOUT_MS)
    )
  };
}

function lookupHost(parsed, callback) {
  var netModule;
  var dnsModule;
  try {
    netModule = getNetModule();
    dnsModule = getDnsModule();
  } catch (error) {
    callback(error);
    return;
  }
  var host = String(parsed.hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (netModule.isIP(host)) {
    callback(null, host);
    return;
  }
  var done = false;
  function finish(error, address) {
    if (done) return;
    done = true;
    callback(error || null, address || null);
  }
  try {
    dnsModule.lookup(host, { all: true, verbatim: true }, function (error, addresses) {
      if (error) {
        finish(error);
        return;
      }
      var values = Array.isArray(addresses) ? addresses : [{ address: addresses }];
      values = values
        .filter(function (entry) {
          return entry && entry.address;
        })
        .sort(function (left, right) {
          return netModule.isIPv4(left.address) === netModule.isIPv4(right.address)
            ? 0
            : netModule.isIPv4(left.address)
              ? -1
              : 1;
        });
      if (!values.length) {
        finish(new Error("DNS lookup returned no address"));
        return;
      }
      finish(null, String(values[0].address || ""));
    });
  } catch (_) {
    try {
      dnsModule.lookup(host, function (error, address) {
        finish(error || null, address);
      });
    } catch (error) {
      finish(error);
    }
  }
}

function responseHeaders(response) {
  var result = {};
  var truncationSuffix = "\n...[truncated]";
  Object.keys(response.headers || {}).forEach(function (key) {
    var value = response.headers[key];
    var text = Array.isArray(value) ? value.join(",") : String(value == null ? "" : value);
    if (text.length > 8192) {
      text = text.slice(0, 8192 - truncationSuffix.length) + truncationSuffix;
    }
    result[String(key).toLowerCase()] = text;
  });
  return result;
}

function responseCharset(contentType) {
  var match = String(contentType || "").match(/(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i);
  if (!match) return "utf8";
  var charset = String(match[1] || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (["utf8", "utf-8"].indexOf(charset) >= 0) return "utf8";
  if (
    [
      "iso88591",
      "iso-8859-1",
      "latin1",
      "latin-1",
      "windows1252",
      "windows-1252",
      "cp1252",
      "cp-1252"
    ].indexOf(charset) >= 0
  )
    return "latin1";
  if (["utf16le", "utf-16le", "ucs2", "ucs-2"].indexOf(charset) >= 0) return "utf16le";
  return "utf8";
}

function performFetch(payload, callback, redirects) {
  var finish = once(callback);
  var redirected = false;
  var validation = validatePayload(payload);
  if (!validation.ok) {
    finish(new Error(validation.error));
    return;
  }
  var parsed = parseUrl(validation.url);
  lookupHost(parsed, function (lookupError, address) {
    if (lookupError) {
      finish(lookupError);
      return;
    }
    var transport;
    try {
      transport = parsed.protocol === "https:" ? getHttpsModule() : http;
    } catch (error) {
      finish(error);
      return;
    }
    var requestHeaders = Object.assign({}, validation.headers);
    if (["POST", "PUT"].indexOf(validation.method) >= 0) {
      // The Android body is a known UTF-8 byte array. OkHttp's bridge uses the
      // caller's Content-Type (or the RequestBody default), sets Content-Length
      // and removes Transfer-Encoding.
      var contentType =
        headerValue(validation.headers, "Content-Type") ||
        (validation.method === "POST" ? "application/x-www-form-urlencoded" : "application/json");
      removeHeader(requestHeaders, "Content-Type");
      requestHeaders["Content-Type"] = contentType;
      removeHeader(requestHeaders, "Content-Length");
      removeHeader(requestHeaders, "Transfer-Encoding");
    } else {
      // Android calls Request.Builder.get()/delete() without a RequestBody.
      // OkHttp's bridge consequently removes body-only headers even when a
      // plugin supplied them explicitly.
      removeHeader(requestHeaders, "Content-Type");
      removeHeader(requestHeaders, "Content-Length");
      removeHeader(requestHeaders, "Transfer-Encoding");
    }
    // OkHttp adds transparent gzip negotiation after removing any caller
    // supplied Accept-Encoding. Node's client does not, so add the same
    // transport header at the final socket boundary.
    if (!hasHeader(requestHeaders, "Range")) requestHeaders["Accept-Encoding"] = "gzip";
    if (!hasHeader(requestHeaders, "Host")) {
      requestHeaders.Host = parsed.host;
    }
    if (!hasHeader(requestHeaders, "Connection")) requestHeaders.Connection = "Keep-Alive";
    if (
      ["POST", "PUT"].indexOf(validation.method) >= 0 &&
      !hasHeader(requestHeaders, "Content-Length")
    ) {
      requestHeaders["Content-Length"] = String(Buffer.byteLength(validation.body, "utf8"));
    }
    var requestOptions = {
      protocol: parsed.protocol,
      // Keep the original Host/SNI while using the Android-compatible
      // IPv4-first DNS result for the actual socket connection.
      hostname: address || parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: validation.method,
      headers: requestHeaders,
      servername: String(parsed.hostname || "").replace(/^\[|\]$/g, ""),
      agent: false
    };
    var request = transport.request(requestOptions, function (response) {
      var responseDone = once(function (error, result) {
        finish(error, result);
      });
      var wireLength = 0;
      response.on("data", function (chunk) {
        wireLength += chunk.length;
        if (wireLength > MAX_WIRE_RESPONSE_BYTES) {
          responseDone(new Error("Plugin provider response exceeds the wire quota"));
          response.destroy();
        }
      });
      response.on("error", function (error) {
        responseDone(error);
      });
      var headers = responseHeaders(response);
      var bodyEncoding = responseCharset(response.headers["content-type"]);
      var location = headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        if (!location) {
          responseDone(new Error("Plugin provider redirect has no location"));
          return;
        }
        if ((redirects || 0) >= MAX_REDIRECTS) {
          responseDone(new Error("Plugin provider redirect limit exceeded"));
          return;
        }
        var nextUrl;
        try {
          nextUrl = new (getUrlModule().URL)(location, validation.url).toString();
        } catch (_) {
          responseDone(new Error("Invalid redirect URL"));
          return;
        }
        redirected = true;
        var redirectedPayload = Object.assign({}, payload, { url: nextUrl });
        var previousUrl = parseUrl(validation.url);
        var redirectedUrl = parseUrl(nextUrl);
        var crossOrigin =
          previousUrl &&
          redirectedUrl &&
          (previousUrl.protocol !== redirectedUrl.protocol ||
            previousUrl.hostname !== redirectedUrl.hostname ||
            (previousUrl.port || "") !== (redirectedUrl.port || ""));
        var redirectedHeaders = Object.assign({}, payload && payload.headers);
        if (crossOrigin) {
          // OkHttp does not forward credentials to a different origin during
          // a follow-up request. Keep all other plugin headers intact.
          removeHeader(redirectedHeaders, "Authorization");
        }
        // OkHttp changes non-GET methods to GET for 301/302/303 redirects and
        // drops the request body/content headers.  307/308 keep the original
        // method and body, matching the native follow-up behavior.
        if (
          [301, 302, 303].indexOf(Number(response.statusCode)) >= 0 &&
          validation.method !== "GET"
        ) {
          redirectedPayload.method = "GET";
          redirectedPayload.body = "";
          Object.keys(redirectedHeaders).forEach(function (headerName) {
            if (
              ["content-length", "content-type", "transfer-encoding"].indexOf(
                String(headerName).toLowerCase()
              ) >= 0
            ) {
              delete redirectedHeaders[headerName];
            }
          });
          redirectedPayload.headers = redirectedHeaders;
        } else if (crossOrigin) {
          redirectedPayload.headers = redirectedHeaders;
        }
        performFetch(redirectedPayload, finish, (redirects || 0) + 1);
        return;
      }

      var stream = response;
      var encoding = String(response.headers["content-encoding"] || "").toLowerCase();
      var transparentGzip = !hasHeader(requestHeaders, "Range");
      if (transparentGzip && encoding === "gzip") {
        delete headers["content-encoding"];
        delete headers["content-length"];
      }
      try {
        if (encoding === "gzip") {
          stream = response.pipe(getZlibModule().createGunzip());
        } else if (encoding === "deflate") {
          stream = response.pipe(getZlibModule().createInflate());
        }
      } catch (error) {
        responseDone(error);
        response.resume();
        return;
      }
      var chunks = [];
      var length = 0;
      var truncated = false;
      var finishTruncated = function () {
        if (truncated) return;
        truncated = true;
        responseDone(null, {
          returnValue: true,
          // Android keeps the original HTTP response metadata when its body
          // cap is reached; truncation is an orthogonal flag.
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          statusText: response.statusMessage || "",
          url: validation.url,
          body: Buffer.concat(chunks).toString(bodyEncoding),
          headers: headers,
          truncated: true
        });
        // `stream` e o response cru OU um zlib.Gunzip/Inflate (ver o pipe acima).
        // Transform.prototype.destroy so existe do Node 8 em diante, e o servico
        // webOS roda em Node 0.12: numa resposta gzipada que estoure a cota isto
        // lancava TypeError e o corpo truncado nunca era entregue. O helper vem
        // do legacyNodePrelude, prefixado no bundle pelo package-webos; fora do
        // webOS o destroy nativo continua valendo.
        if (typeof __nuvioStopStream === "function") {
          __nuvioStopStream(stream);
        } else {
          stream.destroy();
        }
        // response e um http.IncomingMessage, que TEM destroy() no Node 0.12.
        if (stream !== response) response.destroy();
      };
      stream.on("data", function (chunk) {
        if (length >= validation.maxResponseBytes) {
          finishTruncated();
          return;
        }
        var remaining = validation.maxResponseBytes - length;
        var part = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
        chunks.push(part);
        length += part.length;
        if (part.length < chunk.length) {
          finishTruncated();
        }
      });
      stream.on("error", function (error) {
        responseDone(error);
      });
      stream.on("end", function () {
        responseDone(null, {
          returnValue: true,
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          statusText: response.statusMessage || "",
          url: validation.url,
          body: Buffer.concat(chunks).toString(bodyEncoding),
          headers: headers,
          truncated: truncated
        });
      });
    });
    request.setTimeout(validation.timeoutMs, function () {
      request.destroy(new Error("Plugin provider request timed out"));
    });
    request.on("error", function (error) {
      if (!redirected) finish(error);
    });
    if (validation.requestId && typeof finish.registerRequest === "function") {
      finish.registerRequest(validation.requestId, request);
    }
    if (["POST", "PUT"].indexOf(validation.method) >= 0 && validation.body)
      request.write(validation.body);
    request.end();
  });
}

function once(callback) {
  var called = false;
  var wrapped = function () {
    if (called) return;
    called = true;
    return callback.apply(null, arguments);
  };
  if (callback && typeof callback.registerRequest === "function") {
    wrapped.registerRequest = callback.registerRequest;
  }
  return wrapped;
}

function memoryUsage() {
  try {
    if (typeof process !== "undefined" && process && typeof process.memoryUsage === "function") {
      return process.memoryUsage();
    }
  } catch (_) {
    // Some lightweight Web Service runtimes do not expose process memory APIs.
  }
  return {};
}

function createPluginHttpServer({ port = 2711, logger = console } = {}) {
  var activeRequests = {};
  var inFlightRequests = {};
  var scraperRequestWindows = {};
  var hostCircuits = {};

  function hostForPayload(payload) {
    try {
      var parsed = parseUrl(payload && payload.url);
      return parsed ? String(parsed.hostname || "").toLowerCase() : "";
    } catch (_) {
      return "";
    }
  }

  function pruneCircuit(host, now) {
    var circuit = hostCircuits[host];
    if (circuit && circuit.openUntil && circuit.openUntil <= now) {
      delete hostCircuits[host];
      circuit = null;
    }
    return circuit;
  }

  function admitRequest(payload, requestId) {
    var now = Date.now();
    if (requestId && inFlightRequests[requestId]) {
      return { ok: false, status: 409, error: "Duplicate plugin request id" };
    }
    if (Object.keys(inFlightRequests).length >= MAX_ACTIVE_REQUESTS) {
      return { ok: false, status: 429, error: "Plugin service concurrency quota exceeded" };
    }
    var scraperId = String((payload && payload.scraperId) || "").slice(0, 128);
    if (scraperId) {
      var window = scraperRequestWindows[scraperId] || [];
      window = window.filter(function (timestamp) {
        return now - timestamp < 60000;
      });
      if (window.length >= MAX_REQUESTS_PER_SCRAPER_PER_MINUTE) {
        scraperRequestWindows[scraperId] = window;
        return { ok: false, status: 429, error: "Plugin scraper request-rate quota exceeded" };
      }
      window.push(now);
      scraperRequestWindows[scraperId] = window;
    }
    var host = hostForPayload(payload);
    var circuit = pruneCircuit(host, now);
    if (host && circuit && circuit.openUntil > now) {
      return { ok: false, status: 503, error: "Plugin provider circuit is temporarily open" };
    }
    inFlightRequests[requestId] = { request: null, host: host, cancelled: false };
    return { ok: true, host: host };
  }

  function recordHostResult(host, error, result) {
    if (!host) return;
    var failed = Boolean(error) || Number((result && result.status) || 0) >= 500;
    if (!failed) {
      delete hostCircuits[host];
      return;
    }
    var circuit = hostCircuits[host] || { failures: 0, openUntil: 0 };
    circuit.failures += 1;
    if (circuit.failures >= CIRCUIT_FAILURE_LIMIT) circuit.openUntil = Date.now() + CIRCUIT_OPEN_MS;
    hostCircuits[host] = circuit;
  }

  function send(response, status, body) {
    var data = JSON.stringify(body || {});
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(data, "utf8"),
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    response.end(data);
  }
  function readBody(request, callback) {
    var chunks = [];
    var length = 0;
    request.on("data", function (chunk) {
      length += chunk.length;
      if (length <= MAX_SERVICE_REQUEST_BYTES) chunks.push(chunk);
    });
    request.on("end", function () {
      if (length > MAX_SERVICE_REQUEST_BYTES) {
        callback(new Error("Plugin service request is too large"));
        return;
      }
      try {
        callback(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        callback(error);
      }
    });
  }
  var server = http.createServer(function (request, response) {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      response.end();
      return;
    }
    if (request.url === "/health" && request.method === "GET") {
      var memory = memoryUsage();
      send(response, 200, {
        returnValue: true,
        service: "nuvio-plugin-network",
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        serviceVersion: 1,
        runtimeVersion: "nuvio-plugin-network/1",
        quickjsVersion: "quickjs-emscripten/0.32.0 (app-worker)",
        workerSupport: true,
        maxConcurrency: 2,
        memoryTier: "bounded",
        defaultResponseBytes: DEFAULT_RESPONSE_BYTES,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        memory: { rssBytes: Number(memory.rss || 0), heapUsedBytes: Number(memory.heapUsed || 0) },
        jsPluginCapability: true,
        networkBoundary: true,
        port: port
      });
      return;
    }
    if (request.url === "/capabilities" && request.method === "GET") {
      send(response, 200, {
        returnValue: true,
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        serviceVersion: 1,
        runtimeVersion: "nuvio-plugin-network/1",
        quickjsVersion: "quickjs-emscripten/0.32.0 (app-worker)",
        workerSupport: true,
        maxConcurrency: 2,
        memoryTier: "bounded",
        defaultResponseBytes: DEFAULT_RESPONSE_BYTES,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        jsPluginCapability: true,
        networkBoundary: true
      });
      return;
    }
    if (request.url === "/diagnostics" && request.method === "GET") {
      send(response, 200, {
        returnValue: true,
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        activeRequests: Object.keys(activeRequests).length,
        memory: memoryUsage()
      });
      return;
    }
    if (request.url === "/cache/clear" && request.method === "POST") {
      send(response, 200, { returnValue: true, cleared: true });
      return;
    }
    if ((request.url === "/cancel" || request.url === "/fetch") && request.method === "POST") {
      readBody(request, function (bodyError, payload) {
        if (bodyError) {
          send(response, 400, { returnValue: false, errorText: bodyError.message });
          return;
        }
        if (request.url === "/cancel") {
          var cancelId = String(payload.requestId || "");
          var state = inFlightRequests[cancelId];
          var active = activeRequests[cancelId];
          if (state) state.cancelled = true;
          if (active) active.destroy(new Error("Plugin request cancelled"));
          send(response, 200, {
            returnValue: true,
            requestId: cancelId,
            cancelled: Boolean(state || active)
          });
          return;
        }
        var requestId =
          String(payload.requestId || "").slice(0, 128) ||
          `service-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        var admission = admitRequest(payload, requestId);
        if (!admission.ok) {
          send(response, admission.status, {
            returnValue: false,
            errorText: admission.error,
            requestId: requestId
          });
          return;
        }
        var callback = function (error, result) {
          if (requestId) delete activeRequests[requestId];
          var state = inFlightRequests[requestId];
          delete inFlightRequests[requestId];
          recordHostResult(state && state.host, state && state.cancelled ? null : error, result);
          if (error) {
            send(response, 502, {
              returnValue: false,
              errorText: error.message || String(error),
              requestId: requestId
            });
          } else {
            send(response, 200, Object.assign({ requestId: requestId }, result));
          }
        };
        callback.registerRequest = function (id, activeRequest) {
          activeRequests[id] = activeRequest;
          var state = inFlightRequests[id];
          if (state) {
            state.request = activeRequest;
            if (state.cancelled) activeRequest.destroy(new Error("Plugin request cancelled"));
          }
        };
        performFetch(Object.assign({}, payload, { requestId: requestId }), callback, 0);
      });
      return;
    }
    send(response, 404, { returnValue: false, errorText: "Plugin service route not found" });
  });
  server.on("error", function (error) {
    if (logger && typeof logger.warn === "function")
      logger.warn("Plugin service error", error.message || error);
  });
  return server;
}

module.exports = { createPluginHttpServer: createPluginHttpServer };
