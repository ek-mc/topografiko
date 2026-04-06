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
  raw: Record<string, unknown>;
};

export type TEEData = {
  otNumber: string;
  fek: string;
  apofEidos: string;
  municipality: string;
  rings: Point[][];
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
    rings: feature.geometry.rings.map((ring: number[][]) => ring.map((point: number[]) => ({ x: point[0], y: point[1] }))),
    raw: feature.attributes || {},
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
    coords?: { i: number; x: string; y: string }[];
    paperSize?: "A4" | "A3" | "A1";
    scaleDenominator?: number;
    otRings?: Point[][];
  },
) {
  const writer = new DxfWriter();
  writer.setUnits(Units.Millimeters);
  writer.setVariable("$DWGCODEPAGE", { 3: "ANSI_1253" });
  writer.addLType("PARCEL_DASH", "Parcel boundary dash", [8, -4]);
  writer.addLayer("OT_BOUNDARY", 3, "CONTINUOUS");
  writer.addLayer("PARCEL_MAIN", 1, "CONTINUOUS");
  writer.addLayer("PARCEL_ADJ", 8, "PARCEL_DASH");
  writer.addLayer("COORD_GRID", 8, "CONTINUOUS");
  writer.addLayer("ANNOTATION", 7, "CONTINUOUS");

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
  const paper = paperSize === "A3" ? { width: 420, height: 297 } : paperSize === "A1" ? { width: 841, height: 594 } : { width: 297, height: 210 };
  const margin = 10;
  const titleBlockWidth = 112;
  const coordOffsetX = 18;
  const coordOffsetY = 18;
  const drawWin = {
    x0: margin + coordOffsetX,
    y0: margin + coordOffsetY,
    x1: paper.width - titleBlockWidth - margin,
    y1: paper.height - margin,
  };

  const mainParcel = projectedParcels[0];
  const mainParcelPoints = stripClosingPoint(mainParcel.rings[0]);
  if (!mainParcelPoints.length) return writer.stringify();

  const mainBounds = boundsFromPoints(mainParcelPoints);
  const centerX = (mainBounds.minX + mainBounds.maxX) / 2;
  const centerY = (mainBounds.minY + mainBounds.maxY) / 2;
  const displayPoints = [
    ...projectedParcels.flatMap((parcel) => parcel.rings.flatMap((ring) => stripClosingPoint(ring))),
    ...projectedOtRings.flatMap((ring) => stripClosingPoint(ring)),
  ];
  const displayBounds = boundsFromPoints(displayPoints.length ? displayPoints : mainParcelPoints);
  const worldSpanX = Math.max(displayBounds.maxX - displayBounds.minX, mainBounds.maxX - mainBounds.minX, 1);
  const worldSpanY = Math.max(displayBounds.maxY - displayBounds.minY, mainBounds.maxY - mainBounds.minY, 1);
  const winWidth = drawWin.x1 - drawWin.x0;
  const winHeight = drawWin.y1 - drawWin.y0;
  const requestedScale = 1000 / scaleDenominator;
  const fitScale = Math.min((winWidth * 0.9) / worldSpanX, (winHeight * 0.82) / worldSpanY);
  const scale = Math.min(requestedScale, fitScale);
  const windowCenterX = (drawWin.x0 + drawWin.x1) / 2;
  const windowCenterY = (drawWin.y0 + drawWin.y1) / 2;
  const toSheet = (p: Point) => ({
    x: windowCenterX + (p.x - centerX) * scale,
    y: windowCenterY + (p.y - centerY) * scale,
  });
  const visibleWorld = {
    minX: centerX - (windowCenterX - drawWin.x0) / scale,
    maxX: centerX + (drawWin.x1 - windowCenterX) / scale,
    minY: centerY - (windowCenterY - drawWin.y0) / scale,
    maxY: centerY + (drawWin.y1 - windowCenterY) / scale,
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
  const crossHalf = 2.4;
  for (let worldX = Math.ceil(visibleWorld.minX / worldGridStep) * worldGridStep; worldX <= visibleWorld.maxX + 0.001; worldX += worldGridStep) {
    const sx = windowCenterX + (worldX - centerX) * scale;
    addDxfLine(writer, { x: sx, y: drawWin.y0 }, { x: sx, y: drawWin.y0 - 3 }, { layerName: "COORD_GRID" });
    addDxfLine(writer, { x: sx, y: drawWin.y1 }, { x: sx, y: drawWin.y1 + 3 }, { layerName: "COORD_GRID" });
    addDxfText(writer, sx - 1.5, drawWin.y0 - 6.5, 1.5, String(Math.round(worldX)), { rotation: 90, layerName: "ANNOTATION" });
    for (let worldY = Math.ceil(visibleWorld.minY / worldGridStep) * worldGridStep; worldY <= visibleWorld.maxY + 0.001; worldY += worldGridStep) {
      const sy = windowCenterY + (worldY - centerY) * scale;
      addDxfLine(writer, { x: sx - crossHalf, y: sy }, { x: sx + crossHalf, y: sy }, { layerName: "COORD_GRID" });
      addDxfLine(writer, { x: sx, y: sy - crossHalf }, { x: sx, y: sy + crossHalf }, { layerName: "COORD_GRID" });
    }
  }

  for (let worldY = Math.ceil(visibleWorld.minY / worldGridStep) * worldGridStep; worldY <= visibleWorld.maxY + 0.001; worldY += worldGridStep) {
    const sy = windowCenterY + (worldY - centerY) * scale;
    addDxfLine(writer, { x: drawWin.x0, y: sy }, { x: drawWin.x0 - 3, y: sy }, { layerName: "COORD_GRID" });
    addDxfLine(writer, { x: drawWin.x1, y: sy }, { x: drawWin.x1 + 3, y: sy }, { layerName: "COORD_GRID" });
    addDxfText(writer, drawWin.x0 - 13, sy - 0.8, 1.5, String(Math.round(worldY)), { layerName: "ANNOTATION" });
  }

  projectedOtRings.forEach((ring) => {
    const pts = stripClosingPoint(ring).map(toSheet);
    pts.forEach((start, index) => {
      const end = pts[(index + 1) % pts.length];
      addDxfLine(writer, start, end, { layerName: "OT_BOUNDARY", colorNumber: 3 });
    });
  });

  projectedParcels.slice(1).forEach((parcel) => {
    const pts = stripClosingPoint(parcel.rings[0]);
    if (pts.length < 2) return;
    const sheetPoints = pts.map(toSheet);
    sheetPoints.forEach((start, index) => {
      const end = sheetPoints[(index + 1) % sheetPoints.length];
      addDxfLine(writer, start, end, { layerName: "PARCEL_ADJ", lineType: "PARCEL_DASH", lineTypeScale: 0.6, colorNumber: 8 });
    });
    const labelPoint = toSheet(centroidOfRing(parcel.rings[0]));
    addDxfText(writer, labelPoint.x - 8, labelPoint.y, 1.6, parcel.kaek, { layerName: "ANNOTATION" });
  });

  const mainSheetPoints = mainParcelPoints.map(toSheet);
  mainSheetPoints.forEach((start, index) => {
    const end = mainSheetPoints[(index + 1) % mainSheetPoints.length];
    addDxfLine(writer, start, end, { layerName: "PARCEL_MAIN", colorNumber: 1 });
  });
  const mainLabelPoint = toSheet(centroidOfRing(mainParcel.rings[0]));
  addDxfText(writer, mainLabelPoint.x - 8, mainLabelPoint.y, 1.8, mainParcel.kaek, { layerName: "ANNOTATION" });

  if (projectedOtRings[0]?.length) {
    const otCircleCenter = toSheet(centroidOfRing(projectedOtRings[0]));
    addDxfCircle(writer, otCircleCenter, 6, { layerName: "ANNOTATION" });
    addDxfText(writer, otCircleCenter.x - 3.2, otCircleCenter.y + 1.2, 1.5, "Ο.Τ.", { layerName: "ANNOTATION" });
    addDxfText(writer, otCircleCenter.x - 4.2, otCircleCenter.y - 2.8, 1.5, meta?.ot || "-", { layerName: "ANNOTATION" });
  }

  const northX = drawWin.x0 + 16;
  const northY = drawWin.y1 - 20;
  addDxfLine(writer, { x: northX, y: northY - 10 }, { x: northX, y: northY + 2 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX, y: northY + 2 }, { x: northX - 4, y: northY - 6 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX, y: northY + 2 }, { x: northX + 4, y: northY - 6 }, { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: northX - 4, y: northY - 6 }, { x: northX + 4, y: northY - 6 }, { layerName: "ANNOTATION" });
  addDxfText(writer, northX - 2.2, northY + 6, 3, "Β", { layerName: "ANNOTATION" });

  const legendX = drawWin.x1 - 72;
  const legendY = drawWin.y0 + 14;
  addDxfText(writer, legendX, legendY + 14, 2, "ΥΠΟΜΝΗΜΑ", { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX, y: legendY + 8 }, { x: legendX + 22, y: legendY + 8 }, { layerName: "OT_BOUNDARY", colorNumber: 3 });
  addDxfText(writer, legendX + 28, legendY + 7, 1.8, "ρυμοτομική γραμμή", { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX, y: legendY + 2 }, { x: legendX + 22, y: legendY + 2 }, { layerName: "PARCEL_MAIN", colorNumber: 1 });
  addDxfText(writer, legendX + 28, legendY + 1, 1.8, "οικοδομική γραμμή", { layerName: "ANNOTATION" });
  addDxfLine(writer, { x: legendX, y: legendY - 4 }, { x: legendX + 22, y: legendY - 4 }, { layerName: "PARCEL_ADJ", lineType: "PARCEL_DASH", lineTypeScale: 0.6, colorNumber: 8 });
  addDxfText(writer, legendX + 28, legendY - 5, 1.8, "όριο οικοπέδων", { layerName: "ANNOTATION" });

  if (meta?.includeTitleBlock) {
    const x0 = drawWin.x1 + 6;
    const x1 = paper.width - 6;
    const y0 = 6;
    const y1 = paper.height - 6;
    const dateText = new Intl.DateTimeFormat("el-GR").format(new Date());
    addDxfLine(writer, { x: x0, y: y0 }, { x: x1, y: y0 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x1, y: y0 }, { x: x1, y: y1 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x1, y: y1 }, { x: x0, y: y1 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x0, y: y1 }, { x: x0, y: y0 }, { layerName: "ANNOTATION" });
    addDxfText(writer, x0 + 4, y1 - 8, 3, "ΤΟΠΟΓΡΑΦΙΚΟ ΔΙΑΓΡΑΜΜΑ", { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x0, y: y1 - 12 }, { x: x1, y: y1 - 12 }, { layerName: "ANNOTATION" });

    const lines = [
      ["Μελετητής", "-"],
      ["Έργο", "Τοπογραφικό Διάγραμμα"],
      ["Θέση", `Ο.Τ. ${meta.ot || "-"}, Δήμος ${meta.municipality || "-"}`],
      ["KAEK", meta.kaek || "-"],
      ["Κλίμακα", `1:${scaleDenominator}`],
      ["Ημερομηνία", dateText],
      ["Σύστημα αναφοράς", "ΕΓΣΑ '87"],
    ] as const;

    let y = y1 - 20;
    lines.forEach(([label, value]) => {
      addDxfText(writer, x0 + 4, y, 2, label, { layerName: "ANNOTATION" });
      addDxfText(writer, x0 + 37, y, 2, value, { layerName: "ANNOTATION" });
      y -= 7;
    });

    addDxfLine(writer, { x: x0, y: y + 2 }, { x: x1, y: y + 2 }, { layerName: "ANNOTATION" });
    addDxfText(writer, x0 + 4, y - 2, 2, "Συντεταγμένες κορυφών ΕΓΣΑ '87", { layerName: "ANNOTATION" });
    y -= 8;
    addDxfText(writer, x0 + 4, y, 1.6, "#", { layerName: "ANNOTATION" });
    addDxfText(writer, x0 + 12, y, 1.6, "X", { layerName: "ANNOTATION" });
    addDxfText(writer, x0 + 56, y, 1.6, "Y", { layerName: "ANNOTATION" });
    y -= 4.5;

    (meta.coords || []).slice(0, 20).forEach((row) => {
      addDxfText(writer, x0 + 4, y, 1.45, `${row.i}`, { layerName: "ANNOTATION" });
      addDxfText(writer, x0 + 12, y, 1.45, row.x, { layerName: "ANNOTATION" });
      addDxfText(writer, x0 + 56, y, 1.45, row.y, { layerName: "ANNOTATION" });
      y -= 4.3;
    });
  }

  return writer.stringify();
}
