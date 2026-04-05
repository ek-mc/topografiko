# openkaek Architecture Note

## Product framing

**openkaek** is a React web application for academic and informational use. It provides a simplified cadastral-style interface for parcel lookup, map inspection, and local export, while clearly identifying the official Greek public-sector sources that inform the displayed geospatial context.

The application is not positioned as a legal extract service. Its role is to support academic presentation, exploratory parcel viewing, and explainable browser-side export workflows.

## Design philosophy

The chosen visual direction is **Civic Topography**. The interface should feel like a contemporary cartographic instrument rather than a marketing site or generic dashboard. The map is the dominant surface, floating controls remain light, typography is formal and restrained, and information density increases only when the user requests it.

## Frontend stack

The application is implemented as a **React** frontend with a static delivery model.

| Purpose | Choice | Reason |
| --- | --- | --- |
| UI framework | React | Required by the project brief and already scaffolded |
| Language | TypeScript | Safer geometry and export handling |
| Styling | Tailwind CSS with project-level custom tokens | Supports the restrained visual system |
| Map engine | Leaflet with React Leaflet | Non-Google, lightweight, and appropriate for public basemap switching |
| DXF export | `dxf-writer` | Browser-capable DXF generation for local parcel export |
| GeoJSON / KML export | Local utility functions | Explainable client-side generation without a remote export service |

## Information architecture

The initial version stays intentionally focused. The homepage itself acts as both the presentation surface and the working tool.

| Route | Purpose |
| --- | --- |
| `/` | Main map-first parcel viewer with KAEK search, basemap switching, source disclosure, and local export actions |

## Main interface structure

The interface is organized around a full-screen map workspace with modest floating controls.

| Interface area | Function |
| --- | --- |
| Top-left identity pill | Establishes the application name without introducing promotional clutter |
| Top-center search control | Reopens parcel search after the overlay is dismissed |
| Top-right controls | Basemap selector and compact information button |
| Centered search overlay | Primary KAEK input when the page first opens |
| Bottom-left parcel card | Parcel metrics, export actions, and search feedback after a parcel is loaded or a message needs to be shown |
| Main map surface | Basemap display and parcel geometry preview |

## Basemap model

The current application offers a small set of selectable basemaps so the interface remains simple while still useful for comparison.

| Basemap | Role |
| --- | --- |
| Official cadastre | Public Hellenic Cadastre WMS context |
| Satellite | Visual ground context for parcel surroundings |
| OSM | Lightweight street-map alternative |

The map experience must remain non-Google and should treat the official cadastre view as the academically preferred reference layer.

## Data handling model

The project follows a transparent client-side parcel workflow.

| Stage | Description |
| --- | --- |
| Input | Load a clearly identified sample parcel record suitable for stable academic demonstration |
| Normalize | Convert geometry into a shared parcel model |
| Preview | Render parcel outline on the interactive map |
| Measure | Calculate simple parcel metrics from the normalized geometry |
| Export | Generate DXF, GeoJSON, and KML locally in the browser |
| Download | Save generated files without sending export output to a third-party backend |

## Internal parcel model

The application uses a lightweight parcel model that is simple enough for academic explanation while remaining flexible for future live-service integration.

```ts
interface ParcelRecord {
  id: string;
  title: string;
  subtitle: string;
  source: string;
  sourceAuthority: string;
  sourceUrl: string;
  coordinateSystem: string;
  coordinateInterpretation: "geographic" | "projected";
  rings: { x: number; y: number }[][];
  metadata: Record<string, string>;
  disclaimer: string;
}
```

## Export design

DXF, GeoJSON, and KML exports are produced locally in the browser from the active parcel record.

| Export | Current behavior |
| --- | --- |
| DXF | Generates parcel boundary geometry, parcel label, and source note layers |
| GeoJSON | Produces a polygon feature collection with parcel metadata |
| KML | Produces a polygon placemark suitable for common GIS viewers |

The DXF workflow is intentionally modest. It is designed to be explainable during an academic presentation rather than to imitate a complete legal survey sheet.

## Source disclosure model

Public-source identification is available through a compact information control rather than a persistent top-page panel. This keeps the map-first interface clean while ensuring that official public-sector provenance remains visible and auditable when needed.

The interface and documentation should preserve formal wording such as:

> Parcel and contextual geospatial data displayed in this application are derived from official Greek public-sector geospatial sources. Each source remains the property and responsibility of the respective public authority.

Where cadastral parcel data are used, the interface should also keep the shorter caution:

> The cadastral parcel data presented here are used for informational and academic purposes and do not constitute legally valid extracts.

## Privacy and repository principles

The application should remain light, private, and academically neutral. It should avoid tracker scripts, unnecessary third-party runtime hooks, and map providers that conflict with the project’s intended presentation model.

| Repository file | Purpose |
| --- | --- |
| `README.md` | Project framing, setup, features, and source disclosure |
| `LICENSE` | MIT license |
| `CHANGELOG.md` | Initial release note |
| `client/src/pages/Home.tsx` | Main interface implementation |
| `client/src/lib/openkaek.ts` | Parcel model, geometry handling, and local export logic |

## Current implementation scope

The present prototype provides a stable academic demonstration rather than a full production cadastre client.

| Scope item | Current status |
| --- | --- |
| Map-first homepage | Implemented |
| Centered KAEK search overlay | Implemented |
| Search dropdown in top bar | Implemented |
| Official-source info dialog | Implemented |
| Official cadastre / satellite / OSM basemap switch | Implemented |
| Parcel metrics card | Implemented |
| Local DXF export | Implemented |
| Local GeoJSON export | Implemented |
| Local KML export | Implemented |
| Broad live parcel retrieval across arbitrary KAEK values | Future work |

## Implementation note

The current version intentionally uses a clearly identified sample parcel record derived from official public-source structure so that the interface remains stable in a frontend-only academic demonstration. The architecture is prepared for broader future integration with interoperable official geospatial services when a more complete retrieval pipeline is introduced.
