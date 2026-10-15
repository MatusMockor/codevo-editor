import {
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useHighlightedCode } from "../../../../application/codeHighlight/codeHighlighter";
import type { CodeLanguageId } from "../../../../domain/codeHighlight/codeLanguage";
import {
  splitCodeLines,
  type HighlightedLines,
} from "../../../../domain/codeHighlight/highlightedCode";
import { useLatest } from "../../../../ui/foundation/useLatest";
import { HighlightedCodeLines } from "../../../code/HighlightedCodeLines";
import {
  FileViewerFontContext,
  fileViewerFontFamily,
  fileViewerFontSize,
  fileViewerLineHeight,
} from "./fileViewerFont";
import {
  FILE_VIEWER_BLOCK_LINES,
  blockOffset,
  estimatedBlockHeight,
  fileViewerBlockCount,
  fileViewerWindow,
} from "./fileViewerModel";

const MAX_REVEAL_CORRECTIONS = 8;

export const FILE_VIEWER_TOO_LARGE_NOTE =
  "Syntax highlighting is off for this file because it is too large.";

export interface FileViewerCodeProps {
  readonly text: string;
  readonly language: CodeLanguageId;
  readonly wrap: boolean;
  readonly revealLine: number | null;
  readonly revealSequence: number;
  readonly initialScrollTop?: number | null;
  onScrollTopChange?(scrollTop: number): void;
}

interface PendingReveal {
  readonly line: number;
  corrections: number;
}

interface MeasuredHeights {
  readonly key: string;
  readonly heights: ReadonlyMap<number, number>;
}

interface Viewport {
  readonly top: number;
  readonly height: number;
  readonly width: number;
}

const EMPTY_MEASURED: MeasuredHeights = { key: "", heights: new Map() };

