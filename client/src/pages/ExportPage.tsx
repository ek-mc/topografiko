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

type ExportMode = "parcel" | "ot" | "full";
interface ExportPageProps { initialKaek?: string }

function PlaceholderBlock({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-100/70 p-3 text-neutral-500">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide">{title}</div>
      {children || <div className="h-16 rounded bg-neutral-200/70" />}
    </div>
  );
}

export default function ExportPage({ initialKaek }: ExportPageProps) {
  const navigate = useNavigate();
  const [parcel, setParcel] = useState<ParcelData | null>(null);
  const [teeData, setTeeData] = useState<TEEData | null>(null);
  const [teeCandidates, setTeeCandidates] = useState<TEEData[]>([]);
  const [otParcels, setOtParcels] = useState<NeighborParcel[]>([]);
  const [contextParcels, setContextParcels] = useState<NeighborParcel[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ExportMode>("parcel");
  const [showCoords, setShowCoords] = useState(true);
  const [showParcelData, setShowParcelData] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showTitleBlock, setShowTitleBlock] = useState(true);
  const [showTerms, setShowTerms] = useState(true);

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

  const includeBlock = mode !== "parcel";
  const previewParcels = useMemo(() => {
    if (!parcel) return [] as Array<{ kaek: string; rings: Point[][]; current: boolean }>;
    const blockParcels = otParcels.map((item) => ({ kaek: item.kaek, rings: item.rings, current: false }));
    return includeBlock ? [{ kaek: parcel.kaek, rings: parcel.rings, current: true }, ...blockParcels] : [{ kaek: parcel.kaek, rings: parcel.rings, current: true }];
  }, [parcel, otParcels, includeBlock]);

  const previewBounds = useMemo(() => {
    const points = [...contextParcels, ...previewParcels].flatMap((p) => p.rings.flatMap((ring) => stripClosingPoint(ring)));
    return points.length ? boundsFromPoints(points) : null;
  }, [previewParcels, contextParcels]);

  const download = (format: "geojson" | "kml" | "dxf") => {
    if (!parcel) return;
    const parcels = previewParcels.map((p) => ({ kaek: p.kaek, rings: p.rings }));
    const base = includeBlock ? `${parcel.kaek}-ot` : parcel.kaek;
    if (format === "geojson") downloadText(`${base}.geojson`, toGeoJSON(base, parcels), "application/geo+json;charset=utf-8");
    if (format === "kml") downloadText(`${base}.kml`, toKML(base, parcels), "application/vnd.google-earth.kml+xml;charset=utf-8");
    if (format === "dxf") downloadText(`${base}.dxf`, toDXF(parcels, { kaek: parcel.kaek, ot: teeData?.otNumber, municipality: teeData?.municipality, region: "(#Περιφέρεια)", includeTitleBlock: mode === "full" }), "application/dxf;charset=utf-8");
  };

  const coords = useMemo(() => parcel ? stripClosingPoint(parcel.rings[0]).map((p, i) => ({ i: i + 1, x: p.x, y: p.y })) : [], [parcel]);

  return (
    <main className="min-h-screen bg-white px-4 py-8 text-neutral-900">
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(initialKaek ? `/o/${initialKaek}` : "/")} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold">Export</h1>
            <p className="text-sm text-neutral-500">{initialKaek || "—"}</p>
          </div>
        </div>

        {loading ? <p className="text-sm text-neutral-500">Loading export data…</p> : null}

        {parcel ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="inline-flex rounded-2xl border border-neutral-300 bg-neutral-100 p-1 text-sm">
                {([
                  ["parcel", "Parcel"],
                  ["ot", "Ο.Τ."],
                  ["full", "Full"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={`rounded-xl px-4 py-2 ${mode === key ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="inline-flex flex-wrap gap-2 text-sm">
                {[
                  { state: showCoords, setter: setShowCoords, label: "Συντεταγμένες" },
                  { state: showParcelData, setter: setShowParcelData, label: "Στοιχεία" },
                  { state: showLegend, setter: setShowLegend, label: "Υπόμνημα" },
                  { state: showTitleBlock, setter: setShowTitleBlock, label: "Title block" },
                  { state: showTerms, setter: setShowTerms, label: "Όροι / Notes" },
                ].map(({ state, setter, label }) => (
                  <button key={label} type="button" onClick={() => setter((v) => !v)} className={`rounded-full border px-3 py-1.5 ${state ? "border-blue-200 bg-blue-50 text-blue-700" : "border-neutral-300 bg-white text-neutral-500"}`}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="ml-auto grid gap-2 sm:grid-cols-3">
                <button type="button" onClick={() => download("dxf")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50"><Download className="h-4 w-4" />DXF</button>
                <button type="button" onClick={() => download("kml")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50"><Download className="h-4 w-4" />KML</button>
                <button type="button" onClick={() => download("geojson")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50"><Download className="h-4 w-4" />GeoJSON</button>
              </div>
            </div>

            <div className="overflow-auto rounded-2xl border border-neutral-300 bg-neutral-50 p-4 shadow-sm">
              <div className="mx-auto min-w-[1400px] bg-white p-6" style={{ aspectRatio: "420 / 297" }}>
                <div className="grid h-full grid-cols-[1fr_360px] grid-rows-[1fr_auto] gap-4 border border-neutral-400 p-4">
                  <div className="relative rounded-xl border border-neutral-300 bg-neutral-50 p-3">
                    <div className="absolute right-4 top-4 flex flex-col items-center text-xs text-neutral-500">
                      <div className="mb-1 font-semibold">Β</div>
                      <div className="h-10 w-px bg-neutral-500" />
                      <div className="-mt-10 h-0 w-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent border-b-neutral-500" />
                    </div>
                    <div className="absolute left-4 top-4 text-xs text-neutral-500">Κλίμακα 1:200</div>
                    {previewBounds ? (
                      <svg viewBox="0 0 320 320" className="h-full w-full">
                        <rect x="0" y="0" width="320" height="320" fill="#fafafa" />
                        {teeCandidates.flatMap((candidate) => candidate.rings).map((ring, index) => (
                          <path key={index} d={pathFromRingWithBounds(ring, previewBounds)} fill="rgba(59,130,246,0.04)" stroke="#cbd5e1" strokeWidth="1.2" />
                        ))}
                        {mode !== "parcel" ? null : contextParcels.map((item) => {
                          const path = pathFromRingWithBounds(item.rings[0], previewBounds);
                          return <path key={`ctx-${item.kaek}`} d={path} fill="rgba(148,163,184,0.08)" stroke="#cbd5e1" strokeWidth="1" />;
                        })}
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
                  </div>

                  <div className="grid grid-rows-[auto_auto_1fr] gap-4">
                    {showParcelData ? (
                      <div className="rounded-xl border border-neutral-300 bg-white p-3 text-sm">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Στοιχεία Οικοπέδου</div>
                        <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1">
                          <div>KAEK</div><div>{parcel.kaek}</div>
                          <div>Καλλικρατικός Δήμος</div><div>{teeData?.municipality || "—"}</div>
                          <div>Ο.Τ.</div><div>{teeData?.otNumber || "—"}</div>
                          <div>Εμβαδό</div><div>{parcel.area?.toFixed(2) || "—"} m²</div>
                          <div>Περίμετρος</div><div>{parcel.perimeter?.toFixed(2) || "—"} m</div>
                        </div>
                      </div>
                    ) : null}

                    {showCoords ? (
                      <div className="rounded-xl border border-neutral-300 bg-white p-3 text-xs">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Συντεταγμένες Κορυφών</div>
                        <div className="grid grid-cols-[40px_1fr_1fr] gap-x-2 gap-y-1">
                          <div className="font-medium">#</div><div className="font-medium">X</div><div className="font-medium">Y</div>
                          {coords.slice(0, 8).map((row) => (
                            <>
                              <div key={`i-${row.i}`}>{row.i}</div>
                              <div key={`x-${row.i}`}>{row.x.toFixed(2)}</div>
                              <div key={`y-${row.i}`}>{row.y.toFixed(2)}</div>
                            </>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-3">
                      {showLegend ? <PlaceholderBlock title="Υπόμνημα / Layers"><div className="space-y-1 text-xs"><div>parcel-boundary</div><div>ot-boundary</div><div>adjacent-blocks</div><div>north-arrow / scale</div><div>grey-placeholders</div></div></PlaceholderBlock> : null}
                      {showTerms ? <PlaceholderBlock title="Όροι Δόμησης / Πολεοδομικά Στοιχεία" /> : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_320px] gap-4">
                    <div className="grid gap-4">
                      {mode === "full" ? (
                        <div className="grid grid-cols-2 gap-4">
                          <PlaceholderBlock title="Ρυμοτομικές Γραμμές" />
                          <PlaceholderBlock title="Οικοδομικές Γραμμές / Πρασιές" />
                        </div>
                      ) : null}
                      {mode === "full" ? (
                        <div className="grid grid-cols-2 gap-4">
                          <PlaceholderBlock title="Απόσπασμα Ρυμοτομικού" />
                          <PlaceholderBlock title="Φωτογραφική Απεικόνιση / Notes" />
                        </div>
                      ) : null}
                    </div>

                    {showTitleBlock ? (
                      <div className="rounded-xl border border-neutral-300 bg-white p-3 text-xs">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Title Block</div>
                        <div className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1">
                          <div>Σχέδιο</div><div>Τοπογραφικό Διάγραμμα</div>
                          <div>KAEK</div><div>{parcel.kaek}</div>
                          <div>Ο.Τ.</div><div>{teeData?.otNumber || "—"}</div>
                          <div>Δήμος</div><div>{teeData?.municipality || "—"}</div>
                          <div>Κλίμακα</div><div>1:200</div>
                          <div>Ημερομηνία</div><div>{new Date().toLocaleDateString("el-GR")}</div>
                          <div>Μελετητής</div><div className="text-neutral-400">grey placeholder</div>
                          <div>Έργο</div><div className="text-neutral-400">grey placeholder</div>
                          <div>Θέση</div><div className="text-neutral-400">grey placeholder</div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
