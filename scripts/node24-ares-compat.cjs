"use strict";

const Module = require("module");
const util = require("util");

if (typeof util.isDate !== "function") {
  util.isDate = function isDate(value) {
    return value instanceof Date;
  };
}

const originalLoad = Module._load;
const rimrafWrappers = new WeakMap();
const mkdirpWrappers = new WeakMap();

function createLegacyRimraf(rimrafModule) {
  if (rimrafWrappers.has(rimrafModule)) {
    return rimrafWrappers.get(rimrafModule);
  }

  const rimraf = rimrafModule.rimraf;
  const legacyRimraf = function legacyRimraf(path, options, callback) {
    const done = typeof options === "function" ? options : callback;
    const normalizedOptions = typeof options === "function" ? undefined : options;
    const promise = rimraf(path, normalizedOptions);

    if (typeof done === "function") {
      promise.then(() => done(null), done);
    }

    return promise;
  };

  Object.assign(legacyRimraf, rimrafModule);
  legacyRimraf.rimraf = legacyRimraf;
  legacyRimraf.sync = rimrafModule.sync || rimrafModule.rimrafSync;
  legacyRimraf.rimrafSync = rimrafModule.rimrafSync || rimrafModule.sync;

  rimrafWrappers.set(rimrafModule, legacyRimraf);
  return legacyRimraf;
}

function createLegacyMkdirp(mkdirpModule) {
  if (mkdirpWrappers.has(mkdirpModule)) {
    return mkdirpWrappers.get(mkdirpModule);
  }

  const legacyMkdirp = mkdirpModule;
  const wrappedMkdirp = function wrappedMkdirp(path, options, callback) {
    return legacyMkdirp(path, options, callback);
  };

  Object.assign(wrappedMkdirp, legacyMkdirp);
  wrappedMkdirp.mkdirp = function mkdirp(path, options, callback) {
    const done = typeof options === "function" ? options : callback;
    const normalizedOptions = typeof options === "function" ? undefined : options;

    if (typeof done === "function") {
      return legacyMkdirp.mkdirp(path, normalizedOptions, done);
    }

    return new Promise((resolve, reject) => {
      legacyMkdirp.mkdirp(path, normalizedOptions, (error, made) => {
        if (error) {
          reject(error);
        } else {
          resolve(made);
        }
      });
    });
  };
  wrappedMkdirp.mkdirP = wrappedMkdirp.mkdirp;

  mkdirpWrappers.set(mkdirpModule, wrappedMkdirp);
  return wrappedMkdirp;
}

Module._load = function loadWithAresCompat(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (
    request === "rimraf" &&
    typeof loaded !== "function" &&
    typeof loaded?.rimraf === "function"
  ) {
    return createLegacyRimraf(loaded);
  }
  if (request === "mkdirp" && typeof loaded === "function" && typeof loaded.mkdirp === "function") {
    return createLegacyMkdirp(loaded);
  }
  return loaded;
};
