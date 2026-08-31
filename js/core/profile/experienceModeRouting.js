import { addonRepository } from "../../data/repository/addonRepository.js";
import { ExperienceModeStore } from "../../data/local/experienceModeStore.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";
import { ProfileSettingsSyncService } from "./profileSettingsSyncService.js";

function routeForExperience(experience) {
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

/**
 * Decide para qual tela ir depois da selecao de perfil.
 *
 * O pull das configuracoes do perfil so e AGUARDADO quando o estado local nao
 * responde a pergunta — ou seja, num perfil que ainda nao escolheu o modo. Com
 * o modo ja gravado, a rota nao depende da nuvem, e segurar a navegacao por
 * causa dela era o maior custo isolado do arranque: medido na OLED65C9,
 * `resolveExperienceRoute` levava 7148 ms, dos quais o `applyRemoteBlob` no
 * final usava 68,7 ms. Os outros ~7 s eram o usuario olhando uma tela parada
 * esperando um round trip do Supabase.
 *
 * O pull nao e refeito aqui de proposito: quem chama esta funcao dispara
 * `StartupSyncService.requestSyncNow()` logo depois do Router.navigate, e o
 * syncPull dele ja faz `ProfileSettingsSyncService.pull(profileId)`. Repetir o
 * pull solto nesta funcao so competia por rede e CPU com a carga dos catalogos
 * da Home. As configuracoes que o pull traz sao aplicadas quando chegam, e a
 * Home ja tem o caminho para isso: ela pinta a partir do estado local e o
 * `startup-sync-background` em loadData() compara a assinatura das preferencias
 * antes e depois do pull, recarregando em segundo plano se o que esta na tela
 * ficou obsoleto.
 */
export async function resolveExperienceRoute(profileId) {
  const localExperience = ExperienceModeStore.getForProfile(profileId);
  if (localExperience.mode) {
    return routeForExperience(localExperience);
  }

  await ProfileSettingsSyncService.pull(profileId);

  let experience = ExperienceModeStore.getForProfile(profileId);
  const layout = LayoutPreferences.getForProfile(profileId);
  if (!experience.mode && layout.hasChosenLayout) {
    experience = ExperienceModeStore.setForProfile(profileId, { mode: "ADVANCED" });
    await ProfileSettingsSyncService.push(profileId);
  }

  return routeForExperience(experience);
}
