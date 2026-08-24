import { AuthState } from "../../../core/auth/authState.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { SupabaseApi } from "./supabaseApi.js";

const MEMBER_TIERS = new Set(["SUPPORTER", "SUPPORTER_PLUS"]);
const EMPTY_OVERVIEW = Object.freeze({
  status: "inactive",
  tier: null,
  supporterSince: null,
  providerConnected: false,
  subscriptionActive: false,
  membershipLevel: null,
  currentPeriodEnd: null,
  cancelsAtPeriodEnd: false,
  hasActiveGrant: false,
  grantIsLifetime: false,
  grantExpiresAt: null,
  grantKind: null,
  grantTier: null,
  hasLifetimeGrant: false,
  lifetimeGrantTier: null,
  active: false
});

let state = {
  overview: null,
  isLoading: true,
  isRefreshing: false,
  hasError: false
};
let refreshPromise = null;
let authGeneration = 0;
const listeners = new Set();

function booleanValue(value) {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true";
}

function memberTier(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return MEMBER_TIERS.has(normalized) ? normalized : null;
}

function responseRow(payload) {
  if (Array.isArray(payload)) {
    return payload[0] || {};
  }
  if (Array.isArray(payload?.data)) {
    return payload.data[0] || {};
  }
  if (payload?.data && typeof payload.data === "object") {
    return payload.data;
  }
  return payload && typeof payload === "object" ? payload : {};
}

function normalizeOverview(payload) {
  const row = responseRow(payload);
  const hasActiveGrant = booleanValue(row.has_active_grant ?? row.hasActiveGrant);
  const subscriptionActive = booleanValue(
    row.subscription_access_active ?? row.subscriptionAccessActive
  );
  const hasLifetimeGrant =
    hasActiveGrant && booleanValue(row.has_lifetime_grant ?? row.hasLifetimeGrant);
  const status =
    String(row.status || "inactive")
      .trim()
      .toLowerCase() || "inactive";
  const tier = memberTier(row.tier);
  return {
    status,
    tier,
    supporterSince: row.supporter_since ?? row.supporterSince ?? null,
    providerConnected: booleanValue(row.provider_connected ?? row.providerConnected),
    subscriptionActive,
    membershipLevel: memberTier(row.membership_level ?? row.membershipLevel),
    currentPeriodEnd: row.current_period_end ?? row.currentPeriodEnd ?? null,
    cancelsAtPeriodEnd:
      subscriptionActive && booleanValue(row.cancels_at_period_end ?? row.cancelsAtPeriodEnd),
    hasActiveGrant,
    grantIsLifetime: hasActiveGrant && booleanValue(row.grant_is_lifetime ?? row.grantIsLifetime),
    grantExpiresAt: hasActiveGrant ? (row.grant_expires_at ?? row.grantExpiresAt ?? null) : null,
    grantKind: hasActiveGrant ? (row.grant_kind ?? row.grantKind ?? null) : null,
    grantTier: hasActiveGrant ? memberTier(row.grant_tier ?? row.grantTier) : null,
    hasLifetimeGrant,
    lifetimeGrantTier: hasLifetimeGrant
      ? memberTier(row.lifetime_grant_tier ?? row.lifetimeGrantTier)
      : null,
    active: status === "active" && tier != null
  };
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.warn("Membership overview listener failed", error);
    }
  });
}

function setState(next) {
  state = { ...state, ...next };
  notify();
  return state;
}

async function loadOverview({ resetPrevious = false } = {}) {
  if (refreshPromise) {
    return refreshPromise;
  }

  const generation = authGeneration;
  let requestPromise;
  requestPromise = (async () => {
    let previous = null;
    try {
      if (!AuthManager.isAuthenticated) {
        if (AuthManager.getAuthState() === AuthState.LOADING) {
          return setState({
            overview: null,
            isLoading: true,
            isRefreshing: false,
            hasError: false
          });
        }
        return setState({
          overview: EMPTY_OVERVIEW,
          isLoading: false,
          isRefreshing: false,
          hasError: false
        });
      }

      previous = resetPrevious ? null : state.overview;
      setState({
        overview: previous,
        isLoading: previous == null,
        isRefreshing: previous != null,
        hasError: false
      });

      const response = await SupabaseApi.rpc("get_my_membership_overview", {}, true);
      if (generation !== authGeneration || !AuthManager.isAuthenticated) {
        return state;
      }
      return setState({
        overview: normalizeOverview(response),
        isLoading: false,
        isRefreshing: false,
        hasError: false
      });
    } catch (error) {
      if (generation !== authGeneration || !AuthManager.isAuthenticated) {
        return state;
      }
      console.warn("Unable to load membership overview", error);
      return setState({
        overview: previous,
        isLoading: false,
        isRefreshing: false,
        hasError: true
      });
    }
  })().finally(() => {
    if (refreshPromise === requestPromise) {
      refreshPromise = null;
    }
  });
  refreshPromise = requestPromise;
  return requestPromise;
}

AuthManager.subscribe((authState) => {
  if (authState === AuthState.LOADING) {
    authGeneration += 1;
    refreshPromise = null;
    setState({ overview: null, isLoading: true, isRefreshing: false, hasError: false });
    return;
  }
  if (authState === AuthState.SIGNED_OUT) {
    authGeneration += 1;
    refreshPromise = null;
    setState({
      overview: EMPTY_OVERVIEW,
      isLoading: false,
      isRefreshing: false,
      hasError: false
    });
    return;
  }
  authGeneration += 1;
  refreshPromise = null;
  setState({ overview: null, isLoading: true, isRefreshing: false, hasError: false });
  void loadOverview({ resetPrevious: true });
});

export const MembershipOverviewRepository = {
  getState() {
    return state;
  },

  refresh() {
    return loadOverview();
  },

  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }
};
