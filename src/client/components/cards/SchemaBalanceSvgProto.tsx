/**
 * SchemaBalanceSvgProto — Animated SVG for the "balance" cognitive schema.
 * Visual: a scale tilting left/right.
 */
export function SchemaBalanceSvgProto() {
  return (
    <svg className="schema-svg" viewBox="0 0 600 180" aria-label="Balance schema — equilibrium / trade-off">
      {/* Base */}
      <rect className="proto-base" x="280" y="135" width="40" height="10" rx="3" />
      <rect className="proto-stand" x="297" y="65" width="6" height="70" rx="3" />

      {/* Beam group (tilts) */}
      <g className="proto-beam" transform="translate(300, 75)">
        <line className="proto-beam-line" x1="-170" y1="0" x2="170" y2="0" />

        {/* Left pan */}
        <g transform="translate(-150, 0)">
          <line className="proto-string" x1="0" y1="0" x2="0" y2="35" />
          <rect className="proto-pan" x="-28" y="35" width="56" height="10" rx="5" />
          <circle className="proto-weight proto-weight--left" cx="-10" cy="32" r="5" />
          <circle className="proto-weight proto-weight--left" cx="10" cy="32" r="4" />
        </g>

        {/* Right pan */}
        <g transform="translate(150, 0)">
          <line className="proto-string" x1="0" y1="0" x2="0" y2="35" />
          <rect className="proto-pan" x="-28" y="35" width="56" height="10" rx="5" />
          <circle className="proto-weight proto-weight--right" cx="0" cy="32" r="6" />
        </g>
      </g>

      <text className="label" x="300" y="165" textAnchor="middle">
        balance / equilibrium
      </text>
    </svg>
  );
}
