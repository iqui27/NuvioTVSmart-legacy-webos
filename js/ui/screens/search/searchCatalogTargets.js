import { catalogSkipStep, catalogSupportsExtra } from "../../../core/addons/homeCatalogs.js";

export { catalogSkipStep, catalogSupportsExtra };

export function catalogHasUnsupportedRequiredExtra(catalog = {}) {
  return (
    Array.isArray(catalog.extra) &&
    catalog.extra.some((entry) => {
      const name = String(entry?.name || "")
        .trim()
        .toLowerCase();
      return Boolean(entry?.isRequired) && name !== "search";
    })
  );
}

export function buildSearchTargets(addons = []) {
  const targets = [];
  addons.forEach((addon) => {
    (addon.catalogs || []).forEach((catalog) => {
      if (!catalogSupportsExtra(catalog, "search")) return;
      if (catalogHasUnsupportedRequiredExtra(catalog)) return;
      targets.push({
        addonBaseUrl: addon.baseUrl,
        addonId: addon.id,
        addonName: addon.displayName,
        catalogId: catalog.id,
        catalogName: catalog.name,
        type: catalog.apiType,
        supportsSkip: catalogSupportsExtra(catalog, "skip"),
        skipStep: catalogSkipStep(catalog)
      });
    });
  });
  return targets;
}

export function buildSearchScheduleIndices(targets = []) {
  const groups = [];
  const groupsByAddon = new Map();

  targets.forEach((target, index) => {
    const addonKey = `${String(target?.addonBaseUrl || "")}\u0000${String(target?.addonId || "")}`;
    let group = groupsByAddon.get(addonKey);
    if (!group) {
      group = [];
      groupsByAddon.set(addonKey, group);
      groups.push(group);
    }
    group.push(index);
  });

  const schedule = [];
  for (let depth = 0; schedule.length < targets.length; depth += 1) {
    groups.forEach((group) => {
      if (depth < group.length) schedule.push(group[depth]);
    });
  }
  return schedule;
}
