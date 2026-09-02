import { httpRequest } from "../../../core/network/httpClient.js";
import { recordSyncFailure } from "../../../core/sync/syncBackoffPolicy.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../config.js";

/*
 * Um build sem local.properties sai com SUPABASE_URL vazia, e ai toda chamada virava
 * uma URL RELATIVA ("/rest/v1/rpc/..."). Num app file:// isso nao e um erro imediato:
 * a requisicao ainda desce pelo proxy Luna e so morre no teto de 22 s dele
 * (webosSupabaseProxy.js), cinco vezes em serie no arranque, alimentando o backoff
 * de sync como se o servidor estivesse fora. Foi exatamente o que os builds exp.20
 * a exp.28 fizeram na TV dos testadores.
 *
 * Falhar aqui, na hora e com o motivo, e sempre melhor que pendurar: um pacote mal
 * configurado passa a ser obvio em vez de virar "o app esta lento".
 */
function assertSupabaseConfigured() {
  if (!SUPABASE_URL) {
    throw new Error(
      "SUPABASE_URL is empty: this package was built without local.properties, so no account or sync request can work."
    );
  }
}

function trackSyncRequest(request) {
  return Promise.resolve(request).catch((error) => {
    recordSyncFailure(error);
    throw error;
  });
}

function buildHeaders(extra = {}, useSession = true) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    ...extra
  };
  if (!useSession && headers.Authorization == null) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
}

export const SupabaseApi = {
  rpc(functionName, body = {}, useSession = true) {
    assertSupabaseConfigured();
    return trackSyncRequest(
      httpRequest(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }, useSession),
        includeSessionAuth: useSession,
        body: JSON.stringify(body)
      })
    );
  },

  select(table, query = "", useSession = true) {
    assertSupabaseConfigured();
    const suffix = query ? `?${query}` : "";
    return trackSyncRequest(
      httpRequest(`${SUPABASE_URL}/rest/v1/${table}${suffix}`, {
        method: "GET",
        headers: buildHeaders({}, useSession),
        includeSessionAuth: useSession
      })
    );
  },

  upsert(table, rows, onConflict = null, useSession = true) {
    assertSupabaseConfigured();
    const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
    return trackSyncRequest(
      httpRequest(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        method: "POST",
        headers: buildHeaders(
          {
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=representation"
          },
          useSession
        ),
        includeSessionAuth: useSession,
        body: JSON.stringify(rows)
      })
    );
  },

  delete(table, query, useSession = true) {
    assertSupabaseConfigured();
    return trackSyncRequest(
      httpRequest(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        method: "DELETE",
        headers: buildHeaders({ Prefer: "return=representation" }, useSession),
        includeSessionAuth: useSession
      })
    );
  },

  downloadStorageObject(bucket, storagePath, useSession = true) {
    assertSupabaseConfigured();
    const normalizedBucket = encodeURIComponent(String(bucket || "").trim());
    const normalizedPath = String(storagePath || "")
      .trim()
      .replace(/^\/+/, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    if (!normalizedBucket || !normalizedPath) {
      return Promise.resolve(null);
    }
    return trackSyncRequest(
      httpRequest(
        `${SUPABASE_URL}/storage/v1/object/authenticated/${normalizedBucket}/${normalizedPath}`,
        {
          method: "GET",
          headers: buildHeaders({}, useSession),
          includeSessionAuth: useSession,
          responseType: "blob"
        }
      )
    );
  }
};
