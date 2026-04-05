import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import mainUseMap from "@shared/main-use-map.json";
import {
  boundsFromPoints,
  downloadText,
  fetchParcelByKaek,
  fetchParcelsInOT,
  fetchTEECandidates,
  NeighborParcel,
  ParcelData,
  pathFromRingWithBounds,
  Point,
  projectPoint,
  stripClosingPoint,
  TEEData,
  toDXF,
  toGeoJSON,
  toKML,
} from "@/lib/topografiko";

interface ExportPageProps { initialKaek?: string }

export default function ExportPage({ initialKaek }: ExportPageProps) {
  const navigate = useNavigate();
  const [parcel, setParcel] = useState<ParcelData | null>(null);
  const [teeData, setTeeData] = useState<TEEData | null>(null);
  const [teeCandidates, setTeeCandidates] = useState<TEEData[]>([]);
  const [otParcels, setOtParcels] = useState<NeighborParcel[]>([]);
  const [contextParcels, setContextParcels] = useState<NeighborParcel[]>([]);
  const [loading, setLoading] = useState(false);
  const [wholeBlock, setWholeBlock] = useState(false);

  useEffect(() => {
    if (!initialKaek) return;
    (async () => {
      setLoading(true);
      const result = await fetchParcelByKaek(initialKaek);
      setParcel(result);
      if (result) {
        const candidates = await fetchTEECandidates(result.rings);
        setTeeCandidates(candidates);
        const tee = candidates[0] || null;
        setTeeData(tee);
        if (candidates.length) {
          const blocks = await Promise.all(candidates.map((candidate) => fetchParcelsInOT(candidate.rings)));
          const merged = Array.from(new Map(blocks.flat().map((item) => [item.kaek, item])).values()).filter((item) => item.kaek !== result.kaek);
          const filtered = merged.filter((item) => {
            const info = (mainUseMap as Record<string, { code: string; category: string; subcategory: string }>)[item.mainUse];
            const category = info?.category || "";
            const subcategory = info?.subcategory || "";
            const isRoad = category.includes("ΟΔΙΚΟ") || subcategory.includes("ΟΔΙΚΟ") || item.mainUse === "5100";
            const isHuge = (item.area ?? 0) > 5000;
            return !isRoad && !isHuge;
          });
          setOtParcels(filtered);
          setContextParcels(filtered);
        }
      }
      setLoading(false);
    })();
  }, [initialKaek]);

  const previewParcels = useMemo(() => {
    if (!parcel) return [] as Array<{ kaek: string; rings: Point[][]; current: boolean }>;
    const blockParcels = otParcels.map((item) => ({ kaek: item.kaek, rings: item.rings, current: false }));
    return wholeBlock ? [{ kaek: parcel.kaek, rings: parcel.rings, current: true }, ...blockParcels] : [{ kaek: parcel.kaek, rings: parcel.rings, current: true }];
  }, [parcel, otParcels, wholeBlock]);

  const previewBounds = useMemo(() => {
    const points = [...contextParcels, ...previewParcels].flatMap((p) => p.rings.flatMap((ring) => stripClosingPoint(ring)));
    return points.length ? boundsFromPoints(points) : null;
  }, [previewParcels]);

  const download = (format: "geojson" | "kml" | "dxf") => {
    if (!parcel) return;
    const parcels = previewParcels.map((p) => ({ kaek: p.kaek, rings: p.rings }));
    const base = wholeBlock ? `${parcel.kaek}-ot` : parcel.kaek;
    if (format === "geojson") downloadText(`${base}.geojson`, toGeoJSON(base, parcels), "application/geo+json;charset=utf-8");
    if (format === "kml") downloadText(`${base}.kml`, toKML(base, parcels), "application/vnd.google-earth.kml+xml;charset=utf-8");
    if (format === "dxf") downloadText(`${base}.dxf`, toDXF(parcels), "application/dxf;charset=utf-8");
  };

  return (
    <main className="min-h-screen bg-white px-4 py-10 text-neutral-900">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(initialKaek ? `/o/${initialKaek}` : "/")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold">Export</h1>
            <p className="text-sm text-neutral-500">{initialKaek || "—"}</p>
          </div>
        </div>

        {loading ? <p className="text-sm text-neutral-500">Loading export data…</p> : null}

        {parcel ? (
          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm space-y-4">
            <label className="flex items-center gap-3 text-sm text-neutral-700">
              <input type="checkbox" checked={wholeBlock} onChange={(e) => setWholeBlock(e.target.checked)} />
              export όλο το τετράγωνο
            </label>

            {previewBounds ? (
              <svg viewBox="0 0 320 320" className="w-full max-h-[520px] rounded-xl border border-neutral-200 bg-neutral-50">
                <rect x="0" y="0" width="320" height="320" fill="#fafafa" />
                {teeCandidates.flatMap((candidate) => candidate.rings).map((ring, index) => (
                  <path key={index} d={pathFromRingWithBounds(ring, previewBounds)} fill="rgba(59,130,246,0.04)" stroke="#cbd5e1" strokeWidth="1.2" />
                ))}
                {!wholeBlock ? contextParcels.map((item) => {
                  const path = pathFromRingWithBounds(item.rings[0], previewBounds);
                  return <path key={`ctx-${item.kaek}`} d={path} fill="rgba(148,163,184,0.08)" stroke="#cbd5e1" strokeWidth="1" />;
                }) : null}
                {previewParcels.map((item) => {
                  const path = pathFromRingWithBounds(item.rings[0], previewBounds);
                  const pts = stripClosingPoint(item.rings[0]);
                  const cx = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length);
                  const cy = pts.reduce((a, p) => a + p.y, 0) / Math.max(1, pts.length);
                  const c = projectPoint({ x: cx, y: cy }, previewBounds);
                  return (
                    <g key={item.kaek}>
                      <path d={path} fill={item.current ? "rgba(59,130,246,0.08)" : "rgba(148,163,184,0.10)"} stroke={item.current ? "#60a5fa" : "#94a3b8"} strokeWidth={item.current ? "2.2" : "1.2"} />
                      <text x={c.x} y={c.y + 4} fontSize="7.5" textAnchor="middle" fill={item.current ? "#1e3a8a" : "#475569"}>{item.kaek}</text>
                    </g>
                  );
                })}
              </svg>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <button type="button" onClick={() => download("dxf")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50"><Download className="h-4 w-4" />DXF</button>
              <button type="button" onClick={() => download("kml")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50"><Download className="h-4 w-4" />KML</button>
              <button type="button" onClick={() => download("geojson")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50"><Download className="h-4 w-4" />GeoJSON</button>
            </div>

          </section>
        ) : null}
      </div>
    </main>
  );
}
