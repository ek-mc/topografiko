# topografiko — active TODO

## High priority
- [ ] Verify parcel geometry accuracy with projected coordinates (HGRS87/EGSA87 flow and measurement validation).
- [ ] Implement production-ready export layout (paper scale presets including 1:200, title block, north arrow).
- [ ] Finalize data-loading strategy for local JSON enrichment (startup preload vs lazy-load with cache).

## Medium priority
- [ ] Add lightweight tests for geometry transforms and export serializers.
- [ ] Add CI checks for `pnpm check` + `pnpm build` on PRs.
- [ ] Add release checklist (version bump, changelog, tag, release notes).

## Nice to have
- [ ] Add optional parcel overlay controls (line weight, labels on/off) for presentation mode.
