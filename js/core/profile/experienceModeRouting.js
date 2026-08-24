import { addonRepository } from "../../data/repository/addonRepository.js";
import { ExperienceModeStore } from "../../data/local/experienceModeStore.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { ProfileSettingsSyncService } from "./profileSettingsSyncService.js";

export async function resolveExperienceRoute(profileId) {
  await ProfileSettingsSyncService.pull(profileId);

  let experience = ExperienceModeStore.getForProfile(profileId);
  const layout = LayoutPreferences.getForProfile(profileId);
  if (!experience.mode && layout.hasChosenLayout) {
    experience = ExperienceModeStore.setForProfile(profileId, { mode: "ADVANCED" });
    await ProfileSettingsSyncService.push(profileId);
  }

  if (!experience.mode) {
    return "experienceModeSelection";
  }
  if (experience.mode === "ESSENTIAL" && !experience.addonSetupSkipped) {
    const cachedAddons = addonRepository.getCachedInstalledAddons();
    const hasConfiguredAddon = addonRepository
      .getInstalledAddonUrls()
      .some((url) => addonRepository.isAddonEnabled(url));
    if (!cachedAddons.length && !hasConfiguredAddon) {
      return "essentialAddonSetup";
    }
  }
  return "home";
}
