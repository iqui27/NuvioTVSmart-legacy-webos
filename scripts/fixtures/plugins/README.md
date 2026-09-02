# Real Nuvio JS repository snapshots

`real-repositories.json` is a small, checked-in metadata snapshot captured on
2026-08-31 from three public repositories that expose the Android-compatible
Nuvio `manifest.json` contract:

- [NuvioPlugin/All-in-One-Nuvio](https://github.com/NuvioPlugin/All-in-One-Nuvio)
- [phisher98/phisher-nuvio-providers](https://github.com/phisher98/phisher-nuvio-providers)
- [Gowaru/gowaru-nuvio-providers](https://github.com/Gowaru/gowaru-nuvio-providers)

The SHA-256 values in the snapshot pin the source manifests used for the
contract test. CI does not fetch these repositories, because provider domains
and source code can change or disappear. The worker test uses a local contract
provider with the same combinations observed in the snapshots: settings,
`fetch`, HTML selectors, `URLSearchParams`, crypto, headers/referer, movie,
series, episode, anime and normalized stream results.

For a device smoke test, add the `manifestUrl` in the Plugins screen, verify
that the manifest is displayed, then run one movie, one series episode and one
anime request. A failed live provider is not treated as a runtime failure: the
service, Worker, quota and cancellation diagnostics must be checked separately.
