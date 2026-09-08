function getServiceRequest() {
  const request = globalThis.webOS?.service?.request;
  if (typeof request === "function") {
    return request.bind(globalThis.webOS.service);
  }
  return null;
}

function getPalmServiceBridge() {
  return typeof globalThis.PalmServiceBridge === "function" ? globalThis.PalmServiceBridge : null;
}

function normalizeServiceUrl(service) {
  const normalizedService = String(service || "")
    .trim()
    .replace(/\/+$/, "");
  return normalizedService ? `${normalizedService}/` : "";
}

function buildPalmServiceUrl(service, method) {
  const normalizedService = normalizeServiceUrl(service).replace(/\/+$/, "");
  const normalizedMethod = String(method || "")
    .trim()
    .replace(/^\/+/, "");
  if (!normalizedService || !normalizedMethod) {
    return "";
  }
  return `${normalizedService}/${normalizedMethod}`;
}

function parseBridgePayload(payload) {
  if (payload && typeof payload === "object") {
    return payload;
  }
  try {
    return JSON.parse(String(payload || ""));
  } catch (_) {
    return {
      returnValue: false,
      errorCode: -1,
      errorText: String(payload || "Invalid Luna payload")
    };
  }
}

export const WebOsLunaService = {
  isAvailable() {
    return Boolean(getServiceRequest() || getPalmServiceBridge());
  },

  request(
    service,
    { method = "", parameters = {}, subscribe = false, timeoutMs = 30000, signal = null } = {}
  ) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let requestHandle = null;
      let timeoutId = 0;
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = 0;
        }
        signal?.removeEventListener?.("abort", abort);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const succeed = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value || {});
      };
      const abort = () => {
        try {
          requestHandle?.cancel?.();
        } catch (_) {}
        fail({ returnValue: false, errorCode: -2, errorText: "Luna request cancelled" });
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener?.("abort", abort);
      timeoutId = setTimeout(
        () => {
          try {
            requestHandle?.cancel?.();
          } catch (_) {}
          fail({ returnValue: false, errorCode: -3, errorText: "Luna request timed out" });
        },
        Math.max(250, Number(timeoutMs) || 30000)
      );
      const request = getServiceRequest();
      if (request) {
        const serviceUrl = normalizeServiceUrl(service);
        if (!serviceUrl) {
          fail({
            returnValue: false,
            errorCode: -1,
            errorText: "Luna service URL unavailable"
          });
          return;
        }

        requestHandle = request(serviceUrl, {
          method: String(method || "").trim(),
          parameters: parameters && typeof parameters === "object" ? { ...parameters } : {},
          subscribe: Boolean(subscribe),
          onSuccess: (result) => succeed(result),
          onFailure: (result) =>
            fail(
              result || {
                returnValue: false,
                errorCode: -1,
                errorText: "Luna request failed"
              }
            )
        });
        return;
      }

      const PalmServiceBridge = getPalmServiceBridge();
      const targetUrl = buildPalmServiceUrl(service, method);
      if (!PalmServiceBridge || !targetUrl) {
        fail({
          returnValue: false,
          errorCode: -1,
          errorText: "Luna service bridge unavailable"
        });
        return;
      }

      const bridge = new PalmServiceBridge();
      requestHandle = bridge;
      const payload = parameters && typeof parameters === "object" ? { ...parameters } : {};
      if (subscribe) {
        payload.subscribe = true;
      }

      bridge.onservicecallback = (rawResponse) => {
        const parsed = parseBridgePayload(rawResponse);
        if (parsed?.returnValue === false || parsed?.errorCode) {
          fail(parsed);
        } else {
          succeed(parsed);
        }
        try {
          bridge.cancel?.();
        } catch (_) {
          // Ignore bridge cleanup failures.
        }
      };

      try {
        bridge.call(targetUrl, JSON.stringify(payload));
      } catch (error) {
        fail({
          returnValue: false,
          errorCode: -1,
          errorText: String(error?.message || error || "Luna bridge call failed")
        });
      }
    });
  },

  subscribe(service, { method = "", parameters = {}, onSuccess = null, onFailure = null } = {}) {
    const request = getServiceRequest();
    if (request) {
      const serviceUrl = normalizeServiceUrl(service);
      if (!serviceUrl) {
        throw {
          returnValue: false,
          errorCode: -1,
          errorText: "Luna service URL unavailable"
        };
      }

      const handle = request(serviceUrl, {
        method: String(method || "").trim(),
        parameters: parameters && typeof parameters === "object" ? { ...parameters } : {},
        subscribe: true,
        onSuccess: (result) => {
          if (typeof onSuccess === "function") {
            onSuccess(result || {});
          }
        },
        onFailure: (result) => {
          if (typeof onFailure === "function") {
            onFailure(
              result || {
                returnValue: false,
                errorCode: -1,
                errorText: "Luna subscription failed"
              }
            );
          }
        }
      });
      return {
        cancel() {
          try {
            handle?.cancel?.();
          } catch (_) {
            // Ignore cancellation failures.
          }
        }
      };
    }

    const PalmServiceBridge = getPalmServiceBridge();
    const targetUrl = buildPalmServiceUrl(service, method);
    if (!PalmServiceBridge || !targetUrl) {
      throw {
        returnValue: false,
        errorCode: -1,
        errorText: "Luna service bridge unavailable"
      };
    }

    const bridge = new PalmServiceBridge();
    const payload =
      parameters && typeof parameters === "object"
        ? { ...parameters, subscribe: true }
        : { subscribe: true };
    bridge.onservicecallback = (rawResponse) => {
      const parsed = parseBridgePayload(rawResponse);
      if (parsed?.returnValue === false || parsed?.errorCode) {
        if (typeof onFailure === "function") {
          onFailure(parsed);
        }
      } else if (typeof onSuccess === "function") {
        onSuccess(parsed || {});
      }
    };
    bridge.call(targetUrl, JSON.stringify(payload));
    return {
      cancel() {
        try {
          bridge.cancel?.();
        } catch (_) {
          // Ignore cancellation failures.
        }
      }
    };
  }
};
