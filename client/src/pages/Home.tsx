import { Search, Download } from "lucide-react";
import { useMemo, useState } from "react";

type Point = { x: number; y: number };
type ParcelData = {
  kaek: string;
  area: number | null;
  perimeter: number | null;
  mainUse: string;
  description: string;
  link: string;
  rings: Point[][];
  raw: Record<string, unknown>;
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

function normalizeRing(points: Point[]) {
  const usable = points.length > 1 ? points.slice(0, -1) : points;
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
  const usable = points.length > 1 ? points.slice(0, -1) : points;
  const xs = usable.map((p) => p.x);
  const ys = usable.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function shapePath(points: Point[]) {
  const usable = normalizeRing(points);
  if (!usable.length) return "";
  const b = boundsFromRing(points);
  const width = Math.max(1, b.maxX - b.minX);
  const height = Math.max(1, b.maxY - b.minY);
  const pad = 18;
  const size = 320;
  const scale = Math.min((size - pad * 2) / width, (size - pad * 2) / height);

  return usable
    .map((point, index) => {
      const sx = pad + (point.x - b.minX) * scale;
      const sy = size - pad - (point.y - b.minY) * scale;
      return `${index === 0 ? "M" : "L"}${sx.toFixed(2)},${sy.toFixed(2)}`;
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

  return {
    kaek: feature.attributes?.KAEK || normalized,
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

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [parcel, setParcel] = useState<ParcelData | null>(null);

  const primaryRing = useMemo(() => normalizeRing(parcel?.rings?.[0] ?? []), [parcel]);
  const path = useMemo(() => (primaryRing.length ? shapePath(primaryRing) : ""), [primaryRing]);
  const lengths = useMemo(() => (primaryRing.length ? edgeLengths(primaryRing) : []), [primaryRing]);

  const visibleRows = useMemo(() => {
    if (!parcel) return [] as Array<[string, string]>;
    const attrs = parcel.raw;
    return [
      ["KAEK", parcel.kaek],
      ["Εμβαδό", parcel.area != null ? `${formatNumber(parcel.area, 2)} m²` : "—"],
      ["Περίμετρος", parcel.perimeter != null ? `${formatNumber(parcel.perimeter, 2)} m` : "—"],
      ["Κύρια χρήση", parcel.mainUse || "—"],
      ["Περιγραφή", parcel.description || "—"],
      ["ΟΤΑ / link", parcel.link || "—"],
      ["PROP_VERT", attrs.PROP_VERT != null ? String(attrs.PROP_VERT) : "—"],
      ["PROP_HOR", attrs.PROP_HOR != null ? String(attrs.PROP_HOR) : "—"],
      ["Ποσοστό επί της ιδιοκτησίας", attrs.PERCENTAGE != null ? `${attrs.PERCENTAGE}%` : "—"],
    ];
  }, [parcel]);

  const handleSubmit = async () => {
    const value = query.trim();
    if (!value) {
      setMessage("Enter a KAEK first.");
      return;
    }

    setLoading(true);
    setMessage("Searching…");
    setParcel(null);

    try {
      const result = await fetchParcelByKaek(value);
      if (!result) {
        setMessage("No parcel found for this KAEK.");
        return;
      }
      setParcel(result);
      setMessage("");
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

              <svg viewBox="0 0 320 320" className="w-full rounded-xl border border-neutral-200 bg-neutral-50">
                <path d={path} fill="rgba(17,24,39,0.08)" stroke="#111827" strokeWidth="2" />
                {(primaryRing.length ? primaryRing : []).map((point, index) => {
                  const b = boundsFromRing(primaryRing);
                  const width = Math.max(1, b.maxX - b.minX);
                  const height = Math.max(1, b.maxY - b.minY);
                  const pad = 18;
                  const size = 320;
                  const scale = Math.min((size - pad * 2) / width, (size - pad * 2) / height);
                  const sx = pad + (point.x - b.minX) * scale;
                  const sy = size - pad - (point.y - b.minY) * scale;
                  return (
                    <g key={index}>
                      <circle cx={sx} cy={sy} r="3.2" fill="#111827" />
                      <text x={sx + 6} y={sy - 6} fontSize="12" fill="#111827">{greekLabel(index)}</text>
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
                    {visibleRows.map(([label, value]) => (
                      <tr key={label} className="border-b border-neutral-200 last:border-b-0">
                        <th className="w-52 bg-neutral-50 px-4 py-3 text-left font-medium text-neutral-600">{label}</th>
                        <td className="px-4 py-3 text-neutral-900">{value}</td>
                      </tr>
                    ))}
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
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
