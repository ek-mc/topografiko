import { toDXF, type Point } from "../client/src/lib/topografiko.ts";

const ring: Point[] = [
  { x: 23.7993030171144, y: 38.0999046255359 },
  { x: 23.7991433496575, y: 38.0996780322325 },
  { x: 23.7985431600634, y: 38.099480273795 },
  { x: 23.7987679140559, y: 38.100254416969 },
  { x: 23.7993030171144, y: 38.0999046255359 },
];

const dxf = toDXF(
  [{ kaek: "050690803001", rings: [ring] }],
  {
    kaek: "050690803001",
    ot: "1046",
    municipality: "ΚΗΦΙΣΙΑΣ",
    includeTitleBlock: true,
    coords: ring.slice(0, -1).map((p, i) => ({ i: i + 1, x: String(p.x), y: String(p.y) })),
    paperSize: "A3",
    scaleDenominator: 200,
  },
);

const lines = dxf.split(/\r?\n/).slice(0, 24);
console.log(lines.join("\n"));
