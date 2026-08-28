/**
 * Merges a freshly fetched catalog page into the items already shown and
 * computes the next skip offset for pagination.
 *
 * Android's CatalogRow.mergeCatalogPage advances by the page offset reported
 * by the repository, with the returned page size as a fallback. The web
 * repository reports that offset from the raw addon payload, while `items`
 * only contains valid mapped entries; keeping both values avoids re-requesting
 * malformed or filtered entries. Duplicate items are removed by type and id,
 * matching Android's item identity.
 *
 * `displayItems` are the items to append (already filtered for display when
 * needed). `returnedCount` is the page count used by the fallback, while
 * `reportedNextSkip` and `reportedHasMore` are the repository's raw-aware
 * values when available.
 */

function itemKey(item) {
  const id = String(item?.id || "").trim();
  if (!id) {
    return "";
  }
  const type = String(item?.catalogType || item?.type || "")
    .trim()
    .toLowerCase();
  return type ? `${type}:${id}` : id;
}

export function mergeCatalogPage(
  existingItems,
  displayItems,
  currentSkip,
  returnedCount,
  reportedNextSkip,
  reportedHasMore
) {
  const items = Array.isArray(existingItems) ? [...existingItems] : [];
  const seen = new Set(items.map(itemKey).filter(Boolean));
  const incoming = Array.isArray(displayItems) ? displayItems : [];
  let addedCount = 0;
  incoming.forEach((item) => {
    const key = itemKey(item);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(item);
    addedCount += 1;
  });

  const skip = Number(currentSkip);
  const resolvedSkip = Number.isFinite(skip) ? Math.max(0, Math.trunc(skip)) : 0;
  const count = Number(returnedCount);
  const resolvedCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : incoming.length;
  const reportedSkip = Number(reportedNextSkip);
  const nextSkip =
    Number.isFinite(reportedSkip) && Math.trunc(reportedSkip) > resolvedSkip
      ? Math.trunc(reportedSkip)
      : resolvedSkip + resolvedCount;
  const hasMore = typeof reportedHasMore === "boolean" ? reportedHasMore : resolvedCount > 0;

  return { items, addedCount, nextSkip, hasMore };
}
