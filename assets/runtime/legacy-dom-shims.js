(function installLegacyDomShims(window) {
  "use strict";

  // addEventListener's `once` option arrived in Chrome 55; webOS TV 4.x runs
  // Chromium 53. The options object itself is understood there (capture and
  // passive landed in Chrome 49), so the call succeeds and only `once` is
  // dropped — the listener silently never removes itself. On the player that
  // means load/error handlers for logos and subtitle tracks re-fire and stack
  // up for the life of the session.
  //
  // Patching the prototype fixes the whole app and the bundled hls.js/dash.js
  // at once, which hand-editing call sites would not. Loaded from <head>,
  // before any listener is registered.
  var target =
    window.EventTarget && window.EventTarget.prototype
      ? window.EventTarget.prototype
      : window.Node && window.Node.prototype
        ? window.Node.prototype
        : null;

  if (!target || typeof target.addEventListener !== "function") {
    return;
  }

  var onceSupported = false;
  try {
    var probe = Object.defineProperty({}, "once", {
      get: function readOnce() {
        onceSupported = true;
        return false;
      }
    });
    window.addEventListener("nuvio-once-probe", null, probe);
    window.removeEventListener("nuvio-once-probe", null, probe);
  } catch (error) {
    onceSupported = false;
  }

  if (onceSupported) {
    return;
  }

  var originalAdd = target.addEventListener;
  var originalRemove = target.removeEventListener;

  // These two functions replace EventTarget.prototype.addEventListener and
  // removeEventListener for the entire session, so their cost is paid by every
  // listener the app, hls.js and dash.js ever register — and a D-pad UI churns
  // listeners on every focus move and every tile render. Two things matter here:
  //
  // 1. The fast paths forward with .call and explicit arguments. Passing the
  //    `arguments` object to .apply forces V8 to materialise it and blocks
  //    inlining of the wrapper, which on V8 5.3 (Chromium 53) is a real deopt on
  //    a very hot API.
  // 2. Wrappers live in a WeakMap rather than as a property on the listener
  //    function. Defining a property on a function object triggers a hidden
  //    class transition, and it made the lookup in removeEventListener
  //    megamorphic — every remove paid for a miss, whether or not `once` was
  //    ever used.
  var wrapperRegistry = typeof WeakMap === "function" ? new WeakMap() : null;
  var WRAPPER_KEY = "__nuvioOnceWrappers";

  function getWrappers(listener, create) {
    if (wrapperRegistry) {
      var found = wrapperRegistry.get(listener);
      if (!found && create) {
        found = {};
        wrapperRegistry.set(listener, found);
      }
      return found || null;
    }
    if (!listener[WRAPPER_KEY] && create) {
      try {
        Object.defineProperty(listener, WRAPPER_KEY, {
          value: {},
          writable: true,
          configurable: true,
          enumerable: false
        });
      } catch (error) {
        listener[WRAPPER_KEY] = {};
      }
    }
    return listener[WRAPPER_KEY] || null;
  }

  function wrapperKey(type, capture) {
    return String(type) + "::" + (capture ? "1" : "0");
  }

  function isCapture(options) {
    if (typeof options === "boolean") {
      return options;
    }
    return Boolean(options && options.capture);
  }

  target.addEventListener = function addEventListenerWithOnce(type, listener, options) {
    if (
      !options ||
      typeof options !== "object" ||
      !options.once ||
      typeof listener !== "function"
    ) {
      return originalAdd.call(this, type, listener, options);
    }

    var self = this;
    var key = wrapperKey(type, isCapture(options));

    var wrapper = function onceWrapper(event) {
      originalRemove.call(self, type, wrapper, options);
      var registered = getWrappers(listener, false);
      if (registered) {
        delete registered[key];
      }
      return listener.call(this, event);
    };

    // Keep the wrapper reachable from the original listener so a later
    // removeEventListener(type, listener) still finds what was registered.
    getWrappers(listener, true)[key] = wrapper;

    return originalAdd.call(this, type, wrapper, options);
  };

  target.removeEventListener = function removeEventListenerWithOnce(type, listener, options) {
    if (typeof listener === "function") {
      var registered = getWrappers(listener, false);
      if (registered) {
        var key = wrapperKey(type, isCapture(options));
        var wrapper = registered[key];
        if (wrapper) {
          delete registered[key];
          return originalRemove.call(this, type, wrapper, options);
        }
      }
    }
    return originalRemove.call(this, type, listener, options);
  };

  // `Element.prototype.closest` chegou no Chrome 41; o Chromium 38 do webOS 3
  // nao tem. Nao e detalhe: o motor de foco chama `target.closest(".screen")`
  // (js/ui/navigation/focusEngine.js) a cada movimento do D-pad, entao sem isto
  // a navegacao por controle remoto morre mesmo que o app inteiro carregue.
  //
  // `matches` sem prefixo e Chrome 34, logo esta disponivel; ainda assim os
  // prefixos ficam na cadeia porque custam nada e cobrem builds intermediarios.
  if (window.Element && !window.Element.prototype.closest) {
    var proto = window.Element.prototype;
    var matches =
      proto.matches ||
      proto.matchesSelector ||
      proto.webkitMatchesSelector ||
      proto.msMatchesSelector;

    if (matches) {
      proto.closest = function closest(selector) {
        var node = this;
        while (node && node.nodeType === 1) {
          if (matches.call(node, selector)) {
            return node;
          }
          node = node.parentElement || node.parentNode;
        }
        return null;
      };
    }
  }

  // `Node.isConnected` chegou no Chrome 51; o Chromium 38 do webOS 3 devolve
  // `undefined`. Nao e detalhe: o app consulta `node.isConnected` em 66 pontos,
  // e `undefined` e falso — entao TODO no e tratado como desconectado. A vitima
  // mais visivel e a hidratacao de imagens adiadas da home
  // (hydrateHomeLazyImages descarta cada fileira e cada <img> por
  // `!row.isConnected` / `!image.isConnected`), o que deixava os thumbnails do
  // continue watching permanentemente em branco no webOS 3: sao as unicas
  // imagens da primeira dobra que nascem com `data-src` em vez de `src`.
  // Getter no prototype, como o polyfill de referencia do DOM spec.
  if (window.Node && !("isConnected" in window.Node.prototype)) {
    Object.defineProperty(window.Node.prototype, "isConnected", {
      configurable: true,
      enumerable: true,
      get: function isConnected() {
        return (
          !this.ownerDocument ||
          !(
            this.ownerDocument.compareDocumentPosition(this) &
            this.DOCUMENT_POSITION_DISCONNECTED
          )
        );
      }
    });
  }
})(window);
