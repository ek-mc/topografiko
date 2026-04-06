import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import NorthArrow from "@/components/NorthArrow";
import ThemeToggle from "@/components/ThemeToggle";
import { useTheme } from "@/contexts/ThemeContext";
import mainUseMap from "@shared/main-use-map.json";
import {
  boundsFromPoints,
  centroidOfRing,
  downloadText,
  fetchParcelByKaek,
  fetchParcelsInOT,
  fetchTEECandidates,
  filterAdjacentParcels,
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm transition-colors">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function PlaceholderBlock({ title, height = "h-20" }: { title: string; height?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 p-3 transition-colors">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className={`rounded-lg bg-muted/70 ${height}`} />
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
  const [scaleDenominator, setScaleDenominator] = useState<100 | 200 | 500 | 1000>(200);

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

        if (tee?.rings?.length) {
          const selectedOtParcels = await fetchParcelsInOT(tee.rings, result.kaek);
          const filtered = selectedOtParcels.filter((item) => {
            const info = (mainUseMap as Record<string, { code: string; category: string; subcategory: string }>)[item.mainUse];
            const category = info?.category || "";
            const subcategory = info?.subcategory || "";
            const isRoad = category.includes("ΟΔΙΚΟ") || subcategory.includes("ΟΔΙΚΟ") || item.mainUse === "5100";
            const isHuge = (item.area ?? 0) > 5000;
            return !isRoad && !isHuge;
          });
          const adjacent = filterAdjacentParcels(result.rings, filtered);
          setOtParcels(adjacent);
          setContextParcels(adjacent);
        } else {
          setOtParcels([]);
          setContextParcels([]);
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
    const points = [
      ...contextParcels,
      ...previewParcels,
      ...teeCandidates.map((candidate) => ({ rings: candidate.rings } as { rings: Point[][] })),
    ].flatMap((p) => p.rings.flatMap((ring) => stripClosingPoint(ring)));
    return points.length ? boundsFromPoints(points) : null;
  }, [previewParcels, contextParcels, teeCandidates]);

  const coords = useMemo(
    () =>
      parcel
        ? stripClosingPoint(parcel.rings[0]).map((p, i) => ({
            i: i + 1,
            x: String(p.x),
            y: String(p.y),
          }))
        : [],
    [parcel],
  );

  const download = (format: "geojson" | "kml" | "dxf") => {
    if (!parcel) return;

    const parcels = previewParcels.map((p) => ({ kaek: p.kaek, rings: p.rings }));
    const base = includeBlock ? `${parcel.kaek}-ot` : parcel.kaek;

    if (format === "geojson") {
      downloadText(`${base}.geojson`, toGeoJSON(base, parcels), "application/geo+json;charset=utf-8");
    }

    if (format === "kml") {
      downloadText(`${base}.kml`, toKML(base, parcels), "application/vnd.google-earth.kml+xml;charset=utf-8");
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
          scaleDenominator,
          otRings: teeData?.rings,
        }),
        "application/dxf",
        false,
      );
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground transition-colors">
      <div className="mx-auto w-full max-w-[1440px] space-y-6">
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
                {(["A4", "A3", "A1"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    disabled={size !== "A3"}
                    className={`rounded-xl px-4 py-2 ${size === "A3" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground/60"}`}
                  >
                    {size}
                  </button>
                ))}
              </div>

              <div className="inline-flex rounded-2xl border border-border bg-muted/60 p-1 text-sm">
                {([1000, 500, 200, 100] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScaleDenominator(value)}
                    className={`rounded-xl px-4 py-2 transition-colors ${
                      scaleDenominator === value
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
                    }`}
                  >
                    1:{value}
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
                  disabled
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground/50 opacity-60"
                >
                  <Download className="h-4 w-4" />KML
                </button>
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground/50 opacity-60"
                >
                  <Download className="h-4 w-4" />GeoJSON
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors lg:p-5">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-xl border border-border bg-muted/40 shadow-inner transition-colors">
                    {previewBounds ? (
                      <svg viewBox="0 0 320 320" className="aspect-square w-full">
                        <rect x="0" y="0" width="320" height="320" fill={isDark ? "#0f172a" : "#f8fafc"} />
                        <rect x="24" y="18" width="214" height="278" fill="none" stroke={isDark ? "#94a3b8" : "#64748b"} strokeWidth="0.9" />
                        <line x1="238" y1="8" x2="238" y2="312" stroke={isDark ? "#94a3b8" : "#64748b"} strokeWidth="0.9" />
                        <NorthArrow isDark={isDark} />
                        {teeCandidates.flatMap((candidate) => candidate.rings).map((ring, index) => (
                          <path
                            key={index}
                            d={pathFromRingWithBounds(ring, previewBounds)}
                            fill="none"
                            stroke="#22c55e"
                            strokeWidth="1.6"
                          />
                        ))}
                        {previewParcels.filter((item) => !item.current).map((item) => {
                          const path = pathFromRingWithBounds(item.rings[0], previewBounds);
                          const center = projectPoint(centroidOfRing(item.rings[0]), previewBounds);
                          return (
                            <g key={`adj-${item.kaek}`}>
                              <path
                                d={path}
                                fill="none"
                                stroke={isDark ? "#cbd5e1" : "#64748b"}
                                strokeWidth="1"
                                strokeDasharray="5 3"
                              />
                              <text
                                x={center.x}
                                y={center.y + 3}
                                fontSize="6"
                                textAnchor="middle"
                                fill={isDark ? "#e2e8f0" : "#475569"}
                              >
                                {item.kaek}
                              </text>
                            </g>
                          );
                        })}
                        {previewParcels.filter((item) => item.current).map((item) => {
                          const path = pathFromRingWithBounds(item.rings[0], previewBounds);
                          const c = projectPoint(centroidOfRing(item.rings[0]), previewBounds);
                          return (
                            <g key={item.kaek}>
                              <path
                                d={path}
                                fill="none"
                                stroke={isDark ? "#f8fafc" : "#111827"}
                                strokeWidth="1.5"
                              />
                              <text
                                x={c.x}
                                y={c.y + 3}
                                fontSize="6.5"
                                textAnchor="middle"
                                fill={isDark ? "#f8fafc" : "#111827"}
                              >
                                {item.kaek}
                              </text>
                            </g>
                          );
                        })}
                        {(() => {
                          const otRing = teeData?.rings?.[0];
                          if (!otRing) return null;
                          const c = projectPoint(centroidOfRing(otRing), previewBounds);
                          return (
                            <g>
                              <circle cx={c.x} cy={c.y} r="10" fill="none" stroke={isDark ? "#e2e8f0" : "#111827"} strokeWidth="1" />
                              <text x={c.x} y={c.y - 1} fontSize="4.2" textAnchor="middle" fill={isDark ? "#f8fafc" : "#111827"}>Ο.Τ.</text>
                              <text x={c.x} y={c.y + 5} fontSize="4.2" textAnchor="middle" fill={isDark ? "#f8fafc" : "#111827"}>{teeData?.otNumber || "-"}</text>
                            </g>
                          );
                        })()}
                        {Array.from({ length: 4 }).map((_, ix) => {
                          const x = 56 + ix * 50;
                          return Array.from({ length: 4 }).map((__, iy) => {
                            const y = 52 + iy * 56;
                            return (
                              <g key={`${ix}-${iy}`}>
                                <line x1={x - 4} y1={y} x2={x + 4} y2={y} stroke={isDark ? "#cbd5e1" : "#64748b"} strokeWidth="0.8" />
                                <line x1={x} y1={y - 4} x2={x} y2={y + 4} stroke={isDark ? "#cbd5e1" : "#64748b"} strokeWidth="0.8" />
                              </g>
                            );
                          });
                        })}
                        <g>
                          <line x1="250" y1="258" x2="270" y2="258" stroke="#22c55e" strokeWidth="1.6" />
                          <text x="276" y="261" fontSize="5.5" fill={isDark ? "#e2e8f0" : "#334155"}>ρυμοτομική γραμμή</text>
                          <line x1="250" y1="272" x2="270" y2="272" stroke={isDark ? "#f8fafc" : "#111827"} strokeWidth="1.3" />
                          <text x="276" y="275" fontSize="5.5" fill={isDark ? "#e2e8f0" : "#334155"}>οικοδομική γραμμή</text>
                          <line x1="250" y1="286" x2="270" y2="286" stroke={isDark ? "#cbd5e1" : "#64748b"} strokeWidth="1" strokeDasharray="5 3" />
                          <text x="276" y="289" fontSize="5.5" fill={isDark ? "#e2e8f0" : "#334155"}>όριο οικοπέδων</text>
                        </g>
                        <text x="250" y="20" fontSize="6" fill={isDark ? "#e2e8f0" : "#334155"}>Κλίμακα 1:{scaleDenominator}</text>
                      </svg>
                    ) : null}
                  </div>

                  {mode === "full" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-xs uppercase tracking-wide text-muted-foreground">
                        Visual placeholder for additional plan overlays
                      </div>
                      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-xs uppercase tracking-wide text-muted-foreground">
                        Visual placeholder for imagery or regulatory inset
                      </div>
                    </div>
                  ) : null}
                </div>

                <aside className="flex flex-col gap-3 xl:sticky xl:top-6">
                  {showParcelData ? (
                    <Panel title="Στοιχεία Οικοπέδου">
                      <div className="grid grid-cols-[132px_1fr] gap-x-3 gap-y-1 text-sm">
                        <div className="text-muted-foreground">KAEK</div>
                        <div>{parcel.kaek}</div>
                        <div className="text-muted-foreground">Καλλικρατικός Δήμος</div>
                        <div>{teeData?.municipality || "—"}</div>
                        <div className="text-muted-foreground">Ο.Τ.</div>
                        <div>{teeData?.otNumber || "—"}</div>
                        <div className="text-muted-foreground">Εμβαδό</div>
                        <div>{parcel.area?.toFixed(2) || "—"} m²</div>
                        <div className="text-muted-foreground">Περίμετρος</div>
                        <div>{parcel.perimeter?.toFixed(2) || "—"} m</div>
                      </div>
                    </Panel>
                  ) : null}

                  {showCoords ? (
                    <Panel title="Συντεταγμένες Κορυφών">
                      <div className="grid grid-cols-[32px_1fr_1fr] gap-x-2 gap-y-1 text-xs">
                        <div className="font-medium text-muted-foreground">#</div>
                        <div className="font-medium text-muted-foreground">X</div>
                        <div className="font-medium text-muted-foreground">Y</div>
                        {coords.slice(0, 8).map((row) => (
                          <Fragment key={row.i}>
                            <div>{row.i}</div>
                            <div>{row.x}</div>
                            <div>{row.y}</div>
                          </Fragment>
                        ))}
                      </div>
                    </Panel>
                  ) : null}

                  {showLegend ? (
                    <Panel title="Υπόμνημα / Layers">
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2"><span className="h-px w-10 bg-green-500" />ρυμοτομική γραμμή</div>
                        <div className="flex items-center gap-2"><span className="h-px w-10 bg-red-500" />οικοδομική γραμμή</div>
                        <div className="flex items-center gap-2"><span className="h-px w-10 border-t border-dashed border-muted-foreground" />όριο οικοπέδων</div>
                        <div>Σταυροί καννάβου σε ξεχωριστό layer συντεταγμένων.</div>
                        <div>Το οικόπεδο τοποθετείται στο κέντρο του πλαισίου για όλες τις κλίμακες.</div>
                      </div>
                    </Panel>
                  ) : null}

                  {showTerms ? (
                    <PlaceholderBlock title="Όροι Δόμησης / Πολεοδομικά Στοιχεία" height="h-28" />
                  ) : null}

                  {mode === "full" ? (
                    <>
                      <PlaceholderBlock title="Ρυμοτομικές Γραμμές" height="h-16" />
                      <PlaceholderBlock title="Οικοδομικές Γραμμές / Πρασιές" height="h-16" />
                      <PlaceholderBlock title="Απόσπασμα Ρυμοτομικού" height="h-16" />
                      <PlaceholderBlock title="Φωτογραφική Απεικόνιση / Notes" height="h-16" />
                    </>
                  ) : null}

                  {showTitleBlock ? (
                    <Panel title="Title Block">
                      <div className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-xs">
                        <div className="text-muted-foreground">Σχέδιο</div>
                        <div>Τοπογραφικό Διάγραμμα</div>
                        <div className="text-muted-foreground">KAEK</div>
                        <div>{parcel.kaek}</div>
                        <div className="text-muted-foreground">Ο.Τ.</div>
                        <div>{teeData?.otNumber || "—"}</div>
                        <div className="text-muted-foreground">Δήμος</div>
                        <div>{teeData?.municipality || "—"}</div>
                        <div className="text-muted-foreground">Κλίμακα</div>
                        <div>1:{scaleDenominator}</div>
                        <div className="text-muted-foreground">Ημερομηνία</div>
                        <div>{new Date().toLocaleDateString("el-GR")}</div>
                        <div className="text-muted-foreground">Μελετητής</div>
                        <div className="text-muted-foreground/70">grey placeholder</div>
                        <div className="text-muted-foreground">Έργο</div>
                        <div className="text-muted-foreground/70">grey placeholder</div>
                        <div className="text-muted-foreground">Θέση</div>
                        <div className="text-muted-foreground/70">grey placeholder</div>
                      </div>
                    </Panel>
                  ) : null}
                </aside>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
