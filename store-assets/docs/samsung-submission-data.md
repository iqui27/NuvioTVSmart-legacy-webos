# Samsung Seller Office: what to do and what is still needed

## Recommended publication route

Start with a Samsung TV Seller Office account as a Public Seller, register the application and use the Store package profile for the first pre-test. Samsung’s official guide says Public Sellers distribute in the United States by default; distribution outside the US and partner-level APIs require a Partner Seller request. That country-distribution rule is separate from the local EngineFS service used by Nuvio.

The Store package always includes Nuvio’s local EngineFS `tizen:service`, the standard `web.service` feature, and the `application.launch` privilege. This preserves torrent/P2P playback on capable Tizen 5+ TVs; Tizen 4 remains intentionally unsupported by the runtime capability gate. The package script fails if a Store build is explicitly configured without EngineFS instead of silently shipping a feature-reduced application.

Required for the Store package:

- a valid `TIZEN_SECURITY_PROFILE`;
- the official `tizen` CLI in `TIZEN_CLI`;
- optional `TIZEN_SERVICE_METADATA_XML` only if Seller Office gives us a specific metadata element to include.

## Local certificate setup

1. Create a Samsung account and sign in to Samsung Developer/Tizen Studio.
2. Install Tizen Studio with the TV extension and Certificate Manager.
3. Create one author certificate/security profile for the publisher. Keep the author private key and profile backup offline and do not commit them.
4. Use the same author identity for future updates; changing it can prevent updates to an already published application.
5. Store the profile securely in the release runner and set only the profile name in `TIZEN_SECURITY_PROFILE`; the private material belongs in the CI secret/secure store.

The exact public/partner certificate fields and device-DUID rules must be completed in Samsung’s current Certificate Manager flow, not in this repository.

## CLI setup

The release command uses the official Tizen CLI executable. On a local machine this is the `tizen` executable installed with Tizen Studio. In CI, install the official TV SDK or use a controlled runner, then configure:

```sh
TIZEN_CLI=/absolute/path/to/tizen \
TIZEN_SECURITY_PROFILE=NuvioStoreProfile \
npm run package:tizen:store
```

The command verifies that the result contains both `author-signature.xml` and `signature1.xml`. The unsigned WGT from `npm run package:tizen` is used by the Nuvio TV Installer, which signs it locally for the target TV; it must not be uploaded directly to Seller Office.

## Seller Office fields still needed

- Seller account/group and legal seller information.
- Publisher/support starting values copied from the Nuvio Google Play listing: `Nuvio Media`, Muhammed Nayif Rahman, India, `nayiftapframe@gmail.com`, `https://nuvioapp.space`, privacy policy `https://nuvio.tv/privacy-policy`.
- Public Seller or Partner Seller status.
- App title, languages, store descriptions and support contact.
- Privacy URL, content rating and market/country selection. Use the same production country list currently enabled for `com.nuvio.app` on Google Play; Samsung Public Sellers are limited to the US, so a Partner Seller request is required to mirror a wider Android country list.
- Samsung model groups to target; start from Tizen 4+/2018 only if the pre-test and real-device matrix confirm it.
- Four final English JPG screenshots and the UI Description PPTX (draft supplied in this directory).
- Torrent/P2P is intentionally unavailable on Tizen 4; it remains enabled for capable Tizen 5+ Store devices through the bundled local EngineFS service.
- App UI locales currently shipped by the web build: English, Arabic, Bosnian, Czech, German, Greek, Spanish, Spanish (Latin America), French, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Lithuanian, Dutch, Norwegian, Polish, Portuguese (Brazil), Portuguese (Portugal), Romanian, Russian, Slovak, Slovenian, Swedish, Tamil, Turkish, Vietnamese and Chinese (Simplified). Store metadata translations can be added after the English submission.
- A real test account and the provider/add-on configuration used by certification.
- Final player declarations: codecs, containers, streaming engine, subtitle formats and DRM only after the supported test matrix is known.

## Official references

- [Samsung Launch Checklist](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/launch-checklist.html)
- [Publishing an application](https://developer.samsung.com/tizen/Smart-TV/Quickstarts/Publishing-an-application.html)
- [Becoming Partners](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-partner.html)
- [Privileges Q&A](https://developer.samsung.com/smarttv/develop/faq/privileges.html)
- [Entering Application Information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html)
