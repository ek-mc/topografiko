# Maps.gov.gr elevation investigation notes

## Current findings

- Opened `https://maps.gov.gr/gis/map/`.
- The initial markdown extraction exposed only a search/selection shell for prefecture, OTA, street/place, coordinates, and KAEK.
- A subsequent page inspection showed a mostly blank rendered viewport and no detectable interactive elements in the current browser state.
- At this point, the page does **not** yet provide visible evidence of a directly accessible elevation layer, identify widget, or obvious public endpoint from the rendered UI alone.

## Next step

- Inspect network/page source indirectly through external searches or command-line fetches to see whether the app references ArcGIS/GeoServer/WMS/WMTS/feature services with elevation-related names.

## Overlay menu findings

After the application finished loading, the overlay menu exposed the following visible thematic options: only basemap, cadastral parcels, pre-cadastre publication, cadastre publication, NATURA 2000, cadastre status, and municipality statistics. No visible option referred to elevation, DEM, contours, terrain, relief, slope, or hillshade.

The page also exposes a separate **3D** entry, which suggests the platform may support three-dimensional viewing, but this alone does not confirm a point-elevation API or an easily reusable public service for parcel vertex heights.

## 3D mode and resource inspection

The visible interface confirms that the platform has a 3D mode, including controls for lighting, wireframe display, and camera movement. This indicates a terrain-capable viewer, not merely a flat 2D map.

However, the inspected page text still exposed no explicit elevation readout, no visible point-height tool, and no obvious public feature endpoint for retrieving numeric heights per coordinate.

The loaded resources clearly reference a Ktimatologio web API endpoint of the form `https://gis.ktimanet.gr/gis/WebAPIWebServicev1.3/ImageService.aspx?...`, together with a local `3D.js` script. So far, this points to image/visualization services and client-side 3D rendering support, but not yet to a documented, reusable elevation-query API.

## Strong technical evidence from source/runtime

The downloaded `3D.js` file contains direct references to elevation handling. In particular, it updates a UI label with `ΥΨΟΜΕΤΡΟ: ... μέτρα` and calls `MyMap1.GL.getElevationAtXY(x, y)` repeatedly. This is strong evidence that the 3D viewer uses real numeric ground elevation values internally.

At runtime, the page also exposes `MyMap1.GL.getElevationAtXY` as a callable JavaScript function. That means the application likely can compute or retrieve terrain height for EGSA87 map coordinates inside the browser session.

What remains unclear is whether there is a documented and stable public endpoint behind this function, or whether the height retrieval depends on internal client logic and 3D assets that would be risky to rely on directly from our application.
