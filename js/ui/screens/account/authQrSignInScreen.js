import { Router } from "../../navigation/router.js";
import { QrLoginService } from "../../../core/auth/qrLoginService.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { SessionStore } from "../../../core/storage/sessionStore.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { I18n } from "../../../i18n/index.js";
import { Platform } from "../../../platform/index.js";
import { renderBrandWordmarkImage } from "../../components/brandWordmark.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import { PluginManager } from "../../../core/player/pluginManager.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { ServerConfigurationStore } from "../../../data/local/serverConfigurationStore.js";
import { WatchProgressStore } from "../../../data/local/watchProgressStore.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";
import {
  supportsEmailPasswordAuth,
  supportsTvLogin
} from "../../../core/server/serverConfiguration.js";

const GUEST_QR_BYPASS_KEY = "skipAuthQrGate";

function decodeJwtPayload(token) {
  try {
    if (typeof atob !== "function") return null;
    const [, payload] = String(token || "").split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch (_) {
    return null;
  }
}

function connectedAccountIdentity() {
  const payload = decodeJwtPayload(SessionStore.accessToken);
  return {
    email: String(payload?.email || payload?.user_metadata?.email || "").trim(),
    userId: String(payload?.sub || "").trim()
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function focusNode(node) {
  if (!node) {
    return;
  }
  const scope = node.closest?.(".qr-email-form") || node.parentElement;
  scope?.querySelectorAll?.(".focusable.focused").forEach((focusedNode) => {
    if (focusedNode !== node) {
      focusedNode.classList.remove("focused");
    }
  });
  node.classList.add("focused");
  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    node.focus?.();
  }
}

function formatDuration(millis) {
  const totalSeconds = Math.max(0, Math.floor(Number(millis || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseQrExpiration(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export const AuthQrSignInScreen = {
  async mount({ onboardingMode = false } = {}) {
    this.container = document.getElementById("account");
    this.onboardingMode = Boolean(onboardingMode);
    this.hasBackDestination = Router.stack.length > 0;
    this.isMounted = true;
    this.isLeaving = false;
    this.isStartingQr = false;
    this.isPolling = false;
    this.isEmailSubmitting = false;
    this.email = "";
    this.password = "";
    this.emailError = "";
    this.isServerMenuOpen = false;
    this.focusAfterRender = null;
    this.showSignOutConfirmation = false;
    this.isSignedIn = AuthManager.isAuthenticated;
    this.connectedStats = null;
    this.isConnectedStatsLoading = this.isSignedIn;
    this.serverConfiguration = ServerConfigurationStore.getActive();
    this.useEmailLogin = supportsEmailPasswordAuth(this.serverConfiguration);
    this.useQrLogin = supportsTvLogin(this.serverConfiguration) && !this.useEmailLogin;
    ScreenUtils.show(this.container);
    this.render();

    if (this.useQrLogin && !this.isSignedIn) {
      void this.startQr().catch((error) => {
        if (!this.isMounted || this.isLeaving) {
          return;
        }
        console.warn("QR login background start failed", error);
        this.setStatus(this.toFriendlyQrError(error?.message || error));
      });
    }
    if (this.isSignedIn) {
      void this.loadConnectedStats();
    }
  },

  render() {
    if (!this.container || !this.isMounted) {
      return;
    }

    const configuration = this.serverConfiguration || ServerConfigurationStore.getActive();
    const menuItems = configuration?.isCustom
      ? [
          { action: "use-official", label: I18n.t("server_options_use_official") },
          { action: "connect-custom", label: I18n.t("server_options_change_custom") }
        ]
      : [{ action: "connect-custom", label: I18n.t("server_options_connect_custom") }];

    this.container.innerHTML = `
      <div class="qr-layout">
        <button type="button" class="qr-server-menu-trigger focusable" data-action="server-menu"
                aria-label="${escapeHtml(I18n.t("server_options_content_description"))}">⋮</button>
        <section class="qr-left-panel">
          <div class="qr-brand-lockup">
            ${renderBrandWordmarkImage({ className: "qr-logo" })}
          </div>

          <div class="qr-copy-block">
            <h1 class="qr-title">${I18n.t("auth.qr.title")}</h1>
            <p id="qr-description" class="qr-description">${this.getLeftDescription()}</p>
            ${this.renderConnectedAccountIdentity()}
          </div>
        </section>

        <section class="qr-card-panel" aria-label="${escapeHtml(I18n.t("auth.qr.cardAriaLabel"))}">
          <div class="qr-card">
            <header class="qr-card-header">
              <h2 class="qr-card-title">${I18n.t("auth.qr.cardTitle")}</h2>
              <p id="qr-card-subtitle" class="qr-card-subtitle">${this.getCardSubtitle()}</p>
            </header>

            <p class="qr-login-instruction">
              ${
                this.isSignedIn
                  ? I18n.t("auth.qr.syncedData")
                  : this.useEmailLogin
                    ? I18n.t("auth.email.instruction")
                    : I18n.t("auth.qr.scanInstruction")
              }
            </p>
            ${this.renderLoginContent()}
            ${!this.isSignedIn ? this.renderTermsAcknowledgement() : ""}
            <div class="qr-actions">${this.renderActions()}</div>
          </div>
        </section>

        ${this.isServerMenuOpen ? this.renderServerMenu(menuItems) : ""}
        ${this.showSignOutConfirmation ? this.renderSignOutConfirmation() : ""}
      </div>
    `;

    this.bindControls();
    ScreenUtils.indexFocusables(this.container);
    const initialSelector = this.showSignOutConfirmation
      ? ".server-dialog-cancel"
      : this.isServerMenuOpen
        ? ".qr-server-menu-item.focusable"
        : this.focusAfterRender ||
          (this.useEmailLogin && !this.isSignedIn ? "#auth-email-input" : "#qr-refresh-btn");
    const focusContainer = this.showSignOutConfirmation
      ? this.container.querySelector(".auth-signout-confirm-dialog")
      : this.container;
    this.focusAfterRender = null;
    ScreenUtils.setInitialFocus(focusContainer, initialSelector);
  },

  renderLoginContent() {
    if (this.isSignedIn) {
      return this.renderConnectedStats();
    }
    if (this.useEmailLogin) {
      return `
        <form id="auth-email-form" class="qr-email-form" novalidate>
          <label class="qr-input-label" for="auth-email-input">${escapeHtml(I18n.t("auth.email.emailLabel"))}</label>
          <input id="auth-email-input" class="qr-auth-input focusable" data-action="email-input"
                 type="email" autocomplete="username" autocapitalize="none" spellcheck="false"
                 placeholder="${escapeHtml(I18n.t("auth.email.placeholder"))}"
                 value="${escapeHtml(this.email)}" />
          <label class="qr-input-label" for="auth-password-input">${escapeHtml(I18n.t("auth.email.passwordLabel"))}</label>
          <input id="auth-password-input" class="qr-auth-input focusable" data-action="password-input"
                 type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false"
                 placeholder="${escapeHtml(I18n.t("auth.email.passwordPlaceholder"))}"
                 value="${escapeHtml(this.password)}" />
          <button type="button" id="auth-email-submit" class="qr-action-btn qr-action-btn-primary focusable"
                  data-action="email-submit" ${this.isEmailSubmitting ? "disabled" : ""}>
            ${escapeHtml(
              I18n.t(this.isEmailSubmitting ? "auth.email.signingIn" : "auth.email.signIn")
            )}
          </button>
          ${this.emailError ? `<p class="qr-login-error" role="alert">${escapeHtml(this.emailError)}</p>` : ""}
        </form>
      `;
    }

    return `
      <div id="qr-container" class="qr-code-frame"></div>
      <div id="qr-manual-text" class="qr-manual-text"></div>
      <div id="qr-code-text" class="qr-code-text"></div>
      <div id="qr-expiry" class="qr-expiry"></div>
      <div id="qr-status" class="qr-status">${escapeHtml(I18n.t("auth.qr.waitingApproval"))}</div>
    `;
  },

  renderConnectedAccountIdentity() {
    if (!this.isSignedIn) return "";
    const { email, userId } = connectedAccountIdentity();
    if (!email && !userId) return "";
    return `
      <div class="qr-connected-identity">
        ${email ? `<span class="qr-connected-email">${escapeHtml(email)}</span>` : ""}
        ${userId ? `<span class="qr-connected-user-id">${escapeHtml(userId)}</span>` : ""}
      </div>
    `;
  },

  renderConnectedStats() {
    const values = this.isConnectedStatsLoading
      ? ["...", "...", "...", "..."]
      : [
          this.connectedStats?.addons ?? 0,
          this.connectedStats?.plugins ?? 0,
          this.connectedStats?.library ?? 0,
          this.connectedStats?.watchProgress ?? 0
        ];
    const labels = [
      "account_stat_addons",
      "account_stat_plugins",
      "account_stat_library",
      "account_stat_progress"
    ];
    return `
      <div id="qr-connected-stats" class="qr-connected-stats" aria-label="${escapeHtml(
        I18n.t("auth.qr.syncedData")
      )}">
        <div class="qr-connected-stats-line" aria-hidden="true"></div>
        <div class="qr-connected-stats-row">
          ${values
            .map(
              (value, index) => `
                <div class="qr-connected-stat">
                  <strong>${escapeHtml(value)}</strong>
                  <span>${escapeHtml(I18n.t(labels[index]))}</span>
                </div>
                ${
                  index === values.length - 1
                    ? ""
                    : '<div class="qr-connected-stats-divider" aria-hidden="true"></div>'
                }
              `
            )
            .join("")}
        </div>
        <div class="qr-connected-stats-line" aria-hidden="true"></div>
      </div>
    `;
  },

  updateConnectedStats() {
    const statsNode = this.container?.querySelector("#qr-connected-stats");
    if (statsNode) {
      statsNode.outerHTML = this.renderConnectedStats();
    }
  },

  async loadConnectedStats() {
    if (!this.isMounted || !this.isSignedIn) return;
    const profileId = ProfileManager.getActiveProfileId();
    try {
      const library = await savedLibraryRepository.getAll(1000, profileId);
      if (!this.isMounted || !this.isSignedIn) return;
      this.connectedStats = {
        addons: addonRepository.getInstalledAddonUrls().length,
        plugins: PluginManager.listRepositories().length,
        library: Array.isArray(library) ? library.length : 0,
        watchProgress: WatchProgressStore.listForProfile(profileId).length
      };
    } catch (error) {
      console.warn("Unable to load connected account stats", error);
      if (this.isMounted && this.isSignedIn) {
        this.connectedStats = { addons: 0, plugins: 0, library: 0, watchProgress: 0 };
      }
    } finally {
      if (this.isMounted && this.isSignedIn) {
        this.isConnectedStatsLoading = false;
        this.updateConnectedStats();
      }
    }
  },

  renderTermsAcknowledgement() {
    return `
      <div class="qr-terms">
        <span>${escapeHtml(I18n.t("auth_qr_terms_prefix"))}</span>
        <button type="button" class="qr-terms-link focusable" data-action="terms">
          ${escapeHtml(I18n.t("auth_qr_terms_link"))}
        </button>
      </div>
    `;
  },

  renderActions() {
    const backLabel = this.getBackButtonLabel();
    const refreshAction = this.isSignedIn
      ? `<button type="button" id="qr-refresh-btn" class="qr-action-btn qr-action-btn-secondary focusable" data-action="signout">
           ${escapeHtml(I18n.t("auth.account.signOut"))}
         </button>`
      : this.useEmailLogin
        ? ""
        : `<button type="button" id="qr-refresh-btn" class="qr-action-btn qr-action-btn-primary focusable" data-action="refresh">
             ${escapeHtml(I18n.t("auth.qr.refresh"))}
           </button>`;
    const continueLabel = `<button type="button" id="qr-back-btn" class="qr-action-btn qr-action-btn-secondary focusable" data-action="back">
      ${escapeHtml(backLabel)}
    </button>`;
    return `${refreshAction}${continueLabel}`;
  },

  renderServerMenu(items) {
    return `
      <div class="qr-server-menu" role="menu" aria-label="${escapeHtml(I18n.t("server_options_title"))}">
        <div class="qr-server-menu-title">${escapeHtml(I18n.t("server_options_title"))}</div>
        ${items
          .map(
            (item) => `
              <button type="button" class="qr-server-menu-item focusable" data-action="${item.action}" role="menuitem">
                ${escapeHtml(item.label)}
              </button>
            `
          )
          .join("")}
      </div>
    `;
  },

  renderSignOutConfirmation() {
    return `
      <div class="settings-dialog-backdrop">
        <div class="settings-dialog settings-text-dialog auth-signout-confirm-dialog"
             role="dialog" aria-modal="true" aria-labelledby="auth-signout-confirm-title">
          <div id="auth-signout-confirm-title" class="settings-dialog-title">${escapeHtml(
            I18n.t("account_sign_out_confirm_title")
          )}</div>
          <div class="settings-text-dialog-message">${escapeHtml(
            I18n.t("account_sign_out_confirm_subtitle")
          )}</div>
          <div class="settings-text-dialog-actions">
            <button type="button" class="settings-dialog-option settings-text-dialog-button server-dialog-cancel focusable"
                    data-action="cancel-signout">
              <span class="settings-dialog-option-label">${escapeHtml(I18n.t("common.cancel"))}</span>
            </button>
            <button type="button" class="settings-dialog-option settings-text-dialog-button server-dialog-danger focusable"
                    data-action="confirm-signout">
              <span class="settings-dialog-option-label">${escapeHtml(I18n.t("auth.account.signOut"))}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  },

  bindControls() {
    const serverMenuButton = this.container.querySelector("[data-action='server-menu']");
    serverMenuButton?.addEventListener("click", () => this.toggleServerMenu());

    const refreshButton = this.container.querySelector("#qr-refresh-btn");
    refreshButton?.addEventListener("click", () => {
      const action = refreshButton.dataset.action;
      if (action === "signout") {
        this.openSignOutConfirmation();
      } else {
        this.handleRefreshAction();
      }
    });
    this.container.querySelector("#qr-back-btn")?.addEventListener("click", () => {
      void this.handleContinueAction();
    });
    this.container
      .querySelector("[data-action='use-official']")
      ?.addEventListener("click", () => this.openServerConnection("officialReview"));
    this.container
      .querySelector("[data-action='connect-custom']")
      ?.addEventListener("click", () => this.openServerConnection("input"));
    this.container
      .querySelector("[data-action='email-submit']")
      ?.addEventListener("click", () => void this.submitEmailLogin());
    this.container
      .querySelector("[data-action='cancel-signout']")
      ?.addEventListener("click", () => this.dismissSignOutConfirmation());
    this.container
      .querySelector("[data-action='confirm-signout']")
      ?.addEventListener("click", () => void this.handleSignOut());
    this.container.querySelector("[data-action='terms']")?.addEventListener("click", () => {
      window.open?.("https://nuvio.tv/terms", "_blank");
    });

    const emailInput = this.container.querySelector("#auth-email-input");
    const passwordInput = this.container.querySelector("#auth-password-input");
    emailInput?.addEventListener("input", (event) => {
      this.email = String(event.target?.value || "");
      this.emailError = "";
      this.updateEmailError();
    });
    passwordInput?.addEventListener("input", (event) => {
      this.password = String(event.target?.value || "");
      this.emailError = "";
      this.updateEmailError();
    });
  },

  updateEmailError() {
    const errorNode = this.container?.querySelector(".qr-login-error");
    if (errorNode) {
      errorNode.textContent = this.emailError;
      errorNode.hidden = !this.emailError;
    }
  },

  toggleServerMenu() {
    if (this.isLeaving || this.showSignOutConfirmation) return;
    if (this.isServerMenuOpen) {
      this.focusAfterRender = ".qr-server-menu-trigger";
    }
    this.isServerMenuOpen = !this.isServerMenuOpen;
    this.render();
  },

  openSignOutConfirmation() {
    if (this.isLeaving || !this.isSignedIn) return;
    this.isServerMenuOpen = false;
    this.showSignOutConfirmation = true;
    this.render();
  },

  dismissSignOutConfirmation() {
    if (!this.showSignOutConfirmation || this.isLeaving) return;
    this.showSignOutConfirmation = false;
    this.render();
  },

  openServerConnection(initialMode = "list") {
    if (this.isLeaving) return;
    this.isServerMenuOpen = false;
    Router.navigate("serverConnection", {
      returnRoute: "authQrSignIn",
      returnParams: { onboardingMode: this.onboardingMode },
      initialMode
    });
  },

  async startQr() {
    if (
      !this.isMounted ||
      this.isLeaving ||
      this.isStartingQr ||
      !this.useQrLogin ||
      this.isSignedIn
    ) {
      return;
    }
    this.isStartingQr = true;
    this.updateActionButtons();
    this.stopIntervals();
    this.clearQr();
    this.setStatus(I18n.t("auth.qr.preparing"));

    try {
      const result = await QrLoginService.start();
      if (!this.isMounted || this.isLeaving) return;
      if (!result || !result.code) {
        this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
        return;
      }
      this.renderQr(result);
      this.setStatus(I18n.t("auth.qr.scanAndSignIn"));
      this.startPolling(result.code, result.deviceNonce, result.pollIntervalSeconds || 3);
    } finally {
      if (this.isMounted) {
        this.isStartingQr = false;
        this.updateActionButtons();
      }
    }
  },

  renderQr({ loginUrl, verificationUri, displayCode, code, expiresAt }) {
    const qrContainer = this.container?.querySelector("#qr-container");
    const codeText = this.container?.querySelector("#qr-code-text");
    const manualText = this.container?.querySelector("#qr-manual-text");
    if (!qrContainer || !codeText) return;
    const content = String(loginUrl || "").trim();
    if (!content) {
      qrContainer.innerHTML = `<span class="qr-code-unavailable">${escapeHtml(I18n.t("auth.qr.unavailable"))}</span>`;
    } else {
      qrContainer.innerHTML = `<canvas class="qr-image qr-image-canvas" aria-label="${escapeHtml(
        I18n.t("auth.qr.qrImageAlt")
      )}"></canvas>`;
      try {
        QrCodeGenerator.generate(qrContainer.querySelector("canvas"), content, 320);
      } catch (error) {
        console.warn("Unable to render QR code locally", error);
        qrContainer.innerHTML = `<span class="qr-code-unavailable">${escapeHtml(
          I18n.t("auth.qr.unavailable")
        )}</span>`;
      }
    }
    if (manualText) {
      const manualUrl = String(verificationUri || "")
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
      manualText.innerText =
        manualUrl && (displayCode || code)
          ? I18n.t("auth.qr.manualInstruction", { url: manualUrl })
          : "";
    }
    codeText.innerText = I18n.t("auth.qr.codeLabel", {
      code: displayCode || code || ""
    });
    this.startCountdown(expiresAt);
  },

  clearQr() {
    const qrContainer = this.container?.querySelector("#qr-container");
    const manualText = this.container?.querySelector("#qr-manual-text");
    const codeText = this.container?.querySelector("#qr-code-text");
    const expiryNode = this.container?.querySelector("#qr-expiry");
    if (qrContainer) qrContainer.innerHTML = "";
    if (manualText) manualText.innerText = "";
    if (codeText) codeText.innerText = "";
    if (expiryNode) expiryNode.innerText = "";
  },

  startCountdown(expiresAt) {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    const expiration = Number(expiresAt || 0);
    this.qrExpiresAtMillis = expiration;
    if (!expiration) return;
    const renderRemaining = () => {
      if (!this.isMounted) return;
      const remaining = expiration - Date.now();
      const expiryNode = this.container?.querySelector("#qr-expiry");
      if (expiryNode) {
        expiryNode.innerText = I18n.t("auth.qr.expires", {
          duration: formatDuration(remaining)
        });
      }
      if (remaining <= 0) {
        this.setStatus(I18n.t("auth.qr.expired"));
        this.stopIntervals();
      }
    };
    renderRemaining();
    this.countdownTimer = setInterval(renderRemaining, 1000);
  },

  startPolling(code, deviceNonce, pollIntervalSeconds = 3) {
    this.stopPollingOnly();
    this.qrPollIntervalSeconds = Math.max(2, Number(pollIntervalSeconds || 3));
    const pollOnce = async () => {
      if (!this.isMounted || this.isLeaving || this.isPolling) return;
      this.isPolling = true;
      try {
        const pollResult = await QrLoginService.poll(code, deviceNonce);
        const status = typeof pollResult === "string" ? pollResult : pollResult?.status || null;
        if (pollResult && typeof pollResult === "object") {
          const nextInterval = Number(pollResult.pollIntervalSeconds);
          if (Number.isFinite(nextInterval) && nextInterval > 0) {
            this.qrPollIntervalSeconds = Math.max(2, nextInterval);
          }
          const nextExpiration = parseQrExpiration(pollResult.expiresAt);
          if (nextExpiration > 0 && nextExpiration !== this.qrExpiresAtMillis) {
            this.startCountdown(nextExpiration);
          }
        }
        if (!this.isMounted || this.isLeaving) return;
        if (status === "approved") {
          this.setStatus(I18n.t("auth.qr.approved"));
          this.stopPollingOnly();
          const exchange = await QrLoginService.exchange(code, deviceNonce);
          if (!this.isMounted || this.isLeaving) return;
          if (exchange) {
            LocalStore.remove(GUEST_QR_BYPASS_KEY);
            LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
            this.isSignedIn = true;
            this.connectedStats = null;
            this.isConnectedStatsLoading = true;
            this.render();
            void this.loadConnectedStats();
            this.setStatus(I18n.t("auth.qr.success"));
          } else {
            this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
          }
          return;
        }
        if (status === "pending") {
          this.setStatus(I18n.t("auth.qr.waitingApproval"));
        } else if (["expired", "used", "cancelled"].includes(status)) {
          this.setStatus(I18n.t("auth.qr.expired"));
          this.stopPollingOnly();
          return;
        } else if (!status) {
          this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
          this.stopPollingOnly();
          return;
        }
      } finally {
        this.isPolling = false;
        if (this.isMounted && !this.isLeaving && this.pollTimer !== null) {
          this.pollTimer = setTimeout(
            pollOnce,
            Math.max(2, Number(this.qrPollIntervalSeconds || 3)) * 1000
          );
        }
      }
    };
    this.pollTimer = setTimeout(
      pollOnce,
      Math.max(2, Number(this.qrPollIntervalSeconds || 3)) * 1000
    );
  },

  toFriendlyQrError(rawError) {
    const normalizedError = String(rawError || "")
      .replace(/\s+/g, " ")
      .trim();
    const conciseReason =
      normalizedError.length > 160 ? `${normalizedError.slice(0, 157)}...` : normalizedError;
    const message = normalizedError.toLowerCase();
    if (!message) return I18n.t("auth.qr.unavailable");
    if (
      message.includes("qr auth is not configured") ||
      message.includes("missing redirect_base_url configuration") ||
      message.includes("apikey") ||
      message.includes("api key") ||
      message.includes("anon key")
    ) {
      return I18n.t("auth.qr.notConfigured");
    }
    if (message.includes("invalid tv login redirect base url")) {
      return I18n.t("auth.qr.invalidRedirect");
    }
    if (
      (message.includes("start_device_login_session") ||
        message.includes("start_tv_login_session")) &&
      message.includes("could not find the function")
    ) {
      return I18n.t("auth.qr.missingFunction");
    }
    if (message.includes("gen_random_bytes") && message.includes("does not exist")) {
      return I18n.t("auth.qr.missingExtension");
    }
    if (message.includes("network") || message.includes("failed to fetch")) {
      return I18n.t("auth.qr.networkError");
    }
    if (
      message.includes("unsupported method") ||
      message.includes("error response") ||
      message.includes("http 5") ||
      message.includes("http 404") ||
      message.includes("http 405")
    ) {
      return I18n.t("auth.qr.serviceUnavailable");
    }
    return I18n.t("auth.qr.unavailableWithReason", { reason: conciseReason });
  },

  toFriendlyEmailError(rawError) {
    const message = String(rawError?.message || rawError || "")
      .replace(/\s+/g, " ")
      .trim();
    const normalized = message.toLowerCase();
    if (
      normalized.includes("invalid login credentials") ||
      normalized.includes("invalid credentials")
    ) {
      return I18n.t("auth.email.invalidCredentials");
    }
    if (normalized.includes("email not confirmed")) {
      return I18n.t("account_error_email_not_confirmed");
    }
    if (normalized.includes("user already registered")) {
      return I18n.t("account_error_email_already_registered");
    }
    if (normalized.includes("invalid email")) {
      return I18n.t("account_error_invalid_email");
    }
    if (normalized.includes("password") && normalized.includes("short")) {
      return I18n.t("account_error_password_too_short");
    }
    if (normalized.includes("password") && normalized.includes("weak")) {
      return I18n.t("account_error_password_too_weak");
    }
    if (normalized.includes("signup is disabled")) {
      return I18n.t("account_error_signup_disabled");
    }
    if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
      return I18n.t("account_error_rate_limited");
    }
    if (normalized.includes("network") || normalized.includes("failed to fetch")) {
      return I18n.t("auth.email.networkError");
    }
    if (normalized.includes("timeout") || normalized.includes("timed out")) {
      return I18n.t("account_error_connection_timeout");
    }
    if (normalized.includes("connection refused") || normalized.includes("connect failed")) {
      return I18n.t("account_error_connection_refused");
    }
    if (normalized.includes("http 404") || normalized.includes("could not find")) {
      return I18n.t("account_error_service_unavailable");
    }
    if (normalized.includes("http 400") || normalized.includes("bad request")) {
      return I18n.t("account_error_invalid_request");
    }
    return I18n.t("auth.email.signInFailed", {
      reason: message.length > 140 ? `${message.slice(0, 137)}...` : message
    });
  },

  setStatus(text) {
    const statusNode = this.container?.querySelector("#qr-status");
    if (statusNode) statusNode.innerText = text;
  },

  updateActionButtons() {
    const refreshButton = this.container?.querySelector("#qr-refresh-btn");
    if (refreshButton instanceof HTMLButtonElement) {
      const disabled = Boolean(this.isLeaving || this.isStartingQr || this.isEmailSubmitting);
      refreshButton.disabled = disabled;
      refreshButton.setAttribute("aria-busy", this.isStartingQr ? "true" : "false");
    }
  },

  handleRefreshAction() {
    if (this.isLeaving || this.isStartingQr) return;
    void this.startQr();
  },

  async submitEmailLogin() {
    if (this.isLeaving || this.isEmailSubmitting) return;
    const email = String(this.email || "").trim();
    const password = String(this.password || "");
    if (!email || !password) {
      this.emailError = I18n.t("auth.email.required");
      this.render();
      return;
    }
    this.isEmailSubmitting = true;
    this.emailError = "";
    this.render();
    try {
      await AuthManager.signInWithEmail(email, password);
      LocalStore.remove(GUEST_QR_BYPASS_KEY);
      LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
      this.isSignedIn = true;
      this.connectedStats = null;
      this.isConnectedStatsLoading = true;
      void this.loadConnectedStats();
    } catch (error) {
      console.error("SignIn failed", error);
      if (this.isMounted) this.emailError = this.toFriendlyEmailError(error);
    } finally {
      this.isEmailSubmitting = false;
      if (this.isMounted && !this.isLeaving) this.render();
    }
  },

  async handleSignOut() {
    if (this.isLeaving || !this.isSignedIn) return;
    this.showSignOutConfirmation = false;
    this.isLeaving = true;
    this.updateActionButtons();
    try {
      await AuthManager.signOut();
    } finally {
      if (this.isMounted) {
        this.isLeaving = false;
        this.isSignedIn = false;
        this.cleanup();
        Router.navigate("authQrSignIn", { onboardingMode: false }, { replaceHistory: true });
      }
    }
  },

  async handleContinueAction() {
    if (this.isLeaving) return;
    this.isLeaving = true;
    this.updateActionButtons();
    const isGuestContinue = this.onboardingMode && !this.isSignedIn;
    if (isGuestContinue) {
      LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
      // Leaving the auth gate is not a sign-out operation. Keep guest/local
      // profile data intact; only discard the temporary anonymous auth session.
      AuthManager.clearAnonymousSession?.();
      LocalStore.set(GUEST_QR_BYPASS_KEY, true);
    } else if (this.isSignedIn) {
      LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
      LocalStore.remove(GUEST_QR_BYPASS_KEY);
    } else {
      // Back from the regular signed-out account route must not silently mark
      // the first-launch gate as completed; Android only does that for the
      // explicit onboarding action (or after a real account is restored).
      AuthManager.clearAnonymousSession?.();
    }
    this.cleanup();
    if (!this.onboardingMode && this.hasBackDestination) {
      Router.back();
      return;
    }
    Router.navigate("home", {}, { replaceHistory: true, skipStackPush: true });
  },

  leaveAuthScreen() {
    if (this.isLeaving) return;
    this.isLeaving = true;
    this.updateActionButtons();
    this.cleanup();
    if (this.onboardingMode) {
      // Android finishes the onboarding activity on hardware Back. Do not
      // silently turn Back into the explicit guest opt-in action.
      Platform.exitApp();
      return;
    }
    Router.back({ skipConsume: true });
  },

  getLeftDescription() {
    if (this.isSignedIn) return I18n.t("auth.qr.leftDescriptionSignedIn");
    if (this.useEmailLogin) return I18n.t("auth.email.hint");
    return I18n.t("auth.qr.leftDescriptionSignedOut");
  },

  getCardSubtitle() {
    if (this.isSignedIn) return I18n.t("auth.qr.cardSubtitleSignedIn");
    if (this.useEmailLogin) return I18n.t("auth.email.instruction");
    return I18n.t("auth.qr.cardSubtitleSignedOut");
  },

  getBackButtonLabel() {
    if (this.onboardingMode && !this.isSignedIn) {
      return I18n.t("auth.qr.continueWithoutAccount");
    }
    return this.onboardingMode ? I18n.t("auth.qr.continue") : I18n.t("auth.qr.back");
  },

  async onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (this.showSignOutConfirmation) {
      if (keyCode === 27 || keyCode === 461) {
        this.dismissSignOutConfirmation();
        return;
      }
      const dialog = this.container?.querySelector(".auth-signout-confirm-dialog");
      if (ScreenUtils.handleDpadNavigation(event, dialog)) return;
      if (keyCode !== 13) return;
      const action = dialog?.querySelector(".focusable.focused")?.dataset?.action;
      if (action === "cancel-signout") {
        this.dismissSignOutConfirmation();
      } else if (action === "confirm-signout") {
        await this.handleSignOut();
      }
      return;
    }
    if (this.isServerMenuOpen && (keyCode === 27 || keyCode === 461)) {
      this.isServerMenuOpen = false;
      this.focusAfterRender = ".qr-server-menu-trigger";
      this.render();
      return;
    }
    if (keyCode === 27 || keyCode === 461) {
      this.leaveAuthScreen();
      return;
    }
    const navigationContainer = this.isServerMenuOpen
      ? this.container?.querySelector(".qr-server-menu")
      : this.container;
    if (ScreenUtils.handleDpadNavigation(event, navigationContainer)) return;
    if (keyCode !== 13) return;

    const current = navigationContainer?.querySelector(".focusable.focused");
    const action = current?.dataset?.action || "";
    if (action === "server-menu") {
      this.toggleServerMenu();
    } else if (action === "use-official" || action === "connect-custom") {
      this.openServerConnection(action === "use-official" ? "officialReview" : "input");
    } else if (action === "refresh") {
      this.handleRefreshAction();
    } else if (action === "signout") {
      this.openSignOutConfirmation();
    } else if (action === "back") {
      await this.handleContinueAction();
    } else if (action === "email-submit" || action === "password-input") {
      await this.submitEmailLogin();
    } else if (action === "email-input") {
      focusNode(this.container.querySelector("#auth-password-input"));
    }
  },

  consumeBackRequest() {
    if (this.showSignOutConfirmation) {
      this.dismissSignOutConfirmation();
      return true;
    }
    if (this.isServerMenuOpen) {
      this.isServerMenuOpen = false;
      this.focusAfterRender = ".qr-server-menu-trigger";
      this.render();
      return true;
    }
    this.leaveAuthScreen();
    return true;
  },

  stopPollingOnly() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  },

  stopIntervals() {
    this.stopPollingOnly();
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  cleanup() {
    this.isMounted = false;
    this.isLeaving = true;
    this.showSignOutConfirmation = false;
    this.stopIntervals();
    if (this.container) ScreenUtils.hide(this.container);
    this.container = null;
  }
};
