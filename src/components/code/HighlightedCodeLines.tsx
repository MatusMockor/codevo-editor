import { memo, useMemo, type CSSProperties, type JSX } from "react";
import {
  splitCodeLines,
  type CodeToken,
  type HighlightedLine,
  type HighlightedLines,
} from "../../domain/codeHighlight/highlightedCode";
import "./highlightedCode.css";

export interface HighlightedCodeLinesProps {
  readonly lines: HighlightedLines | null;
  readonly plainText: string;
  readonly startLineNumber?: number;
  readonly showLineNumbers?: boolean;
  readonly wrap?: boolean;
  readonly highlightedLine?: number | null;
  readonly className?: string;
}

export const HighlightedCodeLines = memo(function HighlightedCodeLines({
  lines,
  plainText,
  startLineNumber = 1,
  showLineNumbers = false,
  wrap = false,
  highlightedLine = null,
  className,
}: HighlightedCodeLinesProps): JSX.Element {
  const plainLines = useMemo(
    () => (lines === null ? splitCodeLines(plainText) : null),
    [lines, plainText],
  );
  const count = lines?.length ?? plainLines?.length ?? 0;
  const gutterChars = String(startLineNumber + Math.max(0, count - 1)).length;
  const classes = [
    "highlighted-code",
    wrap ? "highlighted-code--wrap" : "highlighted-code--nowrap",
  ];
  if (className !== undefined && className.length > 0) classes.push(className);
  const style = { "--highlighted-code-gutter-chars": gutterChars } as CSSProperties;
  const rows: JSX.Element[] = [];
  for (let index = 0; index < count; index += 1) {
    const lineNumber = startLineNumber + index;
    rows.push(
      <CodeRow
        key={lineNumber}
        lineNumber={lineNumber}
        showLineNumber={showLineNumbers}
        current={highlightedLine === lineNumber}
        tokens={lines?.[index] ?? null}
        plain={plainLines?.[index] ?? ""}
      />,
    );
  }
  return (
    <div className={classes.join(" ")} style={style} role="presentation">
      <code className="highlighted-code__code">{rows}</code>
    </div>
  );
});

interface CodeRowProps {
  readonly lineNumber: number;
  readonly showLineNumber: boolean;
  readonly current: boolean;
  readonly tokens: HighlightedLine | null;
  readonly plain: string;
}

const CodeRow = memo(function CodeRow({
  lineNumber,
  showLineNumber,
  current,
  tokens,
  plain,
}: CodeRowProps): JSX.Element {
  const className = current ? "highlighted-code__line is-current" : "highlighted-code__line";
  return (
    <span className={className} data-line={lineNumber} aria-current={current ? "true" : undefined}>
      {showLineNumber ? (
        <span className="highlighted-code__gutter" aria-hidden="true">
          {lineNumber}
        </span>
      ) : null}
      <span className="highlighted-code__text">
        {tokens === null ? plain : tokens.map(renderToken)}
      </span>
    </span>
  );
});

function renderToken(token: CodeToken, index: number): JSX.Element | string {
  if (token.color === null && !token.italic && !token.bold) return token.text;
  return (
    <span key={index} style={tokenStyle(token)}>
      {token.text}
    </span>
  );
}

function tokenStyle(token: CodeToken): CSSProperties {
  return {
    color: token.color ?? undefined,
    fontStyle: token.italic ? "italic" : undefined,
    fontWeight: token.bold ? 600 : undefined,
  };
}
