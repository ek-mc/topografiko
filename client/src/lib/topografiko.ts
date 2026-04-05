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

export type TEECandidate = TEEData;

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

export async function fetchTEECandidates(rings: Point[][]): Promise<TEECandidate[]> {
  if (!rings?.[0]?.length) return [];
  const points = rings[0];
  const lons = points.map((p) => p.x);
  const lats = points.map((p) => p.y);
  const [xmin, ymin] = transformToGGRS87(Math.min(...lons), Math.min(...lats));
  const [xmax, ymax] = transformToGGRS87(Math.max(...lons), Math.max(...lats));
  const geometry = JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 2100 } });
  const params = new URLSearchParams({
    f: "json",
    returnGeometry: "true",
    spatialRel: "esriSpatialRelIntersects",
    geometry,
    geometryType: "esriGeometryEnvelope",
    inSR: "2100",
    outFields: "OBJECTID,FEK,OT_NUM,APOF_EIDOS,KALL_DHM_NAME",
    outSR: "2100",
    layer: JSON.stringify({ source: { type: "mapLayer", mapLayerId: 6 } }),
  });
  const url = `https://sdigmap.tee.gov.gr/mapping/rest/services/UDM/UDM_SERVICE_POLEODOMIKI_PLIROFORIA/MapServer/dynamicLayer/query?${params.toString()}`;
  const response = await fetch(url);
  const data = await response.json();
  const features = data?.features || [];
  return features.map((feature: { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }) => {
    const attrs = feature.attributes || {};
    return {
      otNumber: String(attrs.OT_NUM || ""),
      fek: String(attrs.FEK || ""),
      apofEidos: String(attrs.APOF_EIDOS || ""),
      municipality: String(attrs.KALL_DHM_NAME || ""),
      rings: (feature.geometry?.rings || []).map((ring: number[][]) => ring.map((point: number[]) => {
        const [lon, lat] = transformFromGGRS87(point[0], point[1]);
        return { x: lon, y: lat };
      })),
    } satisfies TEECandidate;
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

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  meta?: { kaek?: string; ot?: string; municipality?: string; region?: string; includeTitleBlock?: boolean; coords?: { i: number; x: string; y: string }[] },
) {
  const writer = new DxfWriter();
  const projectedParcels = parcels.map((parcel) => ({
    ...parcel,
    rings: parcel.rings.map((ring) => ring.map((p) => {
      const [x, y] = transformToGGRS87(p.x, p.y);
      return { x, y };
    })),
  }));

  projectedParcels.forEach((parcel) => {
    const pts = stripClosingPoint(parcel.rings[0]);
    if (pts.length < 2) return;
    pts.forEach((start, index) => {
      const end = pts[(index + 1) % pts.length];
      writer.addLine(point3d(start.x, start.y, 0), point3d(end.x, end.y, 0));
    });
  });

  if (meta?.includeTitleBlock) {
    const points = projectedParcels.flatMap((parcel) => stripClosingPoint(parcel.rings[0]));
    if (points.length) {
      const bounds = boundsFromPoints(points);
      const width = Math.max(1, bounds.maxX - bounds.minX);
      const height = Math.max(1, bounds.maxY - bounds.minY);
      const boxWidth = Math.max(width * 0.9, 140);
      const boxHeight = Math.max(height * 1.4, 160);
      const x0 = bounds.maxX + width * 0.2;
      const y0 = bounds.minY;
      const x1 = x0 + boxWidth;
      const y1 = y0 + boxHeight;
      writer.addLine(point3d(x0, y0, 0), point3d(x1, y0, 0));
      writer.addLine(point3d(x1, y0, 0), point3d(x1, y1, 0));
      writer.addLine(point3d(x1, y1, 0), point3d(x0, y1, 0));
      writer.addLine(point3d(x0, y1, 0), point3d(x0, y0, 0));
      const lines = [
        ["Engineer", "grey placeholder"],
        ["Project", "Topografiko Diagramma"],
        ["Location", `O.T. ${meta.ot || "***"}, Dimou ${meta.municipality || "(#Municipality)"}, ${meta.region || "(#Region)"}`],
        ["KAEK", meta.kaek || "-"],
      ];
      const step = boxHeight / 10;
      lines.forEach(([label, value], i) => {
        const y = y1 - step * (i + 1);
        writer.addText(point3d(x0 + boxWidth * 0.04, y, 0), step * 0.22, label);
        writer.addText(point3d(x0 + boxWidth * 0.32, y, 0), step * 0.22, value);
      });
      (meta.coords || []).slice(0, 20).forEach((row, idx) => {
        const y = y1 - step * (idx + 5);
        writer.addText(point3d(x0 + boxWidth * 0.04, y, 0), step * 0.18, `${row.i}`);
        writer.addText(point3d(x0 + boxWidth * 0.12, y, 0), step * 0.18, row.x);
        writer.addText(point3d(x0 + boxWidth * 0.52, y, 0), step * 0.18, row.y);
      });
    }
  }

  return writer.stringify();
}
