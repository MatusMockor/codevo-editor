import type { CSSProperties } from "react";
import type { HighlightedLine } from "../../../../domain/codeHighlight/highlightedCode";

export interface AgentDiffCodeProps {
  readonly text: string;
  readonly tokens: HighlightedLine | null;
}

export function AgentDiffCode({ text, tokens }: AgentDiffCodeProps) {
  if (text.length === 0) return " ";
  if (tokens === null || !tokensMatch(tokens, text)) return text;
  return tokens.map((token, index) => (
    <span key={index} style={tokenStyle(token)}>
      {token.text}
    </span>
  ));
}

function tokensMatch(tokens: HighlightedLine, text: string): boolean {
  let offset = 0;
  for (const token of tokens) {
    if (!text.startsWith(token.text, offset)) return false;
    offset += token.text.length;
  }
  return offset === text.length;
}

function tokenStyle(token: HighlightedLine[number]): CSSProperties | undefined {
  if (token.color === null && !token.italic && !token.bold) return undefined;
  return {
    color: token.color ?? undefined,
    fontStyle: token.italic ? "italic" : undefined,
    fontWeight: token.bold ? "bold" : undefined,
  };
}
