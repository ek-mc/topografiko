import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Mountain } from "lucide-react";
import NorthArrow from "@/components/NorthArrow";
import ThemeToggle from "@/components/ThemeToggle";
import { useTheme } from "@/contexts/ThemeContext";
import mainUseMap from "@shared/main-use-map.json";
import otaOfficeMap from "@shared/ota-office-map.json";
import {
  boundsFromPoints,
  BuildingTermsData,
  centroidOfRing,
  CoordinateRow,
  downloadText,
  fetchBuildingTerms,
  fetchContextOTs,
  fetchNearbyPlanningAnnotations,
  fetchOfficialRoadLabels,
  fetchParcelByKaek,
  fetchPlanningLinesForOT,
  fetchParcelsInOT,
  fetchTEECandidates,
  filterAdjacentParcels,
  filterOppositeParcels,
  formatCoordinateRows,
  findBestOtLabelPoint,
  getParcelHorizontalRotationDegrees,
  NearbyPlanningAnnotation,
  NeighborParcel,
  ParcelData,
  ParcelHorizontalAlignment,
  pathFromRingWithBounds,
  Point,
  projectPoint,
  rotateRings,
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

const REGION_BY_NOMOS: Record<string, string> = {
  "ΑΤΤΙΚΗΣ": "Αττικής",
  "ΑΙΤΩΛΟΑΚΑΡΝΑΝΙΑΣ": "Δυτικής Ελλάδας",
  "ΑΡΓΟΛΙΔΟΣ": "Πελοποννήσου",
  "ΑΡΚΑΔΙΑΣ": "Πελοποννήσου",
  "ΑΡΤΑΣ": "Ηπείρου",
  "ΑΧΑΪΑΣ": "Δυτικής Ελλάδας",
  "ΑΧΑΙΑΣ": "Δυτικής Ελλάδας",
  "ΒΟΙΩΤΙΑΣ": "Στερεάς Ελλάδας",
  "ΓΡΕΒΕΝΩΝ": "Δυτικής Μακεδονίας",
  "ΔΡΑΜΑΣ": "Ανατολικής Μακεδονίας και Θράκης",
  "ΔΩΔΕΚΑΝΗΣΟΥ": "Νοτίου Αιγαίου",
  "ΕΒΡΟΥ": "Ανατολικής Μακεδονίας και Θράκης",
  "ΕΥΒΟΙΑΣ": "Στερεάς Ελλάδας",
  "ΕΥΡΥΤΑΝΙΑΣ": "Στερεάς Ελλάδας",
  "ΖΑΚΥΝΘΟΥ": "Ιονίων Νήσων",
  "ΗΛΕΙΑΣ": "Δυτικής Ελλάδας",
  "ΗΜΑΘΙΑΣ": "Κεντρικής Μακεδονίας",
  "ΗΡΑΚΛΕΙΟΥ": "Κρήτης",
  "ΘΕΣΠΡΩΤΙΑΣ": "Ηπείρου",
  "ΘΕΣΣΑΛΟΝΙΚΗΣ": "Κεντρικής Μακεδονίας",
  "ΙΩΑΝΝΙΝΩΝ": "Ηπείρου",
  "ΚΑΒΑΛΑΣ": "Ανατολικής Μακεδονίας και Θράκης",
  "ΚΑΡΔΙΤΣΑΣ": "Θεσσαλίας",
  "ΚΑΣΤΟΡΙΑΣ": "Δυτικής Μακεδονίας",
  "ΚΕΡΚΥΡΑΣ": "Ιονίων Νήσων",
  "ΚΕΦΑΛΛΗΝΙΑΣ": "Ιονίων Νήσων",
  "ΚΙΛΚΙΣ": "Κεντρικής Μακεδονίας",
  "ΚΟΖΑΝΗΣ": "Δυτικής Μακεδονίας",
  "ΚΟΡΙΝΘΙΑΣ": "Πελοποννήσου",
  "ΚΥΚΛΑΔΩΝ": "Νοτίου Αιγαίου",
  "ΛΑΚΩΝΙΑΣ": "Πελοποννήσου",
  "ΛΑΡΙΣΑΣ": "Θεσσαλίας",
  "ΛΑΣΙΘΙΟΥ": "Κρήτης",
  "ΛΕΣΒΟΥ": "Βορείου Αιγαίου",
  "ΛΕΥΚΑΔΑΣ": "Ιονίων Νήσων",
  "ΜΑΓΝΗΣΙΑΣ": "Θεσσαλίας",
  "ΜΕΣΣΗΝΙΑΣ": "Πελοποννήσου",
  "ΞΑΝΘΗΣ": "Ανατολικής Μακεδονίας και Θράκης",
  "ΠΕΙΡΑΙΩΣ": "Αττικής",
  "ΠΕΛΛΗΣ": "Κεντρικής Μακεδονίας",
  "ΠΙΕΡΙΑΣ": "Κεντρικής Μακεδονίας",
  "ΠΡΕΒΕΖΑΣ": "Ηπείρου",
  "ΡΕΘΥΜΝΗΣ": "Κρήτης",
  "ΡΟΔΟΠΗΣ": "Ανατολικής Μακεδονίας και Θράκης",
  "ΣΑΜΟΥ": "Βορείου Αιγαίου",
  "ΣΕΡΡΩΝ": "Κεντρικής Μακεδονίας",
  "ΤΡΙΚΑΛΩΝ": "Θεσσαλίας",
  "ΦΘΙΩΤΙΔΑΣ": "Στερεάς Ελλάδας",
  "ΦΛΩΡΙΝΑΣ": "Δυτικής Μακεδονίας",
  "ΦΩΚΙΔΑΣ": "Στερεάς Ελλάδας",
  "ΧΑΛΚΙΔΙΚΗΣ": "Κεντρικής Μακεδονίας",
  "ΧΑΝΙΩΝ": "Κρήτης",
  "ΧΙΟΥ": "Βορείου Αιγαίου",
};

function resolveRegionFromParcel(parcel: ParcelData | null | undefined) {
  if (!parcel?.otaCode) return undefined;
  const otaInfo = (otaOfficeMap as Record<string, { nomos?: string }>)[parcel.otaCode];
  const nomos = (otaInfo?.nomos || "").trim().toUpperCase();
  return nomos ? REGION_BY_NOMOS[nomos] || nomos : undefined;
}

type ElevationRow = {
  label: string;
  x: number;
  y: number;
  z: number;
};

const greekLabels = [
  "Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ", "Μ", "Ν", "Ξ", "Ο", "Π", "Ρ", "Σ", "Τ", "Υ", "Φ", "Χ", "Ψ", "Ω",
];

const DEFAULT_DECLARATION_TEMPLATES = [
  {
    key: "n65177",
    title: "Δήλωση Ν.651/77",
    signerLabel: "Ο ΜΗΧΑΝΙΚΟΣ",
    template: "Το οικόπεδο με τα στοιχεία {{loopLabel}} και ΚΑΕΚ {{kaek}}, ιδιοκτησίας του eTopografiko, που βρίσκεται επί της οδού eTopografiko και αρ. eTopografiko στο Ο.Τ. {{otNumber}} του ΔΗΜΟΥ {{municipality}} είναι άρτιο και οικοδομήσιμο σύμφωνα με τις κείμενες πολεοδομικές διατάξεις.",
  },
  {
    key: "boundaries",
    title: "Δήλωση Υλοποίησης Ορίων",
    signerLabel: "Ο ΙΔΙΟΚΤΗΤΗΣ",
    template: "Δηλώνω ότι τα όρια του οικοπέδου με ΚΑΕΚ {{kaek}} στο Ο.Τ. {{otNumber}} του ΔΗΜΟΥ {{municipality}} έχουν υλοποιηθεί σύμφωνα με τα διαθέσιμα στοιχεία της αποτύπωσης.",
  },
  {
    key: "ogrg",
    title: "Καθορισμός ΟΓ-ΡΓ",
    signerLabel: "Ο ΜΗΧΑΝΙΚΟΣ",
    template: "Οι Ο.Γ.-Ρ.Γ. του οικοπέδου με ΚΑΕΚ {{kaek}} στο Ο.Τ. {{otNumber}} του ΔΗΜΟΥ {{municipality}} θα τεθούν επί των καλώς μορφωμένων Ο.Γ. και Ρ.Γ. σύμφωνα με το εγκεκριμένο ρυμοτομικό σχέδιο.",
  },
  {
    key: "dei-rema",
    title: "Δήλωση ΔΕΗ-Ρεμάτων",
    signerLabel: "Ο ΜΗΧΑΝΙΚΟΣ",
    template: "Δηλώνω ότι από το οικόπεδο με ΚΑΕΚ {{kaek}} στο Ο.Τ. {{otNumber}} του ΔΗΜΟΥ {{municipality}} δεν διέρχεται ρέμα ούτε γραμμή υψηλής τάσης. Να προσαρμοστεί εφόσον απαιτείται ειδικός έλεγχος για την περιοχή.",
  },
] as const;

function renderDeclarationTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => values[token] || "eTopografiko");
}

