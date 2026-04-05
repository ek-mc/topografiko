## 2026-04-04 validation notes

- The client-side DXF export now produces a non-empty downloaded file after delaying object URL revocation.
- After the latest homepage simplification and server restart, the cadastre basemap is intermittently rendering as a blank gray canvas while the Leaflet attribution still shows Hellenic Cadastre.
- The centered KAEK search overlay is now visually more compact.
- The idle lower-left status panel stays hidden until needed, which matches the requested simplified layout.
- Browser console showed no JavaScript errors during the blank-basemap state, so the next step is DOM/network-style inspection of Leaflet tile elements and WMS request URLs.
