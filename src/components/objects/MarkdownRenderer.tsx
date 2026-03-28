/**
 * MarkdownRenderer — Standalone AI output renderer
 * Adapted for workspace design language.
 */
import { useMemo } from "react";

function applyInlineFormatting(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="bg-workspace-surface px-1.5 py-0.5 rounded text-xs font-mono">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-workspace-text font-semibold">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(~?\$[\d,]+\.?\d*[kKmMbB]?)/g, '<strong class="text-emerald-600 dark:text-emerald-400 font-semibold">$1</strong>')
    .replace(/([\d.]+%)/g, '<strong class="text-blue-600 dark:text-blue-400 font-semibold">$1</strong>');
}

const KNOWN_VALUES = new Set([
  "LOW", "MEDIUM", "HIGH", "CRITICAL",
  "NOW", "IMMEDIATE", "SOON", "LATER",
  "THIS WEEK", "THIS MONTH", "THIS QUARTER", "NEXT QUARTER", "NEXT MONTH",
  "EASY", "MODERATE", "HARD", "COMPLEX",
  "MINIMAL", "SIGNIFICANT", "MAJOR",
  "ACTIVE", "RESOLVED", "PENDING", "OPEN", "CLOSED",
  "YES", "NO", "N/A",
]);

function isCalloutLine(line: string): boolean {
  const trimmed = line.trim().replace(/^[-*]\s*/, "");
  return parseCalloutBadges(trimmed).length > 0;
}

function parseCalloutBadges(line: string): { label: string; value: string }[] {
  const trimmed = typeof line === "string" ? line.trim().replace(/^[-*]\s*/, "").replace(/\*\*/g, "") : "";
  const matches = [...trimmed.matchAll(/\b(EFFORT|URGENCY|PRIORITY|TIMELINE|IMPACT|DIFFICULTY|STATUS|RISK)\s*:\s*([^|;]*?)(?=\s+(?:EFFORT|URGENCY|PRIORITY|TIMELINE|IMPACT|DIFFICULTY|STATUS|RISK)\s*:|[|]|$)/gi)];
  return matches
    .map(m => ({
      label: m[1].toUpperCase(),
      value: m[2].trim().replace(/\*+/g, "").replace(/[.,;!]+$/, "").trim().toUpperCase(),
    }))
    .filter(b => KNOWN_VALUES.has(b.value));
}

function getBadgeColor(_label: string, value: string): string {
  const v = value.toLowerCase();
  if (v.includes("now") || v.includes("high") || v.includes("critical")) return "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
  if (v.includes("medium") || v.includes("quarter") || v.includes("moderate")) return "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800";
  if (v.includes("low") || v.includes("later") || v.includes("next")) return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
  return "bg-workspace-surface text-workspace-text border-workspace-border";
}

