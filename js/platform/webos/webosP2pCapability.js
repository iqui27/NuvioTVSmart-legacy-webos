import { Platform } from "../index.js";

// O EngineFS (motor de torrent) roda dentro do servico Node embutido no app.
// webOS TV 4.x e anteriores rodam **Node v0.12**, e o runtime de midia
// (services/webos/runtime/media-http.cjs, ~5 MB em ES2018) nao e transpilavel
// para esse alvo — a tentativa produziu 1701 erros. Por isso o servico sobe em
// modo "proxy-only" nesses aparelhos: o servidor minimo existe (o proxy de
// imagem e o do Supabase dependem dele), mas nao ha motor de torrent.
//
// Consequencia medida numa OLED65C9 (webOS 4.10): as fontes de torrent aparecem
// normalmente na lista, e ao escolher uma o resolver morre com
// "webOS companion status request timed out" / "Playback engine: none", sem
// nenhuma porta de EngineFS em escuta. Do lado do usuario isso parece um
// defeito aleatorio — pior ainda porque a tela de Ajustes oferecia um
// interruptor de P2P, entao ele liga a opcao e continua sem funcionar. Foi
// exatamente o que aconteceu com um testador.
//
// O Tizen ja tinha esse tratamento (TizenCapabilities.isP2pUnsupported). Isto e
// o equivalente para webOS.
const MIN_WEBOS_MAJOR_WITH_ENGINEFS = 5;

export const WebOsP2pCapability = {
  isP2pUnsupported() {
    if (!Platform.isWebOS()) {
      return false;
    }
    const major = Number(Platform.getWebOsMajorVersion() || 0);
    // Versao desconhecida (0) nao e motivo para desabilitar: so bloqueia quando
    // se sabe que o aparelho e antigo demais.
    return major > 0 && major < MIN_WEBOS_MAJOR_WITH_ENGINEFS;
  }
};
