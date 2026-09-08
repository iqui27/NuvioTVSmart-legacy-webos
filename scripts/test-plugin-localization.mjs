import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const resourcesDir = path.join(root, "res");

const requiredPluginKeys = [
  "plugin_type_nuvio_js",
  "plugin_type_external_dex",
  "plugin_type_legacy",
  "plugin_type_unknown",
  "plugin_runtime_ready",
  "plugin_runtime_error",
  "plugin_runtime_checking",
  "plugin_runtime_unsupported",
  "plugin_tv_model_unsupported",
  "plugin_dex_unsupported",
  "plugin_unknown_preserved",
  "plugin_runtime_tv_only",
  "plugin_runtime_heading",
  "plugin_settings_heading",
  "plugin_settings_subtitle",
  "plugin_repository_add_subtitle",
  "plugin_external_lists_count",
  "plugin_no_provider_code",
  "plugin_code_unavailable",
  "plugin_external_metadata_only",
  "plugin_metadata_only",
  "plugin_external_preserved",
  "plugin_providers_count",
  "plugin_unavailable_count",
  "plugin_profile_editable",
  "plugin_readonly_notice",
  "plugin_enable_all",
  "plugin_disable_all",
  "plugin_refresh_all",
  "plugin_refreshing",
  "plugin_adding",
  "plugin_repo_added_with_providers",
  "plugin_repo_refreshed",
  "plugin_repo_removed",
  "plugin_refresh_complete",
  "plugin_clear_cache",
  "plugin_cache_cleared",
  "plugin_preserved_heading",
  "plugin_preserved_subtitle",
  "plugin_security_note",
  "plugin_title",
  "plugin_subtitle",
  "plugin_enable_plugins_title",
  "plugin_enable_plugins_subtitle",
  "plugin_group_by_repository_title",
  "plugin_group_by_repository_subtitle",
  "plugin_repositories_section",
  "plugin_add_btn",
  "plugin_no_repos",
  "plugin_error_invalid_url",
  "plugin_error_add_repo",
  "plugin_error_refresh",
  "plugin_default_supported_types",
  "settings.plugins.addRepositoryPrompt",
  "settings.plugins.openSubtitle",
  "settings.plugins.refreshRepository",
  "settings.plugins.removeRepository"
];

const criticalKeys = [
  "plugin_tv_model_unsupported",
  "plugin_dex_unsupported",
  "plugin_unknown_preserved"
];

const sharedTechnicalKeys = new Set(["plugin_default_supported_types", "plugin_title"]);

function placeholders(value) {
  return [...String(value || "").matchAll(/%\d+\$[sd]/g)]
    .map((match) => match[0])
    .sort()
    .join("|");
}

function parseStringsXml(source, label) {
  const trimmed = String(source || "").trim();
  assert.match(
    trimmed,
    /^(?:<\?xml\b[\s\S]*?\?>\s*)?<resources\b[^>]*>/,
    `${label}: missing XML/resources root`
  );
  assert.match(trimmed, /<\/resources>$/, `${label}: resources root is not closed`);
  const openStrings = trimmed.match(/<string\b[^>]*>/g) || [];
  const closeStrings = trimmed.match(/<\/string>/g) || [];
  assert.equal(openStrings.length, closeStrings.length, `${label}: unbalanced string tags`);

  const messages = new Map();
  const pattern = /<string\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g;
  for (const match of trimmed.matchAll(pattern)) {
    const key = String(match[1] || "").trim();
    assert.ok(key, `${label}: empty string key`);
    assert.equal(messages.has(key), false, `${label}: duplicate string key ${key}`);
    messages.set(key, String(match[2] || ""));
  }
  assert.equal(messages.size, openStrings.length, `${label}: malformed string declaration`);
  return messages;
}

async function main() {
  const entries = await readdir(resourcesDir, { withFileTypes: true });
  const localeDirs = entries
    .filter((entry) => entry.isDirectory() && /^values(?:-.+)?$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.equal(localeDirs.length, 31, "Expected the 31 Web TV locales");

  const parsed = new Map();
  for (const localeDir of localeDirs) {
    const file = path.join(resourcesDir, localeDir, "strings.xml");
    parsed.set(localeDir, parseStringsXml(await readFile(file, "utf8"), file));
  }

  const base = parsed.get("values");
  for (const key of requiredPluginKeys) {
    assert.equal(base.has(key), true, `Base locale is missing plugin key ${key}`);
  }

  const untranslated = [];
  for (const [localeDir, messages] of parsed) {
    if (localeDir === "values") continue;
    for (const key of criticalKeys) {
      assert.equal(messages.has(key), true, `${localeDir} is missing localized key ${key}`);
    }
    const missing = requiredPluginKeys.filter((key) => !messages.has(key));
    assert.deepEqual(
      missing,
      [],
      `${localeDir} is missing localized plugin keys: ${missing.join(", ")}`
    );
    for (const key of requiredPluginKeys) {
      assert.equal(
        placeholders(messages.get(key)),
        placeholders(base.get(key)),
        `${localeDir}:${key} has a placeholder mismatch`
      );
      if (messages.get(key) === base.get(key) && !sharedTechnicalKeys.has(key)) {
        untranslated.push(`${localeDir}:${key}`);
      }
    }
  }
  assert.deepEqual(
    untranslated,
    [],
    `Plugin keys still equal the base locale: ${untranslated.join(", ")}`
  );

  console.log(`plugin localization tests passed (${localeDirs.length} locales)`);
}

await main();
