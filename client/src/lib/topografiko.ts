import proj4 from "proj4";
import { DxfWriter, Units, point3d } from "@tarikjabiri/dxf";

export type Point = { x: number; y: number };
export type ParcelData = {
  kaek: string;
  otaCode: string;
  area: number | null;
  perimeter: number | null;
  mainUse: string;
  description: string;
  link: string;
  rings: Point[][];
  officialRingsGgrs87: Point[][];
  raw: Record<string, unknown>;
};

export type TEEData = {
  otNumber: string;
  fek: string;
  apofEidos: string;
  municipality: string;
  rings: Point[][];
};

export type BuildingTermsData = {
  sd?: string;
  sdSector?: string;
  sdComment?: string;
  coverage?: string;
  maxCoverageArea?: string;
  maxHeight?: string;
  floors?: string;
  minArea?: string;
  minFrontage?: string;
  lotRuleType?: string;
  buildingSystem?: string;
  notes: string[];
  sourceFek?: string;
  sourceDecisionType?: string;
  sourceDecisionNumber?: string;
  sourceDate?: string;
  sourceTitle?: string;
};

type TEERawFeature = {
  attributes?: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
    paths?: number[][][];
  };
};

export type TEECandidate = TEEData & { objectId?: string; containsCentroid?: boolean };

export type OfficialRoadLabel = {
  name: string;
  municipality: string;
  kind: number;
  point: Point;
  distanceToParcel: number;
};

export type NeighborParcel = {
  kaek: string;
  mainUse: string;
  area: number | null;
  rings: Point[][];
  relation?: "adjacent" | "opposite";
};

export function stripClosingPoint(points: Point[]) {
  if (points.length < 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.y === last.y ? points.slice(0, -1) : [...points];
}

export function boundsFromPoints(points: Point[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}


export function centroidOfRing(points: Point[]) {
  const usable = stripClosingPoint(points);
  if (!usable.length) return { x: 0, y: 0 };
  const sum = usable.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / usable.length, y: sum.y / usable.length };
}

export function projectPoint(point: Point, bounds: { minX: number; maxX: number; minY: number; maxY: number }, size = 320, pad = 22) {
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

export function pathFromRingWithBounds(points: Point[], bounds: { minX: number; maxX: number; minY: number; maxY: number }, size = 320, pad = 22) {
  const usable = stripClosingPoint(points);
  if (!usable.length) return "";
  return usable.map((point, index) => {
    const p = projectPoint(point, bounds, size, pad);
    return `${index === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }).join(" ") + " Z";
}

export async function fetchParcelByKaek(kaek: string): Promise<ParcelData | null> {
  const normalized = kaek.replace(/\s+/g, "").trim();
  const commonParams = {
    f: "json",
    where: `KAEK='${normalized}'`,
    returnGeometry: "true",
    outFields: "*",
    resultRecordCount: "1",
  };
  const url4326 = `https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query?${new URLSearchParams({ ...commonParams, outSR: "4326" }).toString()}`;
  const url2100 = `https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query?${new URLSearchParams({ ...commonParams, outSR: "2100" }).toString()}`;
  const [response4326, response2100] = await Promise.all([fetch(url4326), fetch(url2100)]);
  const [data4326, data2100] = await Promise.all([response4326.json(), response2100.json()]);
  const feature4326 = data4326?.features?.[0];
  const feature2100 = data2100?.features?.[0];
  if (!feature4326?.geometry?.rings?.length || !feature2100?.geometry?.rings?.length) return null;
  const kaekValue = feature4326.attributes?.KAEK || feature2100.attributes?.KAEK || normalized;
  return {
    kaek: kaekValue,
    otaCode: String(kaekValue).slice(0, 5),
    area: feature4326.attributes?.AREA ?? feature2100.attributes?.AREA ?? null,
    perimeter: feature4326.attributes?.PERIMETER ?? feature2100.attributes?.PERIMETER ?? null,
    mainUse: feature4326.attributes?.MAIN_USE || feature2100.attributes?.MAIN_USE || "",
    description: feature4326.attributes?.DESCR || feature2100.attributes?.DESCR || "",
    link: feature4326.attributes?.LINK || feature2100.attributes?.LINK || "",
    rings: feature4326.geometry.rings.map((ring: number[][]) => ring.map((point: number[]) => ({ x: point[0], y: point[1] }))),
    officialRingsGgrs87: feature2100.geometry.rings.map((ring: number[][]) => ring.map((point: number[]) => ({ x: point[0], y: point[1] }))),
    raw: feature4326.attributes || feature2100.attributes || {},
  };
}


export function transformToWebMercator(lon: number, lat: number): [number, number] {
  return proj4("EPSG:4326", "EPSG:3857", [lon, lat]);
}

export function transformFromWebMercator(x: number, y: number): [number, number] {
  return proj4("EPSG:3857", "EPSG:4326", [x, y]);
}

export function transformToGGRS87(lon: number, lat: number): [number, number] {
  const wgs84 = "EPSG:4326";
  const ggrs87 = "+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs";
  return proj4(wgs84, ggrs87, [lon, lat]);
}

export function transformFromGGRS87(x: number, y: number): [number, number] {
  const wgs84 = "EPSG:4326";
  const ggrs87 = "+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs";
  return proj4(ggrs87, wgs84, [x, y]);
}

export async function fetchTEEData(rings: Point[][]): Promise<TEEData | null> {
  const candidates = await fetchTEECandidates(rings);
  return candidates[0] || null;
}

function pointInRing(point: Point, ring: Point[]) {
  const usable = stripClosingPoint(ring);
  let inside = false;
  for (let i = 0, j = usable.length - 1; i < usable.length; j = i++) {
    const xi = usable[i].x;
    const yi = usable[i].y;
    const xj = usable[j].x;
    const yj = usable[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

async function fetchTEERawCandidates(params: URLSearchParams) {
  const url = `https://sdigmap.tee.gov.gr/mapping/rest/services/UDM/UDM_SERVICE_POLEODOMIKI_PLIROFORIA/MapServer/dynamicLayer/query?${params.toString()}`;
  const response = await fetch(url);
  const data = await response.json();
  return (data?.features || []) as TEERawFeature[];
}

async function fetchTEELayerFeaturesByEnvelope(layerId: number, outFields: string[], envelope: { minX: number; minY: number; maxX: number; maxY: number }, returnGeometry = true, resultRecordCount = 80) {
  const params = new URLSearchParams({
    f: "json",
    returnGeometry: returnGeometry ? "true" : "false",
    spatialRel: "esriSpatialRelIntersects",
    geometry: JSON.stringify({
      xmin: envelope.minX,
      ymin: envelope.minY,
      xmax: envelope.maxX,
      ymax: envelope.maxY,
      spatialReference: { wkid: 2100 },
    }),
    geometryType: "esriGeometryEnvelope",
    inSR: "2100",
    outFields: outFields.join(","),
    outSR: "2100",
    resultRecordCount: String(resultRecordCount),
    layer: JSON.stringify({ source: { type: "mapLayer", mapLayerId: layerId } }),
  });
  return fetchTEERawCandidates(params);
}

function readString(value: unknown) {
  return String(value ?? "").trim();
}

function readNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function distancePointToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const px = start.x + t * dx;
  const py = start.y + t * dy;
  return Math.hypot(point.x - px, point.y - py);
}

function distancePointToRing(point: Point, ring: Point[]) {
  const usable = stripClosingPoint(ring);
  if (!usable.length) return Number.POSITIVE_INFINITY;
  if (pointInRing(point, usable)) return 0;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < usable.length; index += 1) {
    const start = usable[index];
    const end = usable[(index + 1) % usable.length];
    minDistance = Math.min(minDistance, distancePointToSegment(point, start, end));
  }
  return minDistance;
}

function distancePointToRings(point: Point, rings: Point[][]) {
  return rings.reduce((minDistance, ring) => Math.min(minDistance, distancePointToRing(point, ring)), Number.POSITIVE_INFINITY);
}

async function loadJsonpValue(url: string, callbackPath: string) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return "";
  }

  return new Promise<string>((resolve) => {
    const root = window as Window & typeof globalThis & { __topografikoJsonp?: Record<string, (value: unknown) => void> };
    root.__topografikoJsonp = root.__topografikoJsonp || {};
    const callbackId = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const fullCallbackPath = `${callbackPath}.${callbackId}`;
    const separator = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      delete root.__topografikoJsonp?.[callbackId];
      script.remove();
    };

    const finish = (value = "") => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    root.__topografikoJsonp[callbackId] = (value: unknown) => {
      finish(String(value ?? ""));
    };

    script.async = true;
    script.src = `${url}${separator}callback=${encodeURIComponent(fullCallbackPath)}&scriptIndex=0`;
    script.onerror = () => {
      console.warn("Official JSONP request failed; continuing without remote labels.", { url });
      finish("");
    };

    document.body.appendChild(script);

    window.setTimeout(() => {
      if (settled) return;
      console.warn("Official JSONP request timed out; continuing without remote labels.", { url });
      finish("");
    }, 12000);
  });
}

