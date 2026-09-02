import { safeApiCall } from "../../core/network/safeApiCall.js";
import { selectCatalogEntries } from "../../core/util/catalogEntryMapper.js";
import { CatalogApi } from "../remote/api/catalogApi.js";
import { addonRepository } from "./addonRepository.js";

class CatalogRepository {
  constructor() {
    this.catalogCache = new Map();
  }

  async getCatalog({
    addonBaseUrl,
    addonId,
    addonName,
    catalogId,
    catalogName,
    type,
    skip = 0,
    skipStep = 100,
    extraArgs = {},
    supportsSkip = false,
    signal = null
  }) {
    const normalizedSkipStep = this.normalizeSkipStep(skipStep);
    const cacheKey = this.buildCacheKey({
      addonId,
      type,
      catalogId,
      skip,
      skipStep: normalizedSkipStep,
      extraArgs,
      supportsSkip
    });

    const cached = this.catalogCache.get(cacheKey);
    if (cached) {
      return {
        status: "success",
        data: cached
      };
    }

    const url = this.buildCatalogUrl({
      baseUrl: addonBaseUrl,
      type,
      catalogId,
      skip,
      extraArgs
    });

    return safeApiCall(() =>
      CatalogApi.getCatalog(url, signal ? { signal } : {}).then((dto) => {
        const { metas, rawItemCount } = selectCatalogEntries(dto?.metas);
        const items = metas.map((meta) => ({
          ...this.mapMeta(meta),
          addonBaseUrl,
          addonId,
          addonName,
          catalogType: type
        }));

        const hasMore = Boolean(supportsSkip && rawItemCount > 0);
        const row = {
          addonId,
          addonName,
          addonBaseUrl,
          catalogId,
          catalogName,
          apiType: type,
          items,
          isLoading: false,
          hasMore,
          currentPage: Math.floor(skip / normalizedSkipStep),
          supportsSkip,
          skipStep: normalizedSkipStep,
          nextSkip: hasMore ? skip + rawItemCount : skip
        };

        this.catalogCache.set(cacheKey, row);
        return row;
      })
    );
  }

  buildCatalogUrl({ baseUrl, type, catalogId, skip = 0, extraArgs = {} }) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    const args = { ...extraArgs };

    if (Object.keys(args).length === 0) {
      return skip > 0
        ? `${basePath}/catalog/${type}/${catalogId}/skip=${skip}.json${baseQuery}`
        : `${basePath}/catalog/${type}/${catalogId}.json${baseQuery}`;
    }

    if (skip > 0 && !Object.prototype.hasOwnProperty.call(args, "skip")) {
      args.skip = String(skip);
    }

    const query = Object.entries(args)
      .map(([key, value]) => `${this.encodeArg(key)}=${this.encodeArg(String(value))}`)
      .join("&");

    return `${basePath}/catalog/${type}/${catalogId}/${query}.json${baseQuery}`;
  }

  buildCacheKey({
    addonId,
    type,
    catalogId,
    skip = 0,
    skipStep = 100,
    extraArgs = {},
    supportsSkip = false
  }) {
    const normalizedArgs = Object.entries(extraArgs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    return `${addonId}_${type}_${catalogId}_${skip}_${skipStep}_${supportsSkip ? "skip" : "no-skip"}_${normalizedArgs}`;
  }

  normalizeSkipStep(value = 100) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.trunc(numericValue) : 100;
  }

  encodeArg(value) {
    return encodeURIComponent(value).replace(/\+/g, "%20");
  }

  mapMeta(meta = {}) {
    return {
      id: meta.id || "",
      name: meta.name || "Untitled",
      type: meta.type || "",
      poster: meta.poster || null,
      background: meta.background || null,
      logo: meta.logo || null,
      description: meta.description || "",
      releaseInfo: meta.releaseInfo || "",
      runtime: meta.runtime ?? null,
      genres: Array.isArray(meta.genres) ? meta.genres : []
    };
  }
}

export const catalogRepository = new CatalogRepository();
