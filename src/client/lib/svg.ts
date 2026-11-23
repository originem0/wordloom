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
export function svgToImageSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end < start) return null;
  let svg = raw.slice(start, end + "</svg>".length);
  // A standalone SVG document without the namespace renders as nothing.
  if (!/^<svg[^>]*\sxmlns=/.test(svg)) {
    svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
