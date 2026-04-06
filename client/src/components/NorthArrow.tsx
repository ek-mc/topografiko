interface NorthArrowProps {
  isDark: boolean;
  x?: number;
  y?: number;
}

export default function NorthArrow({ isDark, x = 286, y = 34 }: NorthArrowProps) {
  const stroke = isDark ? "#cbd5e1" : "#475569";
  const fill = isDark ? "#e2e8f0" : "#334155";

  return (
    <g transform={`translate(${x}, ${y})`}>
      <text
        x="0"
        y="-12"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill={fill}
      >
        Β
      </text>
      <line x1="0" y1="14" x2="0" y2="-6" stroke={stroke} strokeWidth="1.4" />
      <path d="M 0 -18 L -6 -6 L 6 -6 Z" fill={fill} />
    </g>
  );
}
