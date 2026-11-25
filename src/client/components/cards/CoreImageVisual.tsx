import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/client/lib/i18n";
import { svgToImageSrc, svgViewBox, type SvgPresentation } from "@/client/lib/svg";
import { ReviewedCoreImage } from "./ReviewedCoreImage";
import { SchemaBlockageSvgProto } from "./SchemaBlockageSvgProto";
import { SchemaBalanceSvgProto } from "./SchemaBalanceSvgProto";
import { SchemaContainerSvgProto } from "./SchemaContainerSvgProto";
import { SchemaLinkSvgProto } from "./SchemaLinkSvgProto";
import { SchemaPathSvgProto } from "./SchemaPathSvgProto";

const REVIEWED_IMAGES = new Set(["account", "grim", "compromise", "assume"]);

function fallback(type: string) {
  switch (type) {
    case "blockage": return <SchemaBlockageSvgProto />;
    case "balance": return <SchemaBalanceSvgProto />;
    case "container": return <SchemaContainerSvgProto />;
    case "link": return <SchemaLinkSvgProto />;
    case "path": return <SchemaPathSvgProto />;
    default: return null;
  }
}

/** Only the open drawing is measured. Stored SVG remains an isolated image;
 * hand-reviewed drawings are trusted React SVG, with the same type and palette. */
export function CoreImageVisual({ word, type, raw, caption }: { word: string; type: string; raw?: string; caption?: string }) {
  const { t } = useI18n();
  const key = word.toLowerCase().trim();
  const frame = useRef<HTMLDivElement>(null);
  const [presentation, setPresentation] = useState<SvgPresentation>();
  const [badRaw, setBadRaw] = useState<string | null>(null);
  const source = useMemo(() => svgToImageSrc(raw, presentation), [raw, presentation]);
  const failed = typeof raw === "string" && badRaw === raw;

  useLayoutEffect(() => {
    const host = frame.current;
    if (!host) return;
    const measure = () => {
      const drawing = host.querySelector("img,svg");
      if (!drawing) return;
      const bounds = drawing.getBoundingClientRect();
      const [, , width, height] = svgViewBox(drawing.tagName.toLowerCase() === "img" ? raw : drawing.outerHTML);
      const scale = Math.min(bounds.width / width, bounds.height / height);
      if (!(scale > 0)) return;
      const style = getComputedStyle(host);
      const color = (name: string, otherwise: string) => style.getPropertyValue(name).trim() || otherwise;
      const next = {
        scale,
        text: color("--word-text", "#073642"), background: color("--word-card", "#fff"),
        surface: color("--word-surface", "#f4f4f5"), accent: color("--word-accent", "#0f766e"),
        secondary: color("--word-accent-secondary", "#946b00"), border: color("--word-border", "#d4d4d8"),
        fontFamily: style.fontFamily,
      };
      setPresentation((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measure();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    resize?.observe(host);
    const theme = new MutationObserver(measure);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { resize?.disconnect(); theme.disconnect(); };
  }, [raw, key, type, failed]);

  const labelSize = presentation ? Math.max(16, 14 / presentation.scale) : 16;
  return (
    <>
      <div ref={frame} className="core-visual" style={{ "--word-diagram-label-size": `${labelSize}px` } as CSSProperties}>
        {REVIEWED_IMAGES.has(key) ? <ReviewedCoreImage word={key} /> : source && !failed
          ? <img src={source} alt={t(`${word} 的核心意象`, `${word} — core image`)} onError={() => setBadRaw(raw ?? null)} />
          : fallback(type)}
      </div>
      {failed && <p>{t("图暂时无法显示，可以继续读下面的说明。", "The image could not be displayed. You can still read its explanation below.")}</p>}
      {caption && <p className="core-caption">{caption}</p>}
    </>
  );
}
