/**
 * Flat text chips for the source lists, derived in the app ("variante A").
 *
 * Earlier this module took the LABELS from the user's imported badge ruleset. That
 * worked but had two defects measured on the device: the ruleset emitted redundant
 * tokens (`HDR10` next to `HDR`, `DOLBY VISION` next to `HDR` on the same card,
 * because two rules matched the same trait), and every addon whose formatter was
 * not customised produced no tokens at all.
 *
 * So the tokens are parsed here instead, from the release text the addon already
 * sends. One pass, fixed priority, so redundancy cannot happen by construction:
 * `HDR` is only emitted when neither Dolby Vision nor an HDR10 flavour was found.
 *
 * Three visual levels, defined in components.css:
 *   accent  the container (MP4). On this TV Dolby Vision only survives an MP4
 *           container — a DV MKV plays back as its HDR10 base layer — so the
 *           container is the token that actually decides, and it leads the row.
 *   base    what qualifies the choice: resolution, DV, HDR flavour, Atmos, channels.
 *   muted   what only breaks ties: codec and source medium.
 */

const CONTAINER_MP4 = /\.mp4(?:$|[^a-z0-9])|(?:^|[^a-z0-9])mp4(?:$|[^a-z0-9])/i;
const CONTAINER_MKV = /\.mkv(?:$|[^a-z0-9])|(?:^|[^a-z0-9])mkv(?:$|[^a-z0-9])/i;

function streamReleaseText(stream = {}) {
  return [
    stream?.behaviorHints?.filename,
    stream?.raw?.behaviorHints?.filename,
    stream?.raw?.filename,
    stream?.filename,
    stream?.title,
    stream?.name,
    stream?.description
  ]
    .filter(Boolean)
    .join(" ");
}

export function streamIsMp4Container(stream = {}) {
  return CONTAINER_MP4.test(streamReleaseText(stream));
}

// `test` runs against the release text; the first entry that matches within a
// group wins, which is what keeps the row free of near-duplicates.
const TOKEN_GROUPS = [
  {
    name: "resolution",
    entries: [
      { label: "4K", test: /(?:^|[^a-z0-9])(?:2160p|4k|uhd)(?:$|[^a-z0-9])/i },
      { label: "1440P", test: /(?:^|[^a-z0-9])1440p(?:$|[^a-z0-9])/i },
      { label: "1080P", test: /(?:^|[^a-z0-9])1080p(?:$|[^a-z0-9])/i },
      { label: "720P", test: /(?:^|[^a-z0-9])720p(?:$|[^a-z0-9])/i },
      { label: "SD", test: /(?:^|[^a-z0-9])(?:480p|576p)(?:$|[^a-z0-9])/i }
    ]
  },
  {
    // Dolby Vision first: when a release carries both DV and HDR10 metadata the
    // DV flag is the one that describes what the panel can do with it.
    name: "dynamicRange",
    entries: [
      {
        label: "DOLBY VISION",
        test: /dolby[ ._-]?vision|(?:^|[^a-z0-9])(?:dv|dovi)(?:$|[^a-z0-9])/i
      },
      { label: "HDR10+", test: /hdr[ ._-]?10[ ._-]?\+|hdr10plus/i },
      { label: "HDR10", test: /(?:^|[^a-z0-9])hdr[ ._-]?10(?:$|[^a-z0-9])/i },
      { label: "HLG", test: /(?:^|[^a-z0-9])hlg(?:$|[^a-z0-9])/i },
      { label: "HDR", test: /(?:^|[^a-z0-9])hdr(?:$|[^a-z0-9])/i }
    ]
  },
  {
    name: "audioFormat",
    entries: [
      { label: "ATMOS", test: /(?:^|[^a-z0-9])atmos(?:$|[^a-z0-9])/i },
      { label: "TRUEHD", test: /(?:^|[^a-z0-9])true[ ._-]?hd(?:$|[^a-z0-9])/i },
      { label: "DTS-HD", test: /dts[ ._-]?hd|dts[ ._-]?x/i },
      // Lookahead, not a delimiter: `DDP5.1` is the common spelling and a
      // trailing-delimiter test misses it because a digit follows immediately.
      { label: "DD+", test: /(?:^|[^a-z0-9])(?:eac3|ec-?3|ddp|dd\+)(?=\d|$|[^a-z0-9])/i },
      { label: "DTS", test: /(?:^|[^a-z0-9])dts(?:$|[^a-z0-9])/i },
      { label: "DD", test: /(?:^|[^a-z0-9])(?:ac3|dd)(?:$|[^a-z0-9])/i }
    ]
  },
  {
    name: "channels",
    entries: [
      { label: "7.1", test: /(?:^|[^a-z0-9])7[ ._]1(?:$|[^a-z0-9])/ },
      { label: "5.1", test: /(?:^|[^a-z0-9])5[ ._]1(?:$|[^a-z0-9])/ },
      { label: "2.0", test: /(?:^|[^a-z0-9])2[ ._]0(?:$|[^a-z0-9])/ }
    ]
  },
  {
    name: "codec",
    muted: true,
    entries: [
      { label: "AV1", test: /(?:^|[^a-z0-9])av1(?:$|[^a-z0-9])/i },
      { label: "X265", test: /(?:^|[^a-z0-9])(?:x265|h[ ._-]?265|hevc)(?:$|[^a-z0-9])/i },
      { label: "X264", test: /(?:^|[^a-z0-9])(?:x264|h[ ._-]?264|avc)(?:$|[^a-z0-9])/i }
    ]
  },
  {
    name: "medium",
    muted: true,
    entries: [
      { label: "REMUX", test: /(?:^|[^a-z0-9])remux(?:$|[^a-z0-9])/i },
      { label: "BLURAY", test: /blu[ ._-]?ray|(?:^|[^a-z0-9])bd(?:rip)?(?:$|[^a-z0-9])/i },
      { label: "WEB-DL", test: /web[ ._-]?dl/i },
      { label: "WEBRIP", test: /web[ ._-]?rip/i },
      { label: "HDTV", test: /(?:^|[^a-z0-9])hdtv(?:$|[^a-z0-9])/i }
    ]
  }
];

/**
 * Returns `[{ label, variant }]` ready to render, container first.
 */
export function resolveStreamChips(stream = {}) {
  const text = streamReleaseText(stream);
  if (!text) {
    return [];
  }
  const chips = [];
  // MP4 gets the accent, MKV the muted treatment. Naming both is what makes the
  // distinction readable: a row where only some items carry a container chip
  // leaves you guessing whether the others are MKV or simply unlabelled. MKV is
  // muted rather than absent because it is the honest answer, not the good one —
  // this TV cannot output Dolby Vision from it.
  if (CONTAINER_MP4.test(text)) {
    chips.push({ label: "MP4", variant: "accent" });
  } else if (CONTAINER_MKV.test(text)) {
    chips.push({ label: "MKV", variant: "muted" });
  }
  TOKEN_GROUPS.forEach((group) => {
    for (let index = 0; index < group.entries.length; index += 1) {
      const entry = group.entries[index];
      if (entry.test.test(text)) {
        chips.push({ label: entry.label, variant: group.muted ? "muted" : "" });
        return;
      }
    }
  });
  return chips;
}

export function renderStreamChipRow(stream = {}, escapeHtml = (value) => value) {
  return resolveStreamChips(stream)
    .map(
      ({ label, variant }) =>
        `<span class="stream-route-stream-badge text${variant ? ` ${variant}` : ""}">${escapeHtml(label)}</span>`
    )
    .join("");
}
