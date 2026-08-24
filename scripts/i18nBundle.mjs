import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 * The app used to reach its first screen by XHR-ing res/values/strings.xml
 * (231,910 B, 2,698 <string> entries), running it through DOMParser,
 * querySelectorAll-ing every node and regexing each textContent — and then, for
 * any non-English locale, doing the whole thing again for
 * res/values-<locale>/strings.xml before merging. That is ~465 KB of XML and
 * ~5,400 node visits on a Chromium 53 TV, awaited before Router.init() exists.
 *
 * None of it depends on runtime state, so it is done here instead: one
 * already-merged JSON per locale, which the runtime reads with a single fetch
 * and JSON.parse. The XML stays in the package as a fallback, so a locale that
 * fails to precompile still works the old way.
 */

const DEFAULT_LOCALE = "en";
const STRING_ELEMENT = /<string\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g;

const XML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};

// The runtime path decoded entities via DOMParser and then applied its own
// \uXXXX pass, so both steps have to happen here for the output to be
// byte-identical to what the app used to build at boot.
function decodeXmlText(value) {
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (whole, name) => XML_ENTITIES[name] ?? whole)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function parseStringsXml(source, originLabel) {
  if (/<!\[CDATA\[/.test(source)) {
    throw new Error(
      `${originLabel} contains a CDATA section, which this parser does not handle. ` +
        "Extend decodeXmlText before relying on the precompiled locale bundles."
    );
  }

  const messages = {};
  let match;
  STRING_ELEMENT.lastIndex = 0;
  while ((match = STRING_ELEMENT.exec(source)) !== null) {
    const name = match[1].trim();
    if (name) {
      messages[name] = decodeXmlText(match[2]);
    }
  }
  return messages;
}

function localeFromDirName(dirName) {
  if (dirName === "values") return DEFAULT_LOCALE;
  const match = /^values-(.+)$/.exec(dirName);
  return match ? match[1] : null;
}

/**
 * Reads the strings.xml of every res/values directory and writes one merged
 * `<outDir>/<locale>.json` per locale. Returns a manifest for logging.
 */
export async function buildI18nBundles({ resDir, outDir }) {
  const entries = await readdir(resDir, { withFileTypes: true });
  const localeDirs = entries
    .filter((entry) => entry.isDirectory() && localeFromDirName(entry.name))
    .map((entry) => ({ locale: localeFromDirName(entry.name), dirName: entry.name }));

  const baseDir = localeDirs.find((entry) => entry.locale === DEFAULT_LOCALE);
  if (!baseDir) {
    throw new Error(`No res/values directory found in ${resDir}; cannot build locale bundles.`);
  }

  const baseXml = await readFile(path.join(resDir, baseDir.dirName, "strings.xml"), "utf8");
  const baseMessages = parseStringsXml(baseXml, "res/values/strings.xml");
  const baseKeyCount = Object.keys(baseMessages).length;
  if (baseKeyCount === 0) {
    throw new Error("res/values/strings.xml produced zero messages; the parser is broken.");
  }

  await mkdir(outDir, { recursive: true });

  const written = [];
  for (const entry of localeDirs) {
    const xmlPath = path.join(resDir, entry.dirName, "strings.xml");
    let messages = baseMessages;
    if (entry.locale !== DEFAULT_LOCALE) {
      let localizedXml = null;
      try {
        localizedXml = await readFile(xmlPath, "utf8");
      } catch {
        // A locale directory without strings.xml just inherits the base.
      }
      messages = localizedXml
        ? { ...baseMessages, ...parseStringsXml(localizedXml, `res/${entry.dirName}/strings.xml`) }
        : baseMessages;
    }

    const json = JSON.stringify(messages);
    await writeFile(path.join(outDir, `${entry.locale}.json`), json, "utf8");
    written.push({ locale: entry.locale, keys: Object.keys(messages).length, bytes: json.length });
  }

  return { baseKeyCount, locales: written };
}
