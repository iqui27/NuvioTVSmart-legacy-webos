function isRtlCodePoint(codePoint) {
  return (
    (codePoint >= 0x05d0 && codePoint <= 0x05ea) ||
    (codePoint >= 0x0620 && codePoint <= 0x063f) ||
    (codePoint >= 0x0641 && codePoint <= 0x064a) ||
    (codePoint >= 0x066e && codePoint <= 0x066f) ||
    (codePoint >= 0x0671 && codePoint <= 0x06d3) ||
    (codePoint >= 0x06fa && codePoint <= 0x06fc) ||
    (codePoint >= 0x0710 && codePoint <= 0x072f) ||
    (codePoint >= 0x074d && codePoint <= 0x074f) ||
    (codePoint >= 0x0780 && codePoint <= 0x07b1) ||
    (codePoint >= 0x07ca && codePoint <= 0x07ea) ||
    (codePoint >= 0x0800 && codePoint <= 0x0815) ||
    (codePoint >= 0x0840 && codePoint <= 0x0858) ||
    (codePoint >= 0x08a0 && codePoint <= 0x08b4) ||
    (codePoint >= 0x08b6 && codePoint <= 0x08bd) ||
    (codePoint >= 0xfb1d && codePoint <= 0xfb28) ||
    (codePoint >= 0xfb2a && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfeff)
  );
}

function isUnicodeNumberCodePoint(codePoint) {
  return (
    (codePoint >= 0x0030 && codePoint <= 0x0039) ||
    (codePoint >= 0x0660 && codePoint <= 0x0669) ||
    (codePoint >= 0x06f0 && codePoint <= 0x06f9) ||
    (codePoint >= 0x07c0 && codePoint <= 0x07c9) ||
    (codePoint >= 0x0966 && codePoint <= 0x096f) ||
    (codePoint >= 0x09e6 && codePoint <= 0x09ef) ||
    (codePoint >= 0x0a66 && codePoint <= 0x0a6f) ||
    (codePoint >= 0x0ae6 && codePoint <= 0x0aef) ||
    (codePoint >= 0x0b66 && codePoint <= 0x0b6f) ||
    (codePoint >= 0x0be6 && codePoint <= 0x0bef) ||
    (codePoint >= 0x0c66 && codePoint <= 0x0c6f) ||
    (codePoint >= 0x0ce6 && codePoint <= 0x0cef) ||
    (codePoint >= 0x0d66 && codePoint <= 0x0d6f) ||
    (codePoint >= 0x0de6 && codePoint <= 0x0def) ||
    (codePoint >= 0x0e50 && codePoint <= 0x0e59) ||
    (codePoint >= 0x0ed0 && codePoint <= 0x0ed9) ||
    (codePoint >= 0x0f20 && codePoint <= 0x0f29) ||
    (codePoint >= 0x1040 && codePoint <= 0x1049) ||
    (codePoint >= 0x1090 && codePoint <= 0x1099) ||
    (codePoint >= 0x17e0 && codePoint <= 0x17e9) ||
    (codePoint >= 0x1810 && codePoint <= 0x1819) ||
    (codePoint >= 0x1946 && codePoint <= 0x194f) ||
    (codePoint >= 0x19d0 && codePoint <= 0x19d9) ||
    (codePoint >= 0x1a80 && codePoint <= 0x1a89) ||
    (codePoint >= 0x1a90 && codePoint <= 0x1a99) ||
    (codePoint >= 0x1b50 && codePoint <= 0x1b59) ||
    (codePoint >= 0x1bb0 && codePoint <= 0x1bb9) ||
    (codePoint >= 0x1c40 && codePoint <= 0x1c49) ||
    (codePoint >= 0xa620 && codePoint <= 0xa629) ||
    (codePoint >= 0xa8d0 && codePoint <= 0xa8d9) ||
    (codePoint >= 0xa900 && codePoint <= 0xa909) ||
    (codePoint >= 0xa9d0 && codePoint <= 0xa9d9) ||
    (codePoint >= 0xa9f0 && codePoint <= 0xa9f9) ||
    (codePoint >= 0xaa50 && codePoint <= 0xaa59) ||
    (codePoint >= 0xabf0 && codePoint <= 0xabf9) ||
    (codePoint >= 0xff10 && codePoint <= 0xff19)
  );
}

function isLtrCodePoint(codePoint) {
  return (
    (codePoint >= 0x0041 && codePoint <= 0x005a) ||
    (codePoint >= 0x0061 && codePoint <= 0x007a) ||
    (codePoint >= 0x00c0 && codePoint <= 0x02af) ||
    (codePoint >= 0x0370 && codePoint <= 0x058f) ||
    (codePoint >= 0x0900 && codePoint <= 0x1fff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff)
  );
}

/** Return the direction of the first strong Unicode character in content text. */
export function contentTextDirection(value = "") {
  for (const character of String(value || "")) {
    const codePoint = character.codePointAt(0) || 0;
    if (isUnicodeNumberCodePoint(codePoint)) {
      continue;
    }
    if (isRtlCodePoint(codePoint)) {
      return "rtl";
    }
    if (isLtrCodePoint(codePoint)) {
      return "ltr";
    }
  }
  return "ltr";
}

export function isContentRtl(value = "") {
  return contentTextDirection(value) === "rtl";
}
