/**
 * Civic Topography file note:
 * Keep this page simple, map-first, mobile-friendly, and academically credible.
 * The interface should feel close to a cadastral viewer: a large map, modest floating controls,
 * a compact centered KAEK search overlay, and source disclosure behind an information button.
 */

import "leaflet/dist/leaflet.css";

import { CRS, latLng } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileCode2,
  FileJson,
  FileText,
  Info,
  Moon,
  Search,
  Sun,
  Table2,
  X,
} from "lucide-react";
import {
  MapContainer,
  Polygon,
  TileLayer,
  ZoomControl,
  useMapEvents,
} from "react-leaflet";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import {
  OFFICIAL_SAMPLE_PARCELS,
  createDxf,
  createGeoJson,
  createKml,
  downloadTextFile,
  formatMetric,
  getParcelMetrics,
  type ParcelRecord,
} from "@/lib/topografiko";

type SearchState = "idle" | "success" | "error";
type LatLngTuple = [number, number];
type MapPointerInfo = {
  lat: number;
  lng: number;
  x: number;
  y: number;
};

type MapBoundsInfo = {
  west: number;
  south: number;
  east: number;
  north: number;
};

const DEFAULT_IDLE_CENTER: LatLngTuple = [39.2, 23.2];
const DEFAULT_IDLE_ZOOM = 6;
const PARCEL_OVERLAY_MIN_ZOOM = 14;

function readInitialMapState() {
  const params = new URLSearchParams(window.location.search);
  const mapParam = params.get("map");

  if (!mapParam) {
    return {
      center: DEFAULT_IDLE_CENTER as LatLngTuple,
      zoom: DEFAULT_IDLE_ZOOM,
    };
  }

  const [z, lat, lng] = mapParam.split("/");
  const zoom = Number(z);
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (!Number.isFinite(zoom) || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return {
      center: DEFAULT_IDLE_CENTER as LatLngTuple,
      zoom: DEFAULT_IDLE_ZOOM,
    };
  }

  return {
    center: [parsedLat, parsedLng] as LatLngTuple,
    zoom,
  };
}

const SOURCES = [
  {
    title: "Κτηματολογικά τεμάχια INSPIRE",
    authority: "Ελληνικό Κτηματολόγιο",
    href: "https://www.ktimatologio.gr/e-services/23",
    detail:
      "Επίσημα δημόσια γεωχωρικά δεδομένα κτηματολογικών τεμαχίων μέσω διαλειτουργικών υπηρεσιών INSPIRE.",
  },
  {
    title: "Μεταδεδομένα συνόλου δεδομένων",
    authority: "INSPIRE Geoportal",
    href:
      "https://inspire-geoportal.ec.europa.eu/srv/api/records/GR.HellenicCadastre_FFAC7752-D8BB-43CE-B45D-B5F4F5A6C253?language=all",
    detail:
      "Τυπική περιγραφή του συνόλου δεδομένων για αναγνώριση πηγής, πεδίου εφαρμογής και ενημέρωσης.",
  },
  {
    title: "Δημόσιο υπόβαθρο Κτηματολογίου",
    authority: "Ελληνικό Κτηματολόγιο",
    href:
      "https://gis.ktimanet.gr/wms/wmsopen/wmsserver.aspx?SERVICE=WMS&REQUEST=GetCapabilities",
    detail:
      "Δημόσια υπηρεσία WMS που χρησιμοποιείται για το επίσημο χαρτογραφικό υπόβαθρο της εφαρμογής.",
  },
  {
    title: "Ενιαίος Ψηφιακός Χάρτης",
    authority: "Τεχνικό Επιμελητήριο Ελλάδας",
    href: "https://sdigmap.tee.gov.gr/sdmquery/public/",
    detail:
      "Σχετικό δημόσιο χαρτογραφικό περιβάλλον για ευρύτερο χωρικό έλεγχο και συμπληρωματικά επίπεδα.",
  },
];

function normalizeKaek(value: string) {
  return value.replace(/[^0-9a-z]/gi, "").toLowerCase();
}

