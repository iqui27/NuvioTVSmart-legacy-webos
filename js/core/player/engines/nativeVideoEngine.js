export const nativeVideoEngine = {
  name: "native",

  canPlay(videoElement, mimeType) {
    if (!videoElement || !mimeType) {
      return false;
    }
    try {
      const result = String(videoElement.canPlayType(String(mimeType))).toLowerCase();
      return result === "probably" || result === "maybe";
    } catch (_) {
      return false;
    }
  },

  load(videoElement, url, mimeType = null) {
    if (!videoElement) {
      return false;
    }
    videoElement.removeAttribute("src");
    Array.from(videoElement.querySelectorAll("source")).forEach((node) => node.remove());
    if (mimeType) {
      const sourceNode = document.createElement("source");
      sourceNode.src = url;
      sourceNode.type = mimeType;
      // A fetch/decode failure on a <source> child fires "error" on the SOURCE
      // element and never on the media element: the video just parks itself at
      // networkState=NETWORK_NO_SOURCE with readyState=0 and no MediaError, so
      // the app only notices when the startup stall guard trips much later.
      // Re-dispatch the failure on the video element with the shape the player
      // screen's onError already understands (detail.mediaErrorCode) so engine
      // fallback and the error panel run immediately instead of minutes later.
      sourceNode.addEventListener("error", () => {
        if (sourceNode.parentNode !== videoElement) {
          return;
        }
        let event = null;
        try {
          event = new CustomEvent("error", {
            detail: {
              mediaErrorCode: 4,
              sourceError:
                `video <source> failed before any bytes arrived ` +
                `(networkState=${Number(videoElement.networkState || 0)})`
            }
          });
        } catch (_) {
          return;
        }
        videoElement.dispatchEvent(event);
      });
      videoElement.appendChild(sourceNode);
    } else {
      videoElement.src = url;
    }
    videoElement.load();
    return true;
  }
};
