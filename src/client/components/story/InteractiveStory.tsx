import { useMemo } from "react";

interface InteractiveStoryProps {
  story: string;
  onWordClick: (word: string) => void;
}

/**
 * Token produced by parsing: either an English word (clickable) or
 * a run of non-word characters (whitespace, punctuation -- rendered as-is).
 */
interface Token {
  text: string;
  isWord: boolean;
  bold: boolean;
}

// Matches **bold** markers in Markdown
const BOLD_RE = /\*\*(.+?)\*\*/g;
// English words including contractions (don't) and hyphenated compounds (well-known)
const WORD_RE = /[a-zA-Z]+(?:'[a-zA-Z]+)*(?:-[a-zA-Z]+)*/g;

/**
 * Strips Markdown bold markers, tracks which character ranges were bold,
 * then tokenizes into clickable words vs inert text runs.
 */
function tokenize(raw: string): Token[] {
  // 1. Strip **bold** markers, record bold ranges in the *cleaned* string
  const boldRanges: [number, number][] = [];
  let cleaned = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  BOLD_RE.lastIndex = 0;
  while ((match = BOLD_RE.exec(raw)) !== null) {
    // text before this bold marker
    cleaned += raw.slice(cursor, match.index);
    const start = cleaned.length;
    cleaned += match[1]; // inner text (without **)
    boldRanges.push([start, cleaned.length]);
    cursor = match.index + match[0].length;
  }
  cleaned += raw.slice(cursor);

  const isBold = (start: number, end: number) =>
    boldRanges.some(([bs, be]) => start >= bs && end <= be);

  // 2. Tokenize: walk through `cleaned`, alternating between word and non-word runs
  const tokens: Token[] = [];
  let last = 0;

  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(cleaned)) !== null) {
    // Non-word run before this word
    if (match.index > last) {
      tokens.push({
        text: cleaned.slice(last, match.index),
        isWord: false,
        bold: false,
      });
    }
    tokens.push({
      text: match[0],
      isWord: true,
      bold: isBold(match.index, match.index + match[0].length),
    });
    last = match.index + match[0].length;
  }
  // Trailing non-word text
  if (last < cleaned.length) {
    tokens.push({
      text: cleaned.slice(last),
      isWord: false,
      bold: false,
    });
  }

  return tokens;
}

export function InteractiveStory({ story, onWordClick }: InteractiveStoryProps) {
  const tokens = useMemo(() => tokenize(story), [story]);

  return (
    <div className="leading-8 text-base md:text-lg">
      {tokens.map((token, i) => {
        if (!token.isWord) {
          // Preserve newlines as <br>
          if (token.text.includes("\n")) {
            return (
              <span key={i}>
                {token.text.split("\n").map((seg, j, arr) => (
                  <span key={j}>
                    {seg}
                    {j < arr.length - 1 && <br />}
                  </span>
                ))}
              </span>
            );
          }
          return <span key={i}>{token.text}</span>;
        }

        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            className={`cursor-pointer rounded px-0.5 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 ${
              token.bold ? "font-semibold" : ""
            }`}
            onClick={() => onWordClick(token.text)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onWordClick(token.text);
              }
            }}
          >
            {token.text}
          </span>
        );
      })}
    </div>
  );
}
