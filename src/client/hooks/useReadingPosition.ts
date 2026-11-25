import { useEffect, useRef, useState } from "react";
import { readingPosition, rememberReadingPosition, readingGeneration } from "@/client/store/reading";

/** Wait for the list before restoring: scrolling an empty loading page clamps to zero. */
export function useReadingPosition(page: "cards" | "expressions", ready: boolean) {
  const [saved] = useState(() => readingPosition(page));
  const last = useRef(saved);
  const restored = useRef(false);
  const [visit] = useState(readingGeneration);

  useEffect(() => {
    const remember = () => {
      if (!restored.current || visit !== readingGeneration()) return;
      last.current = window.scrollY;
      rememberReadingPosition(page, last.current);
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.removeEventListener("scroll", remember);
      if (visit === readingGeneration()) rememberReadingPosition(page, restored.current ? last.current : saved);
    };
  }, [page, saved, visit]);

  useEffect(() => {
    if (!ready || restored.current) return;
    const restore = () => {
      restored.current = true;
      if (window.scrollY !== saved) window.scrollTo({ top: saved, behavior: "instant" });
      last.current = saved;
    };
    const frame = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frame);
  }, [ready, saved]);
}
