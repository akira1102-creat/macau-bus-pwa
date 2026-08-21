# Design QA — 澳門實時巴士 PWA v0.2.1

## Comparison target and evidence

- Source visual truth: `docs/design/home-concept.png`, `docs/design/route-concept.png`.
- Latest implementation: `http://127.0.0.1:4173/` and `http://127.0.0.1:4173/?tab=routes&route=26A`.
- Implementation screenshots:
  - `C:\Users\AKR\.codex\visualizations\2026\08\21\01a021b9-fb8d-7b31-a8a8-e3117686f59f\macau-bus-home-390x844-v2.png`
  - `C:\Users\AKR\.codex\visualizations\2026\08\21\01a021b9-fb8d-7b31-a8a8-e3117686f59f\macau-bus-route-390x844-v2.png`
  - `C:\Users\AKR\.codex\visualizations\2026\08\21\01a021b9-fb8d-7b31-a8a8-e3117686f59f\macau-bus-home-1280x900-v2.png`
- Combined comparison inputs opened with `view_image`:
  - `C:\Users\AKR\.codex\visualizations\2026\08\21\01a021b9-fb8d-7b31-a8a8-e3117686f59f\compare-home-v2.png`
  - `C:\Users\AKR\.codex\visualizations\2026\08\21\01a021b9-fb8d-7b31-a8a8-e3117686f59f\compare-route-v2.png`
- Viewport: primary mobile CSS viewport 390×844; responsive check 1280×900.
- Pixels and normalization: each source is 853×1844 pixels and was downsampled into a 390×844 comparison slot; each mobile implementation capture is native 390×844 at device scale factor 1. The 1280×900 implementation capture is native. Device status/home chrome in the source is treated as non-app-owned content.
- States: clean light-mode home; route 26A direction 0 with live DSAT observations, OSM tiles and the live-bus tab selected.

## Findings

No actionable P0, P1 or P2 differences remain.

- Typography: the implementation uses a compact system CJK sans stack with the same heavy ink hierarchy, readable small labels and stable wrapping. The long real route name wraps to two lines, while the concept uses the shorter route number as its title; the added `路線 26A` badge preserves the required identity without hiding the real endpoints.
- Spacing and layout: 390×844 keeps the search, sections, direction tabs, map, live row and five-item bottom navigation inside the viewport with no overlap or clipped persistent controls. Desktop intentionally remains a centred phone-width content column, matching the spec.
- Colors and tokens: true white, deep ink, cool-gray dividers, jade active controls and amber estimated status match the visual target. No gradients, nested-card drift or heavy shadows were introduced.
- Images and assets: these screens contain no photographic or custom raster art. The implementation uses real OSM tiles and the specified Lucide outline icon family; no placeholder, emoji, handcrafted SVG or CSS-art substitute is visible.
- Copy and content: app-specific Traditional Chinese copy is coherent. The clean home capture intentionally shows empty favorites/recent items because those are device-local; the concept's populated rows are illustrative. Nearby results intentionally remain empty until the user explicitly grants location permission.
- Icons and controls: icons share consistent stroke weight, selected jade state and practical tap targets. Direction tabs, map zoom, favorites and bottom navigation have clear selected states.
- Responsive/accessibility: 44px controls, focus-visible styling, labelled regions/tabs, top and bottom safe-area handling and desktop centring are present. No PWA/device-chrome mismatch was filed against app-owned content.

## Open questions / accepted deviations

- The concept depicts sample nearby, favorite and recent data; the clean implementation state does not invent local history or request location on launch.
- The concept map is a simplified visual mock; the implementation deliberately uses real Leaflet/OSM tiles, attribution and station-anchored estimated markers.
- Physical-device geolocation permission and iOS/Android Home Screen chrome were not exercised in the desktop IAB; automated permission/error coverage and the PWA install/update E2E remain the evidence for those paths.

## Comparison history

1. First full-view comparison found one P2: route detail did not visibly state route number `26A`; only the long endpoints appeared in the header.
2. Commit `656f79c` added a jade `路線 26A` badge while preserving the endpoint title and 44px back/favorite controls.
3. The v0.2.1 route was rebuilt and recaptured at 390×844. `compare-route-v2.png` shows the route identity above the endpoint title with no new overlap or clipping.

## Browser verification

- Codex in-app Browser: home load, route search for 26A, route open, direction switch, OSM map/attribution, live buses, stop list, favorite toggle and reload persistence, map-tab route picker, and dark theme selection.
- Live check: nine DSAT observations were rendered during the route check; plates were masked and the console had no errors or warnings.
- Production/offline/update automation: 14 Playwright tests passed for 390×844 and desktop, including fresh first-controller offline reload, real changed-worker activation, exactly one guarded reload, localStorage preservation, manifest/icons and API/OSM cache exclusion.

Focused region comparison was not needed after opening the native 390×844 route screenshot separately: the route badge, title wrapping, tabs, map legend, live row, icons and bottom navigation were all readable at native resolution.

## Implementation checklist

- [x] Route identity is explicit above the fold.
- [x] Mobile and desktop layouts preserve the intended hierarchy.
- [x] Required fidelity surfaces and core interactions were checked.
- [x] P0/P1/P2 findings are resolved.

final result: passed
