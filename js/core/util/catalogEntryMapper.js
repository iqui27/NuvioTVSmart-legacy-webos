/**
 * Selects the catalog entries that are safe to render. Entries that are missing an id or a name are
 * dropped, duplicate ids keep only the first entry, and null or non object elements are ignored so a
 * single bad entry never breaks the whole row. The untouched entry count is returned so pagination
 * can advance by the number of entries the addon actually sent, matching the Android app.
 */

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isMappableCatalogEntry(meta) {
  return (
    Boolean(meta) &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    hasText(meta.id) &&
    hasText(meta.name)
  );
}

export function selectCatalogEntries(rawMetas) {
  const source = Array.isArray(rawMetas) ? rawMetas : [];
  const rawItemCount = source.length;
  const seenIds = new Set();
  const metas = [];
  for (const meta of source) {
    if (!isMappableCatalogEntry(meta)) {
      continue;
    }
    if (seenIds.has(meta.id)) {
      continue;
    }
    seenIds.add(meta.id);
    metas.push(meta);
  }
  return { metas, rawItemCount };
}
