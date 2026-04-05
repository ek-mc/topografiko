import { Search, Download, Copy, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import proj4 from "proj4";
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
  raw: Record<string, unknown>;
};

type TEEData = {
  otNumber: string;
  fek: string;
  apofEidos: string;
  municipality: string;
};

type NeighborParcel = {
  kaek: string;
  mainUse: string;
  area: number | null;
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
    returnGeometry: 'false',
    spatialRel: 'esriSpatialRelIntersects',
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '2100',
    outFields: 'OBJECTID,FEK,OT_NUM,APOF_EIDOS,KALL_DHM_NAME',
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
    };
  } catch {
    return null;
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
    outFields: 'KAEK,MAIN_USE,AREA',
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
    
    return features.map((f: { attributes: { KAEK: string; MAIN_USE: string; AREA: number } }) => ({
      kaek: f.attributes.KAEK,
      mainUse: f.attributes.MAIN_USE || '',
      area: f.attributes.AREA,
    })).slice(0, 10);
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
  const [neighbors, setNeighbors] = useState<NeighborParcel[]>([]);
  const [copiedKey, setCopiedKey] = useState("");

  const primaryRing = useMemo(() => normalizeRing(parcel?.rings?.[0] ?? []), [parcel]);
  const path = useMemo(() => (primaryRing.length ? shapePath(primaryRing) : ""), [primaryRing]);
  const lengths = useMemo(() => (primaryRing.length ? edgeLengths(primaryRing) : []), [primaryRing]);

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
    if (!parcel) return [] as Array<[string, string]>;
    const attrs = parcel.raw;
    const otaInfo = (otaOfficeMap as Record<string, { otaCode: string; nomos: string; ota: string; cadastralOffice: string; raw: string }>)[parcel.otaCode];
    const mainUseInfo = (mainUseMap as Record<string, { code: string; category: string; subcategory: string }>)[parcel.mainUse];
    const hasCategory = !!mainUseInfo?.category;
    
    const rows: Array<[string, string]> = [
      ["KAEK", parcel.kaek],
      ["Κωδικός ΟΤΑ", parcel.otaCode || "—"],
      ["Νομός", otaInfo?.nomos || "—"],
      ["ΟΤΑ", otaInfo?.ota || "—"],
      ["Κτηματολογικό Γραφείο", otaInfo?.cadastralOffice || "—"],
      ["Εμβαδό", parcel.area != null ? `${formatNumber(parcel.area, 2)} m²` : "—"],
      ["Περίμετρος", parcel.perimeter != null ? `${formatNumber(parcel.perimeter, 2)} m` : "—"],
    ];
    
    if (hasCategory) {
      rows.push(
        ["Κωδικός Κύριας Χρήσης", parcel.mainUse || "—"],
        ["Κατηγορία Χρήσης", mainUseInfo?.category || "—"],
        ["Υποκατηγορία Χρήσης", mainUseInfo?.subcategory || "—"],
      );
    } else {
      rows.push(["Περιγραφή", parcel.description || "—"]);
    }
    
    // TEE data (Ο.Τ.)
    if (teeData) {
      rows.push(
        ["Οικοδομικό Τετράγωνο (Ο.Τ.)", teeData.otNumber || "—"],
        ["ΦΕΚ", teeData.fek || "—"],
        ["Τύπος Έγκρισης", teeData.apofEidos || "—"],
        ["Καλλικρατικός Δήμος", teeData.municipality || "—"],
      );
    }
    
    rows.push(
      ["ΟΤΑ / link", parcel.link || "—"],
      ["Αριθμός Καθέτων", attrs.PROP_VERT != null ? String(attrs.PROP_VERT) : "—"],
      ["Αριθμός Οριζοντίων", attrs.PROP_HOR != null ? String(attrs.PROP_HOR) : "—"],
      ["Ποσοστό Κύριας Χρήσης", attrs.PERCENTAGE != null ? `${attrs.PERCENTAGE}%` : "—"],
    );
    
    return rows;
  }, [parcel, teeData]);



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
      
      // Fetch TEE data for Ο.Τ.
      const tee = await fetchTEEData(result.rings);
      setTeeData(tee);
      
      // Fetch neighboring parcels
      const neighborList = await fetchNeighbors(result.rings, result.kaek);
      setNeighbors(neighborList);
    } catch (error) {
      setMessage("Lookup failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-white px-4 py-10 text-neutral-900">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex items-center gap-2 rounded-2xl border border-neutral-300 bg-white px-3 py-3 shadow-sm">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSubmit();
              }}
              placeholder="Enter KAEK"
              className="flex-1 bg-transparent px-1 text-lg text-neutral-900 outline-none"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />

            <button
              type="button"
              onClick={handleSubmit}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 text-white active:scale-[0.98]"
              aria-label="Search"
              title="Search"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>

          {message ? <p className="mt-3 px-1 text-sm text-neutral-500">{message}</p> : null}
          {loading ? <p className="mt-2 px-1 text-sm text-neutral-400">Loading parcel data…</p> : null}
{parcel && !teeData && !loading ? <p className="mt-2 px-1 text-sm text-neutral-400">Loading TEE data…</p> : null}
        </div>

        {parcel ? (
          <div className="mt-10 grid gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Shape</h2>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
              </div>

              <svg viewBox="0 0 320 320" className="w-full rounded-xl border border-neutral-200 bg-neutral-50 shadow-inner">
                <rect x="0" y="0" width="320" height="320" fill="#fafafa" />
                <path d={path} fill="rgba(17,24,39,0.05)" stroke="#111827" strokeWidth="2.2" />
                {primaryRing.map((point, index) => {
                  const project = createSvgProjector(primaryRing);
                  const p = project(point);
                  const dx = index % 2 === 0 ? 8 : -18;
                  const dy = index % 2 === 0 ? -8 : 16;
                  return (
                    <g key={index}>
                      <circle cx={p.x} cy={p.y} r="3.6" fill="#111827" />
                      <rect x={p.x + dx - 4} y={p.y + dy - 14} width="18" height="18" rx="4" fill="white" stroke="#d4d4d8" />
                      <text x={p.x + dx + 5} y={p.y + dy - 2} fontSize="11" textAnchor="middle" fill="#111827">{greekLabel(index)}</text>
                    </g>
                  );
                })}
              </svg>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">Parcel data</h2>

              <div className="overflow-hidden rounded-xl border border-neutral-200">
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {visibleRows.map(([label, value]) => {
                      const copyKey = `row-${label}`;
                      return (
                        <tr key={label} className="border-b border-neutral-200 last:border-b-0">
                          <th className="w-52 bg-neutral-50 px-4 py-3 text-left font-medium text-neutral-600">{label}</th>
                          <td className="px-4 py-3 text-neutral-900">
                            <div className="flex items-center justify-between gap-3">
                              <span>{value}</span>
                              <button
                                type="button"
                                onClick={() => copyValue(copyKey, value)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                                title={`Copy ${label}`}
                                aria-label={`Copy ${label}`}
                              >
                                {copiedKey === copyKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-neutral-700">Vertices</h3>
                  <div className="max-h-72 overflow-auto rounded-xl border border-neutral-200">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-neutral-50 text-neutral-600">
                          <th className="px-3 py-2 text-left font-medium">#</th>
                          <th className="px-3 py-2 text-left font-medium">Lon</th>
                          <th className="px-3 py-2 text-left font-medium">Lat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {primaryRing.map((point, index) => (
                          <tr key={index} className="border-t border-neutral-200">
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
                  <h3 className="mb-2 text-sm font-semibold text-neutral-700">Edge lengths</h3>
                  <div className="max-h-72 overflow-auto rounded-xl border border-neutral-200">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-neutral-50 text-neutral-600">
                          <th className="px-3 py-2 text-left font-medium">Πλευρά</th>
                          <th className="px-3 py-2 text-left font-medium">Length</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lengths.map((edge) => (
                          <tr key={edge.label} className="border-t border-neutral-200">
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
              <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <h3 className="mb-2 text-sm font-semibold text-neutral-700">Shareable Link</h3>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-white px-3 py-2 text-sm text-neutral-600">
                    {`${window.location.origin}/topografiko/o/${parcel.kaek}`}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyValue('share-link', `${window.location.origin}/topografiko/o/${parcel.kaek}`)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100"
                    title="Copy link"
                  >
                    {copiedKey === 'share-link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Neighboring Parcels */}
              {neighbors.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold text-neutral-700">Όμορα Οικόπεδα</h3>
                  <div className="max-h-64 overflow-auto rounded-xl border border-neutral-200">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-neutral-50 text-neutral-600">
                          <th className="px-3 py-2 text-left font-medium">KAEK</th>
                          <th className="px-3 py-2 text-left font-medium">Χρήση</th>
                          <th className="px-3 py-2 text-left font-medium">Εμβαδόν</th>
                        </tr>
                      </thead>
                      <tbody>
                        {neighbors.map((neighbor) => (
                          <tr key={neighbor.kaek} className="border-t border-neutral-200">
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
                                className="text-blue-600 hover:underline"
                              >
                                {neighbor.kaek}
                              </a>
                            </td>
                            <td className="px-3 py-2">{neighbor.mainUse || "—"}</td>
                            <td className="px-3 py-2">{neighbor.area != null ? `${formatNumber(neighbor.area, 0)} m²` : "—"}</td>
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
