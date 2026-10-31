# v0.38 — 愛犬と、小さな思い出

## Scope and acceptance

Implement the approved proposal across the existing browser game: 12 authored walks (3 in each of 4 places), calm/challenge modes independent of place, lane-based discoveries, a persistent illustrated memory album, immediate starter progression, contextual dog/furniture reactions, photo export, save transfer, ambient sound, offline installation, a product page and distribution assets. Keep all four classic courses and their record keys. No external account, fabricated payment, fabricated human testing, or public release without working credentials. Prepare a native iOS purchase bridge where local tools support it; distinguish configured commerce and unsigned builds from actual sales/device acceptance.

## Shared interfaces

- `src/journey-catalog.js`: `JOURNEY_PLACES` array `{id,level,title,subtitle,color}`, `JOURNEY_ROUTES` array `{id,level,title,description,seed,discoveries:[{id,title,description,kind,lane,timeMs}],...}`, `getJourneyRoute(id)`, `getJourneyDiscovery(id)`.
- Route IDs: `street-1..3`, `park-1..3`, `mountain-1..3`, `cave-1..3`. Discoveries are distinct across routes, 3 per route, at 8/16/24 active seconds. First encounter lane is center. Existing classic game has `journeyRouteId=null`.
- Game accepts `reset({seed,walkLevel,journeyRouteId=null,journeyMode='calm'})`; constructor accepts same. `game.journeyRouteId`, `game.journeyMode`, `game.discoveryIds`. Emits `discovery` with `{discoveryId,...}` only when the actual lane crosses the encounter; emits route context and `discoveryIds` in end event. Calm reduces obstacle density without changing a classic course. Both modes use 30 seconds and normal input/pause rules. Authored routes have stable seeds and safe paths.
- Persistence: optional `roomShop.journey` namespace, introduced atomically with `initializeJourney`; old roomShop payloads remain valid. `beginWalk` accepts optional routeId/mode; `settleWalk` accepts discoveryIds and completedAt. Settlement validates discovery membership, caps awards, and atomically updates coins, album and first-step milestones. Duplicate/recovered settlement never pays twice. Classic settlement semantics remain unchanged. Result includes journey summary. Existing prices unchanged; journey-only starter/discovery bonuses deliver first furniture within 1–3 trips and natural room by 5–8 trips. Add a player name setting within journey if useful.
- UI `new JourneyUI({controller,renderer,game,onSelectRoute,onSelectClassic,onPhoto,onExportSave,onImportSave})`; methods `render()`, `showMap(trigger)`, `showAlbum(trigger)`, `showDiscovery(event)`, `showResult(event)`, `showHomeMessage(text)`, `get modalOpen`, optional `setBusy`. UI owns new `journey-ui.js` / `journey.css` and markup injected by the class; main owns app integration and index link.
- Renderer supplies contextual home reaction through `reactToHomeItem(itemId)` and `setJourneyHomeContext(context)` or documented equivalent. Preserve the same dog identity, reduced-motion and suspension semantics. New rendering is composed using existing assets and code-native graphics; no unreviewed 3D replacement.

## TODO

- [done] A: catalog, save schema/migration, atomic progression and model tests.
- [done] B: game discovery/course behavior, rendering, three meaningful furniture reactions, ambient audio and focused tests.
- [done] C: responsive map, album, discovery/result/home UI and UI styles, accessible modal behavior.
- [done] Parent: app/controller integration, save transfer/photo, PWA/build, product/distribution assets, native delivery feasibility.
- [done] Parent: review all worker changes; complete integration; unit/build and browser acceptance, failure recovery and offline checks; fix issues including bfcache leases, import preservation, share cancellation, and river composition.
- [done] Parent: final distribution, screenshots/video, README and evidence; final truthful completion report with external acceptance boundaries.

External acceptance remains separate: physical iPhone/iPad and human playtests, full Xcode compilation and signing, actual StoreKit product/content configuration and sandbox purchases, public publishing/store submission. No successful result is fabricated for these unavailable external actions.

## Visual contract

Friendly base, existing cream/brown/sage palette, Japanese system sans. Dog remains the visual focus. Scene cards have actual place thumbnails, natural Japanese copy and compact progress. Tap targets >=44px, obvious focus, no horizontal overflow at 320px, native dialogs with focus restoration, reduced motion. The result prioritizes discoveries and a next action; detailed scores remain available. Offline failure must not strand players. No purchase buttons imply functioning commerce until an actual store product is available.
