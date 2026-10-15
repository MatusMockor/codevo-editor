import type { CSSProperties } from "react";
import { codeLanguageForFence } from "../../domain/codeHighlight/codeLanguage";
import type { CodeToken, HighlightedLines } from "../../domain/codeHighlight/highlightedCode";
import { useRetainedHighlightedCode } from "./AgentMarkdownCodeBodyHighlight";
import { HighlightRun } from "./agentThreadHighlight";

const AGENT_CODE_HIGHLIGHT_DELAY_MS = 150;

export function AgentMarkdownCodeBody({
  code,
  current,
  indexOffset,
  language,
  query,
}: {
  readonly code: string;
  readonly current: number | null;
  readonly indexOffset: number;
  readonly language: string | null;
  readonly query: string;
}) {
  const languageId = codeLanguageForFence(language);
  const lines = useRetainedHighlightedCode(code, languageId ?? "plaintext", {
    enabled: query === "" && languageId !== null && languageId !== "plaintext" && code !== "",
    delayMs: AGENT_CODE_HIGHLIGHT_DELAY_MS,
  });
  if (lines === null || query !== "") {
    return <HighlightRun current={current} indexOffset={indexOffset} query={query} text={code} />;
  }
  return <AgentCodeTokens lines={lines} />;
}

export function AgentCodeTokens({ lines }: { readonly lines: HighlightedLines }) {
  return (
    <span className="agent-md__code-colorized" data-colorized="true">
      {lines.map((line, lineIndex) => (
        <span className="agent-md__code-line" key={`l${lineIndex}`}>
          {line.map((token, tokenIndex) => (
            <span key={`t${tokenIndex}`} style={tokenStyle(token)}>
              {token.text}
            </span>
          ))}
          {lineIndex < lines.length - 1 && "\n"}
        </span>
      ))}
    </span>
  );
}

function tokenStyle(token: CodeToken): CSSProperties | undefined {
  if (token.color === null && !token.italic && !token.bold) return undefined;
  return {
    ...(token.color === null ? {} : { color: token.color }),
    ...(token.italic ? { fontStyle: "italic" } : {}),
    ...(token.bold ? { fontWeight: 600 } : {}),
  };
}
