const MAX_SAMPLE_BYTES = 4096;

const LANGUAGE_CHARSETS = new Map([
  ["heb", "windows-1255"],
  ["he", "windows-1255"],
  ["iw", "windows-1255"],
  ["ara", "windows-1256"],
  ["ar", "windows-1256"],
  ["ell", "windows-1253"],
  ["el", "windows-1253"],
  ["gre", "windows-1253"],
  ["tur", "windows-1254"],
  ["tr", "windows-1254"],
  ["tha", "windows-874"],
  ["th", "windows-874"],
  ["vie", "windows-1258"],
  ["vi", "windows-1258"],
  ["pol", "windows-1250"],
  ["pl", "windows-1250"],
  ["ces", "windows-1250"],
  ["cs", "windows-1250"],
  ["cze", "windows-1250"],
  ["hun", "windows-1250"],
  ["hu", "windows-1250"],
  ["slv", "windows-1250"],
  ["sl", "windows-1250"],
  ["hrv", "windows-1250"],
  ["hr", "windows-1250"],
  ["ron", "windows-1250"],
  ["ro", "windows-1250"],
  ["rum", "windows-1250"],
  ["slk", "windows-1250"],
  ["sk", "windows-1250"]
]);

const WESTERN_LANGUAGES = new Set([
  "por",
  "pt",
  "spa",
  "es",
  "fra",
  "fre",
  "fr",
  "deu",
  "ger",
  "de",
  "ita",
  "it",
  "nld",
  "dut",
  "nl",
  "eng",
  "en",
  "dan",
  "da",
  "swe",
  "sv",
  "nor",
  "no",
  "fin",
  "fi",
  "cat",
  "ca",
  "glg",
  "gl",
  "eus",
  "baq",
  "eu"
]);

