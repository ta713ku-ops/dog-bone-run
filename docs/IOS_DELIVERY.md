# iOS delivery preparation

This folder is a native iPhone/iPad shell for the browser game. It loads the production web distribution from the app bundle, so the four classic walks and the 12 journey routes use the same game code and save model. The shell does not load game code or art from the internet.

## Prepare the bundled game

From the repository root, run:

```sh
npm run build
node scripts/prepare-ios.mjs
```

The prepare script checks the production module graph and all 15 route IDs, rejects symlinks, and copies the complete `dist/` directory into `ios/DogBoneRun/Resources/Site/`. The Xcode target includes that folder as a bundle resource. Re-run the build and prepare steps after web changes so the app contains the matching site version. The distribution includes all locally rendered artwork and synthesized-audio code. Use `release/v0.39.0-manifest.json` for the exact file inventory and byte size; the full site is bundled for offline use.

Open `ios/DogBoneRun.xcodeproj` and select the shared `DogBoneRun` scheme. The target supports iPhone and iPad, uses iOS 17 as its minimum, and starts with bundle identifier `com.taku.DogBoneRun`. Change that identifier to one owned by the publisher before signing or submitting.

## Local web origin and offline behavior

`LoopbackSiteServer` serves only the bundled `Site/` directory and binds to `127.0.0.1:48731`. The port is fixed so the web origin remains `http://127.0.0.1:48731` across launches; `WKWebsiteDataStore.default()` can then retain IndexedDB and other WebKit site data. This ordinary localhost origin supports the app's ES modules, IndexedDB, and Service Worker code. The app itself still works from the bundled files when the device has no internet connection; Service Worker registration is an optional browser cache layer.

The server rejects non-GET/HEAD methods, path traversal, and requests outside the loopback host. The web view allows only the same local origin. A user-activated HTTPS link opens in Safari; other non-local navigation is blocked. App Transport Security permits local networking only; there is no arbitrary-load exception. The loopback binding does not expose the server to the Wi-Fi interface.

The web view uses a content security policy that allows same-origin scripts and connections, inline styles used by the game, and local/data/blob image and audio content. It denies frames, plugins, and form submission to other origins. The script-message handlers also require a main-frame message from the exact loopback host and port.

## Native JavaScript bridge contract

Both handlers use `WKScriptMessageHandlerWithReply`; in WebKit, `postMessage` returns a promise for the native reply. Only the bundled top-level page at `http://127.0.0.1:48731` can call them.

### StoreKit 2

The handler name is `storeKit`:

```js
const bridge = window.webkit?.messageHandlers?.storeKit;
const products = await bridge?.postMessage({ action: 'products' });
const state = await bridge?.postMessage({ action: 'entitlements' });
// Call restore only from an explicit user action; Apple may show an account prompt.
const restored = await bridge?.postMessage({ action: 'restore' });
// Use a real App Store Connect non-consumable identifier after configuring it.
const purchase = await bridge?.postMessage({ action: 'purchase', productId: 'REAL_PRODUCT_ID' });
```

Actions are `products`, `entitlements`, `restore`, and `purchase`. Replies use JSON-compatible objects. Product listing returns `{ok, action, configured, products:[{productId, displayName, displayPrice, contentId}], contentProducts:[{productId, contentId}], entitlements:[productId]}`. If the network product lookup fails, the native service still returns the configured content mapping and verified locally available entitlements, with an empty price/product catalog. Existing owners can use the bundled paid routes offline; a new purchase requires real product metadata and a current StoreKit response. A purchase returns `status: "verified"`, `"pending"`, or `"cancelled"`; errors include a stable `code`. Entitlements contain only product IDs from verified, non-revoked StoreKit transactions.