export function FileViewerCode({
  initialScrollTop = null,
  language,
  onScrollTopChange,
  revealLine,
  revealSequence,
  text,
  wrap,
}: FileViewerCodeProps) {
  const font = useContext(FileViewerFontContext);
  const lineHeight = fileViewerLineHeight(font);
  const fontFamily = fileViewerFontFamily(font);
  const fontSize = fileViewerFontSize(font);
  const lines = useMemo(() => splitCodeLines(text), [text]);
  const highlight = useHighlightedCode(text, language);
  const tokens =
    highlight.kind === "highlighted" && highlight.lines.length === lines.length
      ? highlight.lines
      : null;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ top: 0, height: 0, width: 0 });
  const [measured, setMeasured] = useState<MeasuredHeights>(EMPTY_MEASURED);
  const measureKey = `${wrap ? `wrap:${viewport.width}` : "nowrap"}|${lineHeight}|${fontFamily ?? ""}`;
  const blockCount = fileViewerBlockCount(lines.length);
  const heights = useMemo(() => {
    const known = measured.key === measureKey ? measured.heights : null;
    return Array.from(
      { length: blockCount },
      (_unused, block) =>
        known?.get(block) ?? estimatedBlockHeight(block, lines.length, lineHeight),
    );
  }, [blockCount, lineHeight, lines.length, measureKey, measured]);
  const range = fileViewerWindow({
    heights,
    scrollTop: viewport.top,
    viewportHeight: viewport.height,
  });
  const gutterChars = String(lines.length).length;
  const layoutRef = useLatest({ heights, lineCount: lines.length, lineHeight });
  const restoreRef = useRef(initialScrollTop);
  const pendingRevealRef = useRef<PendingReveal | null>(null);
  const measuringRef = useRef(false);

  const readViewport = useCallback(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    setViewport((current) => {
      const next = {
        top: element.scrollTop,
        height: element.clientHeight,
        width: element.clientWidth,
      };
      if (
        current.top === next.top &&
        current.height === next.height &&
        current.width === next.width
      ) {
        return current;
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (element === null) return undefined;
    readViewport();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(() => readViewport());
    observer.observe(element);
    return () => observer.disconnect();
  }, [readViewport]);

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    const updates = new Map<number, number>();
    for (const block of element.querySelectorAll<HTMLElement>("[data-file-viewer-block]")) {
      const index = Number(block.dataset.fileViewerBlock);
      const height = block.offsetHeight;
      if (!Number.isInteger(index) || height <= 0) continue;
      if (Math.abs((heights[index] ?? 0) - height) < 0.5) continue;
      updates.set(index, height);
    }
    measuringRef.current = updates.size > 0;
    if (updates.size === 0) return;
    setMeasured((current) => {
      const base = current.key === measureKey ? current.heights : new Map<number, number>();
      return { key: measureKey, heights: new Map([...base, ...updates]) };
    });
  }, [heights, measureKey, range.firstBlock, range.lastBlock, tokens]);

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    const restored = restoreRef.current;
    restoreRef.current = null;
    if (restored !== null) {
      element.scrollTop = restored;
      readViewport();
      return;
    }
    if (revealLine === null) return;
    const { heights: known, lineCount, lineHeight: rowHeight } = layoutRef.current;
    const line = Math.min(Math.max(1, revealLine), lineCount) - 1;
    const block = Math.floor(line / FILE_VIEWER_BLOCK_LINES);
    const within = (line % FILE_VIEWER_BLOCK_LINES) * rowHeight;
    const offset = blockOffset(known, block) + within;
    element.scrollTop = Math.max(0, offset - element.clientHeight / 2 + rowHeight / 2);
    pendingRevealRef.current = { line: line + 1, corrections: 0 };
    readViewport();
  }, [layoutRef, readViewport, revealLine, revealSequence]);

  useLayoutEffect(() => {
    const pending = pendingRevealRef.current;
    const element = scrollerRef.current;
    if (pending === null || element === null) return;
    const row = element.querySelector<HTMLElement>(`[data-line="${pending.line}"]`);
    if (row === null) return;
    const rowTop =
      row.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
    const rowHeight = row.offsetHeight > 0 ? row.offsetHeight : layoutRef.current.lineHeight;
    const desired = Math.max(0, rowTop - element.clientHeight / 2 + rowHeight / 2);
    const settled = Math.abs(desired - element.scrollTop) <= 1;
    pending.corrections += 1;
    if (settled && !measuringRef.current) {
      pendingRevealRef.current = null;
      return;
    }
    if (pending.corrections >= MAX_REVEAL_CORRECTIONS) pendingRevealRef.current = null;
    if (settled) return;
    element.scrollTop = desired;
    readViewport();
  });

  const cancelPendingReveal = () => {
    pendingRevealRef.current = null;
  };

  const onScroll = () => {
    readViewport();
    const element = scrollerRef.current;
    if (element !== null) onScrollTopChange?.(element.scrollTop);
  };

  const blocks = [];
  for (let block = range.firstBlock; block <= range.lastBlock; block += 1) {
    blocks.push(
      <FileViewerBlock
        block={block}
        highlightedLine={revealLine}
        key={block}
        lines={lines}
        tokens={tokens}
        wrap={wrap}
      />,
    );
  }

  return (
    <div className="cv-file-viewer__code-frame">
      {highlight.kind === "plain" && highlight.reason === "too-large" && (
        <p className="cv-file-viewer__note" role="note">
          {FILE_VIEWER_TOO_LARGE_NOTE}
        </p>
      )}
      <div
        aria-label="File contents"
        className={
          wrap ? "cv-file-viewer__code cv-file-viewer__code--wrap" : "cv-file-viewer__code"
        }
        data-highlight={highlight.kind}
        onKeyDown={cancelPendingReveal}
        onPointerDown={cancelPendingReveal}
        onScroll={onScroll}
        onWheel={cancelPendingReveal}
        ref={scrollerRef}
        role="region"
        style={
          {
            "--file-viewer-gutter-chars": gutterChars,
            "--file-viewer-line-height": `${lineHeight}px`,
            fontFamily: fontFamily ?? undefined,
            fontSize: fontSize === null ? undefined : `${fontSize}px`,
          } as CSSProperties
        }
        tabIndex={0}
      >
        <div style={{ height: range.before }} aria-hidden="true" />
        {blocks}
        <div style={{ height: range.after }} aria-hidden="true" />
      </div>
    </div>
  );
}

interface FileViewerBlockProps {
  readonly block: number;
  readonly lines: ReadonlyArray<string>;
  readonly tokens: HighlightedLines | null;
  readonly wrap: boolean;
  readonly highlightedLine: number | null;
}

const FileViewerBlock = memo(function FileViewerBlock({
  block,
  highlightedLine,
  lines,
  tokens,
  wrap,
}: FileViewerBlockProps) {
  const start = block * FILE_VIEWER_BLOCK_LINES;
  const end = Math.min(lines.length, start + FILE_VIEWER_BLOCK_LINES);
  const plainText = useMemo(() => lines.slice(start, end).join("\n"), [end, lines, start]);
  const slice = useMemo(
    () => (tokens === null ? null : tokens.slice(start, end)),
    [end, start, tokens],
  );
  return (
    <div data-file-viewer-block={block}>
      <HighlightedCodeLines
        highlightedLine={highlightedLine}
        lines={slice}
        plainText={plainText}
        showLineNumbers
        startLineNumber={start + 1}
        wrap={wrap}
      />
    </div>
  );
});
