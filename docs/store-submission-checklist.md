# Store submission checklist

This checklist separates repository changes from information that must come from the Samsung Seller Office, LG Seller Lounge, or the publisher. It must not contain certificates, private keys, passwords, or test-account credentials.

The locally prepared visual and metadata draft is in [`store-assets/`](../store-assets/README.md): Samsung/LG icons, 1920x1080 screenshots, Samsung UI Description PPTX, store copy, Samsung setup notes, and LG UX/self-checklist notes.

## Technical status

### Samsung Tizen

- The declared minimum remains Tizen 4.0+.
- `npm run package:tizen` creates the unsigned WGT used by development and the Nuvio TV Installer; the installer signs it locally for the target TV before installation.
- `npm run package:tizen:store` creates the Store-signed profile through the official Tizen CLI, requires a security profile, verifies `author-signature.xml` and `signature1.xml`, and fails if either signature is absent.
- The Store profile packages the local EngineFS `tizen:service`, the `web.service` feature, and the `application.launch` privilege. Torrent/P2P therefore remains available on capable Tizen 5+ TVs and is unavailable only on Tizen 4, where the runtime capability gate intentionally reports the feature as unsupported.
- `auto-restart` and `on-boot` are disabled in generated Tizen service metadata.

### LG webOS

- The package keeps the required 80x80 and 130x130 icons plus the 1920x1080 splash image.
- `appinfo.json` now contains `iconColor` and a user-facing `appDescription`.
- The undocumented `requiredVersion` and legacy `bgColor` fields are not emitted; runtime compatibility remains enforced by the project policy and boot gate.
- Packaging validates required appinfo fields, the description length, the icon color, and that every service ID begins with the application ID.
- Torrent/P2P on webOS uses only the bundled local companion service; no external torrent streaming server is configured or required.

## Samsung Seller Office information and materials

- Seller account and app registration details.
- Whether the account is a Samsung Smart TV partner; if yes, the approved service metadata and approval scope.
- The existing Tizen author certificate/security profile used for updates, plus a secure CI installation of that profile.
- The Tizen CLI executable path on the release runner (`TIZEN_CLI`) and the security profile name (`TIZEN_SECURITY_PROFILE`).
- Final store title, descriptions, supported languages, support email, privacy-policy URL, content rating, and market/model-group selection. The target country list should mirror the Android Google Play production listing; starting publisher/contact values copied from Google Play are recorded in [`store-copy.md`](../store-assets/docs/store-copy.md).
- Four JPG screenshots in an accepted resolution and file size.
- 1920x1080 logo/background material, 512x423 icon material, and the UI Description PPTX.
- Draft files: [`store-assets/samsung/`](../store-assets/samsung/) and [`store-assets/docs/store-copy.md`](../store-assets/docs/store-copy.md). Replace the screenshots/copy only if Seller Office requests a different resolution, language, or content treatment.
- A working test account and any provider/add-on configuration required for QA.

Official references: [launch checklist](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/launch-checklist.html), [registering applications](https://developer.samsung.com/tv-seller-office/guides/applications/registering-application.html), and [Tizen CLI packaging](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html?device=signage).

## LG Seller Lounge information and materials

- Separate 400x400 Seller Lounge icon.
- Final store title, description, supported languages, screenshots, privacy/support details, and content information.
- Target the same production country list currently enabled for `com.nuvio.app` on Google Play, subject to LG Seller Lounge availability.
- Draft files: [`store-assets/lg/`](../store-assets/lg/) and [`store-assets/docs/lg-submission-data.md`](../store-assets/docs/lg-submission-data.md).
- A working test account and any required add-on/provider setup.
- Completed UX scenario and App Self Checklist.
- Seller Lounge app registration, country/market selection, and release contact information.

Official references: [app resources](https://webostv.developer.lge.com/develop/getting-started/app-resources), [`appinfo.json`](https://webostv.developer.lge.com/develop/references/appinfo-json), [approval process](https://webostv.developer.lge.com/distribute/app-approval-process), and [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist).

## Local release checks

```sh
npm run format:check
npm run package:webos

# Requires Tizen Studio/Web CLI and a configured security profile.
TIZEN_CLI=/path/to/tizen TIZEN_SECURITY_PROFILE=ProfileName npm run package:tizen:store
```

The unsigned Tizen package is the GitHub release input for the Nuvio TV Installer and must not be uploaded directly to Seller Office. Seller Office requires the separately generated, officially signed package from `npm run package:tizen:store`.
