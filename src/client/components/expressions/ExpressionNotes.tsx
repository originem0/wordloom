import { Fragment, type ReactNode } from "react";
import { BoldMarkup } from "@/client/components/cards/UntrustedText";

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[]; start?: number }
  | { kind: "table"; headings: string[]; rows: string[][] };

const heading = (line: string) => /^#{1,6}\s+(.+)$/.exec(line.trim());
const item = (line: string | undefined) => /^\s*(?:[-*+]\s+|(\d+)[.)]\s+)(.+)$/.exec(line ?? "");
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));

function tableAt(lines: string[], at: number) {
  if (!lines[at]?.includes("|") || !lines[at + 1]?.includes("|")) return null;
  const headings = cells(lines[at]);
  const divider = cells(lines[at + 1]);
  return headings.length > 1 && headings.length === divider.length && divider.every((cell) => /^:?-{3,}:?$/.test(cell)) ? headings : null;
}

// Only the small set of formatting used in study notes. Original sentences
// never go through this reader; HTML and links remain literal text throughout.
function blocksOf(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  for (let at = 0; at < lines.length;) {
    if (!lines[at].trim()) { at++; continue; }
    const title = heading(lines[at]);
    if (title) { blocks.push({ kind: "heading", text: title[1] }); at++; continue; }
    const headings = tableAt(lines, at);
    if (headings) {
      at += 2;
      const rows: string[][] = [];
      while (at < lines.length && lines[at].includes("|") && cells(lines[at]).length === headings.length) rows.push(cells(lines[at++]));
      blocks.push({ kind: "table", headings, rows });
      continue;
    }
    const first = item(lines[at]);
    if (first) {
      const ordered = first[1] !== undefined;
      const items: string[] = [];
      let next: RegExpExecArray | null = first;
      while (next && (next[1] !== undefined) === ordered) {
        items.push(next[2]);
        next = item(lines[++at]);
      }
      blocks.push({ kind: "list", items, ...(ordered && { start: Number(first[1]) }) });
      continue;
    }
    const paragraph = [lines[at++]];
    while (at < lines.length && lines[at].trim() && !heading(lines[at]) && !item(lines[at]) && !tableAt(lines, at)) paragraph.push(lines[at++]);
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

function InlineNote({ text }: { text: string }) {
  return text.split(/(`[^`\n]+`|==[^=\n]+==|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/).map((part, i) => {
    if (/^`[^`\n]+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^==[^=\n]+==$/.test(part)) return <mark key={i}>{part.slice(2, -2)}</mark>;
    if (/^\*[^*\n]+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}><BoldMarkup text={part} /></Fragment>;
  });
}

function renderBlock(block: Block, key: number): ReactNode {
  if (block.kind === "heading") return <h5 key={key}><InlineNote text={block.text} /></h5>;
  if (block.kind === "paragraph") return <p key={key}><InlineNote text={block.text} /></p>;
  if (block.kind === "list") {
    const List = block.start === undefined ? "ul" : "ol";
    return <List key={key} start={block.start}>{block.items.map((text, i) => <li key={i}><InlineNote text={text} /></li>)}</List>;
  }
  return (
    <div key={key} className="expression-note-comparison">
      <table>
        <thead><tr>{block.headings.map((text, i) => <th key={i} scope="col"><InlineNote text={text} /></th>)}</tr></thead>
        <tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((text, j) => j === 0
          ? <th key={j} scope="row"><InlineNote text={text} /></th>
          : <td key={j}><InlineNote text={text} /></td>)}</tr>)}</tbody>
      </table>
      <div className="expression-note-cards">
        {block.rows.map((row, i) => <div key={i}>
          <p className="expression-note-card-title"><InlineNote text={row[0]} /></p>
          <dl>{row.slice(1).map((text, j) => <div key={j}>
            <dt><InlineNote text={block.headings[j + 1]} /></dt>
            <dd><InlineNote text={text} /></dd>
          </div>)}</dl>
        </div>)}
      </div>
    </div>
  );
}

export function ExpressionNotes({ text }: { text: string }) {
  const blocks = blocksOf(text);
  const content: ReactNode[] = [];
  for (let at = 0; at < blocks.length; at++) {
    const block = blocks[at];
    // Fold only explicitly titled extensions. Guessing from paragraph length
    // could hide the very explanation the learner opened the entry to read.
    if (block.kind === "heading" && /^(?:延伸|拓展|补充例句|更多例句|相关)(?:[\s：:]|$)/.test(block.text)) {
      let end = at + 1;
      while (end < blocks.length && blocks[end].kind !== "heading") end++;
      if (end > at + 1) {
        content.push(<details key={at} className="reading-help">
          <summary><InlineNote text={block.text} /></summary>
          <div className="expression-note-body">{blocks.slice(at + 1, end).map((next, i) => renderBlock(next, i))}</div>
        </details>);
        at = end - 1;
        continue;
      }
    }
    content.push(renderBlock(block, at));
  }
  return <div className="expression-note-body">{content}</div>;
}