function pointLabel(index: number) {
  return greekLabels[index] || `P${index + 1}`;
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
  const [buildingTerms, setBuildingTerms] = useState<BuildingTermsData | null>(null);
  const [otParcels, setOtParcels] = useState<NeighborParcel[]>([]);
  const [contextParcels, setContextParcels] = useState<NeighborParcel[]>([]);
  const [contextOts, setContextOts] = useState<TEEData[]>([]);
  const [officialRoadNames, setOfficialRoadNames] = useState<string[]>([]);
  const [nearbyAnnotations, setNearbyAnnotations] = useState<NearbyPlanningAnnotation[]>([]);
  const [urbanLines, setUrbanLines] = useState<Point[][]>([]);
  const [buildingLines, setBuildingLines] = useState<Point[][]>([]);
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [mode, setMode] = useState<ExportMode>("full");
  const [showCoords, setShowCoords] = useState(true);
  const [showParcelData, setShowParcelData] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showTitleBlock, setShowTitleBlock] = useState(true);
  const [showTerms, setShowTerms] = useState(true);
  const [showNearbyLabels, setShowNearbyLabels] = useState(false);
  const [activeDeclarations, setActiveDeclarations] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(DEFAULT_DECLARATION_TEMPLATES.map((item) => [item.key, false])) as Record<string, boolean>
  ));
  const [paperSize, setPaperSize] = useState<"A4" | "A3" | "A1">("A1");
  const [fullExportUnits, setFullExportUnits] = useState<"paper" | "meters">("paper");
  const [scaleDenominator, setScaleDenominator] = useState<100 | 200 | 500 | 1000>(200);
  const [parcelHorizontalAlignment, setParcelHorizontalAlignment] = useState<ParcelHorizontalAlignment>("default");
  const [showElevations, setShowElevations] = useState(false);
  const [elevationsLoading, setElevationsLoading] = useState(false);
  const [elevationRows, setElevationRows] = useState<ElevationRow[]>([]);

  useEffect(() => {
    if (!initialKaek) return;
    try {
      const raw = sessionStorage.getItem(`topografiko:elev:${initialKaek}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.rows) && parsed.rows.length) {
        setElevationRows(parsed.rows);
      }
    } catch {
      // ignore malformed cache
    }
  }, [initialKaek]);

  useEffect(() => {
    if (!initialKaek) return;

    let cancelled = false;

    const isDisplayableParcel = (item: NeighborParcel) => {
      const info = (mainUseMap as Record<string, { code: string; category: string; subcategory: string }>)[item.mainUse];
      const category = info?.category || "";
      const subcategory = info?.subcategory || "";
      const isRoad = category.includes("ΟΔΙΚΟ") || subcategory.includes("ΟΔΙΚΟ") || item.mainUse === "5100";
      const isHuge = (item.area ?? 0) > 5000;
      return !isRoad && !isHuge;
    };

    const load = async () => {
      setLoading(true);
      setContextLoading(false);
      setParcel(null);
      setElevationRows([]);
      setShowElevations(false);
      setTeeData(null);
      setTeeCandidates([]);
      setBuildingTerms(null);
      setOtParcels([]);
      setContextParcels([]);
      setContextOts([]);
      setOfficialRoadNames([]);
      setNearbyAnnotations([]);
      setUrbanLines([]);
      setBuildingLines([]);

      try {
        const result = await fetchParcelByKaek(initialKaek);
        if (cancelled) return;
        setParcel(result);

        if (!result) {
          setLoading(false);
          return;
        }

        const candidatesPromise = fetchTEECandidates(result.rings).catch(() => []);
        const termsPromise = fetchBuildingTerms(result.rings).catch(() => null);
        const roadLabelsPromise = result.officialRingsGgrs87?.length
          ? fetchOfficialRoadLabels(result.officialRingsGgrs87).catch(() => [])
          : Promise.resolve([]);
        const nearbyAnnotationsPromise = result.officialRingsGgrs87?.length
          ? fetchNearbyPlanningAnnotations(result.officialRingsGgrs87).catch(() => [])
          : Promise.resolve([]);

        const candidates = await candidatesPromise;
        if (cancelled) return;
        setTeeCandidates(candidates);
        const tee = candidates[0] || null;
        setTeeData(tee);
        setLoading(false);

        const planningLines = tee?.rings?.length
          ? await fetchPlanningLinesForOT(tee.rings).catch(() => ({ urbanLines: [], buildingLines: [] }))
          : { urbanLines: [], buildingLines: [] };
        if (cancelled) return;
        setUrbanLines(planningLines.urbanLines);
        setBuildingLines(planningLines.buildingLines);

        void termsPromise.then((terms) => {
          if (cancelled) return;
          setBuildingTerms(terms);
        });

        void roadLabelsPromise.then((roadLabels) => {
          if (cancelled) return;
          setOfficialRoadNames(Array.from(new Set(roadLabels.map((item) => item.name))).slice(0, 3));
        });

        void nearbyAnnotationsPromise.then((items) => {
          if (cancelled) return;
          setNearbyAnnotations(items);
        });

        if (!tee?.rings?.length) {
          if (!cancelled) {
            setOtParcels([]);
            setContextParcels([]);
            setContextOts([]);
          }
          return;
        }

        setContextLoading(true);

        const [selectedOtParcels, surroundingOts] = await Promise.all([
          fetchParcelsInOT(tee.rings, result.kaek).catch(() => []),
          fetchContextOTs(tee.rings, tee.otNumber).catch(() => []),
        ]);
        if (cancelled) return;

        const filteredCurrentOt = selectedOtParcels.filter(isDisplayableParcel);
        const adjacent = filterAdjacentParcels(result.rings, filteredCurrentOt).map((item) => ({
          ...item,
          relation: "adjacent" as const,
        }));
        const adjacentKaeks = new Set(filteredCurrentOt.map((item) => item.kaek));
        const limitedSurroundingOts = surroundingOts.slice(0, 8);

        const surroundingParcelGroups = await Promise.all(
          limitedSurroundingOts.map((ot) => fetchParcelsInOT(ot.rings).catch(() => [])),
        );
        if (cancelled) return;

        const surroundingCandidates = surroundingParcelGroups
          .flat()
          .filter(isDisplayableParcel)
          .filter((item) => item.kaek !== result.kaek && !adjacentKaeks.has(item.kaek))
          .reduce<NeighborParcel[]>((acc, item) => {
            if (!acc.some((existing) => existing.kaek === item.kaek)) {
              acc.push(item);
            }
            return acc;
          }, []);

        const opposite = filterOppositeParcels(result.rings, surroundingCandidates, planningLines.urbanLines).map((item) => ({
          ...item,
          relation: "opposite" as const,
        }));

        setOtParcels(filteredCurrentOt);
        setContextParcels(opposite);
        setContextOts(limitedSurroundingOts);
      } catch (error) {
        console.error("Failed to load export data", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setContextLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [initialKaek]);

  const isSimpleMode = mode === "parcel" || mode === "ot";
  const includeBlock = mode !== "parcel";
  const includeOtContext = mode === "ot" || mode === "full";
  const includeFullContext = mode === "full";
  const previewSize = 320;
  const previewPad = 26;

  const exportParcels = useMemo(() => {
    if (!parcel) return [] as Array<{ kaek: string; rings: Point[][]; current: boolean; relation?: "adjacent" | "opposite" }>;
    const otContextParcels = otParcels.map((item) => ({
      kaek: item.kaek,
      rings: item.rings,
      current: false,
      relation: item.relation,
    }));
    const fullContextParcels = contextParcels.map((item) => ({
      kaek: item.kaek,
      rings: item.rings,
      current: false,
      relation: item.relation,
    }));

    return [
      { kaek: parcel.kaek, rings: parcel.rings, current: true },
      ...(includeOtContext ? otContextParcels : []),
      ...(includeFullContext ? fullContextParcels : []),
    ];
  }, [parcel, otParcels, contextParcels, includeOtContext, includeFullContext]);

  const previewRotationCenter = useMemo(() => {
    const mainRing = parcel?.rings?.[0];
    if (!mainRing?.length) return null;
    return centroidOfRing(stripClosingPoint(mainRing));
  }, [parcel]);

  const previewRotationDegrees = useMemo(() => {
    const mainRing = parcel?.rings?.[0];
    if (!mainRing?.length) return 0;
    return getParcelHorizontalRotationDegrees(mainRing, parcelHorizontalAlignment);
  }, [parcel, parcelHorizontalAlignment]);

  const previewParcels = useMemo(() => {
    if (!previewRotationCenter || !previewRotationDegrees) return exportParcels;
    return exportParcels.map((item) => ({
      ...item,
      rings: rotateRings(item.rings, previewRotationCenter, previewRotationDegrees),
    }));
  }, [exportParcels, previewRotationCenter, previewRotationDegrees]);

  const previewOtRings = useMemo(() => {
    if (!teeData?.rings?.length) return [] as Point[][];
    if (!previewRotationCenter || !previewRotationDegrees) return teeData.rings;
    return rotateRings(teeData.rings, previewRotationCenter, previewRotationDegrees);
  }, [teeData, previewRotationCenter, previewRotationDegrees]);

  const previewContextOts = useMemo(() => {
    if (!previewRotationCenter || !previewRotationDegrees) return contextOts;
    return contextOts.map((item) => ({
      ...item,
      rings: rotateRings(item.rings, previewRotationCenter, previewRotationDegrees),
    }));
  }, [contextOts, previewRotationCenter, previewRotationDegrees]);

  const activeNearbyAnnotations = useMemo(() => (showNearbyLabels ? nearbyAnnotations : []), [showNearbyLabels, nearbyAnnotations]);

  const previewNearbyAnnotations = useMemo(() => {
    if (!previewRotationCenter || !previewRotationDegrees) return activeNearbyAnnotations;
    return activeNearbyAnnotations.map((item) => ({
      ...item,
      point: rotateRings([[item.point]], previewRotationCenter, previewRotationDegrees)[0][0],
      rotationDegrees: typeof item.rotationDegrees === "number" ? item.rotationDegrees + previewRotationDegrees : undefined,
      footprint: item.footprint?.length ? rotateRings([item.footprint], previewRotationCenter, previewRotationDegrees)[0] : undefined,
    }));
  }, [activeNearbyAnnotations, previewRotationCenter, previewRotationDegrees]);

  const previewBounds = useMemo(() => {
    const points = [
      ...previewParcels,
      ...(includeOtContext && previewOtRings.length ? [{ rings: previewOtRings } as { rings: Point[][] }] : []),
      ...(includeFullContext ? previewContextOts.map((item) => ({ rings: item.rings })) : []),
    ].flatMap((p) => p.rings.flatMap((ring) => stripClosingPoint(ring)));
    const annotationPoints = previewNearbyAnnotations.map((item) => item.point);
    const allPoints = [...points, ...annotationPoints];
    return allPoints.length ? boundsFromPoints(allPoints) : null;
  }, [previewParcels, previewOtRings, previewContextOts, previewNearbyAnnotations, includeOtContext, includeFullContext]);

  const coords = useMemo<CoordinateRow[]>(() => {
    if (parcel?.officialRingsGgrs87?.[0]?.length) {
      return formatCoordinateRows(parcel.officialRingsGgrs87[0], "P", true);
    }
    if (parcel?.rings?.[0]?.length) {
      return formatCoordinateRows(parcel.rings[0], "P");
    }
    return [];
  }, [parcel]);

  const buildingTermsRows = useMemo(() => {
    if (!buildingTerms) return [] as Array<[string, string]>;
    return [
      ["Σ.Δ.", buildingTerms.sd || ""],
      ["Τομέας Σ.Δ.", buildingTerms.sdSector || ""],
      ["Κάλυψη", buildingTerms.coverage || ""],
      ["Μέγ. κάλυψη", buildingTerms.maxCoverageArea || ""],
      ["Μέγ. ύψος", buildingTerms.maxHeight || ""],
      ["Όροφοι", buildingTerms.floors || ""],
      ["Ελάχ. εμβαδό", buildingTerms.minArea || ""],
      ["Ελάχ. πρόσωπο", buildingTerms.minFrontage || ""],
      ["Αρτιότητα", buildingTerms.lotRuleDescription || buildingTerms.lotRuleType || ""],
      ["Οικ. σύστημα", buildingTerms.buildingSystem || ""],
    ].filter(([, value]) => Boolean(value));
  }, [buildingTerms]);

  const coordinateLoopLabel = useMemo(() => {
    if (!coords.length) return "";
    return `${coords.map((row) => row.label).join("")}${coords[0].label}`;
  }, [coords]);

  const declarationValues = useMemo(() => ({
    kaek: parcel?.kaek || "*",
    municipality: teeData?.municipality || "*",
    otNumber: teeData?.otNumber || "*",
    loopLabel: coordinateLoopLabel ? `${coordinateLoopLabel}` : "*",
  }), [parcel?.kaek, teeData?.municipality, teeData?.otNumber, coordinateLoopLabel]);

  const declarationRows = useMemo(() => {
    return DEFAULT_DECLARATION_TEMPLATES.map((item) => ({
      key: item.key,
      title: item.title,
      signerLabel: item.signerLabel,
      text: renderDeclarationTemplate(item.template, declarationValues),
    }));
  }, [declarationValues]);

  const activeDeclarationRows = useMemo(() => {
    return declarationRows.filter((row) => activeDeclarations[row.key]);
  }, [declarationRows, activeDeclarations]);

  const fetchElevations = async () => {
    if (!parcel?.rings?.[0]?.length) return;
    const ring = stripClosingPoint(parcel.rings[0]);
    if (!ring.length) return;

    setElevationsLoading(true);
    try {
      const latitudes = ring.map((p) => p.y).join(",");
      const longitudes = ring.map((p) => p.x).join(",");
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${encodeURIComponent(latitudes)}&longitude=${encodeURIComponent(longitudes)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Elevation API failed: ${response.status}`);
      const data = await response.json();
      const zValues: number[] = Array.isArray(data?.elevation) ? data.elevation : [];

      const rows: ElevationRow[] = ring.map((p, idx) => ({
        label: pointLabel(idx),
        x: p.x,
        y: p.y,
        z: Number(zValues[idx] ?? NaN),
      }));

      setElevationRows(rows);
      setShowElevations(true);
      try {
        sessionStorage.setItem(`topografiko:elev:${parcel.kaek}`, JSON.stringify({ rows, source: "export-on-demand", ts: Date.now() }));
      } catch {
        // ignore storage failures
      }
    } catch (err) {
      console.error("Failed to fetch elevations", err);
      setElevationRows([]);
      setShowElevations(false);
    } finally {
      setElevationsLoading(false);
    }
  };

  const toggleElevations = () => {
    if (showElevations) {
      setShowElevations(false);
      return;
    }
    setShowElevations(true);
    if (!elevationRows.length && !elevationsLoading) {
      void fetchElevations();
    }
  };

  useEffect(() => {
    if (!parcel || !showElevations || elevationsLoading || elevationRows.length) return;
    void fetchElevations();
  }, [parcel, showElevations, elevationsLoading, elevationRows.length]);

  const download = (format: "geojson" | "kml" | "dxf") => {
    if (!parcel) return;

    const parcels = exportParcels.map((p) => ({ kaek: p.kaek, rings: p.rings, relation: p.relation }));
    const modeLabel = mode === "parcel" ? "parcel" : mode === "ot" ? "ot" : "full";
    const base = mode === "full"
      ? `${parcel.kaek}-${paperSize.toLowerCase()}-1-${scaleDenominator}-${modeLabel}${fullExportUnits === "meters" ? "-meters" : ""}`
      : `${parcel.kaek}-${modeLabel}-meters`;
    const regionName = resolveRegionFromParcel(parcel);

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
          region: regionName,
          area: parcel.area,
          exportMode: mode,
          exportUnits: mode === "full" ? (fullExportUnits === "meters" ? "meters" : "millimeters") : "meters",
          includeTitleBlock: showTitleBlock,
          coords: showCoords ? coords : undefined,
          nearbyAnnotations: showNearbyLabels ? nearbyAnnotations : [],
          paperSize,
          scaleDenominator,
          parcelHorizontalAlignment,
          otRings: includeOtContext ? teeData?.rings : undefined,
          contextOts: includeFullContext ? contextOts : undefined,
          buildingTerms: showTerms ? buildingTerms : null,
          declarations: activeDeclarationRows.length ? activeDeclarationRows : undefined,
          urbanLines: includeFullContext ? urbanLines : undefined,
          buildingLines: includeFullContext ? buildingLines : undefined,
        }),
        "application/dxf",
        false,
      );
    }

  };

  const isFullMetersMode = mode === "full" && fullExportUnits === "meters";
  const fullDxfLabel = isFullMetersMode ? "DXF (real m)" : "DXF";

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
        {!loading && contextLoading ? <p className="text-sm text-muted-foreground">Loading surrounding O.T. context…</p> : null}

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

              {mode === "full" ? (
                <>
                  <div className="inline-flex flex-wrap gap-2 text-sm">
                      {[
                      { state: showCoords, setter: setShowCoords, label: "Συντεταγμένες" },
                      { state: showParcelData, setter: setShowParcelData, label: "Στοιχεία" },
                      { state: showLegend, setter: setShowLegend, label: "Υπόμνημα" },
                      { state: showTitleBlock, setter: setShowTitleBlock, label: "Title block" },
                      { state: showTerms, setter: setShowTerms, label: "Όροι / Notes" },
                      { state: showNearbyLabels, setter: setShowNearbyLabels, label: "Κ.Π. / ΠΕΖΟΔΡΟΜΟΣ" },
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
                    {DEFAULT_DECLARATION_TEMPLATES.map((item) => {
                      const active = activeDeclarations[item.key];
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setActiveDeclarations((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                          className={`rounded-full border px-3 py-1.5 transition-colors ${
                            active
                              ? "border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/15 dark:text-emerald-200"
                              : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          }`}
                        >
                          {item.title}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={toggleElevations}
                      disabled
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground opacity-60"
                    >
                      <Mountain className="h-3.5 w-3.5" />
                      Elevation
                    </button>
                  </div>

                  <div className="inline-flex rounded-2xl border border-border bg-muted/60 p-1 text-sm">
                    {([
                      ["paper", "Fit to paper"],
                      ["meters", "Real size (m)"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFullExportUnits(value)}
                        className={`rounded-xl px-4 py-2 transition-colors ${
                          fullExportUnits === value
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {fullExportUnits === "paper" ? <div className="inline-flex rounded-2xl border border-border bg-muted/60 p-1 text-sm">
                    {(["A4", "A3", "A1"] as const).map((size) => {
                      const enabled = size === "A3" || size === "A1";
                      return (
                        <button
                          key={size}
                          type="button"
                          disabled={!enabled}
                          onClick={() => enabled && setPaperSize(size)}
                          className={`rounded-xl px-4 py-2 transition-colors ${
                            paperSize === size
                              ? "bg-card text-foreground shadow-sm"
                              : enabled
                                ? "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
                                : "text-muted-foreground/60"
                          }`}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div> : null}

                  {fullExportUnits === "paper" ? <div className="inline-flex rounded-2xl border border-border bg-muted/60 p-1 text-sm">
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
                  </div> : null}

                  <label className="inline-flex items-center gap-3 rounded-2xl border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                    <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide">Parcel orientation</span>
                    <select
                      value={parcelHorizontalAlignment}
                      onChange={(event) => setParcelHorizontalAlignment(event.target.value as ParcelHorizontalAlignment)}
                      className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors"
                    >
                      <option value="default">Default</option>
                      <option value="north-side-horizontal">North side horizontal</option>
                      <option value="south-side-horizontal">South side horizontal</option>
                    </select>
                  </label>
                </>
              ) : null}

              <div className={`ml-auto grid gap-2 ${mode === "full" ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
                <button
                  type="button"
                  onClick={() => download("dxf")}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Download className="h-4 w-4" />{fullDxfLabel}
                </button>
                {mode === "full" ? (
                  <>
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
                  </>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors lg:p-5">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-xl border border-border bg-muted/40 shadow-inner transition-colors">
                    {previewBounds ? (
                      <svg viewBox={`0 0 ${previewSize} ${previewSize}`} className="aspect-square w-full">
                        <rect x="0" y="0" width={previewSize} height={previewSize} fill={isDark ? "#0f172a" : "#f8fafc"} />
                        {mode === "full" ? <rect x="18" y="18" width="284" height="284" fill="none" stroke={isDark ? "#94a3b8" : "#64748b"} strokeWidth="0.9" /> : null}
                        {mode === "full" ? <NorthArrow isDark={isDark} rotationDegrees={previewRotationDegrees} /> : null}
                        {mode === "full" ? previewContextOts.map((item, index) => {
                          const ring = item.rings[0];
                          if (!ring?.length) return null;
                          const otAnchor = findBestOtLabelPoint(ring, previewParcels.map((parcelItem) => parcelItem.rings[0]).filter(Boolean)) || centroidOfRing(ring);
                          const center = projectPoint(otAnchor, previewBounds, previewSize, previewPad);
                          const label = `Ο.Τ. ${item.otNumber}`;
                          const labelWidth = Math.max(28, label.length * 2.7);
                          return (
                            <g key={`context-ot-${item.otNumber}-${index}`}>
                              <path
                                d={pathFromRingWithBounds(ring, previewBounds, previewSize, previewPad)}
                                fill="none"
                                stroke={isDark ? "#e2e8f0" : "#334155"}
                                strokeWidth="1"
                              />
                              <rect
                                x={center.x - labelWidth / 2}
                                y={center.y - 7}
                                width={labelWidth}
                                height="14"
                                rx="1.5"
                                fill={isDark ? "#0f172a" : "#f8fafc"}
                                stroke={isDark ? "#e2e8f0" : "#334155"}
                                strokeWidth="0.8"
                              />
                              <text
                                x={center.x}
                                y={center.y + 0.6}
                                fontSize="4.4"
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill={isDark ? "#f8fafc" : "#111827"}
                              >
                                {label}
                              </text>
                            </g>
                          );
                        }) : null}
                        {previewParcels.filter((item) => !item.current).map((item) => {
                          const path = pathFromRingWithBounds(item.rings[0], previewBounds, previewSize, previewPad);
                          const center = projectPoint(centroidOfRing(item.rings[0]), previewBounds, previewSize, previewPad);
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
                          const path = pathFromRingWithBounds(item.rings[0], previewBounds, previewSize, previewPad);
                          const c = projectPoint(centroidOfRing(item.rings[0]), previewBounds, previewSize, previewPad);
                          const ringPoints = stripClosingPoint(item.rings[0]);
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
                              {showElevations
                                ? ringPoints.map((point, idx) => {
                                    const p = projectPoint(point, previewBounds, previewSize, previewPad);
                                    const z = elevationRows[idx]?.z;
                                    const zText = Number.isFinite(z) ? `(+${z.toFixed(2)})` : "(+—)";
                                    return (
                                      <g key={`elev-${idx}`}>
                                        <circle cx={p.x} cy={p.y} r="1.2" fill={isDark ? "#f8fafc" : "#111827"} />
                                        <text
                                          x={p.x + 2.4}
                                          y={p.y - 2.4}
                                          fontSize="4.1"
                                          fill={isDark ? "#e5e7eb" : "#111827"}
                                        >
                                          {`${pointLabel(idx)} ${zText}`}
                                        </text>
                                      </g>
                                    );
                                  })
                                : null}
                            </g>
                          );
                        })}
                        {mode !== "parcel" ? (() => {
                          const otRing = previewOtRings[0];
                          if (!otRing) return null;
                          const otAnchor = findBestOtLabelPoint(otRing, previewParcels.map((parcelItem) => parcelItem.rings[0]).filter(Boolean)) || centroidOfRing(otRing);
                          const c = projectPoint(otAnchor, previewBounds, previewSize, previewPad);
                          const label = `Ο.Τ. ${teeData?.otNumber || "-"}`;
                          const labelWidth = Math.max(34, label.length * 2.8);
                          return (
                            <g>
                              <rect x={c.x - labelWidth / 2} y={c.y - 6.5} width={labelWidth} height="13" rx="1.5" fill={isDark ? "#0f172a" : "#f8fafc"} stroke={isDark ? "#e2e8f0" : "#334155"} strokeWidth="1" />
                              <text x={c.x} y={c.y + 0.5} fontSize="4.8" textAnchor="middle" dominantBaseline="middle" fill={isDark ? "#f8fafc" : "#111827"}>{label}</text>
                            </g>
                          );
                        })() : null}
                        {mode === "full" ? previewNearbyAnnotations.map((item, index) => {
                          if (!previewBounds) return null;
                          const p = projectPoint(item.point, previewBounds, previewSize, previewPad);
                          return (
                            <text
                              key={`nearby-${item.kind}-${item.label}-${index}`}
                              x={p.x}
                              y={p.y}
                              fontSize={item.kind === "pedestrian-road" ? 4.6 : 4.2}
                              fontWeight={item.kind === "pedestrian-road" ? 600 : 700}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              paintOrder="stroke"
                              stroke={isDark ? "#020617" : "#ffffff"}
                              strokeWidth="0.9"
                              transform={item.kind === "pedestrian-road" && typeof item.rotationDegrees === "number" ? `rotate(${item.rotationDegrees} ${p.x} ${p.y})` : undefined}
                              fill={item.kind === "pedestrian-road" ? (isDark ? "#fde047" : "#a16207") : (isDark ? "#86efac" : "#166534")}
                            >
                              {item.label}
                            </text>
                          );
                        }) : null}
                        {mode === "full" ? Array.from({ length: 4 }).map((_, ix) => {
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
                        }) : null}
                        {mode === "full" ? <g>
                          <rect x="156" y="244" width="82" height="58" fill={isDark ? "#0f172a" : "#f8fafc"} stroke={isDark ? "#94a3b8" : "#64748b"} strokeWidth="0.8" />
                          <text x="162" y="252" fontSize="5.1" fill={isDark ? "#e2e8f0" : "#334155"}>ΥΠΟΜΝΗΜΑ</text>
                          <line x1="162" y1="261" x2="182" y2="261" stroke="#22c55e" strokeWidth="1.6" />
                          <text x="187" y="264" fontSize="4.5" fill={isDark ? "#e2e8f0" : "#334155"}>ρυμοτομική γραμμή</text>
                          <line x1="162" y1="273" x2="182" y2="273" stroke="#ef4444" strokeWidth="1.4" />
                          <text x="187" y="276" fontSize="4.5" fill={isDark ? "#e2e8f0" : "#334155"}>οικοδομική γραμμή</text>
                          <line x1="162" y1="285" x2="182" y2="285" stroke={isDark ? "#f8fafc" : "#111827"} strokeWidth="1.2" />
                          <text x="187" y="288" fontSize="4.5" fill={isDark ? "#e2e8f0" : "#334155"}>όριο οικοπέδου</text>
                          <line x1="162" y1="297" x2="182" y2="297" stroke={isDark ? "#cbd5e1" : "#64748b"} strokeWidth="1" strokeDasharray="5 3" />
                          <text x="187" y="300" fontSize="4.5" fill={isDark ? "#e2e8f0" : "#334155"}>όρια όμορων οικοπέδων</text>
                        </g> : null}
                        {mode === "full" ? <text x="224" y="20" fontSize="6" fill={isDark ? "#e2e8f0" : "#334155"}>Κλίμακα 1:{scaleDenominator}</text> : null}
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

                {mode === "full" ? <aside className="flex flex-col gap-3 xl:sticky xl:top-6">
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
                    <Panel title="Συντεταγμένες Κορυφών Οικοπέδου">
                      <div className="overflow-hidden rounded-lg border border-border">
                        <div className="border-b border-border px-3 py-2 text-center text-[11px] font-semibold tracking-wide text-foreground">
                          ΣΥΝΤ/ΜΕΝΕΣ ΚΟΡΥΦΩΝ ΟΙΚΟΠΕΔΟΥ ΕΓΣΑ&apos;87
                        </div>
                        <div className={`grid ${showElevations ? "grid-cols-[52px_minmax(90px,1fr)_minmax(90px,1fr)_82px_92px]" : "grid-cols-[52px_minmax(90px,1fr)_minmax(90px,1fr)_82px]"} border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground`}>
                          <div>Α/Α</div>
                          <div>X</div>
                          <div>Y</div>
                          <div>Πλευρά</div>
                          {showElevations ? <div>Z</div> : null}
                        </div>
                        <div className="divide-y divide-border text-xs">
                          {coords.map((row, idx) => (
                            <div key={row.label} className={`grid ${showElevations ? "grid-cols-[52px_minmax(90px,1fr)_minmax(90px,1fr)_82px_92px]" : "grid-cols-[52px_minmax(90px,1fr)_minmax(90px,1fr)_82px]"} px-3 py-1.5`}>
                              <div>{row.label}</div>
                              <div>{row.x}</div>
                              <div>{row.y}</div>
                              <div>{row.side || "—"}</div>
                              {showElevations ? <div>{Number.isFinite(elevationRows[idx]?.z) ? elevationRows[idx].z.toFixed(3) : "—"}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border px-3 py-2 text-center text-sm font-medium">
                        {`ΕΜΒΑΔΟΝ ΟΙΚΟΠΕΔΟΥ (${coordinateLoopLabel || "-"}): Ε=${parcel.area?.toFixed(2) || "-"} Τ.Μ.`}
                      </div>
                      {showElevations ? (
                        <div className="text-[11px] text-muted-foreground">Τα υψόμετρα προβάλλονται ενδεικτικά από elevation service.</div>
                      ) : null}
                    </Panel>
                  ) : null}


                  {showLegend ? (
                    <Panel title="Υπόμνημα / Layers">
                      <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-2"><span className="h-px w-10 bg-green-500" />ρυμοτομική γραμμή</div>
                          <div className="flex items-center gap-2"><span className="h-px w-10 bg-red-500" />οικοδομική γραμμή</div>
                          <div className="flex items-center gap-2"><span className="h-px w-10 bg-foreground" />όριο οικοπέδου</div>
                          <div className="flex items-center gap-2"><span className="h-px w-10 border-t border-dashed border-muted-foreground" />όρια όμορων οικοπέδων</div>
                          <div>Οι επιγραφές κορυφών του οικοπέδου σημειώνονται ως Α, Β, Γ, … και τοποθετούνται εξωτερικά του περιγράμματος.</div>
                          <div>Οι ενδείξεις μηκών πλευρών τοποθετούνται εσωτερικά για καθαρότερη ανάγνωση του σχεδίου.</div>
                        </div>
                      </div>
                    </Panel>
                  ) : null}

                  {showTerms ? (
                    <Panel title="Όροι Δόμησης / Πολεοδομικά Στοιχεία">
                      {buildingTerms ? (
                        <div className="space-y-4 text-xs">
                          <div className="grid grid-cols-[112px_1fr] gap-x-4 gap-y-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
                            {buildingTermsRows.map(([label, value]) => (
                              <Fragment key={label}>
                                <div className="text-muted-foreground">{label}</div>
                                <div>{value}</div>
                              </Fragment>
                            ))}
                          </div>
                          {buildingTerms.notes.length ? (
                            <div className="space-y-2 border-t border-border pt-3 text-muted-foreground">
                              {buildingTerms.notes.map((note, index) => (
                                <div key={`${index}-${note}`}>{note}</div>
                              ))}
                            </div>
                          ) : null}
                          {(buildingTerms.sourceFek || buildingTerms.sourceDecisionNumber || buildingTerms.sourceDate) ? (
                            <div className="border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
                              {buildingTerms.sourceFek ? <div>ΦΕΚ: {buildingTerms.sourceFek}</div> : null}
                              {buildingTerms.sourceDecisionNumber ? <div>Αριθ. απόφασης: {buildingTerms.sourceDecisionNumber}</div> : null}
                              {buildingTerms.sourceDate ? <div>Ημ/νία: {buildingTerms.sourceDate}</div> : null}
                            </div>
                          ) : null}
                          {activeDeclarationRows.length ? (
                            <div className="space-y-5 border-t border-border pt-4">
                              {activeDeclarationRows.map((row) => (
                                <div key={row.key} className="space-y-4 border-b border-border/60 pb-8 last:border-b-0 last:pb-2">
                                  <div className="font-semibold text-foreground">{row.title}</div>
                                  <div className="leading-7 text-muted-foreground">{row.text}</div>
                                  <div className="pt-6 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/85">{row.signerLabel}</div>
                                  <div className="h-24" />
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          Δεν βρέθηκαν διαθέσιμα στοιχεία όρων δόμησης για το επιλεγμένο ακίνητο.
                        </div>
                      )}
                    </Panel>
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
                        <div className="text-muted-foreground">Χαρτί</div>
                        <div>{paperSize}</div>
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
                </aside> : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
