/**
 * Keep the plugin result boundary equivalent to Android's provider contract.
 * Provenance fields used by the generic Web add-on pipeline are deliberately
 * not part of a plugin group or plugin stream.
 */
export function mapPluginStreamGroup(result = {}) {
  const sourceProviderId = result.sourceId || result.sourceName || null;
  const sourceName = result.sourceName || null;
  const sourceLogo = result.sourceLogo || null;

  return {
    sourceProviderId,
    addonName: sourceName,
    addonLogo: sourceLogo,
    streams: (Array.isArray(result.streams) ? result.streams : []).map((stream) => {
      const mappedStream = stream && typeof stream === "object" ? { ...stream } : {};
      delete mappedStream.streamOrigin;
      return {
        ...mappedStream,
        sourceProviderId,
        addonName: sourceName,
        addonLogo: mappedStream.addonLogo || sourceLogo || null
      };
    })
  };
}
