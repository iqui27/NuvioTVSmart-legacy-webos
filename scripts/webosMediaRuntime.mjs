import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import babel from "@babel/core";
import { parse as acornParse } from "acorn";

import { compatibilityPolicy } from "./compatibilityPolicy.mjs";

/*
 * The EngineFS media runtime ships as a 5 MB minified webpack bundle whose
 * lowest common syntax level is ES2018, while webOS TV 4.x hosts JS services on
 * Node v0.12.2 (V8 3.28) — measured on an OLED65C9, not just read off LG's
 * table. Node 0.12 fails to *parse* the bundle, so the service used to fall
 * back to a proxy-only server and torrent playback was simply unavailable.
 *
 * esbuild cannot do this job: it refuses to lower `class` to ES5, and every
 * const/let/destructuring inside a class body fails with it (1701 errors on
 * this bundle). Babel lowers all of it, including async/await via regenerator,
 * and the result parses as pure ES5.
 *
 * Two things Babel cannot fix on its own are handled here as well: a lookbehind
 * assertion, which V8 3.28 rejects when it compiles the regex literal, and the
 * `instanceof Uint8Array` guards that reject Buffers because Node 0.12 predates
 * Buffer being a Uint8Array subclass.
 */

const BABEL_TARGET = { node: compatibilityPolicy.webOsServiceNodeVersion };

// `/(?<=\W|\d)E(\d{2})/gi` scans a filename segment for episode markers. The
// replacement consumes the preceding character and then rewinds lastIndex past
// it, which reproduces the match positions the zero-width lookbehind produced,
// and pushes the bare "E01" the caller expects to slice.
const LOOKBEHIND_SITE = "var episodeMatch=x.match(/(?<=\\W|\\d)E(\\d{2})/gi);";
const LOOKBEHIND_REPLACEMENT =
  "var episodeMatch=(function(str){var re=/(\\W|\\d)(E\\d{2})/gi,out=null,m;" +
  "while(m=re.exec(str)){(out=out||[]).push(m[2]);re.lastIndex=m.index+m[1].length;}" +
  "return out;})(x);";

/*
 * The `/tracks` endpoint walks the container looking for audio/subtitle tracks.
 * It is not ffprobe: it streams the file through a demuxer and only gives up
 * once `bytesRead >= maxBytesLimit`. Upstream ships a 25 MiB budget read in
 * 15 MiB chunks — on a 20-40 GB movie served over BitTorrent those reads
 * compete with the video's own sequential piece requests, and the player gates
 * its first frame on the result, so the probe starves the playback it is
 * supposed to describe. Matroska/MP4 track headers live at the front of the
 * file, so a much smaller budget finds the same tracks; the smaller chunk keeps
 * a single probe request from monopolising the swarm.
 */
