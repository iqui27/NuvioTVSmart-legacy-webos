function collectionReleaseDate(value) {
  const normalized = String(value || "").trim();
  return normalized || "9999";
}

export function sortCollectionPartsByReleaseDate(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .map((part, index) => ({ part, index }))
    .sort((left, right) => {
      const dateOrder = collectionReleaseDate(left.part?.release_date).localeCompare(
        collectionReleaseDate(right.part?.release_date)
      );
      return dateOrder || left.index - right.index;
    })
    .map(({ part }) => part);
}
