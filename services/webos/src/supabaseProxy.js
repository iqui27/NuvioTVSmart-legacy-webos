var http = require("http");
var https = require("https");
var URL = require("./legacyUrl").URL;

var SUPABASE_PROXY_PATH = "/supabase-proxy";
var MAX_REQUEST_BYTES = 2 * 1024 * 1024;
var MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
var REQUEST_TIMEOUT_MS = 15000;
var MAX_REDIRECTS = 5;
var BROWSER_USER_AGENT = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/120.0.0.0 Safari/537.36"
].join(" ");

var ALLOWED_HEADER_NAMES = {
  accept: true,
  apikey: true,
  authorization: true,
  "content-profile": true,
  "content-type": true,
  prefer: true,
  range: true
};

function send(res, statusCode, headers, body) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(
    statusCode,
    Object.assign(
      {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store"
      },
      headers || {}
    )
  );
  res.end(body || "");
}

function isAllowedSupabaseHost(hostname) {
  var host = String(hostname || "").toLowerCase();
  return host === "api.nuvio.tv" || /\.supabase\.co$/.test(host);
}

function isAllowedDebridTarget(parsed) {
  var host = String(parsed && parsed.hostname ? parsed.hostname : "").toLowerCase();
  var path = String(parsed && parsed.pathname ? parsed.pathname : "");
  if (host === "api.torbox.app") {
    return (
      path === "/v1/api/user/auth/device/start" ||
      path === "/v1/api/user/auth/device/token" ||
      path === "/v1/api/torrents/mylist" ||
      path === "/v1/api/usenet/mylist" ||
      path === "/v1/api/webdl/mylist" ||
      path === "/v1/api/torrents/requestdl" ||
      path === "/v1/api/usenet/requestdl" ||
      path === "/v1/api/webdl/requestdl"
    );
  }
  return (
    host === "www.premiumize.me" &&
    (path === "/token" || path === "/api/item/listall" || path === "/api/item/details")
  );
}

function validateTargetUrl(rawUrl, method) {
  var target = String(rawUrl || "").trim();
  if (!target) {
    return { ok: false, statusCode: 400, message: "Missing url" };
  }
  var parsed = null;
  try {
    parsed = new URL(target);
  } catch (_) {
    return { ok: false, statusCode: 400, message: "Invalid url" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, statusCode: 400, message: "Only HTTPS Supabase URLs are allowed" };
  }
  var isSupabaseTarget =
    isAllowedSupabaseHost(parsed.hostname) &&
    (parsed.pathname.indexOf("/rest/v1/") === 0 || parsed.pathname.indexOf("/storage/v1/") === 0);
  var isDebridTarget = isAllowedDebridTarget(parsed);
  if (!isSupabaseTarget && !isDebridTarget) {
    return { ok: false, statusCode: 403, message: "Proxy target is not allowed" };
  }
  if (isDebridTarget) {
    var normalizedMethod = String(method || "GET").toUpperCase();
    var isAllowedMethod =
      (parsed.hostname === "api.torbox.app" &&
        parsed.pathname === "/v1/api/user/auth/device/start" &&
        normalizedMethod === "GET") ||
      (parsed.hostname === "api.torbox.app" &&
        parsed.pathname === "/v1/api/user/auth/device/token" &&
        normalizedMethod === "POST") ||
      (parsed.hostname === "www.premiumize.me" &&
        parsed.pathname === "/token" &&
        normalizedMethod === "POST") ||
      (normalizedMethod === "GET" &&
        parsed.hostname === "api.torbox.app" &&
        [
          "/v1/api/torrents/mylist",
          "/v1/api/usenet/mylist",
          "/v1/api/webdl/mylist",
          "/v1/api/torrents/requestdl",
          "/v1/api/usenet/requestdl",
          "/v1/api/webdl/requestdl"
        ].indexOf(parsed.pathname) >= 0) ||
      (normalizedMethod === "GET" &&
        parsed.hostname === "www.premiumize.me" &&
        ["/api/item/listall", "/api/item/details"].indexOf(parsed.pathname) >= 0);
    if (!isAllowedMethod) {
      return { ok: false, statusCode: 405, message: "Proxy method is not allowed" };
    }
  }
  return { ok: true, target: target, parsed: parsed };
}

function sanitizeHeaders(headers) {
  var output = {
    Accept: "application/json",
    "User-Agent": BROWSER_USER_AGENT
  };
  Object.keys(headers || {}).forEach(function (name) {
    var normalizedName = String(name || "").trim();
    var key = normalizedName.toLowerCase();
    if (!ALLOWED_HEADER_NAMES[key]) {
      return;
    }
    var value = headers[name];
    if (value == null) {
      return;
    }
    output[normalizedName] = String(value);
  });
  return output;
}

