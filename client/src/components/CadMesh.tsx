interface CadMeshProps {
  patternId: string;
  isDark: boolean;
  size?: number;
}

export default function CadMesh({ patternId, isDark, size = 320 }: CadMeshProps) {
  const minorId = `${patternId}-minor`;
  const majorId = `${patternId}-major`;

  return (
    <>
      <defs>
        <pattern id={minorId} width="8" height="8" patternUnits="userSpaceOnUse">
          <path
            d="M 8 0 L 0 0 0 8"
            fill="none"
            stroke={isDark ? "rgba(148,163,184,0.14)" : "rgba(148,163,184,0.18)"}
            strokeWidth="0.6"
          />
        </pattern>
        <pattern id={majorId} width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke={isDark ? "rgba(148,163,184,0.3)" : "rgba(100,116,139,0.22)"}
            strokeWidth="1"
          />
        </pattern>
      </defs>

      <rect x="0" y="0" width={size} height={size} fill={isDark ? "#0f172a" : "#f8fafc"} />
      <rect x="0" y="0" width={size} height={size} fill={`url(#${minorId})`} />
      <rect x="0" y="0" width={size} height={size} fill={`url(#${majorId})`} />
    </>
  );
}