function normalizeLanguage(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function languageBase(value) {
  return normalizeLanguage(value).split("-", 1)[0];
}

function charsetFromLanguage(languageHint) {
  const normalized = normalizeLanguage(languageHint);
  const language = languageBase(normalized);
  if (WESTERN_LANGUAGES.has(language)) {
    return "windows-1252";
  }
  if (
    ["rus", "ru", "ukr", "uk", "bel", "be", "bul", "bg", "mkd", "mk", "srp", "sr"].includes(
      language
    )
  ) {
    return "windows-1251";
  }
  if (["zho", "zh", "chi"].includes(language)) {
    if (/(?:^|-)(?:tw|hk)(?:-|$)|traditional|hant/.test(normalized)) {
      return "big5";
    }
    if (/(?:^|-)(?:cn|sg)(?:-|$)|simplified|hans/.test(normalized)) {
      return "gb18030";
    }
    return null;
  }
  if (["jpn", "ja"].includes(language)) {
    return "shift_jis";
  }
  if (["kor", "ko"].includes(language)) {
    return "euc-kr";
  }
  return LANGUAGE_CHARSETS.get(language) || null;
}

function charsetFromContentType(contentType) {
  const match = String(contentType || "").match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  if (!match) {
    return null;
  }
  const value = match[1].toLowerCase();
  if (["utf8", "utf-8", "unicode-1-1-utf-8", "us-ascii", "ascii"].includes(value)) {
    return "utf-8";
  }
  if (["iso-8859-1", "latin1", "latin-1"].includes(value)) {
    return "windows-1252";
  }
  return value;
}

function toBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function decodeWithCharset(bytes, charset) {
  if (typeof TextDecoder !== "function") {
    return null;
  }
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch (_) {
    return null;
  }
}

function isFastValidUtf8(bytes) {
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index++];
    if (first <= 0x7f) {
      continue;
    }
    if (first >= 0xc2 && first <= 0xdf) {
      if (index >= bytes.length || (bytes[index++] & 0xc0) !== 0x80) {
        return false;
      }
      continue;
    }
    if (first >= 0xe0 && first <= 0xef) {
      if (
        index + 1 >= bytes.length ||
        (bytes[index++] & 0xc0) !== 0x80 ||
        (bytes[index++] & 0xc0) !== 0x80
      ) {
        return false;
      }
      continue;
    }
    if (first >= 0xf0 && first <= 0xf4) {
      if (
        index + 2 >= bytes.length ||
        (bytes[index++] & 0xc0) !== 0x80 ||
        (bytes[index++] & 0xc0) !== 0x80 ||
        (bytes[index++] & 0xc0) !== 0x80
      ) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

function decodeCleanly(bytes, charset) {
  if (typeof TextDecoder !== "function") {
    return null;
  }
  try {
    // The detector only passes a bounded sample, which may end halfway through
    // a multibyte character. Keep malformed-byte rejection while preserving a
    // valid prefix when the sample boundary cuts only the final character.
    return new TextDecoder(charset, { fatal: true }).decode(bytes, { stream: true });
  } catch (_) {
    return null;
  }
}

function decodeByteRange(bytes, charset, predicate) {
  const text = decodeCleanly(bytes, charset);
  if (!text) {
    return 0;
  }
  return Array.from(text).filter(predicate).length;
}

function isBig5Clean(bytes) {
  const text = decodeWithCharset(bytes, "big5");
  return Boolean(text && !text.includes("\ufffd"));
}

function detectUniversalCharset(bytes) {
  let firstNonAscii = 0;
  while (firstNonAscii < bytes.length && bytes[firstNonAscii] < 0x80) {
    firstNonAscii += 1;
  }
  if (firstNonAscii >= bytes.length) {
    return "utf-8";
  }

  const sampleStart = Math.max(0, firstNonAscii - Math.min(100, firstNonAscii));
  const sample = bytes.subarray(sampleStart, sampleStart + MAX_SAMPLE_BYTES);
  let asciiLetters = 0;
  let nonAscii = 0;
  let consecutiveNonAscii = 0;
  let maxConsecutiveNonAscii = 0;
  for (const byte of sample) {
    if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)) {
      asciiLetters += 1;
      consecutiveNonAscii = 0;
    } else if (byte >= 0x80) {
      nonAscii += 1;
      consecutiveNonAscii += 1;
      maxConsecutiveNonAscii = Math.max(maxConsecutiveNonAscii, consecutiveNonAscii);
    } else {
      consecutiveNonAscii = 0;
    }
  }
  if (!nonAscii) {
    return "utf-8";
  }

  let hiraganaCount = 0;
  for (let index = 0; index < sample.length - 1; index += 1) {
    if (sample[index] === 0x82 && sample[index + 1] >= 0x9f && sample[index + 1] <= 0xf1) {
      hiraganaCount += 1;
    }
  }
  if (hiraganaCount >= 2) {
    return "shift_jis";
  }

  const hangulScore = decodeByteRange(sample, "euc-kr", (char) => {
    const code = char.codePointAt(0);
    return code >= 0xac00 && code <= 0xd7af;
  });
  const hanziScore = decodeByteRange(sample, "gb18030", (char) => {
    const code = char.codePointAt(0);
    return code >= 0x3400 && code <= 0x9fff;
  });
  if (hangulScore >= 4 && hangulScore >= hanziScore && maxConsecutiveNonAscii >= 4) {
    return "euc-kr";
  }

  const thaiEarly = sample.filter((byte) => byte >= 0xa1 && byte <= 0xbf).length;
  if (thaiEarly >= 4 && thaiEarly * 4 >= nonAscii) {
    return "windows-874";
  }

  if (hanziScore >= 4 && maxConsecutiveNonAscii >= 6) {
    let big5TrailCount = 0;
    for (let index = 0; index < sample.length - 1; index += 1) {
      if (
        sample[index] >= 0xa1 &&
        sample[index] <= 0xf9 &&
        sample[index + 1] >= 0x40 &&
        sample[index + 1] <= 0x7e
      ) {
        big5TrailCount += 1;
      }
    }
    return big5TrailCount >= 2 && isBig5Clean(sample) ? "big5" : "gb18030";
  }

  const scores = { turkish: 0, centralEuropean: 0, vietnamese: 0 };
  for (const byte of sample) {
    if ([0xf0, 0xfe, 0xfd, 0xd0, 0xde, 0xdd].includes(byte)) scores.turkish += 1;
    if (
      [
        0xb9, 0xb3, 0x9c, 0x9f, 0x9a, 0x9e, 0x8c, 0x8f, 0x8a, 0x8e, 0x8d, 0x9d, 0xcf, 0xef, 0xbe
      ].includes(byte)
    ) {
      scores.centralEuropean += 1;
    }
    if ([0xcc, 0xd2, 0xf2, 0xf5].includes(byte)) scores.vietnamese += 1;
  }
  if (asciiLetters >= nonAscii || maxConsecutiveNonAscii <= 2) {
    if (scores.turkish >= 2 && scores.turkish > scores.centralEuropean) return "windows-1254";
    if (scores.centralEuropean >= 2 && scores.centralEuropean >= scores.vietnamese) {
      return "windows-1250";
    }
    if (scores.vietnamese >= 2) return "windows-1258";
    return "windows-1252";
  }

  let thai = 0;
  let hebrew = 0;
  let arabicAl = 0;
  let russian = 0;
  let koi8 = 0;
  let greek = 0;
  let c0ToDf = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const byte = sample[index];
    if (byte >= 0xa1 && byte <= 0xbf) thai += 1;
    if (byte >= 0xe0 && byte <= 0xfa) hebrew += 1;
    if (byte >= 0xc0 && byte <= 0xdf) c0ToDf += 1;
    if ([0xee, 0xe0, 0xe5, 0xe8, 0xff, 0xfb, 0xf3, 0xfd, 0xfe].includes(byte)) russian += 1;
    if ([0xcf, 0xc1, 0xc5, 0xc9, 0xd5, 0xdf].includes(byte)) koi8 += 1;
    if (
      [
        0xe1, 0xef, 0xe5, 0xe7, 0xfd, 0xfe, 0xe9, 0xf5, 0xf9, 0xdc, 0xdd, 0xde, 0xdf, 0xfa, 0xfb,
        0xfc
      ].includes(byte)
    ) {
      greek += 1;
    }
    if (byte === 0xc7 && sample[index + 1] === 0xe1) arabicAl += 1;
  }
  if (hebrew === nonAscii && hebrew >= 4 && c0ToDf === 0) return "windows-1255";
  if (thai >= 4 && thai * 4 >= nonAscii) return "windows-874";
  if (arabicAl > 0) return "windows-1256";
  if (koi8 > russian && koi8 >= 3) return "koi8-r";
  if (russian > greek && russian >= 4) return "windows-1251";
  if (greek > russian && greek >= 4) return "windows-1253";
  return "windows-1252";
}