function parseOfficialInfoResponse(raw: string) {
  const payload = raw.startsWith("Info|") ? raw.slice(5) : raw;
  return payload
    .split("~")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, municipality, kindText, xText, yText] = entry.split("::");
      const x = Number(xText);
      const y = Number(yText);
      const kind = Number(kindText);
      if (!name || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(kind)) return null;
      return {
        name: name.trim(),
        municipality: (municipality || "").trim(),
        kind,
        point: { x, y },
      };
    })
    .filter((item): item is { name: string; municipality: string; kind: number; point: Point } => Boolean(item));
}

export async function fetchOfficialRoadLabels(ringsGgrs87: Point[][]): Promise<OfficialRoadLabel[]> {
  const usableRings = ringsGgrs87.map((ring) => stripClosingPoint(ring)).filter((ring) => ring.length >= 3);
  if (!usableRings.length) return [];

  try {
    const allPoints = usableRings.flat();
    const bounds = boundsFromPoints(allPoints);
    const pad = 180;
    const data = `Info:::${bounds.minX - pad}:${bounds.minY - pad}:${bounds.maxX + pad}:${bounds.maxY + pad}:10:1`;
    const url = `https://gis.ktimanet.gr/gis/WebAPIWebServicev1.3/ImageService.aspx?Data=${encodeURIComponent(data)}&KEY=maps.gov.gr`;
    const raw = await loadJsonpValue(url, "__topografikoJsonp");
    const seen = new Set<string>();

    return parseOfficialInfoResponse(raw)
      .filter((item) => item.kind === 3)
      .map((item) => ({
        ...item,
        distanceToParcel: distancePointToRings(item.point, usableRings),
      }))
      .filter((item) => item.distanceToParcel <= 220)
      .sort((a, b) => a.distanceToParcel - b.distanceToParcel || a.name.localeCompare(b.name, "el"))
      .filter((item) => {
        const key = `${item.name}::${item.municipality}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch (error) {
    console.warn("Official road label lookup failed; continuing without road labels.", error);
    return [];
  }
}

function formatValue(value: unknown, suffix = "", digits = 2) {
  const parsed = readNumber(value);
  if (parsed == null) return "";
  const formatted = Number.isInteger(parsed) ? parsed.toString() : parsed.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return suffix ? `${formatted} ${suffix}` : formatted;
}

async function fetchTEELayerFeatureByPoint(layerId: number, outFields: string[], point: Point) {
  const [x, y] = transformToGGRS87(point.x, point.y);
  const params = new URLSearchParams({
    f: "json",
    returnGeometry: "false",
    spatialRel: "esriSpatialRelIntersects",
    geometry: JSON.stringify({ x, y, spatialReference: { wkid: 2100 } }),
    geometryType: "esriGeometryPoint",
    inSR: "2100",
    outFields: outFields.join(","),
    outSR: "2100",
    resultRecordCount: "5",
    layer: JSON.stringify({ source: { type: "mapLayer", mapLayerId: layerId } }),
  });
  const features = await fetchTEERawCandidates(params);
  return features[0]?.attributes || null;
}

export async function fetchBuildingTerms(rings: Point[][]): Promise<BuildingTermsData | null> {
  if (!rings?.[0]?.length) return null;
  const parcelCentroid = centroidOfRing(stripClosingPoint(rings[0]));
  const [heightAttrs, areaAttrs, coverageAttrs, systemAttrs, densityAttrs] = await Promise.all([
    fetchTEELayerFeatureByPoint(16, ["FEK", "MAX_HEIGHT_M", "OROR_MAX_HEIGHT_COMMENT", "NUM_OROFON", "OROR_NUM_OROFON_COMMENT", "SYNTHIKI_TXT", "APOF_EIDOS", "TITLE", "NUMBER_", "SIGN_DATE"], parcelCentroid),
    fetchTEELayerFeatureByPoint(17, ["FEK", "ELAX_EMBADO_M2", "ELAX_PROSOP_M", "OROS_TYPE", "DATE_PAREKLISIS", "SYNTHIKI_TXT", "REMARKS", "APOF_EIDOS", "TITLE", "NUMBER_", "SIGN_DATE"], parcelCentroid),
    fetchTEELayerFeatureByPoint(18, ["FEK", "SYNT_KALYPSIS", "MAX_EMBADO_M2", "SYNTHIKI_TXT", "REMARKS", "APOF_EIDOS", "TITLE", "NUMBER_", "SIGN_DATE"], parcelCentroid),
    fetchTEELayerFeatureByPoint(19, ["FEK", "OIK_SYSTHMA", "SYNTHIKI_TXT", "OROIKS_COMMENT", "APOF_EIDOS", "TITLE", "NUMBER_", "SIGN_DATE"], parcelCentroid),
    fetchTEELayerFeatureByPoint(20, ["FEK", "SD_TIMH", "SD_TOMEAS", "SD_KLIMAKOTOS", "SD_COMMENT", "APOF_EIDOS", "TITLE", "NUMBER_", "SIGN_DATE"], parcelCentroid),
  ]);

  const notes = [
    readString(heightAttrs?.SYNTHIKI_TXT),
    readString(heightAttrs?.OROR_MAX_HEIGHT_COMMENT),
    readString(heightAttrs?.OROR_NUM_OROFON_COMMENT),
    readString(areaAttrs?.SYNTHIKI_TXT),
    readString(areaAttrs?.REMARKS),
    readString(areaAttrs?.OROS_TYPE),
    readString(areaAttrs?.DATE_PAREKLISIS),
    readString(coverageAttrs?.SYNTHIKI_TXT),
    readString(coverageAttrs?.REMARKS),
    readString(systemAttrs?.SYNTHIKI_TXT),
    readString(systemAttrs?.OROIKS_COMMENT),
    readString(densityAttrs?.SD_KLIMAKOTOS),
    readString(densityAttrs?.SD_COMMENT),
  ].filter(Boolean);

  const dedupedNotes = Array.from(new Set(notes));
  const result: BuildingTermsData = {
    sd: formatValue(densityAttrs?.SD_TIMH),
    sdSector: readString(densityAttrs?.SD_TOMEAS),
    sdComment: readString(densityAttrs?.SD_COMMENT),
    coverage: formatValue(coverageAttrs?.SYNT_KALYPSIS, "%"),
    maxCoverageArea: formatValue(coverageAttrs?.MAX_EMBADO_M2, "m²", 0),
    maxHeight: formatValue(heightAttrs?.MAX_HEIGHT_M, "m"),
    floors: formatValue(heightAttrs?.NUM_OROFON, "όροφοι", 0),
    minArea: formatValue(areaAttrs?.ELAX_EMBADO_M2, "m²"),
    minFrontage: formatValue(areaAttrs?.ELAX_PROSOP_M, "m"),
    lotRuleType: readString(areaAttrs?.OROS_TYPE),
    buildingSystem: readString(systemAttrs?.OIK_SYSTHMA),
    notes: dedupedNotes,
    sourceFek: readString(densityAttrs?.FEK || coverageAttrs?.FEK || heightAttrs?.FEK || areaAttrs?.FEK || systemAttrs?.FEK),
    sourceDecisionType: readString(densityAttrs?.APOF_EIDOS || coverageAttrs?.APOF_EIDOS || heightAttrs?.APOF_EIDOS || areaAttrs?.APOF_EIDOS || systemAttrs?.APOF_EIDOS),
    sourceDecisionNumber: readString(densityAttrs?.NUMBER_ || coverageAttrs?.NUMBER_ || heightAttrs?.NUMBER_ || areaAttrs?.NUMBER_ || systemAttrs?.NUMBER_),
    sourceDate: readString(densityAttrs?.SIGN_DATE || coverageAttrs?.SIGN_DATE || heightAttrs?.SIGN_DATE || areaAttrs?.SIGN_DATE || systemAttrs?.SIGN_DATE),
    sourceTitle: readString(densityAttrs?.TITLE || coverageAttrs?.TITLE || heightAttrs?.TITLE || areaAttrs?.TITLE || systemAttrs?.TITLE),
  };

  const hasAnyValue = Boolean(
    result.sd || result.coverage || result.maxHeight || result.floors || result.minArea || result.minFrontage || result.lotRuleType || result.buildingSystem || result.maxCoverageArea || result.sdSector || result.sdComment || result.notes.length,
  );

  return hasAnyValue ? result : null;
}

function normalizeTEECandidate(feature: { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }, parcelCentroid: Point): TEECandidate {
  const attrs = feature.attributes || {};
  const rings = (feature.geometry?.rings || []).map((ring: number[][]) => ring.map((point: number[]) => {
    const [lon, lat] = transformFromGGRS87(point[0], point[1]);
    return { x: lon, y: lat };
  }));
  return {
    objectId: String(attrs.OBJECTID || ""),
    otNumber: String(attrs.OT_NUM || ""),
    fek: String(attrs.FEK || ""),
    apofEidos: String(attrs.APOF_EIDOS || ""),
    municipality: String(attrs.KALL_DHM_NAME || ""),
    rings,
    containsCentroid: rings.some((ring) => pointInRing(parcelCentroid, ring)),
  } satisfies TEECandidate;
}

export async function fetchTEECandidates(rings: Point[][]): Promise<TEECandidate[]> {
  if (!rings?.[0]?.length) return [];
  const points = stripClosingPoint(rings[0]);
  const lons = points.map((p) => p.x);
  const lats = points.map((p) => p.y);
  const parcelCentroid = centroidOfRing(points);
  const [xmin, ymin] = transformToGGRS87(Math.min(...lons), Math.min(...lats));
  const [xmax, ymax] = transformToGGRS87(Math.max(...lons), Math.max(...lats));
  const [cx, cy] = transformToGGRS87(parcelCentroid.x, parcelCentroid.y);

  const commonParams = {
    f: "json",
    returnGeometry: "true",
    inSR: "2100",
    outFields: "OBJECTID,FEK,OT_NUM,APOF_EIDOS,KALL_DHM_NAME",
    outSR: "2100",
    layer: JSON.stringify({ source: { type: "mapLayer", mapLayerId: 6 } }),
  };

  const envelopeParams = new URLSearchParams({
    ...commonParams,
    spatialRel: "esriSpatialRelIntersects",
    geometry: JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 2100 } }),
    geometryType: "esriGeometryEnvelope",
  });

  const pointParams = new URLSearchParams({
    ...commonParams,
    spatialRel: "esriSpatialRelIntersects",
    geometry: JSON.stringify({ x: cx, y: cy, spatialReference: { wkid: 2100 } }),
    geometryType: "esriGeometryPoint",
  });

  const [envelopeFeatures, pointFeatures] = await Promise.all([
    fetchTEERawCandidates(envelopeParams),
    fetchTEERawCandidates(pointParams),
  ]);

  const prioritizedObjectIds = new Set(
    pointFeatures
      .map((feature) => String(feature.attributes?.OBJECTID || ""))
      .filter(Boolean),
  );

  const merged = new Map<string, TEECandidate>();
  [...pointFeatures, ...envelopeFeatures].forEach((feature) => {
    const candidate = normalizeTEECandidate(feature, parcelCentroid);
    const key = candidate.objectId || `${candidate.otNumber}-${candidate.fek}`;
    if (!merged.has(key)) {
      merged.set(key, candidate);
    }
  });

  return Array.from(merged.values()).sort((a, b) => {
    const aPriority = prioritizedObjectIds.has(a.objectId || "") ? 1 : 0;
    const bPriority = prioritizedObjectIds.has(b.objectId || "") ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    const aContains = a.containsCentroid ? 1 : 0;
    const bContains = b.containsCentroid ? 1 : 0;
    if (aContains !== bContains) return bContains - aContains;
    return a.otNumber.localeCompare(b.otNumber, "el");
  });
}

export async function fetchContextOTs(otRings: Point[][], currentOt?: string): Promise<TEEData[]> {
  const points = otRings.flatMap((ring) => stripClosingPoint(ring));
  if (!points.length) return [];
  const projectedPoints = points.map((point) => {
    const [x, y] = transformToGGRS87(point.x, point.y);
    return { x, y };
  });
  const bounds = boundsFromPoints(projectedPoints);
  const padding = Math.max(30, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.9);
  const features = await fetchTEELayerFeaturesByEnvelope(
    6,
    ["OBJECTID", "FEK", "OT_NUM", "APOF_EIDOS", "KALL_DHM_NAME"],
    {
      minX: bounds.minX - padding,
      minY: bounds.minY - padding,
      maxX: bounds.maxX + padding,
      maxY: bounds.maxY + padding,
    },
    true,
    80,
  );
  const currentCentroid = centroidOfRing(stripClosingPoint(otRings[0] || points));
  const seen = new Map<string, TEEData>();
  features.forEach((feature) => {
    const candidate = normalizeTEECandidate(feature, currentCentroid);
    const key = `${candidate.otNumber}-${candidate.fek}`;
    if (!candidate.otNumber || candidate.otNumber === currentOt || seen.has(key)) return;
    seen.set(key, {
      otNumber: candidate.otNumber,
      fek: candidate.fek,
      apofEidos: candidate.apofEidos,
      municipality: candidate.municipality,
      rings: candidate.rings,
    });
  });
  return Array.from(seen.values()).sort((a, b) => {
    const aCenter = centroidOfRing(a.rings[0] || []);
    const bCenter = centroidOfRing(b.rings[0] || []);
    const distA = distanceSquared(aCenter, currentCentroid);
    const distB = distanceSquared(bCenter, currentCentroid);
    return distA - distB;
  });
}

export async function fetchParcelsInOT(otRings: Point[][], currentKaek?: string | undefined): Promise<NeighborParcel[]> {
  const geometry = JSON.stringify({
    rings: otRings.map((ring) => ring.map((p) => [p.x, p.y])),
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    f: "json",
    geometry,
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "KAEK,MAIN_USE,AREA",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: "200",
    where: "1=1",
  });
  const url = `https://services-eu1.arcgis.com/40tFGWzosjaLJpmn/arcgis/rest/services/GEOTEMAXIA_LEITOURGOUN_ON_gdb/FeatureServer/0/query?${params.toString()}`;
  const response = await fetch(url);
  const data = await response.json();
  const features = data?.features || [];
  return features.map((f: { attributes: { KAEK: string; MAIN_USE: string; AREA: number }; geometry?: { rings?: number[][][] } }): NeighborParcel => ({
    kaek: f.attributes.KAEK,
    mainUse: f.attributes.MAIN_USE || "",
    area: f.attributes.AREA,
    rings: (f.geometry?.rings || []).map((ring) => ring.map((point) => ({ x: point[0], y: point[1] }))),
  })).filter((item: NeighborParcel) => !currentKaek || item.kaek !== currentKaek);
}

function distanceSquared(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const lengthSquared = distanceSquared(start, end);
  if (lengthSquared <= 1e-12) return Math.sqrt(distanceSquared(point, start));
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared));
  const projected = {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  };
  return Math.sqrt(distanceSquared(point, projected));
}

function orientation(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, c: Point, tolerance = 1e-6) {
  return (
    Math.min(a.x, c.x) - tolerance <= b.x &&
    b.x <= Math.max(a.x, c.x) + tolerance &&
    Math.min(a.y, c.y) - tolerance <= b.y &&
    b.y <= Math.max(a.y, c.y) + tolerance
  );
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point, tolerance = 1e-6) {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if ((o1 > tolerance && o2 < -tolerance || o1 < -tolerance && o2 > tolerance) && (o3 > tolerance && o4 < -tolerance || o3 < -tolerance && o4 > tolerance)) {
    return true;
  }

  if (Math.abs(o1) <= tolerance && onSegment(a1, b1, a2, tolerance)) return true;
  if (Math.abs(o2) <= tolerance && onSegment(a1, b2, a2, tolerance)) return true;
  if (Math.abs(o3) <= tolerance && onSegment(b1, a1, b2, tolerance)) return true;
  if (Math.abs(o4) <= tolerance && onSegment(b1, a2, b2, tolerance)) return true;
  return false;
}

function segmentDistance(a1: Point, a2: Point, b1: Point, b2: Point) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointToSegmentDistance(a1, b1, b2),
    pointToSegmentDistance(a2, b1, b2),
    pointToSegmentDistance(b1, a1, a2),
    pointToSegmentDistance(b2, a1, a2),
  );
}

