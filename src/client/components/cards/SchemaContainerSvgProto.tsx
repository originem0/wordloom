/**
 * SchemaContainerSvgProto — Animated SVG for the "container" cognitive schema.
 * Visual: a container with an "inside vs outside" boundary; items move in/out.
 */
export function SchemaContainerSvgProto() {
  return (
    <svg
      className="schema-svg"
      viewBox="0 0 600 180"
      aria-label="Container schema — boundary, inside/outside"
    >
      {/* Container */}
      <g transform="translate(250, 40)">
        <rect className="proto-container" x="0" y="0" width="220" height="110" rx="14" />
        <text className="label" x="110" y="135" textAnchor="middle">
          boundary / inside vs outside
        </text>

        {/* Inside items */}
        <circle className="proto-item proto-item--a" cx="60" cy="55" r="8" />
        <circle className="proto-item proto-item--b" cx="120" cy="40" r="7" />
        <circle className="proto-item proto-item--c" cx="160" cy="70" r="6" />
      </g>

      {/* Outside item + arrow in */}
      <g>
        <circle className="proto-item proto-item--outside" cx="170" cy="95" r="7" />
        <path
          className="proto-flow"
          d="M 185 95 C 215 95, 235 90, 250 88"
          fill="none"
        />
        <polygon className="proto-arrow" points="250,88 242,84 242,92" />
        <text className="label" x="155" y="128" textAnchor="middle">
          outside → inside
        </text>
      </g>
    </svg>
  );
}