function parseRequestBody(req, callback) {
  var chunks = [];
  var bodyBytes = 0;

  req.on("data", function (chunk) {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_REQUEST_BYTES) {
      callback(new Error("Proxy request body too large"));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", function () {
    try {
      var raw = Buffer.concat(chunks).toString("utf8");
      callback(null, raw ? JSON.parse(raw) : {});
    } catch (error) {
      callback(error);
    }
  });

  req.on("error", function (error) {
    callback(error);
  });
}

function proxySupabaseRequest(payload, redirectsLeft, callback, redirectChain) {
  var method = String((payload && payload.method) || "GET").toUpperCase();
  var validated = validateTargetUrl(payload && payload.url, method);
  if (!validated.ok) {
    callback(null, {
      statusCode: validated.statusCode || 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: validated.message || "Invalid Supabase request"
    });
    return;
  }

  var parsed = validated.parsed;
  var body = payload && typeof payload.body === "string" ? payload.body : null;
  var headers = sanitizeHeaders((payload && payload.headers) || {});
  if (body && !headers["Content-Length"] && !headers["content-length"]) {
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  var transport = parsed.protocol === "http:" ? http : https;
  var request = transport.request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: method,
      headers: headers
    },
    function (response) {
      var statusCode = Number(response.statusCode || 0);
      var location = response.headers && response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectsLeft <= 0) {
          callback(null, {
            statusCode: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body:
              "Supabase proxy redirect limit reached" +
              (redirectChain && redirectChain.length ? ": " + redirectChain.join(" -> ") : "")
          });
          return;
        }

        var nextUrl = new URL(location, validated.target).toString();
        proxySupabaseRequest(
          Object.assign({}, payload, { url: nextUrl }),
          redirectsLeft - 1,
          callback,
          (redirectChain || []).concat(nextUrl)
        );
        return;
      }

      var responseChunks = [];
      var responseBytes = 0;
      response.on("data", function (chunk) {
        responseBytes += chunk.length;
        if (responseBytes <= MAX_RESPONSE_BYTES) {
          responseChunks.push(chunk);
        }
      });
      response.on("end", function () {
        if (responseBytes > MAX_RESPONSE_BYTES) {
          callback(null, {
            statusCode: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: "Supabase proxy response too large"
          });
          return;
        }
        callback(null, {
          statusCode: statusCode,
          headers: {
            "Content-Type": response.headers["content-type"] || "application/json; charset=utf-8",
            "Content-Range": response.headers["content-range"] || "",
            Range: response.headers.range || ""
          },
          body: Buffer.concat(responseChunks)
        });
      });
    }
  );

  request.setTimeout(REQUEST_TIMEOUT_MS, function () {
    request.destroy(new Error("Supabase proxy request timed out"));
  });
  request.on("error", function (error) {
    callback(error);
  });
  if (body) {
    request.write(body);
  }
  request.end();
}

function createSupabaseProxyHandler() {
  return function supabaseProxyHandler(req, res) {
    var parsedRequest = null;
    try {
      parsedRequest = new URL(req.url || "", "http://127.0.0.1");
    } catch (_) {
      return false;
    }
    if (parsedRequest.pathname !== SUPABASE_PROXY_PATH) {
      return false;
    }

    if (req.method === "OPTIONS") {
      send(res, 204);
      return true;
    }

    if (req.method !== "POST") {
      send(
        res,
        405,
        {
          Allow: "POST, OPTIONS",
          "Content-Type": "text/plain; charset=utf-8"
        },
        "Method not allowed"
      );
      return true;
    }

    parseRequestBody(req, function (parseError, payload) {
      if (parseError) {
        send(
          res,
          400,
          { "Content-Type": "text/plain; charset=utf-8" },
          parseError.message || "Invalid proxy request"
        );
        return;
      }

      proxySupabaseRequest(payload || {}, MAX_REDIRECTS, function (proxyError, proxied) {
        if (proxyError) {
          send(
            res,
            502,
            { "Content-Type": "text/plain; charset=utf-8" },
            proxyError.message || "Supabase proxy request failed"
          );
          return;
        }

        var responseHeaders = Object.assign({}, proxied.headers || {});
        Object.keys(responseHeaders).forEach(function (name) {
          if (responseHeaders[name] === "") {
            delete responseHeaders[name];
          }
        });
        send(res, proxied.statusCode || 502, responseHeaders, proxied.body);
      });
    });

    return true;
  };
}

module.exports = {
  SUPABASE_PROXY_PATH: SUPABASE_PROXY_PATH,
  createSupabaseProxyHandler: createSupabaseProxyHandler,
  validateTargetUrl: validateTargetUrl
};
