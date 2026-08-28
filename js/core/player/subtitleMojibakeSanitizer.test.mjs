import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSubtitleMojibake } from "./subtitleMojibakeSanitizer.js";

test("matches the Android sanitizer mappings", () => {
  const cases = [
    ["â™ª lalala â™ª", "♪ lalala ♪"],
    ["â™« song playing â™«", "♫ song playing ♫"],
    ["â™ melody â™", "♪ melody ♪"],
    ["Itâ€™s great!", "It’s great!"],
    ["â€˜Helloâ€™", "‘Hello’"],
    ["â€œQuoteâ€", "“Quote”"],
    ["â€œQuoteâ€\u009D", "“Quote”"],
    ["Wait â€“ what â€” whyâ€¦", "Wait – what — why…"],
    ["Â¿Cómo estás? Â¡Bien!", "¿Cómo estás? ¡Bien!"],
    ["Â«HolaÂ»", "«Hola»"],
    ["HelloÂ world", "Hello world"],
    ["Hello \uFFFDworld\uFFFD", "Hello world"]
  ];

  for (const [input, expected] of cases) {
    assert.equal(sanitizeSubtitleMojibake(input), expected, input);
  }
});

test("leaves clean subtitle text unchanged", () => {
  const clean = "Hello, world! 123 ♪ ♫ “test”";
  assert.equal(sanitizeSubtitleMojibake(clean), clean);
});

test("returns non-string input unchanged", () => {
  assert.equal(sanitizeSubtitleMojibake(null), null);
  assert.equal(sanitizeSubtitleMojibake(undefined), undefined);
});
