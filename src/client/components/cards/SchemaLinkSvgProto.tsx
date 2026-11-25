import { useI18n } from "@/client/lib/i18n";

/**
 * SchemaLinkSvgProto — Animated SVG for the "link" cognitive schema.
 * Visual: two nodes connected by a pulsing link.
 */
export function SchemaLinkSvgProto() {
  const { t } = useI18n();
  return (
    <svg role="img" className="schema-svg" viewBox="0 0 600 180" aria-label={t("连接图式，节点间的联系", "Link schema — connection between nodes")}>
      <g>
        <circle className="proto-node" cx="150" cy="90" r="18" />
        <circle className="proto-node" cx="450" cy="90" r="18" />

        <line className="proto-link" x1="170" y1="90" x2="430" y2="90" />
        <line className="proto-link proto-link--dash" x1="170" y1="90" x2="430" y2="90" />

        <text className="label" x="150" y="130" textAnchor="middle">
          A
        </text>
        <text className="label" x="450" y="130" textAnchor="middle">
          B
        </text>
        <text className="label" x="300" y="155" textAnchor="middle">
          {t("连接 / 联系", "link / association")}
        </text>
      </g>
    </svg>
  );
}