const TRACK_PROBE_PATCHES = [
  {
    what: "track probe byte budget (25 MiB -> 4 MiB)",
    from: "getTracksData(req.params.url,{maxBytesLimit:26214400})",
    to: "getTracksData(req.params.url,{maxBytesLimit:4194304})"
  },
  {
    what: "track probe chunk size (15 MiB -> 512 KiB)",
    from: "t.chunkSize=null!=n?n:15728640",
    to: "t.chunkSize=null!=n?n:524288"
  },
  /*
   * This one is a correctness fix, not a tuning knob, and it is why audio and
   * subtitle track discovery never worked on this TV.
   *
   * The HTTP reader seeds both its length and its chunk size from
   * `readableHighWaterMark`, a stream property that only exists from Node 8 on.
   * On Node 0.12 it is undefined, so `_read` computes
   * `Math.min(undefined, 0 + undefined) - 1` => NaN and issues the range header
   * `bytes=0-NaN`. The server can never satisfy that, so /tracks hangs until the
   * caller gives up — measured at >50 s, identically before and after the
   * budget changes above. contentLength is only a bootstrap value here: the real
   * length is read back from the response's Content-Range on the first chunk.
   */
  {
    what: "track probe reader seed (readableHighWaterMark is Node 8+)",
    from:
      "i.contentLength=i.readableHighWaterMark,i.bytesRead=0,i.bytesOffset=0," +
      "i.chunkSize=i.readableHighWaterMark,i",
    to:
      "i.contentLength=i.readableHighWaterMark||524288,i.bytesRead=0,i.bytesOffset=0," +
      "i.chunkSize=i.readableHighWaterMark||524288,i"
  },
  /*
   * Second half of the same breakage. `_read` builds its range from
   * `bytesOffset` and then, after the chunk arrives, does
   * `bytesOffset = chunk.length` instead of advancing by it. With a constant
   * chunk size every subsequent read asks for the identical byte range, so the
   * demuxer is fed the same bytes forever and the probe never terminates —
   * observed directly as `bytes=524288-1048575` repeating in the server log
   * until the client timed out. Advance the cursor instead.
   */
  {
    what: "track probe read cursor (assign -> advance)",
    from: "e.contentLength=i,e.bytesRead+=u.length,e.bytesOffset=u.length,e.push(u)",
    to: "e.contentLength=i,e.bytesRead+=u.length,e.bytesOffset+=u.length,e.push(u)"
  },
  /*
   * The reason the probe still never returned after the two fixes above:
   * `Readable.prototype.destroy` only arrived in Node 8, and BOTH continuations
   * of the probe call `t.destroy()` as their first statement, where `t` is a
   * plain stream.Readable subclass that defines no destroy of its own.
   *
   * On the failure path that TypeError fired before the reject, so nothing ever
   * stopped the reader: the byte-budget check tripped on the next `data` event,
   * threw again, and the read loop ran on — which is why a 4 MiB budget still
   * read ~29 MB and "Reached maxBytesLimit" never surfaced. On the success path
   * it threw before `u.format(n).then(e)`, so even a probe that parsed the
   * container correctly returned nothing. Two independent reasons /tracks was
   * dead; both are this one missing method.
   *
   * legacyNodePrelude.js installs __nuvioStopStream, which uses destroy() when
   * the platform has it and otherwise pauses, drops the data listener and pushes
   * EOF so awaiting callers settle instead of hanging.
   */
  {
    what: "track probe success path (Readable#destroy is Node 8+)",
    from: "f=function(n){t.destroy(),u&&u.format(n).then(e).catch(c)}",
    to: "f=function(n){__nuvioStopStream(t),u&&u.format(n).then(e).catch(c)}"
  },
  {
    what: "track probe failure path (Readable#destroy is Node 8+)",
    from: "c=function(e){t.destroy(),i(e)}",
    to: "c=function(e){__nuvioStopStream(t),i(e)}"
  },
  /*
   * The local-file reader carries the same two bugs already fixed above for the
   * HTTP reader, and was missed because /tracks over HTTP was the only path
   * being tested. It affects playback of a local file rather than a stream.
   */
  {
    what: "local-file reader seed (readableHighWaterMark is Node 8+)",
    from:
      "i.path=e,i.fileSize=f.size,i.bytesRead=0,i.bytesOffset=0," +
      "i.chunkSize=i.readableHighWaterMark",
    to:
      "i.path=e,i.fileSize=f.size,i.bytesRead=0,i.bytesOffset=0," +
      "i.chunkSize=i.readableHighWaterMark||524288"
  },
  {
    what: "local-file reader cursor (assign -> advance)",
    from: "e.bytesRead+=a.length,e.bytesOffset=a.length,e.push(a)",
    to: "e.bytesRead+=a.length,e.bytesOffset+=a.length,e.push(a)"
  }
  /*
   * NOT DONE ON PURPOSE: an EOF guard in `_read`.
   *
   * Neither reader signals EOF — once the cursor passes the end, `_read` still
   * issues a backwards range (`start=98681, end=98680` on a 98,681-byte file),
   * which `fs.createReadStream` rejects with "start must be <= end". Guarding on
   * `n > t` and pushing null looks like the obvious fix and was measured to be a
   * regression: the local probe went from a clean 140 ms response to a 45 s
   * timeout.
   *
   * The reason is that the bundled MP4/MKV demuxer's `_decode` has seek branches
   * that return a Promise whose executor calls the seek callback and then never
   * resolves or rejects. So the byte-budget check in the `data` handler is the
   * ONLY thing that can ever terminate a probe. Pushing EOF removes the last
   * `data` event and therefore removes the only brake.
   *
   * Making track contents actually parse means fixing that demuxer's promise
   * plumbing, which is a separate job from making /tracks terminate.
   */
];

const UINT8ARRAY_HELPER = "__nuvioIsUint8Array";