The v0.39 content mapping is implemented: the single non-consumable product maps to `contentId: "dusk-walks"`, the additional three-route collection “夕ぐれのよりみち”. `dusk-1` is a free sample; `dusk-2` and `dusk-3` require a matching verified product entitlement. The free 12 routes are unaffected. After creating the real product in App Store Connect, set the public build setting `JOURNEY_DUSK_PRODUCT_ID` to its actual product identifier. `Info.plist` exposes that value as `JourneyDuskProductID`; the native service rejects an empty or unresolved value and keeps the store unavailable. No invented product ID or simulated transaction is configured in the distributed application. `AppStore.sync()` is called only for an explicit restore action.

The browser `JourneyCommerce` UI is wired to this bridge. Purchase controls appear only after native StoreKit returns a configured product. Native StoreKit also listens for verified `Transaction.updates`, finishes only verified allowlisted non-consumables, and dispatches changed ownership using `journey:entitlements` with `{ productIds: [...] }`. The JS UI updates both purchase buttons and available extra routes. Purchase rights are held outside the game-save and photo databases, are never granted by imported save JSON, and must be obtained again from StoreKit after app restart. Tests use an explicitly isolated fixture to exercise the two extra routes; those tests do not prove an actual purchase, restore, revocation or App Store readiness.

### File export and share sheet

The handler name is `journeyFiles`:

```js
await window.webkit?.messageHandlers?.journeyFiles?.postMessage({
  filename: 'おさんぽの記録.json',
  mimeType: 'application/json',
  base64: '...',
});
```

Supported MIME types are `application/json`, `image/png`, and `image/jpeg`, with matching file extensions. The bridge accepts at most 8 MiB of decoded data, sanitizes the filename, writes to the temporary directory, and presents the native share sheet. The temporary export is removed when the sheet closes. The browser implementation already posts this shape from `JourneyTransfer.downloadFile` and `saveJourneyPhoto`.

## Build and signing

Use a full Xcode installation to build the shared scheme. A generic simulator build can be run with:

```sh
xcodebuild -project ios/DogBoneRun.xcodeproj \
  -scheme DogBoneRun \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

For a device or App Store archive, sign with the publisher's own Apple Developer team in Xcode. The project does not guess a team, provisioning profile, or signing identity. It enables no App Groups, iCloud, push, or other special entitlements. Review the bundle identifier, privacy wording, icons, StoreKit configuration, and current App Store requirements before submission.

The current development host has only `/Library/Developer/CommandLineTools`; `xcodebuild` reports that full Xcode is required, and `/Applications/Xcode.app` is absent. No build result, simulator run, signing result, or physical-device acceptance is claimed from this host. Install/open Xcode, select its developer directory in the normal Xcode setup flow, accept its license, then run the build command above. This task does not change the machine's global developer directory.

## Secrets and configuration

The iOS shell currently needs no API key, account token, backend credential, or private signing key. `ios/.gitignore` excludes `Secrets.xcconfig`, Xcode user state, provisioning profiles, and derived build output. `ios/Secrets.xcconfig.example` contains comments only. Do not put Apple private keys or API credentials into Swift, the site bundle, an xcconfig committed to Git, or an app binary. StoreKit product identifiers are not secrets. Signing certificates and provisioning profiles belong in Xcode's protected account/signing flow.

## Remaining acceptance work

- Build the prepared project with full Xcode and resolve compiler/project diagnostics.
- Run on iPhone and iPad simulators; confirm IndexedDB survives relaunch, all 12 routes and four classic courses launch, and local assets continue working in Airplane Mode.
- Exercise the native share sheet for a JSON save and PNG photo, including cancellation and the 8 MiB limit.
- Test StoreKit with real App Store Connect non-consumable products and sandbox transactions only after product IDs and web entitlement handling are deliberately configured.
- Sign with the publisher's Apple team and verify install, app review metadata, privacy text, performance, VoiceOver, audio, and offline behavior on physical devices.

Primary API references: [WKScriptMessageHandlerWithReply](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply), [StoreKit transaction entitlements](https://developer.apple.com/documentation/storekit/transaction/currententitlements), [AppStore.sync()](https://developer.apple.com/documentation/storekit/appstore/sync%28%29), and [NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information_property_list/nsapptransportsecurity/nsallowslocalnetworking).
