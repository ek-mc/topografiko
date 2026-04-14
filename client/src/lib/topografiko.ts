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

export type PlanningLinesData = {
  urbanLines: Point[][]; // layer 11: Ρυμοτομική γραμμή
  buildingLines: Point[][]; // layer 12: Οικοδομική γραμμή
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
  lotRuleDescription?: string;
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

export type NearbyPlanningAnnotation = {
  kind: "pedestrian-road" | "public-use";
  label: string;
  point: Point;
  rotationDegrees?: number;
  footprint?: Point[];
  sourceFek?: string;
  relation?: "intersects" | "nearby";
  distanceToParcel?: number;
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

function distancePointToRingBoundary(point: Point, ring: Point[]) {
  const usable = stripClosingPoint(ring);
  if (!usable.length) return Number.POSITIVE_INFINITY;
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

function pointInAnyRing(point: Point, rings: Point[][]) {
  return rings.some((ring) => pointInRing(point, ring));
}

export function findBestOtLabelPoint(sourceRing: Point[], avoidRings: Point[][] = []) {
  const ringWorld = stripClosingPoint(sourceRing);
  if (ringWorld.length < 3) return null;

  const usableAvoidRings = avoidRings
    .map((ring) => stripClosingPoint(ring))
    .filter((ring) => ring.length >= 3);
  const worldBounds = boundsFromPoints(ringWorld);
  const worldCenter = centroidOfRing(ringWorld);
  const candidates: Point[] = [];
  const seen = new Set<string>();
  const addCandidate = (point: Point | null) => {
    if (!point) return;
    if (!pointInRing(point, ringWorld) || pointInAnyRing(point, usableAvoidRings)) return;
    const key = `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(point);
  };

  addCandidate(worldCenter);
  const gridSteps = 12;
  for (let ix = 0; ix <= gridSteps; ix += 1) {
    for (let iy = 0; iy <= gridSteps; iy += 1) {
      addCandidate({
        x: worldBounds.minX + ((worldBounds.maxX - worldBounds.minX) * ix) / gridSteps,
        y: worldBounds.minY + ((worldBounds.maxY - worldBounds.minY) * iy) / gridSteps,
      });
    }
  }

  let best: Point | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  candidates.forEach((candidate) => {
    const sourceClearance = distancePointToRingBoundary(candidate, ringWorld);
    const avoidClearance = usableAvoidRings.length
      ? usableAvoidRings.reduce((minDistance, ring) => Math.min(minDistance, distancePointToRingBoundary(candidate, ring)), Number.POSITIVE_INFINITY)
      : sourceClearance;
    const centerPenalty = Math.sqrt(distanceSquared(candidate, worldCenter)) * 0.12;
    const score = sourceClearance * 1.15 + avoidClearance * 1.6 - centerPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });

  return best;
}

function moveLinearPlacementInsideRing(point: Point, rotationDegrees: number, ring: Point[], target: Point) {
  const usable = stripClosingPoint(ring);
  if (usable.length < 3) return point;

  const radians = (rotationDegrees * Math.PI) / 180;
  const tangent = { x: Math.cos(radians), y: Math.sin(radians) };
  const normalA = { x: -tangent.y, y: tangent.x };
  const normalB = { x: tangent.y, y: -tangent.x };
  const centroid = centroidOfRing(usable);
  const directionHint = { x: (target.x + centroid.x) / 2 - point.x, y: (target.y + centroid.y) / 2 - point.y };
  const probeDistances = [2, 1, 0.5];
  let preferredNormals = [normalA, normalB];

  for (const probe of probeDistances) {
    const probeA = { x: point.x + normalA.x * probe, y: point.y + normalA.y * probe };
    const probeB = { x: point.x + normalB.x * probe, y: point.y + normalB.y * probe };
    const insideA = pointInRing(probeA, usable);
    const insideB = pointInRing(probeB, usable);
    if (insideA && !insideB) {
      preferredNormals = [normalA, normalB];
      break;
    }
    if (insideB && !insideA) {
      preferredNormals = [normalB, normalA];
      break;
    }
  }

  if (preferredNormals[0] === normalA && preferredNormals[1] === normalB) {
    const dotA = normalA.x * directionHint.x + normalA.y * directionHint.y;
    const dotB = normalB.x * directionHint.x + normalB.y * directionHint.y;
    preferredNormals = dotA >= dotB ? [normalA, normalB] : [normalB, normalA];
  }

  const offsets = [4, 2, 1, 0.5, 0.25];
  for (const offset of offsets) {
    for (const normal of preferredNormals) {
      const candidate = { x: point.x + normal.x * offset, y: point.y + normal.y * offset };
      if (pointInRing(candidate, usable)) return candidate;
    }
  }

  return point;
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

function cleanNearbyPlanningLabel(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const upper = normalized.toUpperCase();
  if (!normalized) return "";
  if (/^Κ\.?\s*Π\.?$/.test(upper)) return "Κ.Π.";
  if (upper.includes("ΠΕΖΟΔΡΟΜ")) return "ΠΕΖΟΔΡΟΜΟΣ";
  if (upper.includes("ΣΧΟΛΕΙ")) return "ΧΩΡΟΣ ΣΧΟΛΕΙΟΥ";
  if (upper.includes("ΑΘΛΗΤΙΚ")) return "ΑΘΛΗΤΙΚΕΣ ΕΓΚΑΤΑΣΤΑΣΕΙΣ";
  if (upper.includes("ΠΑΡΚ") || upper.includes("ΠΡΑΣΙΝ")) return "ΧΩΡΟΣ ΠΡΑΣΙΝΟΥ";
  return normalized.length > 42 ? `${normalized.slice(0, 39).trimEnd()}…` : normalized;
}

function pointInBounds(point: Point, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

async function queryArcGisLayerByGeometry(layerId: number, ringsGgrs87: Point[][], distance = 220) {
  const geometry = {
    rings: ringsGgrs87.map((ring) => stripClosingPoint(ring).map((point) => [point.x, point.y])),
    spatialReference: { wkid: 2100 },
  };
  const params = new URLSearchParams({
    f: "json",
    geometry: JSON.stringify(geometry),
    geometryType: "esriGeometryPolygon",
    inSR: "2100",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "2100",
    distance: String(distance),
    units: "esriSRUnit_Meter",
  });
  const response = await fetch(`https://sdigmap.tee.gov.gr/mapping/rest/services/UDM/UDM_SERVICE_POLEODOMIKI_PLIROFORIA/MapServer/${layerId}/query?${params.toString()}`);
  if (!response.ok) throw new Error(`Layer ${layerId} query failed with status ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.features) ? payload.features : [];
}

async function queryArcGisLayerByBounds(layerId: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const geometry = {
    xmin: bounds.minX,
    ymin: bounds.minY,
    xmax: bounds.maxX,
    ymax: bounds.maxY,
    spatialReference: { wkid: 2100 },
  };
  const params = new URLSearchParams({
    f: "json",
    geometry: JSON.stringify(geometry),
    geometryType: "esriGeometryEnvelope",
    inSR: "2100",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "2100",
  });
  const response = await fetch(`https://sdigmap.tee.gov.gr/mapping/rest/services/UDM/UDM_SERVICE_POLEODOMIKI_PLIROFORIA/MapServer/${layerId}/query?${params.toString()}`);
  if (!response.ok) throw new Error(`Layer ${layerId} bounds query failed with status ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.features) ? payload.features : [];
}

function closestPointToTarget(points: Point[], target: Point) {
  return points.reduce((best, point) => {
    const distance = distanceSquared(point, target);
    return !best || distance < best.distance ? { point, distance } : best;
  }, null as { point: Point; distance: number } | null)?.point ?? null;
}

function selectNearbyAnnotationPoint(points: Point[], bounds: { minX: number; minY: number; maxX: number; maxY: number }, target: Point) {
  const usable = stripClosingPoint(points);
  if (!usable.length) return null;
  const visible = usable.filter((point) => pointInBounds(point, bounds));
  if (visible.length >= 2) return centroidOfRing(visible);
  if (visible.length === 1) return visible[0];
  return closestPointToTarget(usable, target);
}

function geometryPathsFromFeature(feature: TEERawFeature) {
  const ringPaths = (feature.geometry?.rings || []).map((ring) => ring.map((point) => ({ x: Number(point[0]), y: Number(point[1]) })));
  const linePaths = (feature.geometry?.paths || []).map((path) => path.map((point) => ({ x: Number(point[0]), y: Number(point[1]) })));
  return [...ringPaths, ...linePaths].filter((path) => path.length >= 2);
}

function segmentMidpoint(start: Point, end: Point) {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function selectLinearAnnotationPlacement(
  paths: Point[][],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  target: Point,
): { point: Point; rotationDegrees: number; score: number } | null {
  let best: { point: Point; rotationDegrees: number; score: number } | null = null;
  paths.forEach((path) => {
    const usable = stripClosingPoint(path);
    for (let index = 0; index < usable.length - 1; index += 1) {
      const start = usable[index];
      const end = usable[index + 1];
      const midpoint = segmentMidpoint(start, end);
      if (!pointInBounds(midpoint, bounds)) continue;
      const length = segmentLength(start, end);
      if (length <= 1e-6) continue;
      const score = length - Math.sqrt(distanceSquared(midpoint, target)) * 0.12;
      if (!best || score > best.score) {
        best = {
          point: midpoint,
          rotationDegrees: edgeAngleDegrees(start, end),
          score,
        };
      }
    }
  });
  return best;
}

export async function fetchNearbyPlanningAnnotations(ringsGgrs87: Point[][]): Promise<NearbyPlanningAnnotation[]> {
  const usableRings = ringsGgrs87.map((ring) => stripClosingPoint(ring)).filter((ring) => ring.length >= 3);
  if (!usableRings.length) return [];

  const bounds = boundsFromPoints(usableRings.flat());
  const expandedBounds = {
    minX: bounds.minX - 260,
    minY: bounds.minY - 260,
    maxX: bounds.maxX + 260,
    maxY: bounds.maxY + 260,
  };

  try {
    const parcelCenter = centroidOfRing(usableRings[0]);
    const [pedestrianFeatures, publicUseFeatures] = await Promise.all([
      queryArcGisLayerByBounds(8, expandedBounds).catch(() => []),
      queryArcGisLayerByBounds(22, expandedBounds).catch(() => []),
    ]);

    const seen = new Set<string>();
    const annotations: NearbyPlanningAnnotation[] = [];

    pedestrianFeatures.forEach((feature: TEERawFeature) => {
      const attrs = feature?.attributes || {};
      const paths = geometryPathsFromFeature(feature);
      const points = paths.flatMap((path) => stripClosingPoint(path));
      const ringGeometries = (feature.geometry?.rings || [])
        .map((ring) => ring.map((point) => ({ x: Number(point[0]), y: Number(point[1]) })))
        .map((ring) => stripClosingPoint(ring))
        .filter((ring) => ring.length >= 3);
      const roadFootprint = ringGeometries[0];
      const linearPlacement = selectLinearAnnotationPlacement(paths, expandedBounds, parcelCenter);
      let center = linearPlacement?.point || selectNearbyAnnotationPoint(points, expandedBounds, parcelCenter);
      if (center && linearPlacement && roadFootprint?.length) {
        center = moveLinearPlacementInsideRing(center, linearPlacement.rotationDegrees, roadFootprint, parcelCenter);
      }
      const label = cleanNearbyPlanningLabel(readString(attrs.PZ_XRHSH) || readString(attrs.TITLE) || "ΠΕΖΟΔΡΟΜΟΣ");
      if (!center || !label) return;
      const distanceToParcel = distancePointToRings(center, usableRings);
      if (distanceToParcel > 180) return;
      const key = `pedestrian-road::${Math.round(center.x)}::${Math.round(center.y)}::${label}`;
      if (seen.has(key)) return;
      seen.add(key);
      annotations.push({
        kind: "pedestrian-road",
        label,
        point: center,
        rotationDegrees: linearPlacement?.rotationDegrees,
        footprint: roadFootprint,
        sourceFek: readString(attrs.FEK),
        relation: distanceToParcel <= 25 ? "intersects" : "nearby",
        distanceToParcel,
      });
    });

    publicUseFeatures.forEach((feature: TEERawFeature) => {
      const attrs = feature?.attributes || {};
      const ring = Array.isArray(feature?.geometry?.rings?.[0])
        ? feature.geometry.rings[0].map((point: number[]) => ({ x: Number(point[0]), y: Number(point[1]) }))
        : [];
      const usable = stripClosingPoint(ring);
      const center = selectNearbyAnnotationPoint(usable, expandedBounds, parcelCenter);
      const label = cleanNearbyPlanningLabel(readString(attrs.EID_XRHSH_TXT) || readString(attrs.TITLE));
      if (!center || !label) return;
      const distanceToParcel = distancePointToRings(center, usableRings);
      if (distanceToParcel > 220) return;
      const key = `public-use::${Math.round(center.x)}::${Math.round(center.y)}::${label}`;
      if (seen.has(key)) return;
      seen.add(key);
      annotations.push({
        kind: "public-use",
        label,
        point: center,
        footprint: usable,
        sourceFek: readString(attrs.FEK),
        relation: distanceToParcel <= 25 ? "intersects" : "nearby",
        distanceToParcel,
      });
    });

    return annotations
      .sort((a, b) => {
        const kindPriority = (a.kind === "pedestrian-road" ? 0 : 1) - (b.kind === "pedestrian-road" ? 0 : 1);
        if (kindPriority !== 0) return kindPriority;
        const distancePriority = (a.distanceToParcel ?? Number.POSITIVE_INFINITY) - (b.distanceToParcel ?? Number.POSITIVE_INFINITY);
        if (Math.abs(distancePriority) > 1e-9) return distancePriority;
        return a.label.localeCompare(b.label, "el");
      })
      .slice(0, 8);
  } catch (error) {
    console.warn("Nearby planning annotation lookup failed; continuing without nearby labels.", error);
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

function formatLotRuleDescription(lotRuleType: string, datePareklisis: string) {
  const rawType = readString(lotRuleType).toUpperCase();
  const date = readString(datePareklisis);
  if (!rawType) return "";
  if (rawType.includes("ΚΑΤΑ ΚΑΝΟΝΑ")) return "Άρτιο κατά κανόνα";
  if (rawType.includes("ΚΑΤΑ ΠΑΡΕΚΚΛΙΣΗ")) {
    return date ? `Άρτιο κατά παρέκκλιση (προ της ${date})` : "Άρτιο κατά παρέκκλιση";
  }
  if (rawType === "ΟΧΙ" || rawType.includes("ΜΗ ΑΡΤΙ")) return "Μη άρτιο";
  return readString(lotRuleType);
}

function isIgnorableBuildingTermsNote(value: string) {
  const normalized = readString(value).toUpperCase();
  return !normalized || normalized === "ΟΧΙ" || normalized === "ΚΑΤΑ ΚΑΝΟΝΑ" || normalized === "ΚΑΤΑ ΠΑΡΕΚΚΛΙΣΗ";
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

  const lotRuleType = readString(areaAttrs?.OROS_TYPE);
  const lotRuleDescription = formatLotRuleDescription(lotRuleType, readString(areaAttrs?.DATE_PAREKLISIS));
  const notes = [
    readString(heightAttrs?.SYNTHIKI_TXT),
    readString(heightAttrs?.OROR_MAX_HEIGHT_COMMENT),
    readString(heightAttrs?.OROR_NUM_OROFON_COMMENT),
    readString(areaAttrs?.SYNTHIKI_TXT),
    readString(areaAttrs?.REMARKS),
    readString(coverageAttrs?.SYNTHIKI_TXT),
    readString(coverageAttrs?.REMARKS),
    readString(systemAttrs?.SYNTHIKI_TXT),
    readString(systemAttrs?.OROIKS_COMMENT),
    readString(densityAttrs?.SD_KLIMAKOTOS),
    readString(densityAttrs?.SD_COMMENT),
  ].filter((note) => !isIgnorableBuildingTermsNote(note));

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
    lotRuleType,
    lotRuleDescription,
    buildingSystem: readString(systemAttrs?.OIK_SYSTHMA),
    notes: dedupedNotes,
    sourceFek: readString(densityAttrs?.FEK || coverageAttrs?.FEK || heightAttrs?.FEK || areaAttrs?.FEK || systemAttrs?.FEK),
    sourceDecisionType: readString(densityAttrs?.APOF_EIDOS || coverageAttrs?.APOF_EIDOS || heightAttrs?.APOF_EIDOS || areaAttrs?.APOF_EIDOS || systemAttrs?.APOF_EIDOS),
    sourceDecisionNumber: readString(densityAttrs?.NUMBER_ || coverageAttrs?.NUMBER_ || heightAttrs?.NUMBER_ || areaAttrs?.NUMBER_ || systemAttrs?.NUMBER_),
    sourceDate: readString(densityAttrs?.SIGN_DATE || coverageAttrs?.SIGN_DATE || heightAttrs?.SIGN_DATE || areaAttrs?.SIGN_DATE || systemAttrs?.SIGN_DATE),
    sourceTitle: readString(densityAttrs?.TITLE || coverageAttrs?.TITLE || heightAttrs?.TITLE || areaAttrs?.TITLE || systemAttrs?.TITLE),
  };

  const hasAnyValue = Boolean(
    result.sd || result.coverage || result.maxHeight || result.floors || result.minArea || result.minFrontage || result.lotRuleDescription || result.buildingSystem || result.maxCoverageArea || result.sdSector || result.sdComment || result.notes.length,
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

export async function fetchPlanningLinesForOT(otRings: Point[][]): Promise<PlanningLinesData> {
  const points = otRings.flatMap((ring) => stripClosingPoint(ring));
  if (!points.length) return { urbanLines: [], buildingLines: [] };

  const projectedPoints = points.map((point) => {
    const [x, y] = transformToGGRS87(point.x, point.y);
    return { x, y };
  });
  const bounds = boundsFromPoints(projectedPoints);
  const padding = Math.max(20, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.5);
  const envelope = {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };

  const [urbanFeatures, buildingFeatures] = await Promise.all([
    fetchTEELayerFeaturesByEnvelope(11, ["OBJECTID"], envelope, true, 500).catch(() => []),
    fetchTEELayerFeaturesByEnvelope(12, ["OBJECTID"], envelope, true, 500).catch(() => []),
  ]);

  const toPaths = (features: TEERawFeature[]) =>
    features.flatMap((feature) => (feature.geometry?.paths || []).map((path) =>
      path.map((point) => {
        const [lon, lat] = transformFromGGRS87(point[0], point[1]);
        return { x: lon, y: lat };
      }),
    ));

  return {
    urbanLines: toPaths(urbanFeatures),
    buildingLines: toPaths(buildingFeatures),
  };
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

function segmentAngleDegreesRaw(a: Point, b: Point) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function angleDifferenceDegrees(a: number, b: number) {
  const normalized = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(normalized, 180 - normalized);
}

function segmentProjectionRange(start: Point, end: Point, refStart: Point, refEnd: Point) {
  const axisX = refEnd.x - refStart.x;
  const axisY = refEnd.y - refStart.y;
  const axisLength = Math.hypot(axisX, axisY) || 1;
  const ux = axisX / axisLength;
  const uy = axisY / axisLength;
  const project = (point: Point) => ((point.x - refStart.x) * ux) + ((point.y - refStart.y) * uy);
  const a = project(start);
  const b = project(end);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function projectionOverlapLength(a: { min: number; max: number }, b: { min: number; max: number }) {
  return Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min));
}

export function filterOppositeParcels(
  baseRings: Point[][],
  parcels: NeighborParcel[],
  urbanLines: Point[][],
  options?: { minGapMeters?: number; maxGapMeters?: number; urbanToleranceMeters?: number; angleToleranceDegrees?: number; minOverlapMeters?: number; minOverlapRatio?: number },
) {
  const baseRing = baseRings[0];
  if (!baseRing?.length || !parcels.length || !urbanLines.length) return [] as NeighborParcel[];

  const minGapMeters = options?.minGapMeters ?? 1.5;
  const maxGapMeters = options?.maxGapMeters ?? 35;
  const urbanToleranceMeters = options?.urbanToleranceMeters ?? 16;
  const angleToleranceDegrees = options?.angleToleranceDegrees ?? 14;
  const minOverlapMeters = options?.minOverlapMeters ?? 4;
  const minOverlapRatio = options?.minOverlapRatio ?? 0.3;

  const projectedBase = projectedRing(baseRing);
  const baseSegments = ringSegments(projectedBase);
  const urbanSegments = urbanLines.flatMap((path) => ringSegments(path.map((point) => {
    const [x, y] = transformToGGRS87(point.x, point.y);
    return { x, y };
  })));
  if (!baseSegments.length || !urbanSegments.length) return [] as NeighborParcel[];

  const roadFacingBaseSegments = baseSegments.filter(([baseStart, baseEnd]) => {
    const baseAngle = segmentAngleDegreesRaw(baseStart, baseEnd);
    return urbanSegments.some(([urbanStart, urbanEnd]) => {
      const urbanAngle = segmentAngleDegreesRaw(urbanStart, urbanEnd);
      if (angleDifferenceDegrees(baseAngle, urbanAngle) > angleToleranceDegrees) return false;
      const gap = segmentDistance(baseStart, baseEnd, urbanStart, urbanEnd);
      return gap <= urbanToleranceMeters;
    });
  });
  if (!roadFacingBaseSegments.length) return [] as NeighborParcel[];

  return parcels.filter((parcel) => parcel.rings.some((ring) => {
    const projectedParcel = projectedRing(ring);
    const parcelSegments = ringSegments(projectedParcel);
    return parcelSegments.some(([parcelStart, parcelEnd]) => {
      const parcelAngle = segmentAngleDegreesRaw(parcelStart, parcelEnd);
      return roadFacingBaseSegments.some(([baseStart, baseEnd]) => {
        const baseAngle = segmentAngleDegreesRaw(baseStart, baseEnd);
        if (angleDifferenceDegrees(baseAngle, parcelAngle) > angleToleranceDegrees) return false;
        const gap = segmentDistance(baseStart, baseEnd, parcelStart, parcelEnd);
        if (gap < minGapMeters || gap > maxGapMeters) return false;

        const baseLength = Math.hypot(baseEnd.x - baseStart.x, baseEnd.y - baseStart.y);
        const parcelLength = Math.hypot(parcelEnd.x - parcelStart.x, parcelEnd.y - parcelStart.y);
        const overlap = projectionOverlapLength(
          segmentProjectionRange(baseStart, baseEnd, baseStart, baseEnd),
          segmentProjectionRange(parcelStart, parcelEnd, baseStart, baseEnd),
        );
        const requiredOverlap = Math.max(minOverlapMeters, Math.min(baseLength, parcelLength) * minOverlapRatio);
        if (overlap < requiredOverlap) return false;

        return urbanSegments.some(([urbanStart, urbanEnd]) => {
          const urbanAngle = segmentAngleDegreesRaw(urbanStart, urbanEnd);
          if (angleDifferenceDegrees(baseAngle, urbanAngle) > angleToleranceDegrees) return false;
          return segmentDistance(baseStart, baseEnd, urbanStart, urbanEnd) <= urbanToleranceMeters &&
            segmentDistance(parcelStart, parcelEnd, urbanStart, urbanEnd) <= urbanToleranceMeters;
        });
      });
    });
  }));
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

export type CoordinateRow = { label: string; x: string; y: string; side?: string };

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
  const usable = stripClosingPoint(points);
  return usable.map((point, index) => {
    const [x, y] = coordinatesAreGgrs87 ? [point.x, point.y] : transformToGGRS87(point.x, point.y);
    const next = usable[(index + 1) % usable.length];
    const currentLabel = prefix === "T" ? `T${index + 1}` : greekLabel(index);
    const nextLabel = prefix === "T" ? `T${((index + 1) % usable.length) + 1}` : greekLabel((index + 1) % usable.length);
    return {
      label: currentLabel,
      x: x.toFixed(3),
      y: y.toFixed(3),
      side: next ? `${currentLabel}${nextLabel}=${segmentLength(point, next).toFixed(2)}` : "",
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

export type ParcelHorizontalAlignment = "default" | "north-side-horizontal" | "south-side-horizontal";

function normalizeHorizontalRotation(degrees: number) {
  let normalized = degrees;
  while (normalized > 90) normalized -= 180;
  while (normalized < -90) normalized += 180;
  return normalized;
}

function edgeAngleDegrees(a: Point, b: Point) {
  return normalizeHorizontalRotation((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}

export function rotatePoint(point: Point, center: Point, rotationDegrees: number): Point {
  if (!rotationDegrees) return { ...point };
  const radians = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function rotateRings(rings: Point[][], center: Point, rotationDegrees: number) {
  if (!rotationDegrees) return rings.map((ring) => ring.map((point) => ({ ...point })));
  return rings.map((ring) => ring.map((point) => rotatePoint(point, center, rotationDegrees)));
}

export function getParcelHorizontalRotationDegrees(points: Point[], alignment: ParcelHorizontalAlignment): number {
  if (alignment === "default") return 0;
  const usable = stripClosingPoint(points);
  if (usable.length < 2) return 0;

  let bestEdge: { start: Point; end: Point; midpointY: number; length: number } | null = null;
  for (let index = 0; index < usable.length; index += 1) {
    const start = usable[index];
    const end = usable[(index + 1) % usable.length];
    const midpointY = (start.y + end.y) / 2;
    const length = segmentLength(start, end);
    if (!bestEdge) {
      bestEdge = { start, end, midpointY, length };
      continue;
    }

    const betterByPosition = alignment === "north-side-horizontal"
      ? midpointY > bestEdge.midpointY + 1e-9
      : midpointY < bestEdge.midpointY - 1e-9;
    const tiedByPosition = Math.abs(midpointY - bestEdge.midpointY) <= 1e-9;
    if (betterByPosition || (tiedByPosition && length > bestEdge.length)) {
      bestEdge = { start, end, midpointY, length };
    }
  }

  if (!bestEdge) return 0;
  const edgeAngle = (Math.atan2(bestEdge.end.y - bestEdge.start.y, bestEdge.end.x - bestEdge.start.x) * 180) / Math.PI;
  return normalizeHorizontalRotation(-edgeAngle);
}

function estimateTextWidth(value: string, height: number) {
  return Array.from(encodeDxfText(value)).reduce((sum, char) => {
    if (char === "." || char === ":") return sum + height * 0.24;
    if (/[0-9]/.test(char)) return sum + height * 0.87;
    if (/[Α-Ωα-ω]/.test(char)) return sum + height * 0.87;
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
    declarations?: Array<{ title: string; text: string; signerLabel?: string }>;
    nearbyAnnotations?: NearbyPlanningAnnotation[];
    urbanLines?: Point[][];
    buildingLines?: Point[][];
    parcelHorizontalAlignment?: ParcelHorizontalAlignment;
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
  writer.addLayer("OT_LABELS", 7, "CONTINUOUS");

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
  const projectedUrbanLines = (meta?.urbanLines || []).map((path) => path.map((p) => {
    const isLikelyGgrs = Math.abs(p.x) > 1000 && Math.abs(p.y) > 1000;
    if (isLikelyGgrs) return { x: p.x, y: p.y };
    const [x, y] = transformToGGRS87(p.x, p.y);
    return { x, y };
  }));
  const projectedBuildingLines = (meta?.buildingLines || []).map((path) => path.map((p) => {
    const isLikelyGgrs = Math.abs(p.x) > 1000 && Math.abs(p.y) > 1000;
    if (isLikelyGgrs) return { x: p.x, y: p.y };
    const [x, y] = transformToGGRS87(p.x, p.y);
    return { x, y };
  }));
  const projectedNearbyAnnotations = (meta?.nearbyAnnotations || []).map((item) => {
    const isLikelyGgrs = Math.abs(item.point.x) > 1000 && Math.abs(item.point.y) > 1000;
    if (isLikelyGgrs) return { ...item, point: item.point };
    const [x, y] = transformToGGRS87(item.point.x, item.point.y);
    return { ...item, point: { x, y } };
  });

  const parcelHorizontalAlignment = meta?.parcelHorizontalAlignment || "default";
  const mainProjectedParcelPoints = stripClosingPoint(projectedParcels[0]?.rings[0] || []);
  const rotationCenter = centroidOfRing(mainProjectedParcelPoints);
  const parcelRotationDegrees = getParcelHorizontalRotationDegrees(mainProjectedParcelPoints, parcelHorizontalAlignment);
  const rotatedParcels = parcelRotationDegrees
    ? projectedParcels.map((parcel) => ({ ...parcel, rings: rotateRings(parcel.rings, rotationCenter, parcelRotationDegrees) }))
    : projectedParcels;
  const rotatedOtRings = parcelRotationDegrees ? rotateRings(projectedOtRings, rotationCenter, parcelRotationDegrees) : projectedOtRings;
  const rotatedContextOts = parcelRotationDegrees
    ? projectedContextOts.map((ot) => ({ ...ot, rings: rotateRings(ot.rings, rotationCenter, parcelRotationDegrees) }))
    : projectedContextOts;
  const rotatedUrbanLines = parcelRotationDegrees ? rotateRings(projectedUrbanLines, rotationCenter, parcelRotationDegrees) : projectedUrbanLines;
  const rotatedBuildingLines = parcelRotationDegrees ? rotateRings(projectedBuildingLines, rotationCenter, parcelRotationDegrees) : projectedBuildingLines;
  const rotatedNearbyAnnotations = parcelRotationDegrees
    ? projectedNearbyAnnotations.map((item) => ({ ...item, point: rotatePoint(item.point, rotationCenter, parcelRotationDegrees) }))
    : projectedNearbyAnnotations;

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

  const mainParcel = rotatedParcels[0];
  const mainParcelPoints = stripClosingPoint(mainParcel.rings[0]);
  if (!mainParcelPoints.length) return writer.stringify();

  const fitPoints = rotatedOtRings.flatMap((ring) => stripClosingPoint(ring));
  const referencePoints = fitPoints.length
    ? fitPoints
    : rotatedParcels.flatMap((parcel) => parcel.rings.flatMap((ring) => stripClosingPoint(ring)));
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
  const rawSheetNearbyAnnotations = rotatedNearbyAnnotations
    .map((item) => ({
      ...item,
      point: toSheet(item.point),
      rotationDegrees: typeof item.rotationDegrees === "number" ? normalizeHorizontalRotation(item.rotationDegrees + parcelRotationDegrees) : undefined,
      footprint: item.footprint?.map(toSheet),
    }))
    .filter((item) => item.point.x >= drawWin.x0 && item.point.x <= drawWin.x1 && item.point.y >= drawWin.y0 && item.point.y <= drawWin.y1);
  const legendMaskRect = {
    minX: legendX - mm(1.4),
    minY: legendY - mm(1.4),
    maxX: legendX + legendWidth + mm(1.4),
    maxY: legendY + legendHeight + mm(1.4),
  };
  const rectsOverlap = (a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) => {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  };
  const buildNearbyTextRect = (point: Point, label: string, height: number) => {
    const width = estimateTextWidth(label, height);
    return {
      minX: point.x - width / 2 - mm(0.9),
      maxX: point.x + width / 2 + mm(0.9),
      minY: point.y - height * 0.8,
      maxY: point.y + height * 0.8,
    };
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

  rotatedContextOts.forEach((ot) => {
    ot.rings.forEach((ring) => {
      const worldPts = stripClosingPoint(ring);
      worldPts.forEach((start, index) => {
        const end = worldPts[(index + 1) % worldPts.length];
        const overlapsUrban = projectedUrbanLines.some((urbanPath) => {
          const urbanPts = stripClosingPoint(urbanPath);
          return urbanPts.some((urbanStart, urbanIndex) => {
            if (urbanIndex === urbanPts.length - 1) return false;
            const urbanEnd = urbanPts[urbanIndex + 1];
            return segmentDistance(start, end, urbanStart, urbanEnd) <= 0.35;
          });
        });
        if (overlapsUrban) return;
        addMaskedSheetLine(toSheet(start), toSheet(end), { layerName: "OT_CONTEXT", colorNumber: 7 });
      });
    });
  });

  const urbanSegments = rotatedUrbanLines.flatMap((path) => {
    const pts = stripClosingPoint(path);
    if (pts.length < 2) return [] as Array<{ start: Point; end: Point }>;
    return pts.slice(0, -1).map((start, index) => ({ start, end: pts[index + 1] }));
  });

  const segmentAngleDeg = (a: Point, b: Point) => {
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return ((angle % 180) + 180) % 180;
  };

  const hasUrbanOverlap = (segment: { start: Point; end: Point }) => {
    const angleA = segmentAngleDeg(segment.start, segment.end);
    return urbanSegments.some((urban) => {
      const angleB = segmentAngleDeg(urban.start, urban.end);
      const angleDiff = Math.min(Math.abs(angleA - angleB), 180 - Math.abs(angleA - angleB));
      if (angleDiff > 10) return false;
      return segmentDistance(segment.start, segment.end, urban.start, urban.end) <= 0.35;
    });
  };

  rotatedUrbanLines.forEach((path) => {
    const pts = stripClosingPoint(path);
    if (pts.length < 2) return;
    const sheetPoints = pts.map(toSheet);
    sheetPoints.forEach((start, index) => {
      if (index === sheetPoints.length - 1) return;
      const end = sheetPoints[index + 1];
      addMaskedSheetLine(start, end, { layerName: "OT_BOUNDARY", colorNumber: 3 });
    });
  });

  rotatedBuildingLines.forEach((path) => {
    const pts = stripClosingPoint(path);
    if (pts.length < 2) return;
    const sheetPoints = pts.map(toSheet);
    sheetPoints.forEach((start, index) => {
      if (index === sheetPoints.length - 1) return;
      const end = sheetPoints[index + 1];
      addMaskedSheetLine(start, end, { layerName: "BUILDING_LINE", colorNumber: 1 });
    });
  });

  rotatedParcels.slice(1).forEach((parcel) => {
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

  const otBlockedRects = [
    ...rotatedContextOts.flatMap((ot) => ot.rings.slice(0, 1)),
    ...rotatedOtRings.slice(0, 1),
  ].map((ring) => {
    const sheetPoints = stripClosingPoint(ring).map(toSheet);
    const bounds = boundsFromPoints(sheetPoints);
    return {
      minX: bounds.minX - mm(6),
      minY: bounds.minY - mm(4),
      maxX: bounds.maxX + mm(6),
      maxY: bounds.maxY + mm(4),
    };
  });
  const hardBlockedNearbyRects = [...otBlockedRects, legendMaskRect];
  const softOccupiedNearbyRects: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];
  const insideDrawWindow = (rect: { minX: number; minY: number; maxX: number; maxY: number }) => (
    rect.minX >= drawWin.x0 && rect.maxX <= drawWin.x1 && rect.minY >= drawWin.y0 && rect.maxY <= drawWin.y1
  );
  const buildFootprintBounds = (footprint?: Point[]) => {
    if (!footprint?.length) return null;
    return footprint.reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }), {
      minX: footprint[0].x,
      minY: footprint[0].y,
      maxX: footprint[0].x,
      maxY: footprint[0].y,
    });
  };
  const nearbyPlacementQueue = [...rawSheetNearbyAnnotations].sort((a, b) => {
    if (a.kind === b.kind) return 0;
    return a.kind === "public-use" ? -1 : 1;
  });
  const placedNearbyAnnotations = nearbyPlacementQueue.flatMap((item) => {
    const height = item.kind === "pedestrian-road" ? mm(1.55) : mm(1.4);
    const rotationRadians = ((item.rotationDegrees || 0) * Math.PI) / 180;
    const tangent = { x: Math.cos(rotationRadians), y: Math.sin(rotationRadians) };
    const normal = { x: -tangent.y, y: tangent.x };
    const footprintBounds = buildFootprintBounds(item.footprint);
    const footprintCandidates = item.kind === "public-use" && footprintBounds
      ? [
          { x: footprintBounds.maxX + mm(10), y: (footprintBounds.minY + footprintBounds.maxY) / 2 },
          { x: footprintBounds.minX - mm(10), y: (footprintBounds.minY + footprintBounds.maxY) / 2 },
          { x: (footprintBounds.minX + footprintBounds.maxX) / 2, y: footprintBounds.maxY + mm(8) },
          { x: (footprintBounds.minX + footprintBounds.maxX) / 2, y: footprintBounds.minY - mm(8) },
          { x: footprintBounds.maxX + mm(12), y: footprintBounds.maxY + mm(6) },
          { x: footprintBounds.minX - mm(12), y: footprintBounds.maxY + mm(6) },
          { x: footprintBounds.maxX + mm(12), y: footprintBounds.minY - mm(6) },
          { x: footprintBounds.minX - mm(12), y: footprintBounds.minY - mm(6) },
        ]
      : [];
    const placementCandidates = item.kind === "pedestrian-road"
      ? [
          item.point,
          { x: item.point.x + normal.x * mm(4), y: item.point.y + normal.y * mm(4) },
          { x: item.point.x - normal.x * mm(4), y: item.point.y - normal.y * mm(4) },
          { x: item.point.x + normal.x * mm(2), y: item.point.y + normal.y * mm(2) },
          { x: item.point.x - normal.x * mm(2), y: item.point.y - normal.y * mm(2) },
        ]
      : [
          item.point,
          { x: item.point.x + mm(12), y: item.point.y },
          { x: item.point.x - mm(12), y: item.point.y },
          { x: item.point.x, y: item.point.y + mm(8) },
          { x: item.point.x, y: item.point.y - mm(8) },
          { x: item.point.x + mm(10), y: item.point.y + mm(6) },
          { x: item.point.x - mm(10), y: item.point.y + mm(6) },
          { x: item.point.x + mm(10), y: item.point.y - mm(6) },
          { x: item.point.x - mm(10), y: item.point.y - mm(6) },
          { x: item.point.x + mm(18), y: item.point.y },
          { x: item.point.x - mm(18), y: item.point.y },
          { x: item.point.x, y: item.point.y + mm(14) },
          { x: item.point.x, y: item.point.y - mm(14) },
          ...footprintCandidates,
        ];

    const tryPlace = (respectSoftBlocked: boolean) => {
      for (const candidate of placementCandidates) {
        const rect = buildNearbyTextRect(candidate, item.label, height);
        if (!insideDrawWindow(rect)) continue;
        if (hardBlockedNearbyRects.some((blocked) => rectsOverlap(rect, blocked))) continue;
        if (respectSoftBlocked && softOccupiedNearbyRects.some((blocked) => rectsOverlap(rect, blocked))) continue;
        softOccupiedNearbyRects.push(rect);
        return { ...item, height, point: candidate };
      }
      return null;
    };

    const strictPlacement = tryPlace(true);
    if (strictPlacement) return [strictPlacement];

    if (item.kind === "public-use") {
      const relaxedPlacement = tryPlace(false);
      if (relaxedPlacement) return [relaxedPlacement];
    }

    return [];
  });

  placedNearbyAnnotations.forEach((item) => {
    addCenteredDxfText(writer, item.point.x, item.point.y, item.height, item.label, {
      rotation: item.kind === "pedestrian-road" ? item.rotationDegrees : undefined,
      layerName: "ANNOTATION",
      colorNumber: item.kind === "pedestrian-road" ? 2 : 3,
    });
  });

  const parcelSheetPoints = mainParcelPoints.map(toSheet);
  const parcelCenter = centroidOfRing(parcelSheetPoints);

  buildParcelEdgeLabels(mainParcelPoints).forEach((edge, index) => {
    const start = parcelSheetPoints[index];
    const end = parcelSheetPoints[(index + 1) % parcelSheetPoints.length];
    const vertex = start;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(Math.hypot(dx, dy), 1e-9);
    const normalA = { x: dy / length, y: -dx / length };
    const normalB = { x: -dy / length, y: dx / length };

    const centerAnchor = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const probe = mm(0.9);
    const probeA = { x: centerAnchor.x + normalA.x * probe, y: centerAnchor.y + normalA.y * probe };
    const probeB = { x: centerAnchor.x + normalB.x * probe, y: centerAnchor.y + normalB.y * probe };
    let inward = normalA;
    if (pointInRing(probeA, parcelSheetPoints) && !pointInRing(probeB, parcelSheetPoints)) {
      inward = normalA;
    } else if (pointInRing(probeB, parcelSheetPoints) && !pointInRing(probeA, parcelSheetPoints)) {
      inward = normalB;
    } else {
      const toCenter = { x: parcelCenter.x - centerAnchor.x, y: parcelCenter.y - centerAnchor.y };
      const dotA = normalA.x * toCenter.x + normalA.y * toCenter.y;
      const dotB = normalB.x * toCenter.x + normalB.y * toCenter.y;
      inward = dotA >= dotB ? normalA : normalB;
    }

    const baseOffset = mm(1.25);
    let labelPoint = {
      x: centerAnchor.x + inward.x * baseOffset,
      y: centerAnchor.y + inward.y * baseOffset,
    };

    if (!pointInRing(labelPoint, parcelSheetPoints) || distancePointToSegment(labelPoint, start, end) < mm(0.9)) {
      labelPoint = {
        x: centerAnchor.x + inward.x * mm(1.45),
        y: centerAnchor.y + inward.y * mm(1.45),
      };
    }

    const radialLength = Math.max(Math.hypot(vertex.x - parcelCenter.x, vertex.y - parcelCenter.y), 1e-9);
    const vertexLabelPoint = {
      x: vertex.x + ((vertex.x - parcelCenter.x) / radialLength) * mm(2.2),
      y: vertex.y + ((vertex.y - parcelCenter.y) / radialLength) * mm(2.2),
    };
    addDxfCircle(writer, vertex, mm(0.5), { layerName: "PARCEL_LABELS", colorNumber: 7 });
    addCenteredDxfText(writer, vertexLabelPoint.x, vertexLabelPoint.y, mm(1.45), edge.vertexLabel, { layerName: "PARCEL_LABELS", colorNumber: 7 });
    addCenteredDxfText(writer, labelPoint.x, labelPoint.y, mm(1.28), `${edge.edgeLabel}=${formatLengthMeters(edge.length)}`, {
      rotation: edgeAngleDegrees(start, end),
      layerName: "PARCEL_LABELS",
      colorNumber: 7,
    });
  });

  const labelObstacleSegments: Array<{ start: Point; end: Point }> = [];
  const addObstaclePath = (path: Point[], closed = false) => {
    const pts = stripClosingPoint(path);
    if (pts.length < 2) return;
    for (let i = 0; i < pts.length - 1; i += 1) {
      labelObstacleSegments.push({ start: toSheet(pts[i]), end: toSheet(pts[i + 1]) });
    }
    if (closed) {
      labelObstacleSegments.push({ start: toSheet(pts[pts.length - 1]), end: toSheet(pts[0]) });
    }
  };

  projectedUrbanLines.forEach((path) => addObstaclePath(path, false));
  projectedBuildingLines.forEach((path) => addObstaclePath(path, false));
  rotatedParcels.forEach((parcel) => parcel.rings.forEach((ring) => addObstaclePath(ring, true)));
  rotatedContextOts.forEach((ot) => ot.rings.forEach((ring) => addObstaclePath(ring, true)));
  rotatedOtRings.forEach((ring) => addObstaclePath(ring, true));

  const drawOtBoxLabel = (text: string, sourceRing: Point[], avoidWorldRings: Point[][] = []) => {
    const ringWorld = stripClosingPoint(sourceRing);
    if (!ringWorld.length) return;

    const textHeight = mm(1.55);
    const padX = mm(1.2);
    const padY = mm(0.9);
    const boxWidth = estimateTextWidth(text, textHeight) + padX * 2;
    const boxHeight = textHeight + padY * 2;
    const halfW = boxWidth / 2;
    const halfH = boxHeight / 2;
    const halfWorldX = halfW / scale;
    const halfWorldY = halfH / scale;

    const worldBounds = boundsFromPoints(ringWorld);
    const worldCenter = findBestOtLabelPoint(ringWorld, avoidWorldRings) || centroidOfRing(ringWorld);

    const gridSteps = 8;
    const worldCandidates: Point[] = [worldCenter];
    for (let ix = 0; ix <= gridSteps; ix += 1) {
      for (let iy = 0; iy <= gridSteps; iy += 1) {
        const x = worldBounds.minX + ((worldBounds.maxX - worldBounds.minX) * ix) / gridSteps;
        const y = worldBounds.minY + ((worldBounds.maxY - worldBounds.minY) * iy) / gridSteps;
        const c = { x, y };
        if (!pointInRing(c, ringWorld) || pointInAnyRing(c, avoidWorldRings)) continue;
        const corners = [
          { x: c.x - halfWorldX, y: c.y - halfWorldY },
          { x: c.x + halfWorldX, y: c.y - halfWorldY },
          { x: c.x + halfWorldX, y: c.y + halfWorldY },
          { x: c.x - halfWorldX, y: c.y + halfWorldY },
        ];
        if (corners.every((corner) => pointInRing(corner, ringWorld) && !pointInAnyRing(corner, avoidWorldRings))) worldCandidates.push(c);
      }
    }

    const rectFor = (p: { x: number; y: number }) => ({
      minX: p.x - halfW,
      maxX: p.x + halfW,
      minY: p.y - halfH,
      maxY: p.y + halfH,
    });

    const scoreCandidate = (worldPoint: Point) => {
      if (pointInAnyRing(worldPoint, avoidWorldRings)) return Number.NEGATIVE_INFINITY;
      const p = toSheet(worldPoint);
      const rect = rectFor(p);
      if (rect.minX < drawWin.x0 || rect.maxX > drawWin.x1 || rect.minY < drawWin.y0 || rect.maxY > drawWin.y1) return Number.NEGATIVE_INFINITY;
      if (!(rect.maxX < legendMaskRect.minX || rect.minX > legendMaskRect.maxX || rect.maxY < legendMaskRect.minY || rect.minY > legendMaskRect.maxY)) {
        return Number.NEGATIVE_INFINITY;
      }

      let hits = 0;
      let minClearance = Number.POSITIVE_INFINITY;
      labelObstacleSegments.forEach((seg) => {
        if (clipSegmentToRect(seg.start, seg.end, rect)) hits += 1;
        minClearance = Math.min(minClearance, distancePointToSegment(p, seg.start, seg.end));
      });
      if (hits > 0) return Number.NEGATIVE_INFINITY;

      const avoidClearance = avoidWorldRings.length
        ? avoidWorldRings.reduce((minDistance, ring) => Math.min(minDistance, distancePointToRingBoundary(worldPoint, ring) * scale), Number.POSITIVE_INFINITY)
        : minClearance;
      const centerSheet = toSheet(worldCenter);
      const centerPenalty = Math.hypot(p.x - centerSheet.x, p.y - centerSheet.y) * 0.05;
      return minClearance + Math.min(avoidClearance, minClearance) * 0.9 - centerPenalty;
    };

    let bestWorld = worldCenter;
    let bestScore = Number.NEGATIVE_INFINITY;
    worldCandidates.forEach((candidate) => {
      const score = scoreCandidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestWorld = candidate;
      }
    });

    if (!Number.isFinite(bestScore) || bestScore === Number.NEGATIVE_INFINITY) return;

    const bestSheet = toSheet(bestWorld);
    const x = bestSheet.x;
    const y = bestSheet.y;
    const rect = {
      minX: x - halfW,
      maxX: x + halfW,
      minY: y - halfH,
      maxY: y + halfH,
    };
    if (rect.minX < drawWin.x0 || rect.maxX > drawWin.x1 || rect.minY < drawWin.y0 || rect.maxY > drawWin.y1) return;
    if (!(rect.maxX < legendMaskRect.minX || rect.minX > legendMaskRect.maxX || rect.maxY < legendMaskRect.minY || rect.minY > legendMaskRect.maxY)) return;

    addMaskedSheetLine({ x: x - halfW, y: y - halfH }, { x: x + halfW, y: y - halfH }, { layerName: "OT_LABELS", colorNumber: 7 });
    addMaskedSheetLine({ x: x + halfW, y: y - halfH }, { x: x + halfW, y: y + halfH }, { layerName: "OT_LABELS", colorNumber: 7 });
    addMaskedSheetLine({ x: x + halfW, y: y + halfH }, { x: x - halfW, y: y + halfH }, { layerName: "OT_LABELS", colorNumber: 7 });
    addMaskedSheetLine({ x: x - halfW, y: y + halfH }, { x: x - halfW, y: y - halfH }, { layerName: "OT_LABELS", colorNumber: 7 });
    addCenteredDxfText(writer, x, y - textHeight * 0.36, textHeight, text, { layerName: "OT_LABELS", colorNumber: 7 });
  };

  const otLabelAvoidRings = rotatedParcels.flatMap((parcel) => parcel.rings);
  rotatedContextOts.forEach((ot) => {
    if (ot.otNumber && ot.rings[0]?.length) drawOtBoxLabel(`Ο.Τ. ${ot.otNumber}`, ot.rings[0], otLabelAvoidRings);
  });
  if (meta?.ot && rotatedOtRings[0]?.length) {
    drawOtBoxLabel(`Ο.Τ. ${meta.ot}`, rotatedOtRings[0], otLabelAvoidRings);
  }

  const northX = drawWin.x0 + mm(16);
  const northY = drawWin.y1 - mm(18);
  const northCenter = { x: northX, y: northY };
  const rotateNorthPoint = (point: Point) => rotatePoint(point, northCenter, parcelRotationDegrees);
  const northStemBottom = rotateNorthPoint({ x: northX, y: northY - mm(10) });
  const northStemTop = rotateNorthPoint({ x: northX, y: northY + mm(2) });
  const northLeft = rotateNorthPoint({ x: northX - mm(4), y: northY - mm(6) });
  const northRight = rotateNorthPoint({ x: northX + mm(4), y: northY - mm(6) });
  const northLabel = rotateNorthPoint({ x: northX, y: northY + mm(6) });
  addDxfLine(writer, northStemBottom, northStemTop, { layerName: "ANNOTATION" });
  addDxfLine(writer, northStemTop, northLeft, { layerName: "ANNOTATION" });
  addDxfLine(writer, northStemTop, northRight, { layerName: "ANNOTATION" });
  addDxfLine(writer, northLeft, northRight, { layerName: "ANNOTATION" });
  addCenteredDxfText(writer, northLabel.x, northLabel.y, mm(3), "Β", { rotation: parcelRotationDegrees, layerName: "ANNOTATION" });

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
    const worldPts = stripClosingPoint(ring);
    worldPts.forEach((start, index) => {
      const end = worldPts[(index + 1) % worldPts.length];
      const overlapsUrban = projectedUrbanLines.some((urbanPath) => {
        const urbanPts = stripClosingPoint(urbanPath);
        return urbanPts.some((urbanStart, urbanIndex) => {
          if (urbanIndex === urbanPts.length - 1) return false;
          const urbanEnd = urbanPts[urbanIndex + 1];
          return segmentDistance(start, end, urbanStart, urbanEnd) <= 0.35;
        });
      });
      if (overlapsUrban) return;
      addMaskedSheetLine(toSheet(start), toSheet(end), { layerName: "OT_CONTEXT", colorNumber: 7 });
    });
  });

  if (includeTitleBlock) {
    const x0 = drawWin.x1 + paperConfig.gutter;
    const x1 = paper.width - paperConfig.outerMargin;
    const y0 = paperConfig.outerMargin;
    const y1 = paper.height - paperConfig.outerMargin;
    const dateText = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric" })
      .format(new Date())
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .normalize("NFC");
    const labelX = x0 + mm(4);
    const valueX = x0 + mm(37);
    const titlePanelHeight = paperSize === "A1" ? mm(96) : paperSize === "A4" ? mm(74) : mm(88);
    const titlePanelInset = mm(2);
    const titlePanelX0 = x0 + titlePanelInset;
    const titlePanelX1 = x1 - titlePanelInset;
    const titlePanelY0 = y0 + titlePanelInset;
    const titlePanelY1 = titlePanelY0 + titlePanelHeight;
    const contentBottomLimit = titlePanelY1 + mm(4);

    addDxfLine(writer, { x: x0, y: y0 }, { x: x1, y: y0 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x1, y: y0 }, { x: x1, y: y1 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x1, y: y1 }, { x: x0, y: y1 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: x0, y: y1 }, { x: x0, y: y0 }, { layerName: "ANNOTATION" });

    const tableInset = mm(2.2);
    const tableX0 = x0 + tableInset;
    const tableX1 = x1 - tableInset;
    const tableWidth = tableX1 - tableX0;
    let y = y1 - mm(6);
    const titleRowHeight = mm(5);
    const headerRowHeight = mm(4.3);
    const coordRowHeight = mm(4.15);
    const column1 = tableX0 + mm(11);
    const column2 = tableX0 + mm(35);
    const column3 = tableX0 + mm(61);
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
    addDxfLine(writer, { x: column3, y: tableTop - titleRowHeight }, { x: column3, y: tableBottom }, { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, tableX0 + (column1 - tableX0) / 2, tableTop - titleRowHeight - mm(2.9), mm(1.5), "Α/Α", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, column1 + (column2 - column1) / 2, tableTop - titleRowHeight - mm(2.9), mm(1.5), "X", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, column2 + (column3 - column2) / 2, tableTop - titleRowHeight - mm(2.9), mm(1.5), "Y", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, column3 + (tableX1 - column3) / 2, tableTop - titleRowHeight - mm(2.9), mm(1.5), "ΠΛΕΥΡΑ", { layerName: "ANNOTATION" });

    let rowTop = tableTop - titleRowHeight - headerRowHeight;
    coordinateRows.forEach((row) => {
      const rowBottom = rowTop - coordRowHeight;
      addDxfLine(writer, { x: tableX0, y: rowBottom }, { x: tableX1, y: rowBottom }, { layerName: "ANNOTATION" });
      const rowCenterY = (rowTop + rowBottom) / 2 - mm(0.55);
      addCenteredDxfText(writer, tableX0 + (column1 - tableX0) / 2, rowCenterY, mm(1.45), row.label, { layerName: "ANNOTATION" });
      addCenteredDxfText(writer, column1 + (column2 - column1) / 2, rowCenterY, mm(1.45), row.x, { layerName: "ANNOTATION" });
      addCenteredDxfText(writer, column2 + (column3 - column2) / 2, rowCenterY, mm(1.45), row.y, { layerName: "ANNOTATION" });
      addCenteredDxfText(writer, column3 + (tableX1 - column3) / 2, rowCenterY, mm(1.3), row.side || "-", { layerName: "ANNOTATION" });
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

    addDxfLine(writer, { x: titlePanelX0, y: titlePanelY0 }, { x: titlePanelX1, y: titlePanelY0 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: titlePanelX1, y: titlePanelY0 }, { x: titlePanelX1, y: titlePanelY1 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: titlePanelX1, y: titlePanelY1 }, { x: titlePanelX0, y: titlePanelY1 }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: titlePanelX0, y: titlePanelY1 }, { x: titlePanelX0, y: titlePanelY0 }, { layerName: "ANNOTATION" });

    const panelPadX = mm(3.2);
    const panelWidth = titlePanelX1 - titlePanelX0;
    const panelTopY = titlePanelY1 - mm(3.6);
    const officeBottomY = titlePanelY1 - mm(15);
    const planBlockTopY = titlePanelY0 + mm(37.5);
    const dateTopY = titlePanelY0 + mm(26.5);
    const stampTopY = titlePanelY0 + mm(20.5);
    const fieldLabelX = titlePanelX0 + panelPadX;
    const fieldValueX = titlePanelX0 + mm(28);
    const fieldMaxWidth = titlePanelX1 - fieldValueX - panelPadX;

    addDxfText(writer, fieldLabelX, panelTopY - mm(0.8), mm(3), "eTopografiko", { layerName: "ANNOTATION" });
    wrapTextByWidth("https://ek-mc.github.io/topografiko/", panelWidth - panelPadX * 2, mm(1.2)).forEach((line, index) => {
      addDxfText(writer, fieldLabelX, panelTopY - mm(5) - index * mm(2.7), mm(1.2), line, { layerName: "ANNOTATION" });
    });
    addDxfLine(writer, { x: titlePanelX0, y: officeBottomY }, { x: titlePanelX1, y: officeBottomY }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: titlePanelX0, y: planBlockTopY }, { x: titlePanelX1, y: planBlockTopY }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: titlePanelX0, y: dateTopY }, { x: titlePanelX1, y: dateTopY }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: titlePanelX0, y: stampTopY }, { x: titlePanelX1, y: stampTopY }, { layerName: "ANNOTATION" });

    let fieldY = officeBottomY - mm(4.6);
    const drawTitleField = (label: string, value: string, valueHeight = 1.72, minAdvance = 5.8) => {
      addDxfText(writer, fieldLabelX, fieldY, mm(1.55), `${label}:`, { layerName: "ANNOTATION" });
      const wrapped = wrapTextByWidth(value, fieldMaxWidth, mm(valueHeight));
      wrapped.forEach((line, index) => {
        addDxfText(writer, fieldValueX, fieldY - index * mm(valueHeight + 1.2), mm(valueHeight), line, { layerName: "ANNOTATION" });
      });
      fieldY -= Math.max(mm(minAdvance), wrapped.length * mm(valueHeight + 1.35) + mm(2.2));
    };

    drawTitleField("ΕΡΓΟΔΟΤΗΣ", "eTopografiko");
    drawTitleField("ΕΡΓΟ", "Τοπογραφικό Διάγραμμα ΕΓΣΑ '87");
    drawTitleField("ΘΕΣΗ", `Ο.Τ. ${meta?.ot || "*"} Δήμου ${meta?.municipality || "*"} Περιφέρειας ${meta?.region || "*"}`, 1.58, 6.4);

    const researchersLabelY = fieldY - mm(0.6);
    const researchersDividerY = researchersLabelY + mm(3.7);
    addDxfLine(writer, { x: titlePanelX0, y: researchersDividerY }, { x: titlePanelX1, y: researchersDividerY }, { layerName: "ANNOTATION" });
    addDxfText(writer, fieldLabelX, researchersLabelY, mm(1.55), "ΜΕΛΕΤΗΤΕΣ:", { layerName: "ANNOTATION" });
    addDxfText(writer, fieldValueX, researchersLabelY - mm(4.8), mm(1.9), "eTopografiko", { layerName: "ANNOTATION" });

    const planLabelRowTop = planBlockTopY - mm(3.6);
    const planValueRowY = planBlockTopY - mm(8.7);
    const leftColX = titlePanelX0 + panelWidth * 0.2;
    const rightColX = titlePanelX0 + panelWidth * 0.84;
    addDxfLine(writer, { x: leftColX, y: planBlockTopY }, { x: leftColX, y: dateTopY }, { layerName: "ANNOTATION" });
    addDxfLine(writer, { x: rightColX, y: planBlockTopY }, { x: rightColX, y: dateTopY }, { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, (titlePanelX0 + leftColX) / 2, planLabelRowTop, mm(1.42), "ΑΡ. ΣΧΕΔΙΟΥ", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, (leftColX + rightColX) / 2, planLabelRowTop, mm(1.42), "ΘΕΜΑ ΣΧΕΔΙΟΥ", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, (rightColX + titlePanelX1) / 2, planLabelRowTop, mm(1.42), "ΚΛΙΜΑΚΑ", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, (titlePanelX0 + leftColX) / 2, planValueRowY, mm(4.2), "01", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, (leftColX + rightColX) / 2, planValueRowY, mm(2.65), "ΤΟΠΟΓΡΑΦΙΚΟ ΔΙΑΓΡΑΜΜΑ", { layerName: "ANNOTATION" });
    addCenteredDxfText(writer, (rightColX + titlePanelX1) / 2, planValueRowY, mm(3.4), `1:${scaleDenominator}`, { layerName: "ANNOTATION" });

    const stampMidX = (titlePanelX0 + titlePanelX1) / 2;
    const dateRowTextY = (dateTopY + stampTopY) / 2 - mm(0.5);
    addDxfLine(writer, { x: stampMidX, y: stampTopY }, { x: stampMidX, y: titlePanelY0 }, { layerName: "ANNOTATION" });
    addDxfText(writer, fieldLabelX, stampTopY - mm(3.35), mm(1.55), "ΣΦΡΑΓΙΔΑ:", { layerName: "ANNOTATION" });
    addDxfText(writer, stampMidX + mm(3), stampTopY - mm(3.35), mm(1.55), "ΕΛΕΓΧΟΣ:", { layerName: "ANNOTATION" });
    addDxfText(writer, fieldLabelX, dateRowTextY, mm(1.55), "ΗΜΕΡΟΜΗΝΙΑ:", { layerName: "ANNOTATION" });
    addDxfText(writer, titlePanelX1 - panelPadX - estimateTextWidth(dateText, mm(1.55)), dateRowTextY, mm(1.55), dateText, { layerName: "ANNOTATION" });

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
        ["Αρτιότητα", terms.lotRuleDescription || terms.lotRuleType || ""],
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
          if (y <= contentBottomLimit) return;
          addDxfText(writer, labelX, y, mm(1.14), line, { layerName: "ANNOTATION" });
          y -= mm(2.9);
        });
      });
    }

    if (meta?.declarations?.length && y > contentBottomLimit + mm(8)) {
      addDxfLine(writer, { x: x0, y: y + mm(1.5) }, { x: x1, y: y + mm(1.5) }, { layerName: "ANNOTATION" });
      y -= mm(4.8);

      meta.declarations.forEach((declaration, index) => {
        if (y <= contentBottomLimit) return;
        if (index > 0) y -= mm(2.4);
        addDxfText(writer, labelX, y, mm(1.48), declaration.title, { layerName: "ANNOTATION" });
        y -= mm(4.1);
        wrapTextByWidth(declaration.text, x1 - labelX - mm(4), mm(1.14)).forEach((line) => {
          if (y <= contentBottomLimit) return;
          addDxfText(writer, labelX, y, mm(1.14), line, { layerName: "ANNOTATION" });
          y -= mm(3.05);
        });
        y -= mm(4.6);
        if (declaration.signerLabel && y > contentBottomLimit + mm(16)) {
          addDxfText(writer, x1 - mm(30), y, mm(1.18), declaration.signerLabel, { layerName: "ANNOTATION" });
          y -= mm(17.5);
        }
      });
    }
  }

  return writer.stringify();
}
