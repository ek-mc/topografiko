/*
 * Civic Topography file note:
 * This utility layer supports a restrained academic geospatial tool.
 * Geometry handling must stay transparent, explainable, and suitable for local export.
 */

import Drawing from "dxf-writer";

export type CoordinateInterpretation = "geographic" | "projected";

export interface ParcelPoint {
  x: number;
  y: number;
}

export interface ParcelRecord {
  id: string;
  title: string;
  subtitle: string;
  source: string;
  sourceAuthority: string;
  sourceUrl: string;
  coordinateSystem: string;
  coordinateInterpretation: CoordinateInterpretation;
  rings: ParcelPoint[][];
  metadata: Record<string, string>;
  disclaimer: string;
}

export interface ExportOptions {
  includeLabel: boolean;
  includeSourceNote: boolean;
}

export interface ParcelMetrics {
  areaSquareMeters: number;
  perimeterMeters: number;
  widthMeters: number;
  heightMeters: number;
  centroid: ParcelPoint;
}

export const OFFICIAL_SAMPLE_PARCELS: ParcelRecord[] = [
  {
    id: "hc-inspire-210161404125",
    title: "Official sample parcel",
    subtitle: "Hellenic Cadastre INSPIRE cadastral parcel 210161404125",
    source: "Hellenic Cadastre INSPIRE Cadastral Parcels WFS",
    sourceAuthority: "Hellenic Cadastre",
    sourceUrl:
      "https://gis.ktimanet.gr/inspire/rest/services/cadastralparcels/CadastralParcel/MapServer/exts/InspireFeatureDownload/service",
    coordinateSystem: "EPSG:4258 (ETRS89 geographic coordinates)",
    coordinateInterpretation: "geographic",
    rings: [
      [
        { x: 40.800316828, y: 24.263258817 },
        { x: 40.800638221, y: 24.263041151 },
        { x: 40.800720973, y: 24.263224924 },
        { x: 40.80063327, y: 24.263314163 },
        { x: 40.800338999, y: 24.263314103 },
        { x: 40.800316828, y: 24.263258817 },
      ],
    ],
    metadata: {
      "National cadastral reference": "210161404125",
      "INSPIRE local identifier": "KAEK.210161404125",
      "Service type": "OGC WFS 2.0.0",
      "Geometry record": "Polygon from official INSPIRE feature response",
    },
    disclaimer:
      "The cadastral INSPIRE parcel data presented in this prototype are used for informational and academic purposes and do not constitute legally valid extracts.",
  },
];

function closeRing(points: ParcelPoint[]): ParcelPoint[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) {
    return points;
  }
  return [...points, first];
}

export function parseCoordinateText(text: string): ParcelPoint[] {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  const points = rows.map((row) => {
    const values = row.split(/[;,\s]+/).filter(Boolean);
    if (values.length < 2) {
      throw new Error("Each line must contain two numeric values.");
    }

    const x = Number(values[0]);
    const y = Number(values[1]);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Coordinates must be numeric.");
    }

    return { x, y };
  });

  if (points.length < 3) {
    throw new Error("At least three coordinate pairs are required to form a parcel.");
  }

  return closeRing(points);
}

export function createManualParcel(points: ParcelPoint[]): ParcelRecord {
  return {
    id: "manual-parcel",
    title: "Manual parcel",
    subtitle: "User-defined coordinate sequence for local export",
    source: "User-supplied coordinates",
    sourceAuthority: "Local session",
    sourceUrl: "",
    coordinateSystem: "Local planar coordinates (meters)",
    coordinateInterpretation: "projected",
    rings: [closeRing(points)],
    metadata: {
      "Input mode": "Manual coordinate entry",
      "Export role": "Local preview and drafting output",
    },
    disclaimer:
      "User-defined coordinates are exported locally from the browser. The user remains responsible for the validity and interpretation of the geometry.",
  };
}

function averagePoint(points: ParcelPoint[]): ParcelPoint {
  const usable = points.length > 1 ? points.slice(0, -1) : points;
  const total = usable.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  const count = Math.max(usable.length, 1);
  return { x: total.x / count, y: total.y / count };
}

function projectGeographicPoint(
  point: ParcelPoint,
  anchor: ParcelPoint,
): ParcelPoint {
  const latRadians = (anchor.x * Math.PI) / 180;
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos(latRadians);

  return {
    x: (point.y - anchor.y) * metersPerDegreeLon,
    y: (point.x - anchor.x) * metersPerDegreeLat,
  };
}

