/**
 * SchemaBlockageSvgProto — Animated SVG for the "blockage" cognitive schema.
 * Pixel-level port of prototype-obscure.html <template id="schema-blockage">.
 */
export function SchemaBlockageSvgProto() {
  return (
    <svg
      className="schema-svg"
      viewBox="0 0 600 180"
      aria-label="Blocking schema — observer, obstacle, hidden target"
    >
      {/* Observer (eye) */}
      <g transform="translate(70, 90)">
        <ellipse className="eye" cx="0" cy="0" rx="18" ry="12" />
        <circle className="eye-white" cx="0" cy="0" r="6" />
        <circle className="eye-pupil" cx="0" cy="0" r="3" />
        <text className="label" x="-16" y="32" textAnchor="middle">
          observer
        </text>
      </g>

      {/* Light rays trying to reach target */}
      <g>
        <line className="ray" x1="95" y1="82" x2="240" y2="60" />
        <line className="ray" x1="95" y1="90" x2="240" y2="90" />
        <line className="ray" x1="95" y1="98" x2="240" y2="120" />
      </g>

      {/* Fog / Cloud obstacle */}
      <g transform="translate(300, 90)">
        <ellipse className="cloud" cx="-20" cy="-15" rx="55" ry="28" />
        <ellipse className="cloud" cx="15" cy="5" rx="60" ry="32" />
        <ellipse className="cloud" cx="-10" cy="20" rx="50" ry="25" />
        <text className="label" x="0" y="60" textAnchor="middle">
          cloud / fog / obstacle
        </text>
      </g>

      {/* Dashed arrow (blocked) */}
      <line className="blocked-arrow" x1="240" y1="90" x2="370" y2="90" />

      {/* Target (hidden) */}
      <g transform="translate(490, 90)">
        <rect className="target" x="-32" y="-32" width="64" height="64" rx="10" />
        <text className="question" x="0" y="10" textAnchor="middle">
          ?
        </text>
        <text className="label" x="0" y="55" textAnchor="middle">
          hidden target
        </text>
      </g>
    </svg>
  );
}