function parseHeadingLevel(line: string): { level: number; text: string } | null {
  const match = line.match(/^(#{1,3})\s+(.+)$/);
  return match ? { level: match[1].length, text: match[2] } : null;
}

interface ParsedBlock {
  type: "heading" | "paragraph" | "table" | "bullet-list" | "number-list" | "code-block" | "callout" | "collapsible" | "empty";
  content: string;
  level?: number;
  language?: string;
  headers?: string[];
  rows?: string[][];
  items?: string[];
  badges?: { label: string; value: string }[];
  summary?: string;
}

function parseMarkdown(text: string): ParsedBlock[] {
  const lines = text.split("\n");
  const blocks: ParsedBlock[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLanguage = "";
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];
  let currentList: string[] = [];
  let listType: "bullet" | "number" | null = null;

  const flushList = () => {
    if (currentList.length > 0 && listType) {
      blocks.push({ type: listType === "bullet" ? "bullet-list" : "number-list", content: "", items: [...currentList] });
      currentList = [];
      listType = null;
    }
  };

  const flushTable = () => {
    if (tableHeaders.length > 0) {
      blocks.push({ type: "table", content: "", headers: [...tableHeaders], rows: [...tableRows] });
      tableHeaders = [];
      tableRows = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      if (!inCodeBlock) {
        flushList(); flushTable();
        inCodeBlock = true;
        codeBlockLanguage = line.trimStart().slice(3).trim();
        codeBlockContent = [];
      } else {
        blocks.push({ type: "code-block", content: codeBlockContent.join("\n"), language: codeBlockLanguage });
        inCodeBlock = false;
      }
      continue;
    }
    if (inCodeBlock) { codeBlockContent.push(line); continue; }

    const trimmed = line.trim();

    if (isCalloutLine(line)) {
      flushList(); flushTable();
      blocks.push({ type: "callout", content: trimmed, badges: parseCalloutBadges(line) });
      continue;
    }

    if (trimmed.includes("|")) {
      const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      if (cells.every(c => /^[-:\s]+$/.test(c))) continue;
      if (cells.length >= 2) {
        flushList();
        if (!inTable) { inTable = true; tableHeaders = cells; tableRows = []; } else { tableRows.push(cells); }
        continue;
      }
    } else if (inTable) { flushTable(); }

    if (trimmed === "") { flushList(); continue; }

    const heading = parseHeadingLevel(line);
    if (heading) { flushList(); flushTable(); blocks.push({ type: "heading", content: heading.text, level: heading.level }); continue; }

    if (trimmed.endsWith(":") && trimmed.length < 80 && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
      flushList(); flushTable();
      blocks.push({ type: "heading", content: trimmed, level: 3 });
      continue;
    }

    if (/^[\s]*[-*]\s+/.test(line)) {
      if (listType === "number") flushList();
      listType = "bullet";
      currentList.push(line.replace(/^[\s]*[-*]\s+/, ""));
      continue;
    }

    if (/^[\s]*\d+\.\s+/.test(line)) {
      if (listType === "bullet") flushList();
      listType = "number";
      currentList.push(line.replace(/^[\s]*\d+\.\s+/, ""));
      continue;
    }

    flushTable();
    blocks.push({ type: "paragraph", content: trimmed });
  }

  flushList(); flushTable();
  if (inCodeBlock) blocks.push({ type: "code-block", content: codeBlockContent.join("\n"), language: codeBlockLanguage });
  return blocks;
}

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

export default function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            if (block.level === 1) return <h1 key={i} className="text-xl font-bold text-workspace-text mt-2 mb-3" dangerouslySetInnerHTML={{ __html: applyInlineFormatting(block.content) }} />;
            if (block.level === 2) return (
              <h2 key={i} className="flex items-center gap-2.5 text-lg font-semibold text-workspace-text mt-8 mb-3 pb-2.5 border-b border-workspace-border/50">
                <span className="w-1 h-5 rounded-full bg-workspace-accent shrink-0" />
                <span dangerouslySetInnerHTML={{ __html: applyInlineFormatting(block.content) }} />
              </h2>
            );
            return <h3 key={i} className="text-base font-semibold text-workspace-text mt-5 mb-2" dangerouslySetInnerHTML={{ __html: applyInlineFormatting(block.content) }} />;

          case "callout":
            return (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2.5 my-2.5 px-4 py-2.5 rounded-lg bg-workspace-surface/40 border border-workspace-border/50">
                {block.badges?.map((badge, j) => (
                  <div key={j} className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium tracking-wider text-workspace-text-secondary uppercase">{badge.label}:</span>
                    <span className={`text-[11px] font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full border ${getBadgeColor(badge.label, badge.value)}`}>{badge.value}</span>
                  </div>
                ))}
              </div>
            );

          case "paragraph":
            return <p key={i} className="my-1.5 text-workspace-text break-words" style={{ overflowWrap: "anywhere" }} dangerouslySetInnerHTML={{ __html: applyInlineFormatting(block.content) }} />;

          case "bullet-list":
            return (
              <ul key={i} className="space-y-1.5 ml-4 my-2">
                {block.items?.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="text-workspace-accent mt-0.5 select-none">•</span>
                    <span className="text-workspace-text break-words flex-1" style={{ overflowWrap: "anywhere" }} dangerouslySetInnerHTML={{ __html: applyInlineFormatting(item) }} />
                  </li>
                ))}
              </ul>
            );

          case "number-list":
            return (
              <ol key={i} className="space-y-1.5 ml-4 my-2">
                {block.items?.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="text-workspace-accent font-medium mt-0.5 select-none min-w-[1.25rem]">{j + 1}.</span>
                    <span className="text-workspace-text break-words flex-1" style={{ overflowWrap: "anywhere" }} dangerouslySetInnerHTML={{ __html: applyInlineFormatting(item) }} />
                  </li>
                ))}
              </ol>
            );

          case "table":
            return (
              <div key={i} className="my-3 overflow-x-auto rounded-lg border border-workspace-border/50">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-workspace-surface">
                      {block.headers?.map((h, j) => (
                        <th key={j} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-workspace-text border-b border-workspace-border" dangerouslySetInnerHTML={{ __html: applyInlineFormatting(h) }} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows?.map((row, j) => (
                      <tr key={j} className={j % 2 === 0 ? "bg-white dark:bg-workspace-surface" : "bg-workspace-surface/30"}>
                        {row.map((cell, k) => (
                          <td key={k} className="px-4 py-2.5 text-sm text-workspace-text border-b border-workspace-border/30" dangerouslySetInnerHTML={{ __html: applyInlineFormatting(cell) }} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "code-block":
            return (
              <div key={i} className="my-3 rounded-md bg-slate-950 overflow-hidden">
                {block.language && <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-800 font-mono">{block.language}</div>}
                <pre className="p-4 overflow-x-auto"><code className="text-sm text-slate-100 font-mono">{block.content}</code></pre>
              </div>
            );

          default:
            return null;
        }
      })}
      {isStreaming && <span className="inline-block w-1.5 h-5 bg-workspace-accent/60 animate-pulse ml-0.5 align-text-bottom rounded-sm" />}
    </div>
  );
}
