var nodeUrl = require("url");
var querystring = require("querystring");

/*
 * webOS TV 4.x runs JS services on Node v0.12.2, which has no WHATWG `URL` —
 * `typeof URL` is literally "undefined" there. Every proxy handler in this
 * service parses its request with `new URL(...)` inside a try/catch that treats
 * a throw as "not my request", so on a real TV the ReferenceError made the
 * account, image and debrid proxies silently decline everything and the app saw
 * express answer "Cannot POST /supabase-proxy". Addons never loaded and no
 * debrid could be linked.
 *
 * This exports the global when the platform has one and falls back to a shim
 * built on the legacy `url` module otherwise. The shim covers exactly what this
 * service uses: absolute parsing, base-relative resolution, the component
 * getters, href/toString, and searchParams.get. It is deliberately not exported
 * as a global — the bundled media runtime carries its own URL implementation
 * and branches on whether one exists, and it currently works.
 */

function LegacySearchParams(query) {
  this._values = query ? querystring.parse(String(query)) : {};
}

LegacySearchParams.prototype.get = function get(name) {
  var value = this._values[name];
  if (value === undefined) {
    return null;
  }
  return Array.isArray(value) ? (value.length ? String(value[0]) : null) : String(value);
};

LegacySearchParams.prototype.getAll = function getAll(name) {
  var value = this._values[name];
  if (value === undefined) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map(String);
};

LegacySearchParams.prototype.has = function has(name) {
  return Object.prototype.hasOwnProperty.call(this._values, name);
};

LegacySearchParams.prototype.toString = function toString() {
  return querystring.stringify(this._values);
};

function LegacyURL(input, base) {
  var raw = String(input === undefined ? "" : input);
  // `new URL(relative, base)` accepts a URL object as the base; String() picks
  // up our own toString, so both a string and a LegacyURL work here.
  var resolved = base === undefined || base === null ? raw : nodeUrl.resolve(String(base), raw);
  var parsed = nodeUrl.parse(resolved, false, true);

  if (!parsed.protocol) {
    throw new TypeError("Invalid URL: " + raw);
  }

  this.protocol = parsed.protocol;
  this.hostname = parsed.hostname || "";
  this.port = parsed.port || "";
  this.host = parsed.host || "";
  this.pathname = parsed.pathname || "/";
  this.search = parsed.search || "";
  this.hash = parsed.hash || "";
  this.origin = this.host ? this.protocol + "//" + this.host : "null";
  this.href = nodeUrl.format(parsed);
  this.searchParams = new LegacySearchParams(parsed.query);
}

LegacyURL.prototype.toString = function toString() {
  return this.href;
};

LegacyURL.prototype.toJSON = function toJSON() {
  return this.href;
};

module.exports = {
  URL: typeof URL === "function" ? URL : LegacyURL,
  URLSearchParams: typeof URLSearchParams === "function" ? URLSearchParams : LegacySearchParams,
  LegacyURL: LegacyURL
};
