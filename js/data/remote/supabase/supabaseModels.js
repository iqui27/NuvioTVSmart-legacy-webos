function readBooleanFlag(...values) {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

export function mapSupabaseProfile(row = {}) {
  return {
    id: row.id || "",
    name: row.name || "User",
    avatarColorHex: row.avatar_color_hex || "#1E88E5",
    avatarId: row.avatar_id || row.avatarId || null,
    avatarUrl: row.avatar_url || row.avatarUrl || null,
    profileBackgroundId:
      String(row.profile_background_id || row.profileBackgroundId || "").trim() || null,
    profileBackgroundUrl: row.profile_background_url || row.profileBackgroundUrl || null,
    usesPrimaryAddons: readBooleanFlag(row.uses_primary_addons, row.usesPrimaryAddons),
    usesPrimaryPlugins: readBooleanFlag(row.uses_primary_plugins, row.usesPrimaryPlugins),
    isPrimary: readBooleanFlag(row.is_primary, row.isPrimary)
  };
}
