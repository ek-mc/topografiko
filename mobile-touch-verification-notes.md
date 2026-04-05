# Verification notes

## 2026-04-04 official-behavior parity check

The user clarified that the official Greek Cadastre site uses the same zoom-dependent behavior for cadastral information visibility. Live verification in openkaek now shows the same practical pattern:

- At zoom 17, the official cadastral parcel WMS overlay is active.
- At zoom 16, the overlay still remains visible.
- At zoom 15 and below, the overlay is removed and the compact notice explains that cadastral boundaries appear only after greater zoom.

This aligns openkaek more closely with the official Cadastre behavior instead of forcing parcel overlays at all scales.
