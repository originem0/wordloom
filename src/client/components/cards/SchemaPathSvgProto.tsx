/**
 * SchemaPathSvgProto — Animated SVG for the "path" cognitive schema.
 * Visual: a path with a moving dot (progress) and waypoints.
 */
export function SchemaPathSvgProto() {
  return (
    <svg className="schema-svg" viewBox="0 0 600 180" aria-label="Path schema — progress along a route">
      <path
        className="proto-path"
        d="M 80 120 C 150 40, 250 160, 320 90 S 470 60, 520 110"
        fill="none"
      />

      {/* Waypoints */}
      <circle className="proto-waypoint" cx="80" cy="120" r="6" />
      <circle className="proto-waypoint" cx="210" cy="95" r="5" />
      <circle className="proto-waypoint" cx="320" cy="90" r="5" />
      <circle className="proto-waypoint" cx="520" cy="110" r="6" />

      {/* Moving dot (progress) */}
      <circle className="proto-traveler" r="6">
        <animateMotion dur="6s" repeatCount="indefinite" path="M 80 120 C 150 40, 250 160, 320 90 S 470 60, 520 110" />
      </circle>

      <text className="label" x="300" y="160" textAnchor="middle">
        path / progress
      </text>
    </svg>
  );
}
