/**
 * Turns a model-generated SVG string into an <img> src.
 *
 * The SVG is deliberately NOT inlined into the page. A regex "sanitizer" used
 * to guard an innerHTML sink here and was trivially bypassed (unquoted
 * `onload=`, entity-encoded `javascript:`), and the SVG's own <style> block
 * leaked into the whole document. Loaded as an image, the browser runs no
 * script, fires no event handlers, fetches no external resources and scopes
 * the CSS to the image — while @keyframes animations keep working.
 */
export interface SvgPresentation {
  scale: number;
  text: string;
  background: string;
  surface: string;
  accent: string;
  secondary: string;
  border: string;
  muted: string;
  highlight: string;
  fontFamily?: string;
}

export function svgToImageSrc(raw: string | null | undefined, presentation?: SvgPresentation): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end < start) return null;
  let svg = raw.slice(start, end + "</svg>".length);
  // A standalone SVG document without the namespace renders as nothing.
  if (!/^<svg[^>]*\sxmlns=/.test(svg)) {
    svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // Parsing is only for presentation. The result stays an image, never an
  // inline SVG/HTML sink; model scripts and styles remain isolated from the app.
  if (presentation && presentation.scale > 0 && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (!doc.querySelector("parsererror")) {
      const root = doc.documentElement;
      const [left, top, width, height] = svgViewBox(svg);
      const minimum = 14 / presentation.scale;
      const margin = 6 / presentation.scale;
      const palette: Record<string, string> = {
        "#fdf6e3": presentation.surface, "#eee8d5": presentation.background, "#f4f1eb": presentation.surface,
        "#073642": presentation.text, "#002b36": presentation.text, "#586e75": presentation.text,
        "#657b83": presentation.text, "#839496": presentation.text, "#93a1a1": presentation.text,
        "#2aa198": presentation.accent, "#b58900": presentation.secondary, "#d3cbbf": presentation.border,
        "#f2e8d5": presentation.surface, "#ece1cd": presentation.background, "#302d26": presentation.text,
        "#625846": presentation.muted, "#245c54": presentation.accent, "#d8e3d2": presentation.highlight,
        "#c3b8a3": presentation.border,
      };
      for (const element of root.querySelectorAll("*")) {
        const fill = element.getAttribute("fill")?.toLowerCase();
        const canvas = element.localName === "rect" && Number(element.getAttribute("x") ?? 0) === left && Number(element.getAttribute("y") ?? 0) === top
          && (Number(element.getAttribute("width")) === width || element.getAttribute("width") === "100%")
          && (Number(element.getAttribute("height")) === height || element.getAttribute("height") === "100%");
        for (const attr of ["fill", "stroke", "stop-color", "color"]) {
          const value = element.getAttribute(attr)?.toLowerCase();
          if (value && palette[value]) element.setAttribute(attr, palette[value]);
        }
        if (canvas && fill && ["white", "#fff", "#ffffff", "#fdf6e3", "#eee8d5", "#f7f3e8", "#f2e8d5", "#002b36", "#073642"].includes(fill)) element.setAttribute("fill", presentation.background);
        const style = element.localName === "style" ? element.textContent : element.getAttribute("style");
        if (style) {
          const themed = style.replace(/\b(fill|stroke|color|stop-color)\s*:\s*(#[\da-f]{3,6})(?=[\s;}]|$)/gi, (match, property: string, color: string) => palette[color.toLowerCase()] ? `${property}:${palette[color.toLowerCase()]}` : match);
          if (element.localName === "style") element.textContent = themed;
          else element.setAttribute("style", themed);
        }
        if (element.localName !== "text") continue;
        const inlineSize = element.getAttribute("style")?.match(/font-size\s*:\s*([\d.]+)/i)?.[1];
        const current = Number.parseFloat(inlineSize ?? element.getAttribute("font-size") ?? "14");
        const size = Math.max(Number.isFinite(current) ? current : 14, minimum);
        element.setAttribute("font-size", String(size));
        element.setAttribute("style", `${element.getAttribute("style") ?? ""};font-size:${size}px !important;font-family:${presentation.fontFamily ?? "system-ui,sans-serif"} !important`);
        // Simple labels can otherwise grow beyond the canvas on a phone.
        // Keep authored multiline/rotated layouts intact rather than guessing them.
        if (!element.querySelector("tspan") && !element.closest("[transform]")) {
          const units = Array.from(element.textContent ?? "").reduce((sum, char) => sum + (char.charCodeAt(0) < 256 ? 0.6 : 1), 0);
          const extent = units * size;
          const anchor = element.getAttribute("text-anchor") ?? "start";
          const before = anchor === "middle" ? extent / 2 : anchor === "end" ? extent : 0;
          const after = extent - before;
          const x = Number(element.getAttribute("x"));
          const y = Number(element.getAttribute("y"));
          if (Number.isFinite(x) && extent < width - 2 * margin) element.setAttribute("x", String(Math.max(left + margin + before, Math.min(x, left + width - margin - after))));
          if (Number.isFinite(y)) element.setAttribute("y", String(Math.max(top + size, Math.min(y, top + height - size * 0.25))));
        }
      }
      svg = new XMLSerializer().serializeToString(root);
    }
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Dimensions are read from the inert document, not from a live DOM insertion. */
export function svgViewBox(raw: string | null | undefined): [number, number, number, number] {
  const match = typeof raw === "string" ? raw.match(/\bviewBox\s*=\s*["']([^"']+)["']/) : null;
  const values = match?.[1].trim().split(/[\s,]+/).map(Number);
  return values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0
    ? values as [number, number, number, number] : [0, 0, 600, 180];
}
