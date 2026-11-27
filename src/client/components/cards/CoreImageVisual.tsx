import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n, type translate } from "@/client/lib/i18n";
import { svgToImageSrc, svgViewBox, type SvgPresentation } from "@/client/lib/svg";
import type { Card } from "@/shared/types";
import { reviewedCoreScene, type CoreImageScene } from "./CoreImageScenes";
import { ReviewedCoreImage } from "./ReviewedCoreImage";
import { BoldMarkup } from "./UntrustedText";
import { SchemaBlockageSvgProto } from "./SchemaBlockageSvgProto";
import { SchemaBalanceSvgProto } from "./SchemaBalanceSvgProto";
import { SchemaContainerSvgProto } from "./SchemaContainerSvgProto";
import { SchemaLinkSvgProto } from "./SchemaLinkSvgProto";
import { SchemaPathSvgProto } from "./SchemaPathSvgProto";

const LEGACY_REVIEWED_IMAGES = new Set(["account", "compromise", "assume"]);
type SceneCard = Pick<Card, "word" | "pos" | "schemaAnalysis">;

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

function coreScene({ word, pos, schemaAnalysis: schema }: SceneCard, t: typeof translate): CoreImageScene | undefined {
  const key = word.trim().toLowerCase();
  const raw = schema?.coreSvg?.trim();
  const caption = schema?.coreImageText?.trim();
  const example = schema?.coreImageExample?.trim();
  // A newly written scene owns its drawing, including the choice to omit it.
  if (example) return { raw, caption, example };
  const reviewed = reviewedCoreScene(key, pos, t);
  if (reviewed || !schema) return reviewed;
  const type = schema.coreSchema?.trim().toLowerCase();
  const legacyCaption = caption || (type !== "none" ? schema.coreSchema?.trim() : undefined);
  if (!raw && !legacyCaption) return;
  if (LEGACY_REVIEWED_IMAGES.has(key)) return { caption: legacyCaption, drawing: <ReviewedCoreImage word={key} /> };
  return { raw, caption: legacyCaption, drawing: fallback(type ?? "") };
}

function CoreDrawing({ word, raw, drawing }: Pick<CoreImageScene, "raw" | "drawing"> & { word: string }) {
  const { t } = useI18n();
  const frame = useRef<HTMLDivElement>(null);
  const [presentation, setPresentation] = useState<SvgPresentation>();
  const [badRaw, setBadRaw] = useState<string | null>(null);
  const source = useMemo(() => svgToImageSrc(raw, presentation), [raw, presentation]);
  const failed = !!raw && (!source || badRaw === raw);

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
        text: color("--word-text", "#302d26"), background: color("--word-surface", "#ece1cd"),
        surface: color("--word-card", "#f2e8d5"), accent: color("--word-accent", "#245c54"),
        secondary: color("--word-accent-secondary", "#805c28"), border: color("--word-border", "#c3b8a3"),
        muted: color("--word-muted", "#625846"), highlight: color("--accent", "#d8e3d2"),
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
  }, [raw, word, failed]);

  const labelSize = presentation ? Math.max(16, 14 / presentation.scale) : 16;
  return (
    <>
      {(drawing || (source && !failed)) && <div ref={frame} className="core-visual" style={{ "--word-diagram-label-size": `${labelSize}px` } as CSSProperties}>
        {source && !failed
          ? <img src={source} alt={t(`${word} 的核心意象`, `${word} — core image`)} onError={() => setBadRaw(raw ?? null)} />
          : drawing}
      </div>}
      {failed && <p>{t("图暂时无法显示。", "The image could not be displayed.")}</p>}
    </>
  );
}

export function CoreImageVisual({ card }: { card: SceneCard }) {
  const { t } = useI18n();
  const scene = coreScene(card, t);
  if (!scene) return null;
  return (
    <section className="core-image">
      <h2>{t("核心意象", "Core image")}</h2>
      {(scene.raw || scene.drawing) && <CoreDrawing word={card.word} raw={scene.raw} drawing={scene.drawing} />}
      {scene.caption && <p className="core-caption">{scene.example ? <BoldMarkup text={scene.caption} /> : scene.caption}</p>}
      {scene.example && <p className="core-example" lang="en"><BoldMarkup text={scene.example} /></p>}
    </section>
  );
}
