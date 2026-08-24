import { httpRequest } from "../../../core/network/httpClient.js";

export const StreamApi = {
  async getStreams(url, options = {}) {
    return httpRequest(url, {
      ...options,
      includeSessionAuth: false
    });
  }
};
