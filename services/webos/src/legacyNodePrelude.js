/*
 * Runtime prelude for webOS TV 4.x, whose JS service host is Node v0.12.2
 * (https://webostv.developer.lge.com/develop/guides/js-service-basics).
 *
 * esbuild lowers the *syntax* of the service to ES5, but it never adds missing
 * runtime APIs. Everything installed here is an ES6+ builtin the service code
 * and the bundled media runtime call directly and that V8 3.28 does not ship.
 *
 * This runs as the bundle banner, before any module body, and it patches
 * globals — so the EngineFS runtime loaded later through Module._compile in
 * serverHost.js inherits the same patches without needing its own copy.
 *
 * Must stay ES5: no const/let, no arrow functions, no template literals.
 */
(function installLegacyNodePolyfills(global) {
  "use strict";

  function define(target, name, value) {
    // Anything already present wins, whatever its type. Checking only for
    // functions was enough while every polyfill here was a method, but the
    // numeric constants below would otherwise try to redefine non-writable
    // natives on engines that already have them.
    if (!target || typeof target[name] !== "undefined") {
      return;
    }
    try {
      Object.defineProperty(target, name, {
        value: value,
        writable: true,
        configurable: true,
        enumerable: false
      });
    } catch (error) {
      target[name] = value;
    }
  }

  define(Object, "assign", function assign(target) {
    if (target === null || target === undefined) {
      throw new TypeError("Cannot convert undefined or null to object");
    }
    var output = Object(target);
    for (var i = 1; i < arguments.length; i += 1) {
      var source = arguments[i];
      if (source === null || source === undefined) {
        continue;
      }
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          output[key] = source[key];
        }
      }
    }
    return output;
  });

  define(Array, "from", function from(items, mapFn, thisArg) {
    if (items === null || items === undefined) {
      throw new TypeError("Array.from requires an array-like or iterable object");
    }
    var iterable = Object(items);
    var result = [];
    var iteratorKey = typeof Symbol === "function" && Symbol.iterator;
    var iteratorFactory = iteratorKey ? iterable[iteratorKey] : null;

    if (typeof iteratorFactory === "function") {
      var iterator = iteratorFactory.call(iterable);
      var step = iterator.next();
      var index = 0;
      while (!step.done) {
        result.push(mapFn ? mapFn.call(thisArg, step.value, index) : step.value);
        index += 1;
        step = iterator.next();
      }
      return result;
    }

    var length = Math.min(Math.max(Number(iterable.length) || 0, 0), 9007199254740991);
    for (var i = 0; i < length; i += 1) {
      result.push(mapFn ? mapFn.call(thisArg, iterable[i], i) : iterable[i]);
    }
    return result;
  });

  define(Array.prototype, "find", function find(predicate, thisArg) {
    if (this === null || this === undefined) {
      throw new TypeError("Array.prototype.find called on null or undefined");
    }
    if (typeof predicate !== "function") {
      throw new TypeError("predicate must be a function");
    }
    var list = Object(this);
    var length = list.length >>> 0;
    for (var i = 0; i < length; i += 1) {
      if (predicate.call(thisArg, list[i], i, list)) {
        return list[i];
      }
    }
    return undefined;
  });

  define(Array.prototype, "findIndex", function findIndex(predicate, thisArg) {
    if (this === null || this === undefined) {
      throw new TypeError("Array.prototype.findIndex called on null or undefined");
    }
    if (typeof predicate !== "function") {
      throw new TypeError("predicate must be a function");
    }
    var list = Object(this);
    var length = list.length >>> 0;
    for (var i = 0; i < length; i += 1) {
      if (predicate.call(thisArg, list[i], i, list)) {
        return i;
      }
    }
    return -1;
  });

  define(Array.prototype, "includes", function includes(target, fromIndex) {
    if (this === null || this === undefined) {
      throw new TypeError("Array.prototype.includes called on null or undefined");
    }
    var list = Object(this);
    var length = list.length >>> 0;
    var start = Number(fromIndex) || 0;
    if (start < 0) {
      start = Math.max(length + start, 0);
    }
    for (var i = start; i < length; i += 1) {
      // NaN never equals itself, so compare it separately.
      if (list[i] === target || (target !== target && list[i] !== list[i])) {
        return true;
      }
    }
    return false;
  });

  define(String.prototype, "includes", function includes(search, position) {
    return String.prototype.indexOf.call(this, search, position || 0) !== -1;
  });

  define(String.prototype, "startsWith", function startsWith(search, position) {
    var start = position || 0;
    return String.prototype.indexOf.call(this, search, start) === start;
  });

  define(String.prototype, "endsWith", function endsWith(search, length) {
    var text = String(this);
    var end = length === undefined ? text.length : Number(length);
    var target = String(search);
    var start = end - target.length;
    return start >= 0 && text.indexOf(target, start) === start;
  });

  define(String.prototype, "repeat", function repeat(count) {
    var times = Math.floor(Number(count) || 0);
    if (times < 0 || times === Infinity) {
      throw new RangeError("Invalid count value");
    }
    var text = String(this);
    var output = "";
    for (var i = 0; i < times; i += 1) {
      output += text;
    }
    return output;
  });

  function padWith(text, targetLength, padString, atStart) {
    var length = Math.floor(Number(targetLength) || 0);
    if (length <= text.length) {
      return text;
    }
    var filler = padString === undefined ? " " : String(padString);
    if (!filler) {
      return text;
    }
    var pad = "";
    while (pad.length < length - text.length) {
      pad += filler;
    }
    pad = pad.slice(0, length - text.length);
    return atStart ? pad + text : text + pad;
  }

  define(String.prototype, "padStart", function padStart(targetLength, padString) {
    return padWith(String(this), targetLength, padString, true);
  });

  define(String.prototype, "padEnd", function padEnd(targetLength, padString) {
    return padWith(String(this), targetLength, padString, false);
  });

  define(Number, "isFinite", function isFinite(value) {
    return typeof value === "number" && global.isFinite(value);
  });

  define(Number, "isInteger", function isInteger(value) {
    return typeof value === "number" && global.isFinite(value) && Math.floor(value) === value;
  });

  define(Number, "isNaN", function isNaN(value) {
    return typeof value === "number" && value !== value;
  });

  // ES6 numeric constants. Most bundled libraries guard these with
  // `Number.MAX_SAFE_INTEGER || 9007199254740991`, but torrent-stream does not:
  // it runs `opts.pulse || (opts.pulse = Number.MAX_SAFE_INTEGER)` and
  // `engine.pulse = Number.MAX_SAFE_INTEGER`. On V8 3.28 that assigns undefined,
  // every rate computation downstream becomes NaN, and the range request the
  // track probe issues goes out as `bytes=0-NaN` — which the server can never
  // satisfy, so /tracks hangs until the caller times out. Audio/subtitle track
  // discovery was dead on this TV for exactly this reason.
  define(Number, "MAX_SAFE_INTEGER", 9007199254740991);
  define(Number, "MIN_SAFE_INTEGER", -9007199254740991);
  define(Number, "EPSILON", Math.pow(2, -52));
  define(Number, "parseInt", global.parseInt);
  define(Number, "parseFloat", global.parseFloat);

  define(Math, "trunc", function trunc(value) {
    var number = Number(value);
    if (!global.isFinite(number) || number === 0) {
      return number;
    }
    return number > 0 ? Math.floor(number) : Math.ceil(number);
  });

  define(Math, "sign", function sign(value) {
    var number = Number(value);
    if (number !== number || number === 0) {
      return number;
    }
    return number > 0 ? 1 : -1;
  });

  // Buffer.from / Buffer.alloc landed in Node 4.5; 0.12 only has the
  // now-removed `new Buffer()` constructor forms.
  if (typeof global.Buffer === "function") {
    define(global.Buffer, "from", function from(value, encodingOrOffset, length) {
      if (typeof value === "number") {
        throw new TypeError("The first argument must not be of type number");
      }
      if (typeof value === "string") {
        return new global.Buffer(value, encodingOrOffset || "utf8");
      }
      if (value && typeof value === "object" && typeof value.byteLength === "number") {
        if (encodingOrOffset === undefined && length === undefined) {
          return new global.Buffer(value);
        }
        return new global.Buffer(value).slice(
          encodingOrOffset || 0,
          length === undefined ? undefined : (encodingOrOffset || 0) + length
        );
      }
      return new global.Buffer(value);
    });

    define(global.Buffer, "alloc", function alloc(size, fill, encoding) {
      var buffer = new global.Buffer(Math.max(Number(size) || 0, 0));
      buffer.fill(fill === undefined ? 0 : fill, 0, buffer.length, encoding);
      return buffer;
    });

    define(global.Buffer, "allocUnsafe", function allocUnsafe(size) {
      return new global.Buffer(Math.max(Number(size) || 0, 0));
    });
  }

  // Node 4 made Buffer a Uint8Array subclass; on V8 3.28 it is still its own
  // type, so every `x instanceof Uint8Array` guard in the media runtime rejects
  // the Buffers those same code paths produce — bittorrent-dht's kbucket throws
  // "localNodeId is not a Uint8Array" and torrent creation dies with a 500. The
  // runtime is transpiled with a plugin that rewrites that operator into a call
  // to this helper, which restores the modern-Node answer.
  if (typeof global.__nuvioIsUint8Array !== "function") {
    global.__nuvioIsUint8Array = function isUint8Array(value) {
      if (typeof global.Uint8Array === "function" && value instanceof global.Uint8Array) {
        return true;
      }
      return Boolean(global.Buffer) && global.Buffer.isBuffer(value);
    };
  }

  // `Readable.prototype.destroy` only arrived in Node 8. The track-probe reader
  // in the media runtime calls `t.destroy()` as the FIRST statement of both its
  // success and its failure continuation, so on V8 3.28 both threw a TypeError
  // before doing anything else: the failure path never rejected and never
  // stopped reading (the byte-budget check kept tripping and kept throwing, so
  // the probe walked the whole file), and the success path threw before handing
  // the parsed tracks back — audio and subtitle track discovery could not work
  // at all. The runtime is transpiled with a patch that routes both call sites
  // here instead.
  if (typeof global.__nuvioStopStream !== "function") {
    global.__nuvioStopStream = function stopStream(stream) {
      if (!stream) {
        return;
      }
      if (typeof stream.destroy === "function") {
        try {
          stream.destroy();
          return;
        } catch (error) {
          /* Fall through to the manual teardown below. */
        }
      }
      // Order matters: stop the flow first, then drop the consumer, then signal
      // EOF so anything still awaiting the stream settles instead of hanging.
      try {
        if (typeof stream.pause === "function") {
          stream.pause();
        }
      } catch (error) {
        /* ignore */
      }
      try {
        if (typeof stream.removeAllListeners === "function") {
          stream.removeAllListeners("data");
        }
      } catch (error) {
        /* ignore */
      }
      try {
        if (typeof stream.push === "function") {
          stream.push(null);
        }
      } catch (error) {
        /* ignore */
      }
    };
  }

  // The bundled media runtime references Symbol.asyncIterator. V8 3.28 has
  // Symbol but not this well-known symbol, and a missing one turns every
  // `obj[Symbol.asyncIterator]` lookup into a TypeError on undefined.
  if (typeof global.Symbol === "function" && !global.Symbol.asyncIterator) {
    try {
      global.Symbol.asyncIterator = global.Symbol("Symbol.asyncIterator");
    } catch (error) {
      /* Symbol is frozen on some builds; nothing else we can do here. */
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof global !== "undefined" ? global : this);
