import { httpRequest } from "../../../core/network/httpClient.js";
import { recordSyncFailure } from "../../../core/sync/syncBackoffPolicy.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../config.js";

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
    return trackSyncRequest(
      httpRequest(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        method: "DELETE",
        headers: buildHeaders({ Prefer: "return=representation" }, useSession),
        includeSessionAuth: useSession
      })
    );
  },

  downloadStorageObject(bucket, storagePath, useSession = true) {
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
