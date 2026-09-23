import type { CSSProperties } from "react";
import { useAgentCodeColorization, type AgentCodeToken } from "./agentCodeColorizer";
import { HighlightRun } from "./agentThreadHighlight";

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
  const lines = useAgentCodeColorization(code, language, query === "");
  if (lines === null) {
    return <HighlightRun current={current} indexOffset={indexOffset} query={query} text={code} />;
  }
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

function tokenStyle(token: AgentCodeToken): CSSProperties | undefined {
  if (token.color === null && !token.italic && !token.bold) return undefined;
  return {
    ...(token.color === null ? {} : { color: token.color }),
    ...(token.italic ? { fontStyle: "italic" } : {}),
    ...(token.bold ? { fontWeight: 600 } : {}),
  };
}
