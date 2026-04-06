import proj4 from "proj4";
import { DxfWriter, point3d } from "@tarikjabiri/dxf";

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

function encodeDxfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/[\r\n]+/g, " ")
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code <= 126 ? char : `\\U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
    })
    .join("");
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
  meta?: { kaek?: string; ot?: string; municipality?: string; region?: string; includeTitleBlock?: boolean; coords?: { i: number; x: string; y: string }[]; paperSize?: "A4" | "A3" | "A1"; scaleDenominator?: number },
) {
  const writer = new DxfWriter();
  const projectedParcels = parcels.map((parcel) => ({
    ...parcel,
    rings: parcel.rings.map((ring) => ring.map((p) => {
      const [x, y] = transformToGGRS87(p.x, p.y);
      return { x, y };
    })),
  }));

  const paperSize = meta?.paperSize || "A3";
  const scaleDenominator = meta?.scaleDenominator || 200;
  const paper = paperSize === "A3" ? { width: 420, height: 297 } : paperSize === "A1" ? { width: 841, height: 594 } : { width: 297, height: 210 };
  const margin = 15;
  const titleBlockWidth = 140;
  const coordSpace = 35;
  const drawWin = {
    x0: margin + coordSpace,
    y0: margin + 10,
    x1: paper.width - titleBlockWidth - margin,
    y1: paper.height - margin - coordSpace,
  };

  const mainParcel = projectedParcels[0];
  const parcelPoints = stripClosingPoint(mainParcel.rings[0]);
  
  if (parcelPoints.length) {
    const bounds = boundsFromPoints(parcelPoints);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    
    // Calculate proper scale for 1:200 or fit-to-window
    const parcelWidth = bounds.maxX - bounds.minX;
    const parcelHeight = bounds.maxY - bounds.minY;
    const winWidth = drawWin.x1 - drawWin.x0;
    const winHeight = drawWin.y1 - drawWin.y0;
    const fitScale = Math.min(winWidth / parcelWidth, winHeight / parcelHeight) * 0.85;
    const requestedScale = 1000 / scaleDenominator;
    const scale = Math.min(fitScale, requestedScale);
    const windowCenterX = (drawWin.x0 + drawWin.x1) / 2;
    const windowCenterY = (drawWin.y0 + drawWin.y1) / 2;
    const toSheet = (p: Point) => ({
      x: windowCenterX + (p.x - centerX) * scale,
      y: windowCenterY + (p.y - centerY) * scale,
    });
    const toWorld = (sx: number, sy: number) => ({
      x: centerX + (sx - windowCenterX) / scale,
      y: centerY + (sy - windowCenterY) / scale,
    });

    // A3 frame and drawing window
    writer.addLine(point3d(0, 0, 0), point3d(paper.width, 0, 0));
    writer.addLine(point3d(paper.width, 0, 0), point3d(paper.width, paper.height, 0));
    writer.addLine(point3d(paper.width, paper.height, 0), point3d(0, paper.height, 0));
    writer.addLine(point3d(0, paper.height, 0), point3d(0, 0, 0));
    writer.addLine(point3d(drawWin.x0, drawWin.y0, 0), point3d(drawWin.x1, drawWin.y0, 0));
    writer.addLine(point3d(drawWin.x1, drawWin.y0, 0), point3d(drawWin.x1, drawWin.y1, 0));
    writer.addLine(point3d(drawWin.x1, drawWin.y1, 0), point3d(drawWin.x0, drawWin.y1, 0));
    writer.addLine(point3d(drawWin.x0, drawWin.y1, 0), point3d(drawWin.x0, drawWin.y0, 0));
    writer.addLine(point3d(drawWin.x1, 0, 0), point3d(drawWin.x1, paper.height, 0));

    projectedParcels.forEach((parcel) => {
      const pts = stripClosingPoint(parcel.rings[0]).map(toSheet);
      if (pts.length < 2) return;
      pts.forEach((start, index) => {
        const end = pts[(index + 1) % pts.length];
        writer.addLine(point3d(start.x, start.y, 0), point3d(end.x, end.y, 0));
      });
    });

    // north arrow symbol (triangle with line)
    const nx = drawWin.x0 + 12;
    const ny = drawWin.y1 - 15;
    writer.addLine(point3d(nx, ny - 12, 0), point3d(nx, ny + 3, 0));
    writer.addLine(point3d(nx, ny + 3, 0), point3d(nx - 4, ny - 5, 0));
    writer.addLine(point3d(nx, ny + 3, 0), point3d(nx + 4, ny - 5, 0));
    writer.addLine(point3d(nx - 4, ny - 5, 0), point3d(nx + 4, ny - 5, 0));
    writer.addText(point3d(nx - 2, ny + 6, 0), 3, encodeDxfText("Β"));

    // coordinate frame ticks with crosshairs and rounded coords
    const tickStep = 50; // mm on paper
    const roundTo = 50; // round world coords to nearest 50
    const seenX = new Set<number>();
    const seenY = new Set<number>();
    
    for (let sx = drawWin.x0; sx <= drawWin.x1 + 0.1; sx += tickStep) {
      const world = toWorld(sx, drawWin.y0);
      const roundedX = Math.round(world.x / roundTo) * roundTo;
      
      // Skip duplicates
      if (seenX.has(roundedX)) continue;
      seenX.add(roundedX);
      
      // Ticks
      writer.addLine(point3d(sx, drawWin.y0, 0), point3d(sx, drawWin.y0 - 4, 0));
      writer.addLine(point3d(sx, drawWin.y1, 0), point3d(sx, drawWin.y1 + 4, 0));
      // Cross (+) at bottom
      writer.addLine(point3d(sx - 3, drawWin.y0, 0), point3d(sx + 3, drawWin.y0, 0));
      writer.addLine(point3d(sx, drawWin.y0 - 3, 0), point3d(sx, drawWin.y0 + 3, 0));
      // Cross (+) at top
      writer.addLine(point3d(sx - 3, drawWin.y1, 0), point3d(sx + 3, drawWin.y1, 0));
      writer.addLine(point3d(sx, drawWin.y1 - 3, 0), point3d(sx, drawWin.y1 + 3, 0));
      // Coordinates - ensure full number is shown
      const xText = String(Math.round(roundedX));
      writer.addText(point3d(sx - 12, drawWin.y0 + 8, 0), 2.2, encodeDxfText(xText));
    }
    
    for (let sy = drawWin.y0; sy <= drawWin.y1 + 0.1; sy += tickStep) {
      const world = toWorld(drawWin.x0, sy);
      const roundedY = Math.round(world.y / roundTo) * roundTo;
      
      // Skip duplicates
      if (seenY.has(roundedY)) continue;
      seenY.add(roundedY);
      
      // Ticks
      writer.addLine(point3d(drawWin.x0, sy, 0), point3d(drawWin.x0 - 4, sy, 0));
      writer.addLine(point3d(drawWin.x1, sy, 0), point3d(drawWin.x1 + 4, sy, 0));
      // Cross (+) at left
      writer.addLine(point3d(drawWin.x0 - 3, sy, 0), point3d(drawWin.x0 + 3, sy, 0));
      writer.addLine(point3d(drawWin.x0, sy - 3, 0), point3d(drawWin.x0, sy + 3, 0));
      // Cross (+) at right
      writer.addLine(point3d(drawWin.x1 - 3, sy, 0), point3d(drawWin.x1 + 3, sy, 0));
      writer.addLine(point3d(drawWin.x1, sy - 3, 0), point3d(drawWin.x1, sy + 3, 0));
      // Coordinates - ensure full number is shown
      const yText = String(Math.round(roundedY));
      writer.addText(point3d(drawWin.x0 + 4, sy + 2, 0), 2.2, encodeDxfText(yText));
    }

    if (meta?.includeTitleBlock) {
      const x0 = drawWin.x1 + 6;
      const x1 = paper.width - 6;
      const y0 = 6;
      const y1 = paper.height - 6;
      writer.addLine(point3d(x0, y0, 0), point3d(x1, y0, 0));
      writer.addLine(point3d(x1, y0, 0), point3d(x1, y1, 0));
      writer.addLine(point3d(x1, y1, 0), point3d(x0, y1, 0));
      writer.addLine(point3d(x0, y1, 0), point3d(x0, y0, 0));
      const lines = [
        ["Μελετητής", "-"],
        ["Έργο", "Τοπογραφικό Διάγραμμα"],
        ["Θέση", `Ο.Τ. ${meta.ot || "***"}, Δήμου ${meta.municipality || "-"}`],
        ["KAEK", meta.kaek || "-"],
      ];
      let y = y1 - 10;
      lines.forEach(([label, value]) => {
        writer.addText(point3d(x0 + 4, y, 0), 2.2, encodeDxfText(label));
        writer.addText(point3d(x0 + 34, y, 0), 2.2, encodeDxfText(value));
        y -= 8;
      });
      writer.addText(point3d(x0 + 4, y - 2, 0), 2.2, encodeDxfText("Συντεταγμένες ΕΓΣΑ87"));
      y -= 8;
      (meta.coords || []).slice(0, 20).forEach((row) => {
        writer.addText(point3d(x0 + 4, y, 0), 1.8, encodeDxfText(`${row.i}`));
        writer.addText(point3d(x0 + 12, y, 0), 1.8, encodeDxfText(row.x));
        writer.addText(point3d(x0 + 60, y, 0), 1.8, encodeDxfText(row.y));
        y -= 5;
      });
    }
  }

  return writer.stringify();
}
