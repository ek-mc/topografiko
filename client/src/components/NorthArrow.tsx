interface NorthArrowProps {
  isDark: boolean;
  x?: number;
  y?: number;
  size?: number;
  rotationDegrees?: number;
}

export default function NorthArrow({ isDark, x = 286, y = 34, size = 1, rotationDegrees = 0 }: NorthArrowProps) {
  const stroke = isDark ? "#cbd5e1" : "#475569";
  const fill = isDark ? "#e2e8f0" : "#334155";

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotationDegrees}) scale(${size})`} aria-label="North arrow">
      <line x1="0" y1="14" x2="0" y2="-4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 0 -16 L -5.5 -4 L 5.5 -4 Z" fill={fill} stroke={stroke} strokeWidth="0.8" strokeLinejoin="round" />
      <line x1="-3.5" y1="14" x2="3.5" y2="14" stroke={stroke} strokeWidth="1.2" strokeLinecap="round" />
    </g>
  );
}
