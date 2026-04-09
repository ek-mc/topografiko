import { Search, Download, Copy, Check, House, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import proj4 from "proj4";
import NorthArrow from "@/components/NorthArrow";
import ThemeToggle from "@/components/ThemeToggle";
import { useTheme } from "@/contexts/ThemeContext";
import otaOfficeMap from "@shared/ota-office-map.json";
import mainUseMap from "@shared/main-use-map.json";

type Point = { x: number; y: number };
type ParcelData = {
  kaek: string;
  otaCode: string;
  area: number | null;
  perimeter: number | null;
  mainUse: string;
  description: string;
  link: string;
  rings: Point[][];
  percentage: number | null;
  propVert: number | null;
  propHor: number | null;
  hasUndividedOwnership: boolean;
  raw: Record<string, unknown>;
};

type TEEData = {
  otNumber: string;
  fek: string;
  apofEidos: string;
  municipality: string;
  rings: Point[][];
};

type OTContextPolygon = {
  rings: Point[][];
};

type NeighborParcel = {
  kaek: string;
  mainUse: string;
  area: number | null;
  percentage: number | null;
  propVert: number | null;
  propHor: number | null;
  hasUndividedOwnership: boolean;
  rings: Point[][];
};

function transformFromGGRS87(x: number, y: number): [number, number] {
  const wgs84 = "EPSG:4326";
  const ggrs87 = "+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs";
  try {
    const result = proj4(ggrs87, wgs84, [x, y]);
    return [result[0], result[1]];
  } catch {
    return [x, y];
  }
}

type RowInfo = {
  label: string;
  value: string;
  source: "Κτηματολόγιο" | "TEE" | "Local JSON" | "Σύνθεση";
  sourceDetail?: string;
  primary?: boolean;
};

function formatNumber(value: number | null, digits = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("el-GR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a: Point, b: Point) {
  const R = 6371000;
  const lat1 = toRadians(a.y);
  const lat2 = toRadians(b.y);
  const dLat = toRadians(b.y - a.y);
  const dLon = toRadians(b.x - a.x);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * R * Math.asin(Math.sqrt(h));
}

function greekLabel(index: number) {
  const letters = ["Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ", "Μ", "Ν", "Ξ", "Ο", "Π", "Ρ", "Σ", "Τ", "Υ", "Φ", "Χ", "Ψ", "Ω"];
  return letters[index] || `P${index + 1}`;
}

function stripClosingPoint(points: Point[]) {
  if (points.length < 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  const isClosed = first.x === last.x && first.y === last.y;
  return isClosed ? points.slice(0, -1) : [...points];
}

function normalizeRing(points: Point[]) {
  const usable = stripClosingPoint(points);
  if (!usable.length) return [];

  let startIndex = 0;
  for (let i = 1; i < usable.length; i++) {
    const current = usable[i];
    const best = usable[startIndex];
    if (current.y > best.y || (current.y === best.y && current.x > best.x)) {
      startIndex = i;
    }
  }

  const rotated = [...usable.slice(startIndex), ...usable.slice(0, startIndex)];
  return rotated;
}

function edgeLengths(points: Point[]) {
  const usable = normalizeRing(points);
  const result: { label: string; length: number }[] = [];

  for (let i = 0; i < usable.length; i++) {
    const a = usable[i];
    const b = usable[(i + 1) % usable.length];
    result.push({
      label: `${greekLabel(i)}${greekLabel((i + 1) % usable.length)}`,
      length: distanceMeters(a, b),
    });
  }

  return result;
}

function boundsFromRing(points: Point[]) {
  const usable = stripClosingPoint(points)
  const xs = usable.map((p) => p.x);
  const ys = usable.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function createSvgProjector(points: Point[]) {
  const b = boundsFromRing(points);
  const width = Math.max(1e-9, b.maxX - b.minX);
  const height = Math.max(1e-9, b.maxY - b.minY);
  const pad = 28;
  const size = 320;
  const scale = Math.min((size - pad * 2) / width, (size - pad * 2) / height);
  const offsetX = (size - width * scale) / 2;
  const offsetY = (size - height * scale) / 2;

  return (point: Point) => ({
    x: offsetX + (point.x - b.minX) * scale,
    y: size - (offsetY + (point.y - b.minY) * scale),
  });
}

function shapePath(points: Point[]) {
  const usable = normalizeRing(points);
  if (!usable.length) return "";
  const project = createSvgProjector(usable);

  return usable
    .map((point, index) => {
      const p = project(point);
      return `${index === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ") + " Z";
}



function projectPoint(point: Point, bounds: { minX: number; maxX: number; minY: number; maxY: number }, size = 320, pad = 22) {
  const width = Math.max(1e-9, bounds.maxX - bounds.minX);
  const height = Math.max(1e-9, bounds.maxY - bounds.minY);
  const scale = Math.min((size - pad * 2) / width, (size - pad * 2) / height);
  const offsetX = (size - width * scale) / 2;
  const offsetY = (size - height * scale) / 2;
  return {
    x: offsetX + (point.x - bounds.minX) * scale,
    y: size - (offsetY + (point.y - bounds.minY) * scale),
  };
}

function pathFromRingWithBounds(points: Point[], bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
  const usable = stripClosingPoint(points);
  if (!usable.length) return "";
  return usable.map((point, index) => {
    const p = projectPoint(point, bounds);
    return `${index === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }).join(" ") + " Z";
}

function centroid(points: Point[]) {
  const usable = stripClosingPoint(points);
  if (!usable.length) return { x: 0, y: 0 };
  const sum = usable.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / usable.length, y: sum.y / usable.length };
}

function ownershipLabel(propHor: number | null, propVert: number | null) {
  if ((propHor ?? 0) > 0) return "Οριζόντια συνιδιοκτησία";
  if ((propVert ?? 0) > 0) return "Εξ αδιαιρέτου συνιδιοκτησία";
  return "Ακέραια ιδιοκτησία";
}

async function fetchParcelByKaek(kaek: string): Promise<ParcelData | null> {
  const normalized = kaek.replace(/\s+/g, "").trim();
  const params = new URLSearchParams({
    f: "json",
    where: `KAEK='${normalized}'`,
    returnGeometry: "true",
    outFields: "*",
    outSR: "4326",
    resultRecordCount: "1",
  });

  const url = `https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ArcGIS query failed with status ${response.status}`);
  const data = await response.json();
  const feature = data?.features?.[0];
  if (!feature?.geometry?.rings?.length) return null;

  const kaekValue = feature.attributes?.KAEK || normalized;
  const percentage = feature.attributes?.PERCENTAGE ?? null;
  const propVert = feature.attributes?.PROP_VERT ?? null;
  const propHor = feature.attributes?.PROP_HOR ?? null;

  return {
    kaek: kaekValue,
    otaCode: String(kaekValue).slice(0, 5),
    area: feature.attributes?.AREA ?? null,
    perimeter: feature.attributes?.PERIMETER ?? null,
    mainUse: feature.attributes?.MAIN_USE || "",
    description: feature.attributes?.DESCR || "",
    link: feature.attributes?.LINK || "",
    rings: feature.geometry.rings.map((ring: number[][]) =>
      ring.map((point: number[]) => ({ x: point[0], y: point[1] })),
    ),
    percentage,
    propVert,
    propHor,
    hasUndividedOwnership: Boolean((propVert ?? 0) > 0 || (propHor ?? 0) > 0),
    raw: feature.attributes || {},
  };
}

// TEE coordinate transformation: WGS84 (4326) to GGRS87 (2100)
function transformToGGRS87(lon: number, lat: number): [number, number] {
  // Define projections
  const wgs84 = 'EPSG:4326';
  const ggrs87 = '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs';
  
  try {
    const result = proj4(wgs84, ggrs87, [lon, lat]);
    return [result[0], result[1]];
  } catch {
    // Fallback: approximate transformation
    return [lon * 111000 + 500000, lat * 111000];
  }
}

async function fetchTEEData(rings: Point[][]): Promise<TEEData | null> {
  if (!rings?.[0]?.length) return null;
  
  // Get bounds from polygon
  const points = rings[0];
  const lons = points.map((p) => p.x);
  const lats = points.map((p) => p.y);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  
  // Transform to GGRS87
  const [xmin, ymin] = transformToGGRS87(minLon, minLat);
  const [xmax, ymax] = transformToGGRS87(maxLon, maxLat);
  
  const geometry = JSON.stringify({
    xmin, ymin, xmax, ymax,
    spatialReference: { wkid: 2100 }
  });
  
  const params = new URLSearchParams({
    f: 'json',
    returnGeometry: 'true',
    spatialRel: 'esriSpatialRelIntersects',
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '2100',
    outFields: 'OBJECTID,FEK,FEK_FILE_URL,PUBL_DATE,OT_NUM,APOF_EIDOS,TITLE,NUMBER_,SIGN_DATE,GEOREF_DIAGRAM_URL,INITIAL_DIAGRAM_URL,KALL_DHM_NAME,KEY_FLAG',
    outSR: '2100',
    layer: JSON.stringify({ source: { type: 'mapLayer', mapLayerId: 6 } }),
  });
  
  const url = `https://sdigmap.tee.gov.gr/mapping/rest/services/UDM/UDM_SERVICE_POLEODOMIKI_PLIROFORIA/MapServer/dynamicLayer/query?${params.toString()}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const feature = data?.features?.[0];
    if (!feature) return null;
    
    const attrs = feature.attributes;
    return {
      otNumber: attrs.OT_NUM || '',
      fek: attrs.FEK || '',
      apofEidos: attrs.APOF_EIDOS || '',
      municipality: attrs.KALL_DHM_NAME || '',
      rings: (feature.geometry?.rings || []).map((ring: number[][]) => ring.map((point: number[]) => { const [lon, lat] = transformFromGGRS87(point[0], point[1]); return { x: lon, y: lat }; })),
    };
  } catch {
    return null;
  }
}





async function fetchNearbyOTPolygons(rings: Point[][], currentOt: string): Promise<OTContextPolygon[]> {
  if (!rings?.[0]?.length) return [];
  const points = rings[0];
  const lons = points.map((p) => p.x);
  const lats = points.map((p) => p.y);
  const minLon = Math.min(...lons) - 0.0015;
  const maxLon = Math.max(...lons) + 0.0015;
  const minLat = Math.min(...lats) - 0.0015;
  const maxLat = Math.max(...lats) + 0.0015;
  const [xmin, ymin] = transformToGGRS87(minLon, minLat);
  const [xmax, ymax] = transformToGGRS87(maxLon, maxLat);
  const geometry = JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 2100 } });
  const params = new URLSearchParams({
    f: 'json',
    returnGeometry: 'true',
    spatialRel: 'esriSpatialRelIntersects',
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '2100',
    outFields: 'OT_NUM',
    outSR: '2100',
    layer: JSON.stringify({ source: { type: 'mapLayer', mapLayerId: 6 } }),
  });
  const url = `https://sdigmap.tee.gov.gr/mapping/rest/services/UDM/UDM_SERVICE_POLEODOMIKI_PLIROFORIA/MapServer/dynamicLayer/query?${params.toString()}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    const features = data?.features || [];
    return features
      .filter((feature: { attributes?: { OT_NUM?: string } }) => feature.attributes?.OT_NUM && feature.attributes.OT_NUM !== currentOt)
      .slice(0, 12)
      .map((feature: { geometry?: { rings?: number[][][] } }) => ({
        rings: (feature.geometry?.rings || []).map((ring: number[][]) => ring.map((point: number[]) => {
          const [lon, lat] = transformFromGGRS87(point[0], point[1]);
          return { x: lon, y: lat };
        })),
      }));
  } catch {
    return [];
  }
}

async function fetchParcelsInOT(otRings: Point[][], currentKaek?: string): Promise<NeighborParcel[]> {
  if (!otRings?.[0]?.length) return [];
  const geometry = JSON.stringify({
    rings: otRings.map((ring) => ring.map((p) => [p.x, p.y])),
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    f: 'json',
    geometry,
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'KAEK,MAIN_USE,AREA,PERCENTAGE,PROP_VERT,PROP_HOR',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '200',
    where: '1=1',
  });
  const url = `https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query?${params.toString()}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    const features = data?.features || [];
    return features.map((f: { attributes: { KAEK: string; MAIN_USE: string; AREA: number; PERCENTAGE?: number; PROP_VERT?: number; PROP_HOR?: number }; geometry?: { rings?: number[][][] } }): NeighborParcel => {
      const percentage = f.attributes.PERCENTAGE ?? null;
      const propVert = f.attributes.PROP_VERT ?? null;
      const propHor = f.attributes.PROP_HOR ?? null;
      return {
        kaek: f.attributes.KAEK,
        mainUse: f.attributes.MAIN_USE || '',
        area: f.attributes.AREA,
        percentage,
        propVert,
        propHor,
        hasUndividedOwnership: Boolean((propVert ?? 0) > 0 || (propHor ?? 0) > 0),
        rings: (f.geometry?.rings || []).map((ring) => ring.map((point) => ({ x: point[0], y: point[1] }))),
      };
    }).filter((item: NeighborParcel) => item.kaek !== currentKaek);
  } catch {
    return [];
  }
}

async function fetchNeighbors(rings: Point[][], currentKaek: string): Promise<NeighborParcel[]> {
  if (!rings?.[0]?.length) return [];
  
  // Create a buffer around the parcel polygon for neighboring search
  const points = rings[0];
  const lons = points.map((p) => p.x);
  const lats = points.map((p) => p.y);
  const minLon = Math.min(...lons) - 0.0001; // ~10m buffer
  const maxLon = Math.max(...lons) + 0.0001;
  const minLat = Math.min(...lats) - 0.0001;
  const maxLat = Math.max(...lats) + 0.0001;
  
  const geometry = JSON.stringify({
    rings: [[
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat]
    ]],
    spatialReference: { wkid: 4326 }
  });
  
  const params = new URLSearchParams({
    f: 'json',
    geometry,
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'KAEK,MAIN_USE,AREA,PERCENTAGE,PROP_VERT,PROP_HOR',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '20',
    where: `KAEK<>'${currentKaek}'`,
  });
  
  const url = `https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query?${params.toString()}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    const features = data?.features || [];
    
    return features.map((f: { attributes: { KAEK: string; MAIN_USE: string; AREA: number; PERCENTAGE?: number; PROP_VERT?: number; PROP_HOR?: number }; geometry?: { rings?: number[][][] } }) => {
      const percentage = f.attributes.PERCENTAGE ?? null;
      const propVert = f.attributes.PROP_VERT ?? null;
      const propHor = f.attributes.PROP_HOR ?? null;
      return {
        kaek: f.attributes.KAEK,
        mainUse: f.attributes.MAIN_USE || '',
        area: f.attributes.AREA,
        percentage,
        propVert,
        propHor,
        hasUndividedOwnership: Boolean((propVert ?? 0) > 0 || (propHor ?? 0) > 0),
        rings: (f.geometry?.rings || []).map((ring) => ring.map((point) => ({ x: point[0], y: point[1] }))),
      };
    }).slice(0, 10);
  } catch {
    return [];
  }
}

interface HomeProps {
  initialKaek?: string;
}

export default function Home({ initialKaek }: HomeProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialKaek || "");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [parcel, setParcel] = useState<ParcelData | null>(null);
  const [teeData, setTeeData] = useState<TEEData | null>(null);
  const [teeCandidates, setTeeCandidates] = useState<TEEData[]>([]);
  const [neighbors, setNeighbors] = useState<NeighborParcel[]>([]);
  const [otContext, setOtContext] = useState<OTContextPolygon[]>([]);
  const [copiedKey, setCopiedKey] = useState("");
  const [openInfoKey, setOpenInfoKey] = useState("");
  const [showMoreRows, setShowMoreRows] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const primaryRing = useMemo(() => normalizeRing(parcel?.rings?.[0] ?? []), [parcel]);
  const path = useMemo(() => (primaryRing.length ? shapePath(primaryRing) : ""), [primaryRing]);
  const lengths = useMemo(() => (primaryRing.length ? edgeLengths(primaryRing) : []), [primaryRing]);
  const blockBounds = useMemo(() => {
    const allPoints = [
      ...(teeData?.rings?.flatMap((ring) => stripClosingPoint(ring)) ?? []),
      ...neighbors.flatMap((neighbor) => neighbor.rings.flatMap((ring) => stripClosingPoint(ring))),
      ...primaryRing,
    ];
    if (!allPoints.length) return null;
    const xs = allPoints.map((p) => p.x);
    const ys = allPoints.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [neighbors, primaryRing, teeData]);

  useEffect(() => {
    if (initialKaek) {
      setQuery(initialKaek);
    }
  }, [initialKaek]);

  // Auto-search when initialKaek is provided via URL
  useEffect(() => {
    if (initialKaek && query === initialKaek && !loading && parcel?.kaek !== initialKaek) {
      handleSubmit();
    }
  }, [initialKaek, query, loading, parcel?.kaek]);

  const visibleRows = useMemo(() => {
    if (!parcel) return [] as RowInfo[];
    const attrs = parcel.raw;
    const otaInfo = (otaOfficeMap as Record<string, { otaCode: string; nomos: string; ota: string; cadastralOffice: string; raw: string }>)[parcel.otaCode];
    const mainUseInfo = (mainUseMap as Record<string, { code: string; category: string; subcategory: string }>)[parcel.mainUse];
    const hasCategory = !!mainUseInfo?.category;
    
    const rows: RowInfo[] = [
      { label: "KAEK", value: parcel.kaek, source: "Κτηματολόγιο", sourceDetail: "Επίσημο layer γεωτεμαχίων Κτηματολογίου", primary: true },
      { label: "Καλλικρατικός Δήμος", value: teeData?.municipality || otaInfo?.ota || "—", source: teeData?.municipality ? "TEE" : "Local JSON", sourceDetail: teeData?.municipality ? "Πολεοδομική πληροφορία TEE / SDI" : "Τοπικό mapping από PDF ΟΤΑ/Κτηματολογικών Γραφείων", primary: true },
      { label: "Κωδικός ΟΤΑ", value: parcel.otaCode || "—", source: "Σύνθεση", sourceDetail: "Εξαγωγή από KAEK + local enrichment" },
      { label: "ΟΤΑ", value: otaInfo?.ota || "—", source: "Local JSON", sourceDetail: "Τοπικό mapping από PDF ΟΤΑ/Κτηματολογικών Γραφείων" },
      { label: "Κτηματολογικό Γραφείο", value: otaInfo?.cadastralOffice || "—", source: "Local JSON", sourceDetail: "Τοπικό mapping από PDF ΟΤΑ/Κτηματολογικών Γραφείων" },
      { label: "Εμβαδό", value: parcel.area != null ? `${formatNumber(parcel.area, 2)} m²` : "—", source: "Κτηματολόγιο", sourceDetail: "AREA από ArcGIS service", primary: true },
      { label: "Περίμετρος", value: parcel.perimeter != null ? `${formatNumber(parcel.perimeter, 2)} m` : "—", source: "Κτηματολόγιο", sourceDetail: "PERIMETER από ArcGIS service", primary: true },
    ];
    
    if (hasCategory) {
      rows.push(
        { label: "Κωδικός Κύριας Χρήσης", value: parcel.mainUse || "—", source: "Κτηματολόγιο", sourceDetail: "MAIN_USE code από Κτηματολόγιο" },
        { label: "Κατηγορία Χρήσης", value: mainUseInfo?.category || "—", source: "Κτηματολόγιο", sourceDetail: "Ενημέρωση: 2019/01" },
        { label: "Υποκατηγορία Χρήσης", value: mainUseInfo?.subcategory || "—", source: "Κτηματολόγιο", sourceDetail: "Ενημέρωση: 2019/01" },
      );
    } else {
      rows.push({ label: "Περιγραφή", value: parcel.description || "—", source: "Κτηματολόγιο", sourceDetail: "DESCR από ArcGIS service" });
    }
    
    // TEE data (Ο.Τ.)
    if (teeData) {
      rows.push(
        { label: "Οικοδομικό Τετράγωνο (Ο.Τ.)", value: teeData.otNumber || "—", source: "TEE", sourceDetail: "Πολεοδομική πληροφορία TEE / SDI", primary: true },
        { label: "ΦΕΚ", value: teeData.fek || "—", source: "TEE", sourceDetail: "Πολεοδομική πληροφορία TEE / SDI" },
        { label: "Τύπος Έγκρισης", value: teeData.apofEidos || "—", source: "TEE", sourceDetail: "Πολεοδομική πληροφορία TEE / SDI" },
              );
    }
    
    rows.push(
      { label: "ΟΤΑ / link", value: parcel.link || "—", source: "Κτηματολόγιο", sourceDetail: "LINK από ArcGIS service" },
      { label: "Καθεστώς", value: ownershipLabel(parcel.propHor, parcel.propVert), source: "Κτηματολόγιο", sourceDetail: "Σύνθεση από PROP_VERT/PROP_HOR" },
      { label: "Αριθμός Καθέτων", value: attrs.PROP_VERT != null ? String(attrs.PROP_VERT) : "—", source: "Κτηματολόγιο", sourceDetail: "PROP_VERT από ArcGIS service" },
      { label: "Αριθμός Οριζοντίων", value: attrs.PROP_HOR != null ? String(attrs.PROP_HOR) : "—", source: "Κτηματολόγιο", sourceDetail: "PROP_HOR από ArcGIS service" },
      { label: "Ποσοστό Κύριας Χρήσης", value: attrs.PERCENTAGE != null ? `${attrs.PERCENTAGE}%` : "—", source: "Κτηματολόγιο", sourceDetail: "PERCENTAGE από ArcGIS service" },
    );
    
    return rows;
  }, [parcel, teeData]);



  const displayedRows = useMemo(() => (showMoreRows ? visibleRows : visibleRows.filter((row) => row.primary)), [visibleRows, showMoreRows]);

  const copyValue = async (key: string, value: string) => {
    if (!value || value === "—") return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? "" : current)), 1200);
    } catch {
      setMessage("Copy failed.");
    }
  };

  const handleSubmit = async () => {
    const value = query.trim();
    if (!value) {
      setMessage("Enter a KAEK first.");
      return;
    }

    setLoading(true);
    setMessage("Searching…");
    setParcel(null);
    setTeeData(null);
    setTeeCandidates([]);
    setNeighbors([]);

    try {
      const result = await fetchParcelByKaek(value);
      if (!result) {
        setMessage("No parcel found for this KAEK.");
        return;
      }
      setParcel(result);
      setMessage("");
      navigate(`/o/${result.kaek}`, { replace: true });
      
      // Fetch TEE OT candidates
      const { fetchTEECandidates } = await import("@/lib/topografiko");
      const candidates = await fetchTEECandidates(result.rings);
      setTeeCandidates(candidates);
      const tee = candidates[0] || null;
      setTeeData(tee);
      const nearbyOTs = tee?.rings?.length && tee?.otNumber ? await fetchNearbyOTPolygons(tee.rings, tee.otNumber) : [];
      setOtContext(nearbyOTs);
      
      const parcelList = tee?.rings?.length
        ? await fetchParcelsInOT(tee.rings, result.kaek)
        : await fetchNeighbors(result.rings, result.kaek);
      const filteredParcels = parcelList.filter((item) => {
        const mainUseInfo = (mainUseMap as Record<string, { code: string; category: string; subcategory: string }>)[item.mainUse];
        const category = mainUseInfo?.category || "";
        const subcategory = mainUseInfo?.subcategory || "";
        const isRoad = category.includes("ΟΔΙΚΟ") || subcategory.includes("ΟΔΙΚΟ") || item.mainUse === "5100";
        const isHuge = (item.area ?? 0) > 5000;
        return !isRoad && !isHuge;
      });
      setNeighbors(filteredParcels);
    } catch (error) {
      setMessage("Lookup failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground transition-colors">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setMessage("");
                setParcel(null);
                setTeeData(null);
                setNeighbors([]);
                navigate(`/`);
              }}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label="Home"
              title="Αρχική"
            >
              <House className="h-5 w-5" />
            </button>

            <div className="flex flex-1 items-center gap-2 rounded-2xl border border-border bg-card px-3 py-3 shadow-sm transition-colors">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSubmit();
              }}
              placeholder="Enter KAEK"
              className="flex-1 bg-transparent px-1 text-lg text-foreground outline-none placeholder:text-muted-foreground"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />

              <button
              type="button"
              onClick={handleSubmit}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-white transition-transform active:scale-[0.98] dark:bg-primary dark:text-primary-foreground"
              aria-label="Search"
              title="Search"
            >

              <Search className="h-5 w-5" />
            </button>
            </div>

            <ThemeToggle compact />
          </div>

          {message ? <p className="mt-3 px-1 text-sm text-muted-foreground">{message}</p> : null}
          {loading ? <p className="mt-2 px-1 text-sm text-muted-foreground/80">Loading parcel data…</p> : null}
{parcel && !teeData && !loading ? <p className="mt-2 px-1 text-sm text-muted-foreground/80">Loading TEE data…</p> : null}
        </div>

        {parcel ? (
          <div className="mt-10 space-y-8">
            <section className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Οικόπεδο</h2>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onClick={() => navigate(`/o/${parcel.kaek}/export`)}
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
              </div>

              <svg viewBox="0 0 320 320" className={`w-full ${teeCandidates.length > 1 ? "max-h-[720px]" : "max-h-[520px]"}`}>
                <rect x="0" y="0" width="320" height="320" fill={isDark ? "#0f172a" : "#f8fafc"} />
                <NorthArrow isDark={isDark} />
                <path d={path} fill={isDark ? "rgba(96,165,250,0.12)" : "rgba(59,130,246,0.06)"} stroke={isDark ? "#93c5fd" : "#60a5fa"} strokeWidth="2.2" />
                {primaryRing.map((point, index) => {
                  const project = createSvgProjector(primaryRing);
                  const p = project(point);
                  const dx = index % 2 === 0 ? 8 : -18;
                  const dy = index % 2 === 0 ? -8 : 16;
                  return (
                    <g key={index}>
                      <circle cx={p.x} cy={p.y} r="3.6" fill={isDark ? "#e2e8f0" : "#111827"} />
                      <text x={p.x + dx + 5} y={p.y + dy - 2} fontSize="11" textAnchor="middle" fill={isDark ? "#cbd5e1" : "#334155"}>{greekLabel(index)}</text>
                    </g>
                  );
                })}
              </svg>
            </section>

            <section className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Parcel data</h2>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {displayedRows.map((row) => {
                      const { label, value, source, sourceDetail } = row;
                      const copyKey = `row-${label}`;
                      return (
                        <tr key={label} className="border-b border-border last:border-b-0">
                          <th className="w-52 bg-muted/50 px-4 py-3 text-left font-medium text-muted-foreground">{label}</th>
                          <td className="px-4 py-3 text-foreground">
                            <div className="flex items-center justify-between gap-3">
                              <span>{value}</span>
                              <div className="relative flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setOpenInfoKey((current) => (current === copyKey ? "" : copyKey))}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                  title={`Info for ${label}`}
                                  aria-label={`Info for ${label}`}
                                >
                                  <Info className="h-4 w-4" />
                                </button>
                                {openInfoKey === copyKey ? (
                                  <div className="absolute right-20 top-10 z-10 w-56 rounded-xl border border-border bg-popover p-3 text-xs text-muted-foreground shadow-lg">
                                    <div className="font-semibold text-foreground">Πηγή: {source}</div>
                                    <div className="mt-1">{sourceDetail || source}</div>
                                  </div>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => copyValue(copyKey, value)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                  title={`Copy ${label}`}
                                  aria-label={`Copy ${label}`}
                                >
                                  {copiedKey === copyKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {visibleRows.some((row) => !row.primary) ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowMoreRows((current) => !current)}
                    className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {showMoreRows ? "− λιγότερα" : "+ περισσότερα"}
                  </button>
                </div>
              ) : null}

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">Vertices</h3>
                  <div className="max-h-72 overflow-auto rounded-xl border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-muted/50 text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">#</th>
                          <th className="px-3 py-2 text-left font-medium">Lon</th>
                          <th className="px-3 py-2 text-left font-medium">Lat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {primaryRing.map((point, index) => (
                          <tr key={index} className="border-t border-border">
                            <td className="px-3 py-2">{greekLabel(index)}</td>
                            <td className="px-3 py-2">{point.x.toFixed(6)}</td>
                            <td className="px-3 py-2">{point.y.toFixed(6)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">Edge lengths</h3>
                  <div className="max-h-72 overflow-auto rounded-xl border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-muted/50 text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">Πλευρά</th>
                          <th className="px-3 py-2 text-left font-medium">Length</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lengths.map((edge) => (
                          <tr key={edge.label} className="border-t border-border">
                            <td className="px-3 py-2">{edge.label}</td>
                            <td className="px-3 py-2">{formatNumber(edge.length, 2)} m</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Shareable URL */}
              <div className="mt-6 rounded-xl border border-border bg-muted/40 p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Shareable Link</h3>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground">
                    {`${window.location.origin}/topografiko/o/${parcel.kaek}`}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyValue('share-link', `${window.location.origin}/topografiko/o/${parcel.kaek}`)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    title="Copy link"
                  >
                    {copiedKey === 'share-link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* OT Map */}
              {(neighbors.length > 0 || teeCandidates.length > 1) && blockBounds ? (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">Χάρτης Ο.Τ.</h3>
                                    <svg viewBox="0 0 320 320" className="w-full max-h-[520px] rounded-xl border border-border bg-muted/40 shadow-inner">
                    <rect x="0" y="0" width="320" height="320" fill={isDark ? "#0f172a" : "#f8fafc"} />
                    <NorthArrow isDark={isDark} />
                    {(teeData?.rings ?? []).map((ring, index) => {
                      const otPath = pathFromRingWithBounds(ring, blockBounds);
                      return (
                        <path
                          key={`ot-${index}`}
                          d={otPath}
                          fill={isDark ? "rgba(96,165,250,0.10)" : "rgba(59,130,246,0.04)"}
                          stroke={isDark ? "#93c5fd" : "#60a5fa"}
                          strokeWidth="1.5"
                          strokeDasharray="4 4"
                        />
                      );
                    })}
                    {neighbors.map((neighbor) => {
                      const neighborPath = pathFromRingWithBounds(neighbor.rings[0], blockBounds);
                      const labelPoint = projectPoint(centroid(neighbor.rings[0]), blockBounds);
                      return (
                        <g key={neighbor.kaek}>
                          <path
                            d={neighborPath}
                            fill={neighbor.hasUndividedOwnership
                              ? (isDark ? "rgba(37,99,235,0.16)" : "rgba(37,99,235,0.10)")
                              : (isDark ? "rgba(148,163,184,0.14)" : "rgba(148,163,184,0.10)")}
                            stroke={neighbor.hasUndividedOwnership
                              ? (isDark ? "#60a5fa" : "#1d4ed8")
                              : (isDark ? "#cbd5e1" : "#94a3b8")}
                            strokeWidth={neighbor.hasUndividedOwnership ? "1.6" : "1.1"}
                            className="cursor-pointer"
                            onClick={() => {
                              setQuery(neighbor.kaek);
                              navigate(`/o/${neighbor.kaek}`);
                              setTimeout(() => {
                                const button = document.querySelector('button[aria-label="Search"]') as HTMLButtonElement | null;
                                button?.click();
                              }, 10);
                            }}
                          />
                          <text
                            x={labelPoint.x}
                            y={labelPoint.y + 4}
                            fontSize="7.5"
                            textAnchor="middle"
                            fill={isDark ? "#e2e8f0" : "#475569"}
                            className="cursor-pointer"
                            onClick={() => {
                              setQuery(neighbor.kaek);
                              navigate(`/o/${neighbor.kaek}`);
                              setTimeout(() => {
                                const button = document.querySelector('button[aria-label="Search"]') as HTMLButtonElement | null;
                                button?.click();
                              }, 10);
                            }}
                          >
                            {neighbor.kaek}
                          </text>
                        </g>
                      );
                    })}
                    <path
                      d={pathFromRingWithBounds(primaryRing, blockBounds)}
                      fill={parcel.hasUndividedOwnership
                        ? (isDark ? "rgba(37,99,235,0.22)" : "rgba(37,99,235,0.12)")
                        : (isDark ? "rgba(96,165,250,0.16)" : "rgba(59,130,246,0.08)")}
                      stroke={parcel.hasUndividedOwnership
                        ? (isDark ? "#93c5fd" : "#1d4ed8")
                        : (isDark ? "#93c5fd" : "#60a5fa")}
                      strokeWidth={parcel.hasUndividedOwnership ? "2.6" : "2.2"}
                      className="cursor-pointer"
                      onClick={() => {
                        setQuery(parcel.kaek);
                        navigate(`/o/${parcel.kaek}`);
                      }}
                    />
                    {(() => {
                      const c = projectPoint(centroid(primaryRing), blockBounds);
                      return (
                        <text
                          x={c.x}
                          y={c.y + 4}
                          fontSize="7.5"
                          textAnchor="middle"
                          fill={isDark ? "#bfdbfe" : "#1e3a8a"}
                          className="cursor-pointer"
                          onClick={() => {
                            setQuery(parcel.kaek);
                            navigate(`/o/${parcel.kaek}`);
                          }}
                        >
                          {parcel.kaek}
                        </text>
                      );
                    })()}
                  </svg>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Έντονο μπλε περίγραμμα = ένδειξη συνιδιοκτησίας από query (PROP_VERT/PROP_HOR).
                  </p>
                </div>
              ) : null}

              {/* Neighboring Parcels */}
              {neighbors.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">Οικόπεδα μέσα στο Ο.Τ.</h3>
                  <div className="rounded-xl border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-muted/50 text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">KAEK</th>
                          <th className="px-3 py-2 text-left font-medium">Χρήση</th>
                          <th className="px-3 py-2 text-left font-medium">Εμβαδόν</th>
                          <th className="px-3 py-2 text-left font-medium">Καθεστώς</th>
                        </tr>
                      </thead>
                      <tbody>
                        {neighbors.map((neighbor, index) => (
                          <tr key={neighbor.kaek} className="border-t border-border">
                            <td className="px-3 py-2">
                              <a
                                href={`/topografiko/o/${neighbor.kaek}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  setQuery(neighbor.kaek);
                                  navigate(`/o/${neighbor.kaek}`);
                                  setTimeout(() => {
                                    const button = document.querySelector('button[aria-label="Search"]') as HTMLButtonElement | null;
                                    button?.click();
                                  }, 10);
                                }}
                                className="text-blue-600 hover:underline dark:text-blue-300"
                              >
                                {neighbor.kaek}
                              </a>
                            </td>
                            <td className="px-3 py-2">{((mainUseMap as Record<string, { code: string; category: string; subcategory: string }>)[neighbor.mainUse]?.subcategory || (mainUseMap as Record<string, { code: string; category: string; subcategory: string }>)[neighbor.mainUse]?.category || neighbor.mainUse || "—")}</td>
                            <td className="px-3 py-2">{neighbor.area != null ? `${formatNumber(neighbor.area, 0)} m²` : "—"}</td>
                            <td className="px-3 py-2">{ownershipLabel(neighbor.propHor, neighbor.propVert)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
