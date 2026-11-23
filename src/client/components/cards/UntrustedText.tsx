import { Fragment } from "react";

/**
 * Renders model output that uses `**bold**` emphasis as React nodes.
 *
 * Deep-layer text is written by the model from visitor-supplied input, so it
 * is never passed to dangerouslySetInnerHTML: the only markup this produces is
 * the <strong> it creates itself; everything else is a text node.
 */
export function BoldMarkup({ text }: { text: string }) {
  // split() with one capture group alternates plain, bold, plain, bold, …
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}
