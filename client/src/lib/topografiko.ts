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
  buildingSystem?: string;
  notes: string[];
  sourceFek?: string;
  sourceDecisionType?: string;
  sourceDecisionNumber?: string;
  sourceDate?: string;
  sourceTitle?: string;
};

export type TEECandidate = TEEData & { objectId?: string; containsCentroid?: boolean };

export type NeighborParcel = {
  kaek: string;
  mainUse: string;
  area: number | null;
  rings: Point[][];
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

export function pathFromRingWithBounds(points: Point[], bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
  const usable = stripClosingPoint(points);
  if (!usable.length) return "";
  return usable.map((point, index) => {
    const p = projectPoint(point, bounds);
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
  return (data?.features || []) as { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }[];
}

function readString(value: unknown) {
  return String(value ?? "").trim();
}

function readNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    buildingSystem: readString(systemAttrs?.OIK_SYSTHMA),
    notes: dedupedNotes,
    sourceFek: readString(densityAttrs?.FEK || coverageAttrs?.FEK || heightAttrs?.FEK || areaAttrs?.FEK || systemAttrs?.FEK),
    sourceDecisionType: readString(densityAttrs?.APOF_EIDOS || coverageAttrs?.APOF_EIDOS || heightAttrs?.APOF_EIDOS || areaAttrs?.APOF_EIDOS || systemAttrs?.APOF_EIDOS),
    sourceDecisionNumber: readString(densityAttrs?.NUMBER_ || coverageAttrs?.NUMBER_ || heightAttrs?.NUMBER_ || areaAttrs?.NUMBER_ || systemAttrs?.NUMBER_),
    sourceDate: readString(densityAttrs?.SIGN_DATE || coverageAttrs?.SIGN_DATE || heightAttrs?.SIGN_DATE || areaAttrs?.SIGN_DATE || systemAttrs?.SIGN_DATE),
    sourceTitle: readString(densityAttrs?.TITLE || coverageAttrs?.TITLE || heightAttrs?.TITLE || areaAttrs?.TITLE || systemAttrs?.TITLE),
  };

  const hasAnyValue = Boolean(
    result.sd || result.coverage || result.maxHeight || result.floors || result.minArea || result.minFrontage || result.buildingSystem || result.maxCoverageArea || result.sdSector || result.sdComment || result.notes.length,
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
  parcels: { kaek: string; rings: Point[][] }[],
  meta?: {
    kaek?: string;
    ot?: string;
    municipality?: string;
    region?: string;
    includeTitleBlock?: boolean;
    coords?: CoordinateRow[];
    paperSize?: "A4" | "A3" | "A1";
    scaleDenominator?: number;
    otRings?: Point[][];
    buildingTerms?: BuildingTermsData | null;
  },
) {
  const writer = new DxfWriter();
  writer.setUnits(Units.Millimeters);
  writer.setVariable("$DWGCODEPAGE", { 3: "ANSI_1253" });
  writer.addLType("PARCEL_DASH", "Parcel boundary dash", [8, -4]);
  writer.addLayer("OT_BOUNDARY", 3, "CONTINUOUS");
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
    rings: parcel.rings.map((ring) => ring.map((p) => {
      const [x, y] = transformToGGRS87(p.x, p.y);
      return { x, y };
    })),
  }));
  const projectedOtRings = (meta?.otRings || []).map((ring) => ring.map((p) => {
    const [x, y] = transformToGGRS87(p.x, p.y);
    return { x, y };
  }));

  const paperSize = meta?.paperSize || "A3";
  const scaleDenominator = meta?.scaleDenominator || 200;
  const paperConfig = paperSize === "A1"
    ? { width: 841, height: 594, outerMargin: 12, frameGap: 2.5, gutter: 10, titleBlockWidth: 184, textFactor: 1.65 }
    : paperSize === "A3"
      ? { width: 420, height: 297, outerMargin: 8, frameGap: 2, gutter: 6, titleBlockWidth: 112, textFactor: 1 }
      : { width: 297, height: 210, outerMargin: 6, frameGap: 1.5, gutter: 5, titleBlockWidth: 88, textFactor: 0.88 };
  const paper = { width: paperConfig.width, height: paperConfig.height };
  const mm = (value: number) => value * paperConfig.textFactor;
  const drawWin = {
    x0: paperConfig.outerMargin + mm(paperConfig.frameGap),
    y0: paperConfig.outerMargin + mm(paperConfig.frameGap),
    x1: paper.width - paperConfig.outerMargin - paperConfig.titleBlockWidth - paperConfig.gutter,
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
  const coordinateTitle = coordinateRows[0]?.label?.startsWith("T")
    ? "Συντεταγμένες κορυφών Ο.Τ. ΕΓΣΑ '87"
    : "Συντεταγμένες κορυφών οικοπέδου ΕΓΣΑ '87";

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
      addDxfLine(writer, { x: sx - crossHalf, y: sy }, { x: sx + crossHalf, y: sy }, { layerName: "COORD_GRID" });
      addDxfLine(writer, { x: sx, y: sy - crossHalf }, { x: sx, y: sy + crossHalf }, { layerName: "COORD_GRID" });
    }
  }

  for (let worldY = Math.ceil(visibleWorld.minY / worldGridStep) * worldGridStep; worldY <= visibleWorld.maxY + 0.001; worldY += worldGridStep) {
    const sy = windowCenterY + (worldY - fitCenterY) * scale;
    addDxfLine(writer, { x: drawWin.x0, y: sy }, { x: drawWin.x0 - mm(1.8), y: sy }, { layerName: "COORD_GRID" });
    addDxfLine(writer, { x: drawWin.x1, y: sy }, { x: drawWin.x1 + mm(1.8), y: sy }, { layerName: "COORD_GRID" });
    addDxfText(writer, drawWin.x0 - mm(9.4), sy - mm(0.55), gridLabelHeight, String(Math.round(worldY)), { layerName: "ANNOTATION" });
  }

  projectedParcels.slice(1).forEach((parcel) => {
    const pts = stripClosingPoint(parcel.rings[0]);
    if (pts.length < 2) return;
    const sheetPoints = pts.map(toSheet);
    sheetPoints.forEach((start, index) => {
      const end = sheetPoints[(index + 1) % sheetPoints.length];
      addDxfLine(writer, start, end, { layerName: "PARCEL_ADJ", lineType: "PARCEL_DASH", lineTypeScale: mm(0.6), colorNumber: 8 });
    });
    const labelPoint = toSheet(centroidOfRing(parcel.rings[0]));
    addCenteredDxfText(writer, labelPoint.x, labelPoint.y, mm(1.6), parcel.kaek, { layerName: "ANNOTATION" });
  });

  const mainSheetPoints = mainParcelPoints.map(toSheet);
  mainSheetPoints.forEach((start, index) => {
    const end = mainSheetPoints[(index + 1) % mainSheetPoints.length];
    addDxfLine(writer, start, end, { layerName: "PARCEL_MAIN", colorNumber: 7 });
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
    const outwardX = (dy / length) * parcelOrientation;
    const outwardY = (-dx / length) * parcelOrientation;
    const mid = { x: (start.x + end.x) / 2 - outwardX * mm(3.2), y: (start.y + end.y) / 2 - outwardY * mm(3.2) };
    const radialLength = Math.max(Math.hypot(vertex.x - parcelCenter.x, vertex.y - parcelCenter.y), 1e-9);
    const vertexLabelPoint = {
      x: vertex.x + ((vertex.x - parcelCenter.x) / radialLength) * mm(2.8),
      y: vertex.y + ((vertex.y - parcelCenter.y) / radialLength) * mm(2.8),
    };
    addDxfCircle(writer, vertex, mm(0.5), { layerName: "PARCEL_LABELS", colorNumber: 7 });
    addCenteredDxfText(writer, vertexLabelPoint.x, vertexLabelPoint.y, mm(1.45), edge.vertexLabel, { layerName: "PARCEL_LABELS", colorNumber: 7 });
    addCenteredDxfText(writer, mid.x, mid.y, mm(1.4), `${edge.edgeLabel}=${formatLengthMeters(edge.length)}`, {
      rotation: edgeAngleDegrees(start, end),
      layerName: "PARCEL_LABELS",
      colorNumber: 7,
    });
  });

  if (projectedOtRings[0]?.length) {
    const otCenter = toSheet(centroidOfRing(projectedOtRings[0]));
    const halfWidth = mm(8.5);
    const halfHeight = mm(4.8);
    addDxfLine(writer, { x: otCenter.x - halfWidth, y: otCenter.y - halfHeight }, { x: otCenter.x + halfWidth, y: otCenter.y - halfHeight }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: otCenter.x + halfWidth, y: otCenter.y - halfHeight }, { x: otCenter.x + halfWidth, y: otCenter.y + halfHeight }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: otCenter.x + halfWidth, y: otCenter.y + halfHeight }, { x: otCenter.x - halfWidth, y: otCenter.y + halfHeight }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: otCenter.x - halfWidth, y: otCenter.y + halfHeight }, { x: otCenter.x - halfWidth, y: otCenter.y - halfHeight }, { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, otCenter.x, otCenter.y + mm(0.8), mm(1.9), "Ο.Τ.", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, otCenter.x, otCenter.y - mm(2.3), mm(1.9), meta?.ot || "-", { layerName: "ANNOTATION" });
  }

  const northX = drawWin.x0 + mm(16);
  const northY = drawWin.y1 - mm(18);
  addDxfLine(writer, { x: northX, y: northY - mm(10) }, { x: northX, y: northY + mm(2) }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX, y: northY + mm(2) }, { x: northX - mm(4), y: northY - mm(6) }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX, y: northY + mm(2) }, { x: northX + mm(4), y: northY - mm(6) }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX - mm(4), y: northY - mm(6) }, { x: northX + mm(4), y: northY - mm(6) }, { layerName: "ANNOTATION" });
  addCenteredDxfText(writer, northX, northY + mm(6), mm(3), "Β", { layerName: "ANNOTATION" });

  const legendWidth = mm(82);
  const legendHeight = mm(31);
  const legendX = drawWin.x1 - legendWidth - mm(1.5);
  const legendY = drawWin.y0 + mm(1.5);
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
  addDxfText(writer, legendX + mm(32), legendY + legendHeight - mm(29), mm(1.65), "όριο οικοπέδων", { layerName: "ANNOTATION" });

  projectedOtRings.forEach((ring) => {
    const pts = stripClosingPoint(ring).map(toSheet);
    pts.forEach((start, index) => {
      const end = pts[(index + 1) % pts.length];
      addDxfLine(writer, start, end, { layerName: "OT_BOUNDARY", colorNumber: 3 });
    });
  });

  if (meta?.includeTitleBlock) {
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
      ["KAEK", meta?.kaek || "-"],
      ["Κλίμακα", `1:${scaleDenominator}`],
      ["Ημερομηνία", dateText],
      ["Σύστημα αναφοράς", "ΕΓΣΑ '87"],
    ] as const;

    let y = y1 - headerHeight - mm(8);
    lines.forEach(([label, value]) => {
      addDxfText(writer, labelX, y, mm(2), label, { layerName: "ANNOTATION" });
      addDxfText(writer, valueX, y, mm(2), value, { layerName: "ANNOTATION" });
      y -= rowGap;
    });

    addDxfLine(writer, { x: x0, y: y + mm(2) }, { x: x1, y: y + mm(2) }, { layerName: "ANNOTATION" });
    addDxfText(writer, labelX, y - mm(2), mm(2), coordinateTitle, { layerName: "ANNOTATION" });
    y -= mm(8);
    addDxfText(writer, labelX, y, mm(1.6), "Σημείο", { layerName: "ANNOTATION" });
    addDxfText(writer, x0 + mm(22), y, mm(1.6), "X", { layerName: "ANNOTATION" });
    addDxfText(writer, x0 + mm(64), y, mm(1.6), "Y", { layerName: "ANNOTATION" });
    y -= mm(4.5);

    coordinateRows.slice(0, paperSize === "A1" ? 28 : 20).forEach((row) => {
      addDxfText(writer, labelX, y, mm(1.45), row.label, { layerName: "ANNOTATION" });
      addDxfText(writer, x0 + mm(22), y, mm(1.45), row.x, { layerName: "ANNOTATION" });
      addDxfText(writer, x0 + mm(64), y, mm(1.45), row.y, { layerName: "ANNOTATION" });
      y -= mm(4.3);
    });

    const terms = meta?.buildingTerms;
    if (terms) {
      addDxfLine(writer, { x: x0, y: y + mm(1.5) }, { x: x1, y: y + mm(1.5) }, { layerName: "ANNOTATION" });
      addDxfText(writer, labelX, y - mm(2), mm(2), "Όροι Δόμησης", { layerName: "ANNOTATION" });
      y -= mm(8);

      const termRows = [
        ["Σ.Δ.", terms.sd || "-"],
        ["Τομέας Σ.Δ.", terms.sdSector || "-"],
        ["Κάλυψη", terms.coverage || "-"],
        ["Μέγ. κάλυψη", terms.maxCoverageArea || "-"],
        ["Μέγ. ύψος", terms.maxHeight || "-"],
        ["Όροφοι", terms.floors || "-"],
        ["Ελάχ. εμβαδό", terms.minArea || "-"],
        ["Ελάχ. πρόσωπο", terms.minFrontage || "-"],
        ["Οικ. σύστημα", terms.buildingSystem || "-"],
      ] as const;

      termRows.forEach(([label, value]) => {
        addDxfText(writer, labelX, y, mm(1.6), label, { layerName: "ANNOTATION" });
        addDxfText(writer, valueX, y, mm(1.6), value, { layerName: "ANNOTATION" });
        y -= mm(4.6);
      });

      const sourceParts = [terms.sourceFek, terms.sourceDecisionNumber, terms.sourceDate].filter(Boolean).join(" | ");
      if (sourceParts) {
        y -= mm(1);
        addDxfText(writer, labelX, y, mm(1.45), `Πηγή: ${sourceParts}`, { layerName: "ANNOTATION" });
        y -= mm(4.6);
      }

      terms.notes.slice(0, paperSize === "A1" ? 6 : 4).forEach((note) => {
        const trimmed = note.length > 72 ? `${note.slice(0, 69)}...` : note;
        addDxfText(writer, labelX, y, mm(1.35), trimmed, { layerName: "ANNOTATION" });
        y -= mm(4.1);
      });
    }
  }

  return writer.stringify();
}
