// Lazy route registry.
//
// Stage 1a: the plumbing only. Every lazy route is registered synchronously at
// module-evaluation time with a placeholder ("stub") that sits in the router's
// route map until the real screen module is available. In this stage the
// resolver simply hands back the statically imported screen, so nothing is
// actually fetched and behaviour must be identical to the previous router. The
// point of the stage is to prove the reordered navigate/back sequence before a
// separate chunk exists.
//
// The stub is deliberately minimal. It exists to satisfy EXISTENCE checks
// (`this.routes[route]` truthiness, `cleanup?.()`, "is this a known route")
// and must never satisfy a BEHAVIOURAL one. Concretely it must NOT expose
// `getRouteStateKey`, `captureRouteState` or `clearRouteStateOnMount`:
//
//   * `getRouteStateKey`: the real screen derives the key from its params in a
//     way only it knows. A guessed key would make the router write a snapshot
//     under a key the real screen later computes differently, so the restore
//     silently misses and the user loses their scroll/playback position with no
//     error anywhere.
//   * `captureRouteState`: a stub returning `{}` would OVERWRITE a perfectly
//     good snapshot — most damagingly on the webOS suspend path, which captures
//     the current route state without being able to await anything.
//   * `clearRouteStateOnMount`: answering for the real screen would either
//     wipe a snapshot that should have been restored, or keep a stale one the
//     real screen wanted cleared.
//
// Every other consumer of the route map uses optional call syntax and already
// treats an absent hook as "unsupported", which is exactly the right answer for
// a screen that is not loaded yet. Omitting is strictly better than guessing.

export function createLazyRouteStub(routeName, chunkName, mount) {
  return {
    __lazyRoute: routeName,
    __chunk: chunkName,
    cleanup() {},
    mount
  };
}

export function isLazyRouteStub(screen) {
  return Boolean(screen && screen.__lazyRoute);
}

export const LazyRouteRegistry = {
  entries: new Map(),

  // Registers one lazy route. `resolve` returns the screen object or a promise
  // for it. `mount` is what the stub exposes as its own mount, i.e. the loader
  // path taken when something mounts the route without going through
  // `ensureRouteLoaded` first.
  register(routeName, { chunk, resolve, mount } = {}) {
    const route = String(routeName || "").trim();
    if (!route || typeof resolve !== "function") {
      return null;
    }
    const entry = {
      route,
      chunk: String(chunk || route),
      resolve,
      screen: null,
      pending: null
    };
    entry.stub = createLazyRouteStub(
      route,
      entry.chunk,
      typeof mount === "function" ? mount : createStubMount(entry)
    );
    this.entries.set(route, entry);
    return entry.stub;
  },

  isLazy(routeName) {
    return this.entries.has(routeName);
  },

  getStub(routeName) {
    return this.entries.get(routeName)?.stub || null;
  },

  // Synchronous probe. True once the real screen module is available.
  isLoaded(routeName) {
    return Boolean(this.entries.get(routeName)?.screen);
  },

  getLoaded(routeName) {
    return this.entries.get(routeName)?.screen || null;
  },

  // Returns a promise for the real screen, or null when the load failed. The
  // in-flight promise is memoised on the entry and cleared in `finally`, so a
  // failed load can be retried on the next navigation instead of poisoning the
  // route forever.
  load(routeName) {
    const entry = this.entries.get(routeName);
    if (!entry) {
      return Promise.resolve(null);
    }
    if (entry.screen) {
      return Promise.resolve(entry.screen);
    }
    if (entry.pending) {
      return entry.pending;
    }
    entry.pending = Promise.resolve()
      .then(() => entry.resolve())
      .then((screen) => {
        if (!screen || typeof screen.mount !== "function") {
          console.warn("Lazy route resolved without a mountable screen", routeName);
          return null;
        }
        entry.screen = screen;
        return screen;
      })
      .catch((error) => {
        console.warn("Failed to load lazy route", routeName, error);
        return null;
      })
      .then((screen) => {
        entry.pending = null;
        return screen;
      });
    return entry.pending;
  }
};

// Fallback mount used when a caller reaches the stub directly. It loads the
// real screen and forwards the mount. It never paints a fatal screen: a missing
// screen chunk must degrade, not kill the app.
function createStubMount(entry) {
  return async function stubMount(params, context) {
    const screen = await LazyRouteRegistry.load(entry.route);
    if (!screen) {
      return;
    }
    await screen.mount(params, context);
  };
}
