# Cadastre overlay notes

The missing parcel-information layer is not part of the current public basemap WMS.

## Confirmed official behavior

The official Hellenic Cadastre INSPIRE metadata states that cadastral diagrams should only appear when the WMS is viewed at scale **1:9000 or larger**, and they are hidden at smaller scales for performance reasons.

## Confirmed official service endpoints

| Purpose | Endpoint |
| --- | --- |
| Public basemap already in use | `https://gis.ktimanet.gr/wms/wmsopen/wmsserver.aspx` |
| Parcel overlay view service | `http://gis.ktimanet.gr/inspire/rest/services/cadastralparcels/CadastralParcelWMS/MapServer/exts/InspireView/service?REQUEST=GetCapabilities&SERVICE=WMS&VERSION=1.3.0` |
| Parcel download service | `https://gis.ktimanet.gr/inspire/rest/services/cadastralparcels/CadastralParcel/MapServer/exts/InspireFeatureDownload/service?SERVICE=WFS&REQUEST=GetCapabilities` |

## Implementation implication

The app should keep the lightweight basemap at low zooms and only activate the official parcel-boundary overlay after a sufficiently high zoom threshold, likely around the equivalent of the official 1:9000 visibility rule.
