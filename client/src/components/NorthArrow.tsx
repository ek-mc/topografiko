interface NorthArrowProps {
  isDark: boolean;
  x?: number;
  y?: number;
}

export default function NorthArrow({ isDark, x = 286, y = 36 }: NorthArrowProps) {
  const stroke = isDark ? "#e2e8f0" : "#334155";
  const fill = isDark ? "#f8fafc" : "#1e293b";
  const plate = isDark ? "rgba(15,23,42,0.72)" : "rgba(248,250,252,0.88)";

  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-15"
        y="-24"
        width="30"
        height="44"
        rx="8"
        fill={plate}
        stroke={isDark ? "rgba(226,232,240,0.25)" : "rgba(51,65,85,0.18)"}
        strokeWidth="0.8"
      />
      <text
        x="0"
        y="-10"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="11"
        fontWeight="700"
        fontFamily="Inter, Arial, sans-serif"
        fill={fill}
      >
        Β
      </text>
      <line x1="0" y1="14" x2="0" y2="-1" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M 0 -13 L -6 -1 L 6 -1 Z" fill={fill} />
    </g>
  );
}
