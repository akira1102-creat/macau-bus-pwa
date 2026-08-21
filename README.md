# 澳門巴士 PWA

This repository keeps the static Macau transit catalog local. The upstream JSON files and generated catalog are intentionally ignored by Git; only the schema, synchronizer, provenance rules, and sanitized fixtures are committed.

## Local setup

```text
npm install
npm run data:sync
npm test
npm run typecheck
npm run lint
```

`data:sync` downloads exactly five files from the pinned `ChiHin-Lio/macau-bus-data` ref, normalizes them to `public/data/catalog.json`, and writes `public/data/provenance.json`. Set `MACAU_BUS_DATA_REF` to an audited commit when updating the source.

The DSAT probe is deliberately opt-in and makes one polite POST request:

```text
npm run dsat:test -- --route 1 --direction 0
```

The probe prints only protocol metadata and a sanitized summary. Do not commit upstream data, live vehicle identifiers, response bodies, or secrets.