function latin1Bytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) return null;
    bytes[index] = code;
  }
  return bytes;
}

function repairDoubleEncodedUtf8IfNeeded(text, languageHint = "") {
  if (!text) return text;
  const language = languageBase(languageHint);
  const target = ["heb", "he", "iw"].includes(language)
    ? ["windows-1255", (char) => char >= "\u0590" && char <= "\u05ff"]
    : ["ara", "ar"].includes(language)
      ? ["windows-1256", (char) => char >= "\u0600" && char <= "\u06ff"]
      : ["ell", "el", "gre"].includes(language)
        ? ["windows-1253", (char) => char >= "\u0370" && char <= "\u03ff"]
        : ["rus", "ru", "ukr", "uk"].includes(language)
          ? ["windows-1251", (char) => char >= "\u0400" && char <= "\u04ff"]
          : null;
  const sourceBytes = latin1Bytes(text);
  if (!sourceBytes) return text;

  if (target) {
    const latin1Count = Array.from(text).filter(
      (char) => char >= "\u00e0" && char <= "\u00fa"
    ).length;
    if (latin1Count >= 5) {
      const candidate = decodeWithCharset(sourceBytes, target[0]);
      if (candidate && Array.from(candidate).filter(target[1]).length > 0) return candidate;
    }
    return text;
  }

  const words = text.split(/\s+/).filter((word) => word.length >= 2);
  const mojibakeWords = words.filter((word) =>
    Array.from(word).every((char) => /[\u00e0-\u00fa]|[<i>/<>,.!?:'"\\_()-]/.test(char))
  );
  if (mojibakeWords.length < 5 || mojibakeWords.length * 3 < words.length) return text;
  const candidate = decodeWithCharset(sourceBytes, "windows-1255");
  const hebrewCount = candidate
    ? Array.from(candidate).filter((char) => char >= "\u0590" && char <= "\u05ff").length
    : 0;
  return hebrewCount >= 10 ? candidate : text;
}

export function decodeSubtitleBytes(value, { languageHint = "", contentType = "" } = {}) {
  const bytes = toBytes(value);
  if (!bytes?.length) return "";

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return repairDoubleEncodedUtf8IfNeeded(
      decodeWithCharset(bytes.subarray(3), "utf-8") || "",
      languageHint
    );
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeWithCharset(bytes.subarray(2), "utf-16le") || "";
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeWithCharset(bytes.subarray(2), "utf-16be") || "";
  }

  if (isFastValidUtf8(bytes)) {
    return repairDoubleEncodedUtf8IfNeeded(decodeWithCharset(bytes, "utf-8") || "", languageHint);
  }

  const charset =
    charsetFromContentType(contentType) ||
    charsetFromLanguage(languageHint) ||
    detectUniversalCharset(bytes);
  return repairDoubleEncodedUtf8IfNeeded(decodeWithCharset(bytes, charset) || "", languageHint);
}

export function decodeSubtitleResponseBody(response, options = {}) {
  if (!response || typeof response.arrayBuffer !== "function") {
    return Promise.resolve(null);
  }
  return response.arrayBuffer().then((buffer) =>
    decodeSubtitleBytes(buffer, {
      ...options,
      contentType: options.contentType || response.headers?.get?.("content-type") || ""
    })
  );
}