function getParcelKaek(parcel: ParcelRecord) {
  return parcel.metadata["National cadastral reference"] || parcel.title;
}

function getGeographicRing(parcel: ParcelRecord): LatLngTuple[] | null {
  if (parcel.coordinateInterpretation !== "geographic") {
    return null;
  }

  const ring = parcel.rings[0];
  const usable = ring.length > 1 ? ring.slice(0, -1) : ring;
  return usable.map((point) => [point.x, point.y]);
}

function buildPointerInfo(lat: number, lng: number): MapPointerInfo {
  const projected = CRS.EPSG3857.project(latLng(lat, lng));

  return {
    lat,
    lng,
    x: projected.x,
    y: projected.y,
  };
}

function getApproxScaleDenominator(zoom: number, latitude: number) {
  const metersPerPixel =
    (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom + 8);

  return metersPerPixel / 0.0002645833333333333;
}

function formatProjectedCoordinate(value: number | null) {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("el-GR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatGeographicCoordinate(value: number | null) {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  }).format(value);
}

function projectLonLatToWebMercator(lat: number, lng: number) {
  const x = (lng * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return { x, y };
}

async function queryCadastreParcelAtPoint(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ParcelRecord | null> {
  console.log("[topografiko] ArcGIS parcel query start", { lat, lng });
  const { x, y } = projectLonLatToWebMercator(lat, lng);
  const geometry = JSON.stringify({ x, y, spatialReference: { wkid: 3857 } });
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometryType: "esriGeometryPoint",
    geometry,
    inSR: "3857",
    spatialRel: "esriSpatialRelIntersects",
    returnGeometry: "true",
    outFields: "OBJECTID,KAEK,AREA,PERIMETER,LINK",
    outSR: "4326",
    resultRecordCount: "1",
  });

  const url = `https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query?${params.toString()}`;
  console.log("[topografiko] ArcGIS parcel query url", url);
  const response = await fetch(url, { signal });
  console.log("[topografiko] ArcGIS parcel query response", response.status, response.ok);
  const data = await response.json();
  console.log("[topografiko] ArcGIS parcel query payload", data);
  const feature = data?.features?.[0];

  if (!feature?.geometry?.rings?.length) {
    return null;
  }

  const attrs = feature.attributes || {};
  const rings = feature.geometry.rings.map((ring: number[][]) =>
    ring.map((point: number[]) => ({ x: point[1], y: point[0] })),
  );

  return {
    id: `arcgis-parcel-${attrs.OBJECTID ?? "unknown"}`,
    title: attrs.KAEK || "Parcel",
    subtitle: "ArcGIS parcel feature from Hellenic Cadastre official map services",
    source: "Hellenic Cadastre ArcGIS Feature Service",
    sourceAuthority: "Hellenic Cadastre",
    sourceUrl:
      "https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0",
    coordinateSystem: "EPSG:4326 geographic coordinates",
    coordinateInterpretation: "geographic",
    rings,
    metadata: {
      "National cadastral reference": String(attrs.KAEK || ""),
      Area: attrs.AREA != null ? String(attrs.AREA) : "",
      Perimeter: attrs.PERIMETER != null ? String(attrs.PERIMETER) : "",
      Link: attrs.LINK || "",
      "ArcGIS OBJECTID": attrs.OBJECTID != null ? String(attrs.OBJECTID) : "",
    },
    disclaimer:
      "The parcel information shown is fetched from official Hellenic Cadastre ArcGIS services for informational use and does not constitute a legally valid extract.",
  };
}

async function queryCadastreParcelsInBounds(
  bounds: MapBoundsInfo,
  signal?: AbortSignal,
): Promise<ParcelRecord[]> {
  const min = projectLonLatToWebMercator(bounds.south, bounds.west);
  const max = projectLonLatToWebMercator(bounds.north, bounds.east);
  const geometry = JSON.stringify({
    xmin: min.x,
    ymin: min.y,
    xmax: max.x,
    ymax: max.y,
    spatialReference: { wkid: 3857 },
  });

  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometryType: "esriGeometryEnvelope",
    geometry,
    inSR: "3857",
    spatialRel: "esriSpatialRelIntersects",
    returnGeometry: "true",
    outFields: "OBJECTID,KAEK,AREA,PERIMETER,LINK",
    outSR: "4326",
    resultRecordCount: "40",
  });

  const url = `https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query?${params.toString()}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`ArcGIS viewport query failed with status ${response.status}`);
  const data = await response.json();
  const features = Array.isArray(data?.features) ? data.features : [];

  return features
    .filter((feature: any) => feature?.geometry?.rings?.length)
    .map((feature: any) => {
      const attrs = feature.attributes || {};
      const rings = feature.geometry.rings.map((ring: number[][]) =>
        ring.map((point: number[]) => ({ x: point[1], y: point[0] })),
      );
      return {
        id: `arcgis-parcel-${attrs.OBJECTID ?? "unknown"}`,
        title: attrs.KAEK || "Parcel",
        subtitle: "ArcGIS parcel feature from Hellenic Cadastre official map services",
        source: "Hellenic Cadastre ArcGIS Feature Service",
        sourceAuthority: "Hellenic Cadastre",
        sourceUrl:
          "https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0",
        coordinateSystem: "EPSG:4326 geographic coordinates",
        coordinateInterpretation: "geographic",
        rings,
        metadata: {
          "National cadastral reference": String(attrs.KAEK || ""),
          Area: attrs.AREA != null ? String(attrs.AREA) : "",
          Perimeter: attrs.PERIMETER != null ? String(attrs.PERIMETER) : "",
          Link: attrs.LINK || "",
          "ArcGIS OBJECTID": attrs.OBJECTID != null ? String(attrs.OBJECTID) : "",
        },
        disclaimer:
          "The parcel information shown is fetched from official Hellenic Cadastre ArcGIS services for informational use and does not constitute a legally valid extract.",
      } satisfies ParcelRecord;
    });
}

function MapEffects({
  activeParcel,
  initialCenter,
  initialZoom,
  onMapInteract,
  onViewportChange,
  onPointerChange,
  onMapClick,
}: {
  activeParcel: ParcelRecord | null;
  initialCenter: LatLngTuple;
  initialZoom: number;
  onMapInteract: () => void;
  onViewportChange: (state: { zoom: number; center: LatLngTuple; bounds: MapBoundsInfo }) => void;
  onPointerChange: (pointer: MapPointerInfo | null) => void;
  onMapClick: (lat: number, lng: number) => void;
}) {
  let syncFrame = 0;

  const syncViewport = () => {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const nextCenter: LatLngTuple = [center.lat, center.lng];
    const bounds = map.getBounds();

    onViewportChange({
      zoom,
      center: nextCenter,
      bounds: {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
    });
    onPointerChange(buildPointerInfo(center.lat, center.lng));
  };

  const syncUrl = () => {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const nextMap = `${zoom}/${center.lat.toFixed(5)}/${center.lng.toFixed(5)}`;
    const params = new URLSearchParams(window.location.search);
    params.set("map", nextMap);
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", next);
  };

  const scheduleUrlSync = () => {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => {
      syncUrl();
      syncFrame = 0;
    });
  };

  const map = useMapEvents({
    click: (event) => {
      console.log("[topografiko] map click", event.latlng);
      onMapInteract();
      onPointerChange(buildPointerInfo(event.latlng.lat, event.latlng.lng));
      onMapClick(event.latlng.lat, event.latlng.lng);
      syncViewport();
    },
    mousedown: () => onMapInteract(),
    dragstart: () => onMapInteract(),
    movestart: () => onMapInteract(),
    zoomstart: () => onMapInteract(),
    mousemove: (event) => {
      onPointerChange(buildPointerInfo(event.latlng.lat, event.latlng.lng));
    },
    zoom: () => scheduleUrlSync(),
    move: () => scheduleUrlSync(),
    zoomend: () => syncViewport(),
    moveend: () => syncViewport(),
  });

  useEffect(() => {
    syncViewport();

    const container = map.getContainer();
    const handleTouch = () => {
      onMapInteract();
      syncViewport();
      scheduleUrlSync();
    };

    container.addEventListener("touchstart", handleTouch, { passive: true });
    container.addEventListener("touchmove", handleTouch, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouch);
      container.removeEventListener("touchmove", handleTouch);
      if (syncFrame) cancelAnimationFrame(syncFrame);
    };
  }, [map, onMapInteract, onPointerChange, onViewportChange]);

  const geographicRing = activeParcel ? getGeographicRing(activeParcel) : null;

  useEffect(() => {
    if (geographicRing && geographicRing.length > 0) {
      map.fitBounds(geographicRing, { padding: [40, 40] });
      return;
    }

    map.setView(initialCenter, initialZoom);
  }, [map, geographicRing, initialCenter, initialZoom]);

  return null;
}

function BasemapLayer() {
  return (
    <TileLayer
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution="OpenStreetMap contributors"
    />
  );
}

export default function Home() {
  const { theme, toggleTheme } = useTheme();
  const initialMapState = useMemo(() => readInitialMapState(), []);
  const [activeParcel, setActiveParcel] = useState<ParcelRecord | null>(null);
  const [query, setQuery] = useState("");
  const [showCenterSearch, setShowCenterSearch] = useState(true);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchMessage, setSearchMessage] = useState(
    "Πληκτρολογήστε ΚΑΕΚ για φόρτωση δείγματος.",
  );
  const [mapZoom, setMapZoom] = useState(initialMapState.zoom);
  const [mapCenter, setMapCenter] = useState<LatLngTuple>(initialMapState.center);
  const [mapBounds, setMapBounds] = useState<MapBoundsInfo | null>(null);
  const [visibleParcels, setVisibleParcels] = useState<ParcelRecord[]>([]);
  const [isLoadingVisibleParcels, setIsLoadingVisibleParcels] = useState(false);
  const [mapPointer, setMapPointer] = useState<MapPointerInfo | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isPickingParcel, setIsPickingParcel] = useState(false);

  const centerSearchRef = useRef<HTMLDivElement | null>(null);
  const topSearchRef = useRef<HTMLDivElement | null>(null);
  const parcelQueryAbortRef = useRef<AbortController | null>(null);
  const viewportQueryAbortRef = useRef<AbortController | null>(null);

  const metrics = useMemo(
    () => (activeParcel ? getParcelMetrics(activeParcel) : null),
    [activeParcel],
  );
  const geographicRing = activeParcel ? getGeographicRing(activeParcel) : null;

  const handleMapInteract = () => {
    setShowCenterSearch(false);
    setShowSearchDropdown(false);
  };

  const handleMapParcelPick = async (lat: number, lng: number) => {
    console.log("[topografiko] handleMapParcelPick", { lat, lng });
    parcelQueryAbortRef.current?.abort();
    const controller = new AbortController();
    parcelQueryAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);

    setIsPickingParcel(true);
    setSearchState("success");
    setSearchMessage("ArcGIS query starting...");

    try {
      const parcel = await queryCadastreParcelAtPoint(lat, lng, controller.signal);
      if (controller.signal.aborted) return;

      if (!parcel) {
        console.log("[topografiko] no parcel found");
        setSearchState("error");
        setSearchMessage("ArcGIS query ran, but no parcel was found at this point.");
        return;
      }

      console.log("[topografiko] parcel found", parcel);
      setActiveParcel(parcel);
      setSearchState("success");
      setSearchMessage(`ArcGIS parcel found: ${getParcelKaek(parcel)}.`);
      setShowCenterSearch(false);
      setShowSearchDropdown(false);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log("[topografiko] ArcGIS parcel query aborted");
        return;
      }
      console.error("[topografiko] ArcGIS parcel query failed", error);
      setSearchState("error");
      setSearchMessage("ArcGIS query failed. Check console/network.");
    } finally {
      window.clearTimeout(timeoutId);
      if (parcelQueryAbortRef.current === controller) {
        parcelQueryAbortRef.current = null;
      }
      setIsPickingParcel(false);
    }
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      const insideCenterSearch = centerSearchRef.current?.contains(target) ?? false;
      const insideTopSearch = topSearchRef.current?.contains(target) ?? false;

      if (!insideCenterSearch && !insideTopSearch) {
        setShowCenterSearch(false);
        setShowSearchDropdown(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);



  useEffect(() => {
    if (!mapBounds || mapZoom < PARCEL_OVERLAY_MIN_ZOOM) {
      viewportQueryAbortRef.current?.abort();
      setVisibleParcels([]);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      viewportQueryAbortRef.current?.abort();
      const controller = new AbortController();
      viewportQueryAbortRef.current = controller;
      setIsLoadingVisibleParcels(true);

      try {
        const parcels = await queryCadastreParcelsInBounds(mapBounds, controller.signal);
        if (controller.signal.aborted) return;
        setVisibleParcels(parcels);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.error("[topografiko] viewport ArcGIS query failed", error);
      } finally {
        if (viewportQueryAbortRef.current === controller) {
          viewportQueryAbortRef.current = null;
        }
        setIsLoadingVisibleParcels(false);
      }
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [mapBounds, mapZoom]);

  const runSearch = () => {
    const normalizedQuery = normalizeKaek(query);

    if (!normalizedQuery) {
      setSearchState("error");
      setSearchMessage("Συμπληρώστε έναν κωδικό ΚΑΕΚ.");
      return;
    }

    const match = OFFICIAL_SAMPLE_PARCELS.find((parcel) => {
      const kaek = normalizeKaek(getParcelKaek(parcel));
      const inspireId = normalizeKaek(
        parcel.metadata["INSPIRE local identifier"] || "",
      );

      return (
        kaek === normalizedQuery ||
        kaek.includes(normalizedQuery) ||
        inspireId.includes(normalizedQuery)
      );
    });

    if (!match) {
      setSearchState("error");
      setSearchMessage(
        "Δεν βρέθηκε γεωτεμάχιο στο τρέχον δείγμα. Δοκιμάστε 210161404125.",
      );
      return;
    }

    setActiveParcel(match);
    setSearchState("success");
    setSearchMessage(`Φορτώθηκε το γεωτεμάχιο ${getParcelKaek(match)}.`);
    setShowCenterSearch(false);
    setShowSearchDropdown(false);
  };

  const handleExport = (format: "dxf" | "geojson" | "kml") => {
    if (!activeParcel) {
      return;
    }

    const safeId = activeParcel.id.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();

    if (format === "dxf") {
      downloadTextFile(
        `topografiko-${safeId}.dxf`,
        createDxf(activeParcel, {
          includeLabel: true,
          includeSourceNote: true,
        }),
        "application/dxf",
      );
      return;
    }

    if (format === "geojson") {
      downloadTextFile(
        `topografiko-${safeId}.geojson`,
        createGeoJson(activeParcel),
        "application/geo+json",
      );
      return;
    }

    downloadTextFile(
      `topografiko-${safeId}.kml`,
      createKml(activeParcel),
      "application/vnd.google-earth.kml+xml",
    );
  };

  return (
    <div className="page-shell min-h-screen bg-[radial-gradient(circle_at_top,rgba(224,214,196,0.18),transparent_32%),linear-gradient(180deg,#f4efe6,#eee6da)] text-ink">
      <main className="relative h-screen overflow-hidden">
        <MapContainer
          center={initialMapState.center}
          zoom={initialMapState.zoom}
          zoomControl={false}
          className="h-full w-full"
          dragging={true}
          touchZoom={true}
          doubleClickZoom={true}
          scrollWheelZoom={true}
        >
          <BasemapLayer />
                    <ZoomControl position="topleft" />
          <MapEffects
            activeParcel={activeParcel}
            initialCenter={initialMapState.center}
            initialZoom={initialMapState.zoom}
            onMapInteract={handleMapInteract}
            onViewportChange={({ zoom, center, bounds }) => {
              setMapZoom(zoom);
              setMapCenter(center);
              setMapBounds(bounds);
            }}
            onPointerChange={setMapPointer}
            onMapClick={handleMapParcelPick}
          />
          {visibleParcels
            .filter((parcel) => parcel.id !== activeParcel?.id)
            .map((parcel) => {
              const ring = getGeographicRing(parcel);
              if (!ring) return null;
              return (
                <Polygon
                  key={parcel.id}
                  positions={ring}
                  pathOptions={{
                    color: "#8b5e5a",
                    weight: 1.4,
                    fillOpacity: 0.02,
                    opacity: 0.9,
                  }}
                />
              );
            })}
          {geographicRing ? (
            <Polygon
              positions={geographicRing}
              pathOptions={{
                color: "#c43d2f",
                weight: 1.8,
                fillOpacity: 0,
                opacity: 0.95,
              }}
            />
          ) : null}
        </MapContainer>

        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent_18%,transparent_82%,rgba(37,34,29,0.06))]" />

        <div className="absolute inset-x-0 top-0 z-[1000] border-b border-[rgba(54,65,57,0.12)] bg-[rgba(248,245,239,0.92)] backdrop-blur-sm dark:border-white/10 dark:bg-[#0d1117]/95">
          <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-4">
            <div className="border border-[rgba(54,65,57,0.12)] bg-white/70 px-3 py-1.5 dark:border-white/12 dark:bg-[#161b22] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[rgba(52,61,55,0.72)] sm:text-[11px]">topografiko</p>
            </div>
            <div className="flex items-center gap-2">
            <div ref={topSearchRef} className="relative">
              <Button
                variant="outline"
                className="h-10 border-[rgba(54,65,57,0.12)] bg-white/85 px-3 text-ink shadow-[0_10px_28px_rgba(28,24,20,0.08)] dark:border-white/12 dark:bg-[#21262d] dark:text-[#f0f6fc] dark:hover:bg-[#30363d] sm:px-4"
                onClick={() => setShowSearchDropdown((open) => !open)}
              >
                <Search className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Αναζήτηση</span>
              </Button>

              {showSearchDropdown ? (
                <div className="absolute left-1/2 top-12 w-[min(16.5rem,calc(100vw-1rem))] -translate-x-1/2 rounded-[1rem] border border-[rgba(54,65,57,0.12)] bg-[rgba(248,245,239,0.98)] p-2.5 shadow-[0_22px_56px_rgba(28,24,20,0.16)] backdrop-blur-md dark:border-white/12 dark:bg-[#161b22]/96 dark:text-[#f0f6fc] sm:top-14 sm:w-[min(21rem,calc(100vw-2rem))] sm:rounded-[1.2rem] sm:p-4">
                  <p className="section-label hidden sm:block">Αναζήτηση ΚΑΕΚ</p>
                  <div className="flex gap-2 sm:mt-2">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          runSearch();
                        }
                      }}
                      placeholder="ΚΑΕΚ"
                      className="h-9 flex-1 rounded-full border border-[rgba(54,65,57,0.12)] bg-white/90 px-3 text-sm text-ink outline-none transition focus:border-[rgba(67,89,78,0.4)] dark:border-white/12 dark:bg-[#0d1117] dark:text-[#f0f6fc] sm:h-11 sm:px-4"
                    />
                    <Button className="h-9 rounded-full bg-ink px-4 text-paper hover:bg-[rgba(35,44,40,0.94)] sm:h-11 sm:px-5" onClick={runSearch}>
                      Εύρεση
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              className="h-10 w-10 border-[rgba(54,65,57,0.12)] bg-white/85 p-0 text-ink shadow-[0_10px_28px_rgba(28,24,20,0.08)] dark:border-white/12 dark:bg-[#21262d] dark:text-[#f0f6fc] dark:hover:bg-[#30363d]"
              onClick={() => setShowStats((open) => !open)}
            >
              <Table2 className="h-4 w-4" />
              <span className="sr-only">Στοιχεία</span>
            </Button>
            <Button
              variant="outline"
              className="h-10 w-10 border-[rgba(54,65,57,0.12)] bg-white/85 p-0 text-ink shadow-[0_10px_28px_rgba(28,24,20,0.08)] dark:border-white/12 dark:bg-[#21262d] dark:text-[#f0f6fc] dark:hover:bg-[#30363d]"
              onClick={() => toggleTheme?.()}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="sr-only">Εναλλαγή θέματος</span>
            </Button>
            <Button
              variant="outline"
              className="h-10 w-10 border-[rgba(54,65,57,0.12)] bg-white/85 p-0 text-ink shadow-[0_10px_28px_rgba(28,24,20,0.08)] dark:border-white/12 dark:bg-[#21262d] dark:text-[#f0f6fc] dark:hover:bg-[#30363d]"
              onClick={() => setShowInfo((open) => !open)}
            >
              <Info className="h-4 w-4" />
              <span className="sr-only">Πληροφορίες</span>
            </Button>
            </div>
          </div>
        </div>

        {showInfo ? (
          <div className="absolute right-3 top-16 z-[1000] sm:right-4 sm:top-18">
            <div className="max-w-[17rem] rounded-[1rem] border border-[rgba(54,65,57,0.12)] bg-[rgba(248,245,239,0.94)] px-3 py-2.5 text-[12px] leading-5 text-ink shadow-[0_10px_28px_rgba(28,24,20,0.08)] backdrop-blur-sm dark:border-white/12 dark:bg-[#161b22]/95 dark:text-[#f0f6fc] sm:max-w-[19rem] sm:px-4 sm:text-[13px]">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <Info className="h-4 w-4" />
                <span>Πληροφορίες</span>
              </div>
              <p>OSM βασικός χάρτης με ArcGIS feature lookup, χωρίς βαρύ WMS overlay.</p>
              <p className="mt-1 text-[rgba(44,53,45,0.68)]">Πηγή δεδομένων: Ν.Π.Δ.Δ. ΕΛΛΗΝΙΚΟ ΚΤΗΜΑΤΟΛΟΓΙΟ</p>
            </div>
          </div>
        ) : null}

        {showStats ? (
          <div className="pointer-events-none absolute left-3 top-[5.2rem] z-[1000] sm:left-4 sm:top-[5.4rem]">
            <div className="rounded-[1rem] border border-[rgba(54,65,57,0.12)] bg-[rgba(248,245,239,0.94)] px-3 py-2.5 text-[12px] leading-5 text-ink shadow-[0_10px_28px_rgba(28,24,20,0.08)] backdrop-blur-sm dark:border-white/12 dark:bg-[#161b22]/95 dark:text-[#f0f6fc] sm:px-4 sm:text-[13px]">
              <p>Zoom: {mapZoom}</p>
              <p>
                X: {formatProjectedCoordinate(mapPointer?.x ?? null)}, Y:{" "}
                {formatProjectedCoordinate(mapPointer?.y ?? null)}
              </p>
              <p>
                Lat: {formatGeographicCoordinate(mapPointer?.lat ?? null)}, Lon:{" "}
                {formatGeographicCoordinate(mapPointer?.lng ?? null)}
              </p>
              <p className="mt-1 text-[11px] text-[rgba(44,53,45,0.62)]">
Αυτόματη φόρτωση γειτονικών γεωτεμαχίων στο viewport όταν υπάρχει αρκετό zoom.
              </p>
            </div>
          </div>
        ) : null}

        {showCenterSearch ? (
          <div className="pointer-events-none absolute inset-0 z-[900] flex items-center justify-center px-3">
            <div
              ref={centerSearchRef}
              className="pointer-events-auto w-full max-w-[11.5rem] rounded-[0.85rem] border border-[rgba(54,65,57,0.12)] bg-[rgba(248,245,239,0.94)] p-1.5 shadow-[0_14px_34px_rgba(28,24,20,0.12)] backdrop-blur-md dark:border-white/12 dark:bg-[#161b22]/96 dark:text-[#f0f6fc] sm:max-w-[16rem] sm:rounded-[0.95rem] sm:p-2"
            >
              <div className="flex items-center gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      runSearch();
                    }
                  }}
                  placeholder="ΚΑΕΚ"
                  className="h-8 flex-1 rounded-full border border-[rgba(54,65,57,0.12)] bg-white/92 px-3 text-[13px] text-ink outline-none transition focus:border-[rgba(67,89,78,0.4)] dark:border-white/12 dark:bg-[#0d1117] dark:text-[#f0f6fc] sm:h-9 sm:text-sm"
                />
                <Button
                  className="h-8 min-w-8 bg-ink px-2.5 text-paper hover:bg-[rgba(35,44,40,0.94)] dark:bg-[#21262d] dark:text-[#f0f6fc] dark:hover:bg-[#30363d] sm:h-9 sm:px-3"
                  onClick={runSearch}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1.5 hidden px-1 text-[11px] leading-5 text-[rgba(44,53,45,0.62)] dark:text-[#8b949e] sm:block">
                Δοκιμή: <strong>210161404125</strong>
              </p>
            </div>
          </div>
        ) : null}

        {activeParcel || searchState !== "idle" || isPickingParcel ? (
          <div className="absolute bottom-3 left-3 z-[1000] w-[min(19rem,calc(100vw-1.5rem))] sm:bottom-4 sm:left-4 sm:w-[min(24rem,calc(100vw-2rem))]">
            <div className="rounded-[1.15rem] border border-[rgba(54,65,57,0.12)] bg-[rgba(248,245,239,0.94)] p-3 shadow-[0_18px_48px_rgba(28,24,20,0.14)] backdrop-blur-md dark:border-white/12 dark:bg-[#161b22]/96 dark:text-[#f0f6fc] sm:rounded-[1.35rem] sm:p-4">
              {activeParcel ? (
                <>
                  <div className="flex items-start justify-between gap-3"><p className="section-label">Ενεργό γεωτεμάχιο</p><button type="button" className="rounded-md border border-[rgba(54,65,57,0.12)] px-2 py-1 text-xs text-[rgba(44,53,45,0.72)] hover:bg-white/70" onClick={() => setActiveParcel(null)}><X className="h-3.5 w-3.5" /></button></div>
                  <h2 className="mt-1 font-display text-2xl tracking-[-0.03em] text-ink sm:text-3xl">
                    {getParcelKaek(activeParcel)}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[rgba(44,53,45,0.72)]">
                    {activeParcel.subtitle}
                  </p>

                  {metrics ? (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        ["Εμβαδό", `${formatMetric(metrics.areaSquareMeters)} m²`],
                        ["Περίμετρος", `${formatMetric(metrics.perimeterMeters)} m`],
                        ["Πλάτος", `${formatMetric(metrics.widthMeters)} m`],
                        ["Ύψος", `${formatMetric(metrics.heightMeters)} m`],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-[1rem] border border-[rgba(54,65,57,0.08)] bg-white/72 px-3 py-2"
                        >
                          <p className="text-[11px] uppercase tracking-[0.16em] text-[rgba(44,53,45,0.5)]">
                            {label}
                          </p>
                          <p className="mt-1 text-sm font-medium text-ink">{value}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <Button
                      className="justify-between bg-ink px-4 text-paper hover:bg-[rgba(35,44,40,0.94)]"
                      onClick={() => handleExport("dxf")}
                    >
                      <span className="flex items-center gap-2">
                        <FileCode2 className="h-4 w-4" /> DXF
                      </span>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-between border-[rgba(54,65,57,0.12)] bg-white/80 px-4 text-ink"
                      onClick={() => handleExport("geojson")}
                    >
                      <span className="flex items-center gap-2">
                        <FileJson className="h-4 w-4" /> GeoJSON
                      </span>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-between border-[rgba(54,65,57,0.12)] bg-white/80 px-4 text-ink"
                      onClick={() => handleExport("kml")}
                    >
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4" /> KML
                      </span>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-4 rounded-[1rem] border border-[rgba(54,65,57,0.08)] bg-white/68 px-4 py-3 text-sm leading-6 text-[rgba(44,53,45,0.72)]">
                    {searchMessage}
                  </div>
                </>
              ) : (
                <div className="rounded-[1rem] border border-[rgba(140,79,58,0.16)] bg-[rgba(154,88,64,0.08)] px-4 py-3 text-sm leading-6 text-[rgba(118,58,40,0.92)]">
                  {searchMessage}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

