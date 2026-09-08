export function createCatalogRow({
  addonId,
  addonName,
  addonBaseUrl,
  catalogId,
  catalogName,
  apiType,
  items = [],
  isLoading = false,
  hasMore = false,
  currentPage = 0,
  supportsSkip = false,
  skipStep = 100
}) {
  return {
    addonId,
    addonName,
    addonBaseUrl,
    catalogId,
    catalogName,
    apiType,
    items,
    isLoading,
    hasMore,
    currentPage,
    supportsSkip,
    skipStep
  };
}
