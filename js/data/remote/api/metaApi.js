import { httpRequest } from "../../../core/network/httpClient.js";

export const MetaApi = {
  async getMeta(url, options = {}) {
    return httpRequest(url, {
      ...options,
      includeSessionAuth: false
    });
  }
};