function ringSegments(points: Point[]) {
  const usable = stripClosingPoint(points);
  return usable.map((point, index) => [point, usable[(index + 1) % usable.length]] as const);
}

function projectedRing(points: Point[]) {
  return stripClosingPoint(points).map((point) => {
    const [x, y] = transformToGGRS87(point.x, point.y);
    return { x, y };
  });
}

function ringsAreAdjacent(a: Point[], b: Point[], toleranceMeters = 0.35) {
  const aProjected = projectedRing(a);
  const bProjected = projectedRing(b);
  if (aProjected.length < 2 || bProjected.length < 2) return false;
  const aSegments = ringSegments(aProjected);
  const bSegments = ringSegments(bProjected);
  return aSegments.some(([a1, a2]) => bSegments.some(([b1, b2]) => segmentDistance(a1, a2, b1, b2) <= toleranceMeters));
}

export function filterAdjacentParcels(baseRings: Point[][], parcels: NeighborParcel[], toleranceMeters = 0.35) {
  const baseRing = baseRings[0];
  if (!baseRing?.length) return [] as NeighborParcel[];
  return parcels.filter((parcel) => parcel.rings.some((ring) => ringsAreAdjacent(baseRing, ring, toleranceMeters)));
}

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8", addBom = false) {
  const payload = addBom ? `\ufeff${content}` : content;
  const blob = new Blob([payload], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const DXF_TEXT_STYLE = "GREEK";

function encodeDxfText(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function addDxfText(
  writer: DxfWriter,
  x: number,
  y: number,
  height: number,
  value: string,
  options?: { rotation?: number; layerName?: string; colorNumber?: number },
) {
  const entity = writer.addText(point3d(x, y, 0), height, encodeDxfText(value), {
    rotation: options?.rotation,
    layerName: options?.layerName,
  });
  entity.textStyle = DXF_TEXT_STYLE;
  if (options?.colorNumber != null) entity.colorNumber = options.colorNumber;
  return entity;
}

function addCenteredDxfText(
  writer: DxfWriter,
  centerX: number,
  y: number,
  height: number,
  value: string,
  options?: { rotation?: number; layerName?: string; colorNumber?: number },
) {
  return addDxfText(writer, centerX - estimateTextWidth(value, height) / 2, y, height, value, options);
}

function addDxfLine(
  writer: DxfWriter,
  start: Point,
  end: Point,
  options?: { layerName?: string; lineType?: string; lineTypeScale?: number; colorNumber?: number },
) {
  const entity = writer.addLine(point3d(start.x, start.y, 0), point3d(end.x, end.y, 0), {
    layerName: options?.layerName,
    lineType: options?.lineType,
    lineTypeScale: options?.lineTypeScale,
  });
  if (options?.colorNumber != null) entity.colorNumber = options.colorNumber;
  return entity;
}

function addDxfCircle(
  writer: DxfWriter,
  center: Point,
  radius: number,
  options?: { layerName?: string; lineType?: string; colorNumber?: number },
) {
  const entity = writer.addCircle(point3d(center.x, center.y, 0), radius, {
    layerName: options?.layerName,
    lineType: options?.lineType,
  });
  if (options?.colorNumber != null) entity.colorNumber = options.colorNumber;
  return entity;
}

export type CoordinateRow = { label: string; x: string; y: string };

export function greekLabel(index: number) {
  const letters = ["Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ", "Μ", "Ν", "Ξ", "Ο", "Π", "Ρ", "Σ", "Τ", "Υ", "Φ", "Χ", "Ψ", "Ω"];
  return letters[index] || `P${index + 1}`;
}

export function normalizeRingFromNorthEast(points: Point[]) {
  const usable = stripClosingPoint(points);
  if (!usable.length) return [] as Point[];
  let startIndex = 0;
  for (let i = 1; i < usable.length; i++) {
    const current = usable[i];
    const best = usable[startIndex];
    if (current.y > best.y || (current.y === best.y && current.x > best.x)) {
      startIndex = i;
    }
  }
  return [...usable.slice(startIndex), ...usable.slice(0, startIndex)];
}

export function formatCoordinateRows(points: Point[], prefix: "T" | "P" = "T", coordinatesAreGgrs87 = false): CoordinateRow[] {
  return stripClosingPoint(points).map((point, index) => {
    const [x, y] = coordinatesAreGgrs87 ? [point.x, point.y] : transformToGGRS87(point.x, point.y);
    return {
      label: prefix === "T" ? `T${index + 1}` : greekLabel(index),
      x: x.toFixed(3),
      y: y.toFixed(3),
    };
  });
}

function signedArea(points: Point[]) {
  const usable = stripClosingPoint(points);
  let sum = 0;
  for (let i = 0; i < usable.length; i++) {
    const a = usable[i];
    const b = usable[(i + 1) % usable.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function segmentLength(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function formatLengthMeters(value: number) {
  return value.toFixed(2);
}

export function buildCoordinateLoopLabel(rows: CoordinateRow[]) {
  if (!rows.length) return "";
  return `${rows.map((row) => row.label).join("")}${rows[0].label}`;
}

function formatAreaForPlan(area: number | null | undefined) {
  if (area == null || !Number.isFinite(area)) return "-";
  return area.toFixed(2);
}

function edgeAngleDegrees(a: Point, b: Point) {
  let degrees = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (degrees > 90) degrees -= 180;
  if (degrees < -90) degrees += 180;
  return degrees;
}

function estimateTextWidth(value: string, height: number) {
  return Array.from(encodeDxfText(value)).reduce((sum, char) => {
    if (char === "." || char === ":") return sum + height * 0.24;
    if (/[0-9]/.test(char)) return sum + height * 0.56;
    if (/[Α-Ωα-ω]/.test(char)) return sum + height * 0.6;
    return sum + height * 0.52;
  }, 0);
}

function wrapTextByWidth(value: string, maxWidth: number, height: number) {
  const normalized = encodeDxfText(value);
  if (!normalized) return [] as string[];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (current && estimateTextWidth(candidate, height) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function clipSegmentToRect(start: Point, end: Point, rect: { minX: number; minY: number; maxX: number; maxY: number }) {
  const INSIDE = 0;
  const LEFT = 1;
  const RIGHT = 2;
  const BOTTOM = 4;
  const TOP = 8;
  const outCode = (point: Point) => {
    let code = INSIDE;
    if (point.x < rect.minX) code |= LEFT;
    else if (point.x > rect.maxX) code |= RIGHT;
    if (point.y < rect.minY) code |= BOTTOM;
    else if (point.y > rect.maxY) code |= TOP;
    return code;
  };

  let x0 = start.x;
  let y0 = start.y;
  let x1 = end.x;
  let y1 = end.y;
  let code0 = outCode(start);
  let code1 = outCode(end);

  while (true) {
    if (!(code0 | code1)) return { start: { x: x0, y: y0 }, end: { x: x1, y: y1 } };
    if (code0 & code1) return null;

    const codeOut = code0 || code1;
    let x = 0;
    let y = 0;

    if (codeOut & TOP) {
      x = x0 + ((x1 - x0) * (rect.maxY - y0)) / ((y1 - y0) || 1e-12);
      y = rect.maxY;
    } else if (codeOut & BOTTOM) {
      x = x0 + ((x1 - x0) * (rect.minY - y0)) / ((y1 - y0) || 1e-12);
      y = rect.minY;
    } else if (codeOut & RIGHT) {
      y = y0 + ((y1 - y0) * (rect.maxX - x0)) / ((x1 - x0) || 1e-12);
      x = rect.maxX;
    } else {
      y = y0 + ((y1 - y0) * (rect.minX - x0)) / ((x1 - x0) || 1e-12);
      x = rect.minX;
    }

    if (codeOut === code0) {
      x0 = x;
      y0 = y;
      code0 = outCode({ x: x0, y: y0 });
    } else {
      x1 = x;
      y1 = y;
      code1 = outCode({ x: x1, y: y1 });
    }
  }
}

function pointInRect(point: Point, rect: { minX: number; minY: number; maxX: number; maxY: number }, tolerance = 1e-6) {
  return point.x >= rect.minX - tolerance && point.x <= rect.maxX + tolerance && point.y >= rect.minY - tolerance && point.y <= rect.maxY + tolerance;
}

function segmentParameter(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return 0;
  const raw = Math.abs(dx) >= Math.abs(dy)
    ? (point.x - start.x) / (dx || 1e-12)
    : (point.y - start.y) / (dy || 1e-12);
  return Math.max(0, Math.min(1, raw));
}

function splitSegmentOutsideRect(start: Point, end: Point, rect: { minX: number; minY: number; maxX: number; maxY: number }) {
  const startInside = pointInRect(start, rect);
  const endInside = pointInRect(end, rect);
  const inside = clipSegmentToRect(start, end, rect);
  if (!inside) return [{ start, end }];
  if (startInside && endInside) return [] as Array<{ start: Point; end: Point }>;

  const t0 = segmentParameter(inside.start, start, end);
  const t1 = segmentParameter(inside.end, start, end);
  const minT = Math.min(t0, t1);
  const maxT = Math.max(t0, t1);
  const segments: Array<{ start: Point; end: Point }> = [];

  if (!startInside && minT > 1e-6) {
    segments.push({ start, end: inside.start });
  }

  if (!endInside && maxT < 1 - 1e-6) {
    segments.push({ start: inside.end, end });
  }

  return segments;
}

function buildParcelEdgeLabels(points: Point[]) {
  const usable = stripClosingPoint(points);
  return usable.map((point, index) => {
    const next = usable[(index + 1) % usable.length];
    return {
      start: point,
      end: next,
      vertexLabel: greekLabel(index),
      edgeLabel: `${greekLabel(index)}${greekLabel((index + 1) % usable.length)}`,
      length: segmentLength(point, next),
    };
  });
}

export function toGeoJSON(name: string, parcels: { kaek: string; rings: Point[][] }[]) {
  return JSON.stringify({
    type: "FeatureCollection",
    features: parcels.map((parcel) => ({
      type: "Feature",
      properties: { kaek: parcel.kaek, name: `${name}-${parcel.kaek}` },
      geometry: {
        type: "Polygon",
        coordinates: parcel.rings.map((ring) => ring.map((p) => [p.x, p.y])),
      },
    })),
  }, null, 2);
}

export function toKML(name: string, parcels: { kaek: string; rings: Point[][] }[]) {
  const placemarks = parcels.map((parcel) => {
    const coords = parcel.rings[0].map((p) => `${p.x},${p.y},0`).join(" ");
    return `<Placemark><name>${parcel.kaek}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${name}</name>${placemarks}</Document></kml>`;
}

export function toDXF(
  parcels: { kaek: string; rings: Point[][]; relation?: "adjacent" | "opposite" }[],
  meta?: {
    kaek?: string;
    ot?: string;
    municipality?: string;
    region?: string;
    area?: number | null;
    includeTitleBlock?: boolean;
    coords?: CoordinateRow[];
    paperSize?: "A4" | "A3" | "A1";
    scaleDenominator?: number;
    otRings?: Point[][];
    contextOts?: TEEData[];
    buildingTerms?: BuildingTermsData | null;
  },
) {
  const writer = new DxfWriter();
  writer.setUnits(Units.Millimeters);
  writer.setVariable("$DWGCODEPAGE", { 3: "ANSI_1253" });
  writer.addLType("PARCEL_DASH", "Parcel boundary dash", [8, -4]);
  writer.addLayer("OT_BOUNDARY", 3, "CONTINUOUS");
  writer.addLayer("OT_CONTEXT", 7, "CONTINUOUS");
  writer.addLayer("BUILDING_LINE", 1, "CONTINUOUS");
  writer.addLayer("PARCEL_MAIN", 7, "CONTINUOUS");
  writer.addLayer("PARCEL_ADJ", 8, "PARCEL_DASH");
  writer.addLayer("COORD_GRID", 8, "CONTINUOUS");
  writer.addLayer("ANNOTATION", 7, "CONTINUOUS");
  writer.addLayer("OT_POINTS", 7, "CONTINUOUS");
  writer.addLayer("PARCEL_LABELS", 7, "CONTINUOUS");

  const greekStyle = writer.tables.addStyle(DXF_TEXT_STYLE);
  greekStyle.fontFileName = "arial.ttf";
  greekStyle.lastHeightUsed = 2.5;

  const projectedParcels = parcels.map((parcel) => ({
    ...parcel,
    relation: parcel.relation,
    rings: parcel.rings.map((ring) => ring.map((p) => {
      const isLikelyGgrs = Math.abs(p.x) > 1000 && Math.abs(p.y) > 1000;
      if (isLikelyGgrs) return { x: p.x, y: p.y };
      const [x, y] = transformToGGRS87(p.x, p.y);
      return { x, y };
    })),
  }));
  const projectedOtRings = (meta?.otRings || []).map((ring) => ring.map((p) => {
    const isLikelyGgrs = Math.abs(p.x) > 1000 && Math.abs(p.y) > 1000;
    if (isLikelyGgrs) return { x: p.x, y: p.y };
    const [x, y] = transformToGGRS87(p.x, p.y);
    return { x, y };
  }));
  const projectedContextOts = (meta?.contextOts || []).map((ot) => ({
    ...ot,
    rings: ot.rings.map((ring) => ring.map((p) => {
      const isLikelyGgrs = Math.abs(p.x) > 1000 && Math.abs(p.y) > 1000;
      if (isLikelyGgrs) return { x: p.x, y: p.y };
      const [x, y] = transformToGGRS87(p.x, p.y);
      return { x, y };
    })),
  }));

  const paperSize = meta?.paperSize || "A3";
  const scaleDenominator = meta?.scaleDenominator || 200;
  const includeTitleBlock = Boolean(meta?.includeTitleBlock);
  const paperConfig = paperSize === "A1"
    ? { width: 841, height: 594, outerMargin: 12, frameGap: 2.5, gutter: 10, titleBlockWidth: 204, textFactor: 1.65 }
    : paperSize === "A3"
      ? { width: 420, height: 297, outerMargin: 8, frameGap: 2, gutter: 6, titleBlockWidth: 126, textFactor: 1 }
      : { width: 297, height: 210, outerMargin: 6, frameGap: 1.5, gutter: 5, titleBlockWidth: 96, textFactor: 0.88 };
  const paper = { width: paperConfig.width, height: paperConfig.height };
  const mm = (value: number) => value * paperConfig.textFactor;
  const drawWin = {
    x0: paperConfig.outerMargin + mm(paperConfig.frameGap),
    y0: paperConfig.outerMargin + mm(paperConfig.frameGap),
    x1: includeTitleBlock
      ? paper.width - paperConfig.outerMargin - paperConfig.titleBlockWidth - paperConfig.gutter
      : paper.width - paperConfig.outerMargin - mm(paperConfig.frameGap),
    y1: paper.height - paperConfig.outerMargin - mm(paperConfig.frameGap),
  };

  const mainParcel = projectedParcels[0];
  const mainParcelPoints = stripClosingPoint(mainParcel.rings[0]);
  if (!mainParcelPoints.length) return writer.stringify();

  const fitPoints = projectedOtRings.flatMap((ring) => stripClosingPoint(ring));
  const referencePoints = fitPoints.length
    ? fitPoints
    : projectedParcels.flatMap((parcel) => parcel.rings.flatMap((ring) => stripClosingPoint(ring)));
  const fitBounds = boundsFromPoints(referencePoints.length ? referencePoints : mainParcelPoints);
  const fitCenterX = (fitBounds.minX + fitBounds.maxX) / 2;
  const fitCenterY = (fitBounds.minY + fitBounds.maxY) / 2;
  const worldSpanX = Math.max(fitBounds.maxX - fitBounds.minX, 1);
  const worldSpanY = Math.max(fitBounds.maxY - fitBounds.minY, 1);
  const winWidth = drawWin.x1 - drawWin.x0;
  const winHeight = drawWin.y1 - drawWin.y0;
  const requestedScale = 1000 / scaleDenominator;
  const fitPadding = 0.018;
  const fitScale = Math.min((winWidth * (1 - fitPadding * 2)) / worldSpanX, (winHeight * (1 - fitPadding * 2)) / worldSpanY);
  const scale = Math.min(requestedScale, fitScale);
  const windowCenterX = (drawWin.x0 + drawWin.x1) / 2;
  const windowCenterY = (drawWin.y0 + drawWin.y1) / 2;
  const toSheet = (p: Point) => ({
    x: windowCenterX + (p.x - fitCenterX) * scale,
    y: windowCenterY + (p.y - fitCenterY) * scale,
  });
  const visibleWorld = {
    minX: fitCenterX - (windowCenterX - drawWin.x0) / scale,
    maxX: fitCenterX + (drawWin.x1 - windowCenterX) / scale,
    minY: fitCenterY - (windowCenterY - drawWin.y0) / scale,
    maxY: fitCenterY + (drawWin.y1 - windowCenterY) / scale,
  };
  const coordinateRows = meta?.coords?.length
    ? meta.coords
    : formatCoordinateRows(parcels[0].rings[0], "P");
  const coordinateTitle = "ΣΥΝΤ/ΜΕΝΕΣ ΚΟΡΥΦΩΝ ΟΙΚΟΠΕΔΟΥ ΕΓΣΑ'87";
  const coordinateLoopLabel = buildCoordinateLoopLabel(coordinateRows);
  const legendWidth = mm(82);
  const legendHeight = mm(31);
  const legendX = drawWin.x1 - legendWidth - mm(1.5);
  const legendY = drawWin.y0 + mm(1.5);
  const clipRect = { minX: drawWin.x0, minY: drawWin.y0, maxX: drawWin.x1, maxY: drawWin.y1 };
  const legendMaskRect = {
    minX: legendX - mm(1.4),
    minY: legendY - mm(1.4),
    maxX: legendX + legendWidth + mm(1.4),
    maxY: legendY + legendHeight + mm(1.4),
  };
  const addMaskedSheetLine = (start: Point, end: Point, options?: { layerName?: string; lineType?: string; lineTypeScale?: number; colorNumber?: number }) => {
    const clipped = clipSegmentToRect(start, end, clipRect);
    if (!clipped) return null;
    const visibleSegments = splitSegmentOutsideRect(clipped.start, clipped.end, legendMaskRect);
    if (!visibleSegments.length) return null;
    visibleSegments.forEach((segment) => addDxfLine(writer, segment.start, segment.end, options));
    return true;
  };

  addDxfLine(writer, { x: 0, y: 0 }, { x: paper.width, y: 0 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: paper.width, y: 0 }, { x: paper.width, y: paper.height }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: paper.width, y: paper.height }, { x: 0, y: paper.height }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: 0, y: paper.height }, { x: 0, y: 0 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: drawWin.x0, y: drawWin.y0 }, { x: drawWin.x1, y: drawWin.y0 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: drawWin.x1, y: drawWin.y0 }, { x: drawWin.x1, y: drawWin.y1 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: drawWin.x1, y: drawWin.y1 }, { x: drawWin.x0, y: drawWin.y1 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: drawWin.x0, y: drawWin.y1 }, { x: drawWin.x0, y: drawWin.y0 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: drawWin.x1, y: 0 }, { x: drawWin.x1, y: paper.height }, { layerName: "ANNOTATION" });

  const worldGridStep = scaleDenominator <= 100 ? 10 : scaleDenominator <= 200 ? 20 : scaleDenominator <= 500 ? 50 : 100;
  const crossHalf = mm(2.2);
  const gridLabelHeight = mm(1.15);
  for (let worldX = Math.ceil(visibleWorld.minX / worldGridStep) * worldGridStep; worldX <= visibleWorld.maxX + 0.001; worldX += worldGridStep) {
    const sx = windowCenterX + (worldX - fitCenterX) * scale;
    addDxfLine(writer, { x: sx, y: drawWin.y0 }, { x: sx, y: drawWin.y0 - mm(1.8) }, { layerName: "COORD_GRID" });
    addDxfLine(writer, { x: sx, y: drawWin.y1 }, { x: sx, y: drawWin.y1 + mm(1.8) }, { layerName: "COORD_GRID" });
    addDxfText(writer, sx - mm(0.8), drawWin.y0 - mm(5.8), gridLabelHeight, String(Math.round(worldX)), { rotation: 90, layerName: "ANNOTATION" });
    for (let worldY = Math.ceil(visibleWorld.minY / worldGridStep) * worldGridStep; worldY <= visibleWorld.maxY + 0.001; worldY += worldGridStep) {
      const sy = windowCenterY + (worldY - fitCenterY) * scale;
      addMaskedSheetLine({ x: sx - crossHalf, y: sy }, { x: sx + crossHalf, y: sy }, { layerName: "COORD_GRID" });
      addMaskedSheetLine({ x: sx, y: sy - crossHalf }, { x: sx, y: sy + crossHalf }, { layerName: "COORD_GRID" });
    }
  }

  for (let worldY = Math.ceil(visibleWorld.minY / worldGridStep) * worldGridStep; worldY <= visibleWorld.maxY + 0.001; worldY += worldGridStep) {
    const sy = windowCenterY + (worldY - fitCenterY) * scale;
    addDxfLine(writer, { x: drawWin.x0, y: sy }, { x: drawWin.x0 - mm(1.8), y: sy }, { layerName: "COORD_GRID" });
    addDxfLine(writer, { x: drawWin.x1, y: sy }, { x: drawWin.x1 + mm(1.8), y: sy }, { layerName: "COORD_GRID" });
    addDxfText(writer, drawWin.x0 - mm(9.4), sy - mm(0.55), gridLabelHeight, String(Math.round(worldY)), { layerName: "ANNOTATION" });
  }

  projectedContextOts.forEach((ot) => {
    ot.rings.forEach((ring) => {
      const pts = stripClosingPoint(ring).map(toSheet);
      pts.forEach((start, index) => {
        const end = pts[(index + 1) % pts.length];
        addMaskedSheetLine(start, end, { layerName: "OT_CONTEXT", colorNumber: 7 });
      });
    });
    const labelPoint = toSheet(centroidOfRing(ot.rings[0] || []));
    if (labelPoint.x >= drawWin.x0 && labelPoint.x <= drawWin.x1 && labelPoint.y >= drawWin.y0 && labelPoint.y <= drawWin.y1 && !pointInRect(labelPoint, legendMaskRect)) {
      const text = `Ο.Τ. ${ot.otNumber}`;
      const textHeight = mm(1.35);
      const halfWidth = estimateTextWidth(text, textHeight) / 2 + mm(1.8);
      const halfHeight = mm(2.6);
      addDxfLine(writer, { x: labelPoint.x - halfWidth, y: labelPoint.y - halfHeight }, { x: labelPoint.x + halfWidth, y: labelPoint.y - halfHeight }, { layerName: "OT_CONTEXT", colorNumber: 7 });
      addDxfLine(writer, { x: labelPoint.x + halfWidth, y: labelPoint.y - halfHeight }, { x: labelPoint.x + halfWidth, y: labelPoint.y + halfHeight }, { layerName: "OT_CONTEXT", colorNumber: 7 });
      addDxfLine(writer, { x: labelPoint.x + halfWidth, y: labelPoint.y + halfHeight }, { x: labelPoint.x - halfWidth, y: labelPoint.y + halfHeight }, { layerName: "OT_CONTEXT", colorNumber: 7 });
      addDxfLine(writer, { x: labelPoint.x - halfWidth, y: labelPoint.y + halfHeight }, { x: labelPoint.x - halfWidth, y: labelPoint.y - halfHeight }, { layerName: "OT_CONTEXT", colorNumber: 7 });
      addCenteredDxfText(writer, labelPoint.x, labelPoint.y - mm(0.7), textHeight, text, { layerName: "ANNOTATION", colorNumber: 7 });
    }
  });

  projectedParcels.slice(1).forEach((parcel) => {
    const pts = stripClosingPoint(parcel.rings[0]);
    if (pts.length < 2) return;
    const sheetPoints = pts.map(toSheet);
    sheetPoints.forEach((start, index) => {
      const end = sheetPoints[(index + 1) % sheetPoints.length];
      addMaskedSheetLine(start, end, {
        layerName: "PARCEL_ADJ",
        lineType: "PARCEL_DASH",
        lineTypeScale: mm(0.6),
        colorNumber: 8,
      });
    });
    const labelPoint = toSheet(centroidOfRing(parcel.rings[0] || []));
    if (labelPoint.x >= drawWin.x0 && labelPoint.x <= drawWin.x1 && labelPoint.y >= drawWin.y0 && labelPoint.y <= drawWin.y1 && !pointInRect(labelPoint, legendMaskRect)) {
      addCenteredDxfText(writer, labelPoint.x, labelPoint.y - mm(0.7), mm(1.2), parcel.kaek, {
        layerName: "ANNOTATION",
        colorNumber: 8,
      });
    }
  });

  const mainSheetPoints = mainParcelPoints.map(toSheet);
  mainSheetPoints.forEach((start, index) => {
    const end = mainSheetPoints[(index + 1) % mainSheetPoints.length];
    addMaskedSheetLine(start, end, { layerName: "PARCEL_MAIN", colorNumber: 7 });
  });
  const mainLabelPoint = toSheet(centroidOfRing(mainParcel.rings[0]));
  addCenteredDxfText(writer, mainLabelPoint.x, mainLabelPoint.y, mm(1.8), mainParcel.kaek, { layerName: "ANNOTATION" });

  const parcelSheetPoints = mainParcelPoints.map(toSheet);
  const parcelCenter = centroidOfRing(parcelSheetPoints);
  const parcelOrientation = signedArea(parcelSheetPoints) >= 0 ? 1 : -1;
  buildParcelEdgeLabels(mainParcelPoints).forEach((edge, index) => {
    const start = parcelSheetPoints[index];
    const end = parcelSheetPoints[(index + 1) % parcelSheetPoints.length];
    const vertex = start;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(Math.hypot(dx, dy), 1e-9);
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const normalA = { x: dy / length, y: -dx / length };
    const normalB = { x: -dy / length, y: dx / length };
    const toCenter = { x: parcelCenter.x - midpoint.x, y: parcelCenter.y - midpoint.y };
    const dotA = normalA.x * toCenter.x + normalA.y * toCenter.y;
    const dotB = normalB.x * toCenter.x + normalB.y * toCenter.y;
    const inward = dotA >= dotB ? normalA : normalB;
    const mid = { x: midpoint.x + inward.x * mm(4.2), y: midpoint.y + inward.y * mm(4.2) };
    const radialLength = Math.max(Math.hypot(vertex.x - parcelCenter.x, vertex.y - parcelCenter.y), 1e-9);
    const vertexLabelPoint = {
      x: vertex.x + ((vertex.x - parcelCenter.x) / radialLength) * mm(2.2),
      y: vertex.y + ((vertex.y - parcelCenter.y) / radialLength) * mm(2.2),
    };
    addDxfCircle(writer, vertex, mm(0.5), { layerName: "PARCEL_LABELS", colorNumber: 7 });
    addCenteredDxfText(writer, vertexLabelPoint.x, vertexLabelPoint.y, mm(1.45), edge.vertexLabel, { layerName: "PARCEL_LABELS", colorNumber: 7 });
    addCenteredDxfText(writer, mid.x, mid.y, mm(1.28), `${edge.edgeLabel}=${formatLengthMeters(edge.length)}`, {
      rotation: edgeAngleDegrees(start, end),
      layerName: "PARCEL_LABELS",
      colorNumber: 7,
    });
  });

  if (projectedOtRings[0]?.length) {
    const otCenter = toSheet(centroidOfRing(projectedOtRings[0]));
    const halfWidth = mm(11.5);
    const halfHeight = mm(4.8);
    addDxfLine(writer, { x: otCenter.x - halfWidth, y: otCenter.y - halfHeight }, { x: otCenter.x + halfWidth, y: otCenter.y - halfHeight }, { layerName: "OT_CONTEXT", colorNumber: 7 });
    addDxfLine(writer, { x: otCenter.x + halfWidth, y: otCenter.y - halfHeight }, { x: otCenter.x + halfWidth, y: otCenter.y + halfHeight }, { layerName: "OT_CONTEXT", colorNumber: 7 });
    addDxfLine(writer, { x: otCenter.x + halfWidth, y: otCenter.y + halfHeight }, { x: otCenter.x - halfWidth, y: otCenter.y + halfHeight }, { layerName: "OT_CONTEXT", colorNumber: 7 });
    addDxfLine(writer, { x: otCenter.x - halfWidth, y: otCenter.y + halfHeight }, { x: otCenter.x - halfWidth, y: otCenter.y - halfHeight }, { layerName: "OT_CONTEXT", colorNumber: 7 });
    addCenteredDxfText(writer, otCenter.x, otCenter.y - mm(0.9), mm(1.9), `Ο.Τ. ${meta?.ot || "-"}`, { layerName: "ANNOTATION", colorNumber: 7 });
  }

  const northX = drawWin.x0 + mm(16);
  const northY = drawWin.y1 - mm(18);
  addDxfLine(writer, { x: northX, y: northY - mm(10) }, { x: northX, y: northY + mm(2) }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX, y: northY + mm(2) }, { x: northX - mm(4), y: northY - mm(6) }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX, y: northY + mm(2) }, { x: northX + mm(4), y: northY - mm(6) }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX - mm(4), y: northY - mm(6) }, { x: northX + mm(4), y: northY - mm(6) }, { layerName: "ANNOTATION" });
  addCenteredDxfText(writer, northX, northY + mm(6), mm(3), "Β", { layerName: "ANNOTATION" });

  addDxfLine(writer, { x: legendX, y: legendY }, { x: legendX + legendWidth, y: legendY }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX + legendWidth, y: legendY }, { x: legendX + legendWidth, y: legendY + legendHeight }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX + legendWidth, y: legendY + legendHeight }, { x: legendX, y: legendY + legendHeight }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX, y: legendY + legendHeight }, { x: legendX, y: legendY }, { layerName: "ANNOTATION" });
  addDxfText(writer, legendX + mm(4), legendY + legendHeight - mm(5), mm(2), "ΥΠΟΜΝΗΜΑ", { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX + mm(4), y: legendY + legendHeight - mm(10) }, { x: legendX + mm(26), y: legendY + legendHeight - mm(10) }, { layerName: "OT_BOUNDARY", colorNumber: 3 });
  addDxfText(writer, legendX + mm(32), legendY + legendHeight - mm(11), mm(1.65), "ρυμοτομική γραμμή", { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX + mm(4), y: legendY + legendHeight - mm(16) }, { x: legendX + mm(26), y: legendY + legendHeight - mm(16) }, { layerName: "BUILDING_LINE", colorNumber: 1 });
  addDxfText(writer, legendX + mm(32), legendY + legendHeight - mm(17), mm(1.65), "οικοδομική γραμμή", { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX + mm(4), y: legendY + legendHeight - mm(22) }, { x: legendX + mm(26), y: legendY + legendHeight - mm(22) }, { layerName: "PARCEL_MAIN", colorNumber: 7 });
  addDxfText(writer, legendX + mm(32), legendY + legendHeight - mm(23), mm(1.65), "όριο οικοπέδου", { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX + mm(4), y: legendY + legendHeight - mm(28) }, { x: legendX + mm(26), y: legendY + legendHeight - mm(28) }, { layerName: "PARCEL_ADJ", lineType: "PARCEL_DASH", lineTypeScale: mm(0.6), colorNumber: 8 });
  addDxfText(writer, legendX + mm(32), legendY + legendHeight - mm(29), mm(1.65), "όρια όμορων οικοπέδων", { layerName: "ANNOTATION" });

  projectedOtRings.forEach((ring) => {
    const pts = stripClosingPoint(ring).map(toSheet);
    pts.forEach((start, index) => {
      const end = pts[(index + 1) % pts.length];
        addMaskedSheetLine(start, end, { layerName: "OT_CONTEXT", colorNumber: 7 });

    });
  });

  if (includeTitleBlock) {
    const x0 = drawWin.x1 + paperConfig.gutter;
    const x1 = paper.width - paperConfig.outerMargin;
    const y0 = paperConfig.outerMargin;
    const y1 = paper.height - paperConfig.outerMargin;
    const dateText = new Intl.DateTimeFormat("el-GR").format(new Date());
    const headerHeight = mm(12);
    const rowGap = mm(7);
    const labelX = x0 + mm(4);
    const valueX = x0 + mm(37);
    addDxfLine(writer, { x: x0, y: y0 }, { x: x1, y: y0 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x1, y: y0 }, { x: x1, y: y1 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x1, y: y1 }, { x: x0, y: y1 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x0, y: y1 }, { x: x0, y: y0 }, { layerName: "ANNOTATION" });
    addDxfText(writer, x0 + mm(4), y1 - mm(8), mm(3), "ΤΟΠΟΓΡΑΦΙΚΟ ΔΙΑΓΡΑΜΜΑ", { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x0, y: y1 - headerHeight }, { x: x1, y: y1 - headerHeight }, { layerName: "ANNOTATION" });

    const lines = [
      ["Μελετητής", "-"],
      ["Έργο", "Τοπογραφικό Διάγραμμα"],
      ["Θέση", `Ο.Τ. ${meta?.ot || "-"}, Δήμος ${meta?.municipality || "-"}`],
      ...(meta?.region ? [["Οδοί", meta.region]] as const : []),
      ["KAEK", meta?.kaek || "-"],
      ["Κλίμακα", `1:${scaleDenominator}`],
      ["Ημερομηνία", dateText],
      ["Σύστημα αναφοράς", "ΕΓΣΑ '87"],
    ];

    let y = y1 - headerHeight - mm(8);
    lines.forEach(([label, value]) => {
      addDxfText(writer, labelX, y, mm(2), label, { layerName: "ANNOTATION" });
      addDxfText(writer, valueX, y, mm(2), value, { layerName: "ANNOTATION" });
      y -= rowGap;
    });

    const tableInset = mm(2.2);
    const tableX0 = x0 + tableInset;
    const tableX1 = x1 - tableInset;
    const tableWidth = tableX1 - tableX0;
    const titleRowHeight = mm(5);
    const headerRowHeight = mm(4.3);
    const coordRowHeight = mm(4.15);
    const column1 = tableX0 + mm(12);
    const column2 = tableX0 + mm(52);
    const tableTop = y + mm(2);
    const tableBottom = tableTop - titleRowHeight - headerRowHeight - coordinateRows.length * coordRowHeight;

    addDxfLine(writer, { x: tableX0, y: tableTop }, { x: tableX1, y: tableTop }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: tableX1, y: tableTop }, { x: tableX1, y: tableBottom }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: tableX1, y: tableBottom }, { x: tableX0, y: tableBottom }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: tableX0, y: tableBottom }, { x: tableX0, y: tableTop }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: tableX0, y: tableTop - titleRowHeight }, { x: tableX1, y: tableTop - titleRowHeight }, { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, (tableX0 + tableX1) / 2, tableTop - mm(3.7), mm(1.85), coordinateTitle, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: tableX0, y: tableTop - titleRowHeight - headerRowHeight }, { x: tableX1, y: tableTop - titleRowHeight - headerRowHeight }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: column1, y: tableTop - titleRowHeight }, { x: column1, y: tableBottom }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: column2, y: tableTop - titleRowHeight }, { x: column2, y: tableBottom }, { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, tableX0 + (column1 - tableX0) / 2, tableTop - titleRowHeight - mm(2.9), mm(1.5), "Α/Α", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, column1 + (column2 - column1) / 2, tableTop - titleRowHeight - mm(2.9), mm(1.5), "X", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, column2 + (tableX1 - column2) / 2, tableTop - titleRowHeight - mm(2.9), mm(1.5), "Y", { layerName: "ANNOTATION" });

    let rowTop = tableTop - titleRowHeight - headerRowHeight;
    coordinateRows.forEach((row) => {
      const rowBottom = rowTop - coordRowHeight;
      addDxfLine(writer, { x: tableX0, y: rowBottom }, { x: tableX1, y: rowBottom }, { layerName: "ANNOTATION" });
      const rowCenterY = (rowTop + rowBottom) / 2 - mm(0.55);
      addCenteredDxfText(writer, tableX0 + (column1 - tableX0) / 2, rowCenterY, mm(1.45), row.label, { layerName: "ANNOTATION" });
      addCenteredDxfText(writer, column1 + (column2 - column1) / 2, rowCenterY, mm(1.45), row.x, { layerName: "ANNOTATION" });
      addCenteredDxfText(writer, column2 + (tableX1 - column2) / 2, rowCenterY, mm(1.45), row.y, { layerName: "ANNOTATION" });
      rowTop = rowBottom;
    });

    const areaBoxTop = tableBottom - mm(4.2);
    const areaBoxBottom = areaBoxTop - mm(6);
    addDxfLine(writer, { x: tableX0, y: areaBoxTop }, { x: tableX1, y: areaBoxTop }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: tableX1, y: areaBoxTop }, { x: tableX1, y: areaBoxBottom }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: tableX1, y: areaBoxBottom }, { x: tableX0, y: areaBoxBottom }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: tableX0, y: areaBoxBottom }, { x: tableX0, y: areaBoxTop }, { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, (tableX0 + tableX1) / 2, (areaBoxTop + areaBoxBottom) / 2 - mm(0.75), mm(1.9), `ΕΜΒΑΔΟΝ ΟΙΚΟΠΕΔΟΥ (${coordinateLoopLabel}): Ε=${formatAreaForPlan(meta?.area)}ΤΜ`, { layerName: "ANNOTATION" });
    y = areaBoxBottom - mm(4.5);

    const terms = meta?.buildingTerms;
    if (terms) {
      addDxfLine(writer, { x: x0, y: y + mm(1.5) }, { x: x1, y: y + mm(1.5) }, { layerName: "ANNOTATION" });
      addDxfText(writer, labelX, y - mm(2), mm(2), "Όροι Δόμησης", { layerName: "ANNOTATION" });
      y -= mm(8);

      const termRows = [
        ["Σ.Δ.", terms.sd || ""],
        ["Τομέας Σ.Δ.", terms.sdSector || ""],
        ["Κάλυψη", terms.coverage || ""],
        ["Μέγ. κάλυψη", terms.maxCoverageArea || ""],
        ["Μέγ. ύψος", terms.maxHeight || ""],
        ["Όροφοι", terms.floors || ""],
        ["Ελάχ. εμβαδό", terms.minArea || ""],
        ["Ελάχ. πρόσωπο", terms.minFrontage || ""],
        ["Αρτιότητα", terms.lotRuleType || ""],
        ["Οικ. σύστημα", terms.buildingSystem || ""],
      ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;

      termRows.forEach(([label, value]) => {
        addDxfText(writer, labelX, y, mm(1.48), label, { layerName: "ANNOTATION" });
        addDxfText(writer, valueX, y, mm(1.48), value, { layerName: "ANNOTATION" });
        y -= mm(4.1);
      });

      const sourceParts = [terms.sourceFek, terms.sourceDecisionNumber, terms.sourceDate].filter(Boolean).join(" | ");
      if (sourceParts) {
        y -= mm(0.8);
        wrapTextByWidth(`Πηγή: ${sourceParts}`, x1 - labelX - mm(4), mm(1.22)).forEach((line) => {
          addDxfText(writer, labelX, y, mm(1.22), line, { layerName: "ANNOTATION" });
          y -= mm(3.2);
        });
      }

      terms.notes.forEach((note) => {
        wrapTextByWidth(note, x1 - labelX - mm(4), mm(1.14)).forEach((line) => {
          if (y <= y0 + mm(3.2)) return;
          addDxfText(writer, labelX, y, mm(1.14), line, { layerName: "ANNOTATION" });
          y -= mm(2.9);
        });
      });
    }
  }

  return writer.stringify();
}