export function getDisplayRings(parcel: ParcelRecord): ParcelPoint[][] {
  if (parcel.coordinateInterpretation === "projected") {
    return parcel.rings.map((ring) => closeRing(ring));
  }

  const anchor = averagePoint(parcel.rings[0]);
  return parcel.rings.map((ring) =>
    closeRing(ring).map((point) => projectGeographicPoint(point, anchor)),
  );
}

function calculateRingArea(points: ParcelPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function calculateRingPerimeter(points: ParcelPoint[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    total += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return total;
}

export function getParcelMetrics(parcel: ParcelRecord): ParcelMetrics {
  const displayRing = getDisplayRings(parcel)[0];
  const xs = displayRing.map((point) => point.x);
  const ys = displayRing.map((point) => point.y);
  const centroid = averagePoint(displayRing);

  return {
    areaSquareMeters: calculateRingArea(displayRing),
    perimeterMeters: calculateRingPerimeter(displayRing),
    widthMeters: Math.max(...xs) - Math.min(...xs),
    heightMeters: Math.max(...ys) - Math.min(...ys),
    centroid,
  };
}

export function formatMetric(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function createGeoJson(parcel: ParcelRecord): string {
  const coordinates = parcel.rings.map((ring) => {
    const closedRing = closeRing(ring);
    if (parcel.coordinateInterpretation === "geographic") {
      return closedRing.map((point) => [point.y, point.x]);
    }
    return closedRing.map((point) => [point.x, point.y]);
  });

  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            id: parcel.id,
            title: parcel.title,
            subtitle: parcel.subtitle,
            source: parcel.source,
            sourceAuthority: parcel.sourceAuthority,
            coordinateSystem: parcel.coordinateSystem,
            ...parcel.metadata,
          },
          geometry: {
            type: "Polygon",
            coordinates,
          },
        },
      ],
    },
    null,
    2,
  );
}

export function createKml(parcel: ParcelRecord): string {
  const ring = closeRing(parcel.rings[0]);
  const coordinateRows = ring
    .map((point) => {
      if (parcel.coordinateInterpretation === "geographic") {
        return `${point.y},${point.x},0`;
      }
      return `${point.x},${point.y},0`;
    })
    .join(" ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(parcel.title)}</name>
    <Placemark>
      <name>${escapeXml(parcel.title)}</name>
      <description>${escapeXml(parcel.subtitle)}</description>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinateRows}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createDxf(
  parcel: ParcelRecord,
  options: ExportOptions,
): string {
  const drawing = new Drawing();
  drawing.setUnits("Meters");

  drawing.addLayer("PARCEL_BOUNDARY", Drawing.ACI.BLUE, "CONTINUOUS");
  drawing.addLayer("PARCEL_LABELS", Drawing.ACI.GREEN, "CONTINUOUS");
  drawing.addLayer("SOURCE_NOTE", Drawing.ACI.WHITE, "DOTTED");

  const ring = getDisplayRings(parcel)[0];
  const metrics = getParcelMetrics(parcel);

  drawing.setActiveLayer("PARCEL_BOUNDARY");
  drawing.drawPolyline(
    ring.map((point) => [point.x, point.y]),
    true,
    0,
    0,
  );

  if (options.includeLabel) {
    drawing.setActiveLayer("PARCEL_LABELS");
    drawing.drawText(
      metrics.centroid.x,
      metrics.centroid.y,
      Math.max(metrics.widthMeters, metrics.heightMeters) / 18 || 1.6,
      0,
      parcel.metadata["National cadastral reference"] || parcel.title,
      "center",
      "middle",
    );
  }

  if (options.includeSourceNote) {
    drawing.setActiveLayer("SOURCE_NOTE");
    drawing.drawText(
      metrics.centroid.x,
      metrics.centroid.y - Math.max(metrics.heightMeters * 0.7, 4),
      Math.max(Math.min(metrics.widthMeters / 24, 1.5), 0.8),
      0,
      `${parcel.sourceAuthority} | ${parcel.source}`,
      "center",
      "top",
    );
  }

  return drawing.toDxfString();
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();

  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

export function createDefaultManualInput(): string {
  return [
    "0 0",
    "32 0",
    "35 18",
    "12 26",
    "-3 14",
  ].join("\n");
}
