# Third-party data notices

## Macau transit catalog

The deployment workflow generates `data/catalog.json` from the pinned source recorded in `scripts/sync-static-data.ts`. The generated artifact includes its source revision, file URLs, timestamps, and SHA-256 provenance. It is not committed to this repository.

The Macau Transport Bureau (DSAT) data-open catalogue describes static bus route data as unconditionally open and downloadable from its website. The currently pinned intermediary repository does not publish an explicit licence in this repository's audited snapshot. Confirm the applicable source terms before reusing or redistributing the generated catalog outside this application.

## Realtime observations

Realtime bus observations are requested from DSAT on demand through the Netlify Function. Raw upstream responses and request tokens are not returned or stored by this application. Vehicle plate identifiers are masked by the public API before they reach the browser.

## Map tiles

Map data and tiles are provided by OpenStreetMap contributors and are displayed with attribution in the application. Production traffic must continue to follow the OpenStreetMap tile usage policy.