// Node 4 made Buffer a Uint8Array subclass. On V8 3.28 it is still a type of
// its own, so `x instanceof Uint8Array` rejects the Buffers the surrounding
// code produces — bittorrent-dht's kbucket throws "localNodeId is not a
// Uint8Array" and torrent creation dies with a 500. Rewriting the operator to a
// helper that also accepts Buffer restores the semantics the bundle was written
// against. legacyNodePrelude.js installs the helper as a global.
function bufferIsUint8ArrayPlugin() {
  return {
    name: "nuvio-buffer-is-uint8array",
    visitor: {
      BinaryExpression(nodePath) {
        const { node } = nodePath;
        if (node.operator !== "instanceof") return;
        if (node.right.type !== "Identifier" || node.right.name !== "Uint8Array") return;
        // Only rewrite the global; a local binding of that name is not ours.
        if (nodePath.scope.hasBinding("Uint8Array", true)) return;
        nodePath.replaceWith({
          type: "CallExpression",
          callee: { type: "Identifier", name: UINT8ARRAY_HELPER },
          arguments: [node.left]
        });
      }
    }
  };
}

function patchSyntaxV8CannotCompile(source) {
  if (!source.includes(LOOKBEHIND_SITE)) {
    throw new Error(
      "The episode-marker lookbehind was not found in the media runtime. The bundle " +
        "changed; re-check which regexes V8 3.28 cannot compile before shipping."
    );
  }

  const patched = source.split(LOOKBEHIND_SITE).join(LOOKBEHIND_REPLACEMENT);
  if (/\(\?<[=!]/.test(patched)) {
    throw new Error("A lookbehind assertion survived the media runtime patch.");
  }
  return patched;
}

function patchTrackProbeBudget(source) {
  let patched = source;
  for (const patch of TRACK_PROBE_PATCHES) {
    const occurrences = patched.split(patch.from).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Expected exactly one site for the ${patch.what} patch in the media runtime, ` +
          `found ${occurrences}. The bundle changed; re-locate it before shipping.`
      );
    }
    patched = patched.split(patch.from).join(patch.to);
  }
  return patched;
}

function assertRuntimeIsEs5(code) {
  // Node 0.12 fails to parse the bundle rather than misbehaving at runtime, and
  // the service swallows that into a proxy-only fallback — a regression here
  // would silently take torrent playback away again. Fail the build instead.
  try {
    acornParse(code, { ecmaVersion: 5 });
  } catch (error) {
    throw new Error(
      `The transpiled media runtime is not ES5 (${error.message}). ` +
        "Node 0.12 on webOS TV 4.x cannot parse it."
    );
  }

  if (code.includes("instanceof Uint8Array")) {
    throw new Error(
      "An `instanceof Uint8Array` guard survived transpilation; Buffers would be " +
        "rejected on Node 0.12."
    );
  }
}

function buildCacheKey(source) {
  return (
    createHash("sha256")
      .update("nuvio-media-runtime:3")
      .update(JSON.stringify(BABEL_TARGET))
      // Fold the source patches into the key so editing one invalidates the cache
      // on its own — a stale hit here ships the previous runtime silently.
      .update(JSON.stringify(TRACK_PROBE_PATCHES))
      .update(LOOKBEHIND_REPLACEMENT)
      .update(source)
      .digest("hex")
  );
}

/**
 * Transpiles the EngineFS bundle to ES5 and writes it to `outputPath`.
 * Results are cached by source hash because Babel walks 5 MB of minified code.
 */
export async function buildWebOsMediaRuntime({ sourcePath, outputPath, cacheDir }) {
  const original = await readFile(sourcePath, "utf8");
  const cacheKey = buildCacheKey(original);
  const cachePath = cacheDir ? path.join(cacheDir, `media-http.${cacheKey}.cjs`) : null;

  if (cachePath) {
    try {
      const cached = await readFile(cachePath, "utf8");
      await writeFile(outputPath, cached, "utf8");
      return { bytes: cached.length, cached: true };
    } catch {
      /* Nothing cached for this source; fall through and transpile. */
    }
  }

  const patched = patchTrackProbeBudget(patchSyntaxV8CannotCompile(original));

  const result = await babel.transformAsync(patched, {
    filename: path.basename(sourcePath),
    sourceType: "script",
    babelrc: false,
    configFile: false,
    compact: true,
    comments: false,
    generatorOpts: { compact: true },
    plugins: [bufferIsUint8ArrayPlugin],
    presets: [
      [
        "@babel/preset-env",
        {
          targets: BABEL_TARGET,
          bugfixes: true,
          // The bundle carries its own `typeof Symbol` guards; Babel's rewrite
          // of `typeof` only bloats it.
          exclude: ["transform-typeof-symbol"],
          modules: false
        }
      ]
    ]
  });

  assertRuntimeIsEs5(result.code);
  await writeFile(outputPath, result.code, "utf8");

  if (cachePath) {
    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, result.code, "utf8");
    } catch {
      /* A cold cache only costs a few seconds; never fail the build for it. */
    }
  }

  return { bytes: result.code.length, cached: false };
}
