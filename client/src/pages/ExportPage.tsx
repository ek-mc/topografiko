import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { useTheme } from "@/contexts/ThemeContext";
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
interface ExportPageProps {
  initialKaek?: string;
}

function PlaceholderBlock({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/50 p-3 text-muted-foreground transition-colors">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide">{title}</div>
      {children || <div className="h-16 rounded bg-muted" />}
    </div>
  );
}

export default function ExportPage({ initialKaek }: ExportPageProps) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
  const [paperSize] = useState<"A3" | "A4">("A3");

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
          const blocks = await Promise.all(
            candidates.map((candidate) => fetchParcelsInOT(candidate.rings))
          );
          const merged = Array.from(
            new Map(blocks.flat().map((item) => [item.kaek, item])).values()
          ).filter((item) => item.kaek !== result.kaek);
          const filtered = merged.filter((item) => {
            const info = (mainUseMap as Record<
              string,
              { code: string; category: string; subcategory: string }
            >)[item.mainUse];
            const category = info?.category || "";
            const subcategory = info?.subcategory || "";
            const isRoad =
              category.includes("ΟΔΙΚΟ") ||
              subcategory.includes("ΟΔΙΚΟ") ||
              item.mainUse === "5100";
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
    const blockParcels = otParcels.map((item) => ({
      kaek: item.kaek,
      rings: item.rings,
      current: false,
    }));
    return includeBlock
      ? [{ kaek: parcel.kaek, rings: parcel.rings, current: true }, ...blockParcels]
      : [{ kaek: parcel.kaek, rings: parcel.rings, current: true }];
  }, [parcel, otParcels, includeBlock]);

  const previewBounds = useMemo(() => {
    const points = [...contextParcels, ...previewParcels].flatMap((p) =>
      p.rings.flatMap((ring) => stripClosingPoint(ring))
    );
    return points.length ? boundsFromPoints(points) : null;
  }, [previewParcels, contextParcels]);

  const download = (format: "geojson" | "kml" | "dxf") => {
    if (!parcel) return;
    const parcels = previewParcels.map((p) => ({ kaek: p.kaek, rings: p.rings }));
    const base = includeBlock ? `${parcel.kaek}-ot` : parcel.kaek;
    if (format === "geojson") {
      downloadText(
        `${base}.geojson`,
        toGeoJSON(base, parcels),
        "application/geo+json;charset=utf-8"
      );
    }
    if (format === "kml") {
      downloadText(
        `${base}.kml`,
        toKML(base, parcels),
        "application/vnd.google-earth.kml+xml;charset=utf-8"
      );
    }
    if (format === "dxf") {
      downloadText(
        `${base}.dxf`,
        toDXF(parcels, {
          kaek: parcel.kaek,
          ot: teeData?.otNumber,
          municipality: teeData?.municipality,
          region: "(#Perifereia)",
          includeTitleBlock: mode === "full",
          coords,
          paperSize,
          scaleDenominator: 200,
        }),
        "application/dxf;charset=utf-8"
      );
    }
  };

  const coords = useMemo(
    () =>
      parcel
        ? stripClosingPoint(parcel.rings[0]).map((p, i) => ({
            i: i + 1,
            x: String(p.x),
            y: String(p.y),
          }))
        : [],
    [parcel]
  );

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground transition-colors">
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(initialKaek ? `/o/${initialKaek}` : "/")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Export</h1>
            <p className="text-sm text-muted-foreground">{initialKaek || "—"}</p>
          </div>
          <div className="ml-auto">
            <ThemeToggle compact />
          </div>
        </div>

        {loading ? <p className="text-sm text-muted-foreground">Loading export data…</p> : null}

        {parcel ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors">
              <div className="inline-flex rounded-2xl border border-border bg-muted/60 p-1 text-sm">
                {([
                  ["parcel", "Parcel"],
                  ["ot", "Ο.Τ."],
                  ["full", "Full"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={`rounded-xl px-4 py-2 transition-colors ${
                      mode === key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
                    }`}
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
                  <button
                    key={label}
                    type="button"
                    onClick={() => setter((v) => !v)}
                    className={`rounded-full border px-3 py-1.5 transition-colors ${
                      state
                        ? "border-blue-300 bg-blue-500/10 text-blue-700 dark:border-blue-400/40 dark:bg-blue-400/15 dark:text-blue-200"
                        : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="inline-flex rounded-2xl border border-border bg-muted/60 p-1 text-sm">
                {(["A3", "A4", "A2"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    disabled={size !== "A3"}
                    className={`rounded-xl px-4 py-2 ${
                      size === "A3" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground/60"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>

              <div className="ml-auto grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => download("dxf")}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Download className="h-4 w-4" />DXF
                </button>
                <button
                  type="button"
                  onClick={() => download("kml")}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Download className="h-4 w-4" />KML
                </button>
                <button
                  type="button"
                  onClick={() => download("geojson")}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Download className="h-4 w-4" />GeoJSON
                </button>
              </div>
            </div>

            <div className="overflow-auto rounded-2xl border border-border bg-muted/40 p-4 shadow-sm transition-colors">
              <div
                className="mx-auto min-w-[1400px] bg-card p-6 transition-colors"
                style={{ aspectRatio: "420 / 297" }}
              >
                <div className="grid h-full grid-cols-[1fr_360px] grid-rows-[1fr_auto] gap-4 border border-border p-4">
                  <div className="relative rounded-xl border border-border bg-muted/40 p-3 transition-colors">
                    <div className="absolute right-4 top-4 flex flex-col items-center text-xs text-muted-foreground">
                      <div className="mb-1 font-semibold">Β</div>
                      <div className="h-10 w-px bg-neutral-500 dark:bg-neutral-300" />
                      <div className="-mt-10 h-0 w-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent border-b-neutral-500 dark:border-b-neutral-300" />
                    </div>
                    <div className="absolute left-4 top-4 text-xs text-muted-foreground">Κλίμακα 1:200</div>
                    {previewBounds ? (
                      <svg viewBox="0 0 320 320" className="h-full w-full">
                        <rect x="0" y="0" width="320" height="320" fill={isDark ? "#0f172a" : "#fafafa"} />
                        {teeCandidates.flatMap((candidate) => candidate.rings).map((ring, index) => (
                          <path
                            key={index}
                            d={pathFromRingWithBounds(ring, previewBounds)}
                            fill={isDark ? "rgba(96,165,250,0.08)" : "rgba(59,130,246,0.04)"}
                            stroke={isDark ? "#64748b" : "#cbd5e1"}
                            strokeWidth="1.2"
                          />
                        ))}
                        {mode !== "parcel"
                          ? null
                          : contextParcels.map((item) => {
                              const path = pathFromRingWithBounds(item.rings[0], previewBounds);
                              return (
                                <path
                                  key={`ctx-${item.kaek}`}
                                  d={path}
                                  fill={isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.08)"}
                                  stroke={isDark ? "#64748b" : "#cbd5e1"}
                                  strokeWidth="1"
                                />
                              );
                            })}
                        {previewParcels.map((item) => {
                          const path = pathFromRingWithBounds(item.rings[0], previewBounds);
                          const pts = stripClosingPoint(item.rings[0]);
                          const cx = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length);
                          const cy = pts.reduce((a, p) => a + p.y, 0) / Math.max(1, pts.length);
                          const c = projectPoint({ x: cx, y: cy }, previewBounds);
                          return (
                            <g key={item.kaek}>
                              <path
                                d={path}
                                fill={
                                  item.current
                                    ? isDark
                                      ? "rgba(96,165,250,0.16)"
                                      : "rgba(59,130,246,0.08)"
                                    : isDark
                                      ? "rgba(148,163,184,0.14)"
                                      : "rgba(148,163,184,0.10)"
                                }
                                stroke={item.current ? (isDark ? "#93c5fd" : "#60a5fa") : isDark ? "#cbd5e1" : "#94a3b8"}
                                strokeWidth={item.current ? "2.2" : "1.2"}
                              />
                              <text
                                x={c.x}
                                y={c.y + 4}
                                fontSize="7.5"
                                textAnchor="middle"
                                fill={item.current ? (isDark ? "#dbeafe" : "#1e3a8a") : isDark ? "#e2e8f0" : "#475569"}
                              >
                                {item.kaek}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    ) : null}
                  </div>

                  <div className="grid grid-rows-[auto_auto_1fr] gap-4">
                    {showParcelData ? (
                      <div className="rounded-xl border border-border bg-card p-3 text-sm transition-colors">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Στοιχεία Οικοπέδου
                        </div>
                        <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1">
                          <div>KAEK</div>
                          <div>{parcel.kaek}</div>
                          <div>Καλλικρατικός Δήμος</div>
                          <div>{teeData?.municipality || "—"}</div>
                          <div>Ο.Τ.</div>
                          <div>{teeData?.otNumber || "—"}</div>
                          <div>Εμβαδό</div>
                          <div>{parcel.area?.toFixed(2) || "—"} m²</div>
                          <div>Περίμετρος</div>
                          <div>{parcel.perimeter?.toFixed(2) || "—"} m</div>
                        </div>
                      </div>
                    ) : null}

                    {showCoords ? (
                      <div className="rounded-xl border border-border bg-card p-3 text-xs transition-colors">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Συντεταγμένες Κορυφών
                        </div>
                        <div className="grid grid-cols-[40px_1fr_1fr] gap-x-2 gap-y-1">
                          <div className="font-medium">#</div>
                          <div className="font-medium">X</div>
                          <div className="font-medium">Y</div>
                          {coords.slice(0, 8).map((row) => (
                            <Fragment key={row.i}>
                              <div>{row.i}</div>
                              <div>{row.x}</div>
                              <div>{row.y}</div>
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-3">
                      {showLegend ? (
                        <PlaceholderBlock title="Υπόμνημα / Layers">
                          <div className="space-y-1 text-xs">
                            <div>parcel-boundary</div>
                            <div>ot-boundary</div>
                            <div>adjacent-blocks</div>
                            <div>north-arrow / scale</div>
                            <div>grey-placeholders</div>
                          </div>
                        </PlaceholderBlock>
                      ) : null}
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
                      <div className="rounded-xl border border-border bg-card p-3 text-xs transition-colors">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Title Block
                        </div>
                        <div className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1">
                          <div>Σχέδιο</div>
                          <div>Τοπογραφικό Διάγραμμα</div>
                          <div>KAEK</div>
                          <div>{parcel.kaek}</div>
                          <div>Ο.Τ.</div>
                          <div>{teeData?.otNumber || "—"}</div>
                          <div>Δήμος</div>
                          <div>{teeData?.municipality || "—"}</div>
                          <div>Κλίμακα</div>
                          <div>1:200</div>
                          <div>Ημερομηνία</div>
                          <div>{new Date().toLocaleDateString("el-GR")}</div>
                          <div>Μελετητής</div>
                          <div className="text-muted-foreground/70">grey placeholder</div>
                          <div>Έργο</div>
                          <div className="text-muted-foreground/70">grey placeholder</div>
                          <div>Θέση</div>
                          <div className="text-muted-foreground/70">grey placeholder</div>
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
