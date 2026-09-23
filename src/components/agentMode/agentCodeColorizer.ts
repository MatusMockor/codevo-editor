import { createContext, useContext, useEffect, useState } from "react";

export const MAX_AGENT_COLORIZED_CODE_CHARS = 8_000;
export const MAX_AGENT_COLORIZED_CODE_LINES = 250;
export const AGENT_CODE_COLORIZE_DELAY_MS = 120;

export interface AgentCodeToken {
  readonly text: string;
  readonly color: string | null;
  readonly italic: boolean;
  readonly bold: boolean;
}

export type AgentColorizedLines = ReadonlyArray<ReadonlyArray<AgentCodeToken>>;

export interface AgentCodeColorizer {
  colorize(code: string, language: string): Promise<AgentColorizedLines | null>;
}

export const AgentCodeColorizerContext = createContext<AgentCodeColorizer | null>(null);

export function agentCodeColorizable(code: string, language: string | null): language is string {
  if (language === null || language === "") return false;
  if (code.length === 0 || code.length > MAX_AGENT_COLORIZED_CODE_CHARS) return false;
  return lineCountWithin(code, MAX_AGENT_COLORIZED_CODE_LINES);
}

interface ColorizedResult {
  readonly colorizer: AgentCodeColorizer;
  readonly code: string;
  readonly language: string;
  readonly lines: AgentColorizedLines;
}

export function useAgentCodeColorization(
  code: string,
  language: string | null,
  enabled: boolean,
): AgentColorizedLines | null {
  const colorizer = useContext(AgentCodeColorizerContext);
  const [result, setResult] = useState<ColorizedResult | null>(null);
  const requested = enabled && colorizer !== null && agentCodeColorizable(code, language);

  useEffect(() => {
    if (!requested || colorizer === null || language === null) return;
    let active = true;
    const timer = setTimeout(() => {
      colorizer.colorize(code, language).then(
        (lines) => {
          if (!active || lines === null) return;
          setResult({ colorizer, code, language, lines });
        },
        () => undefined,
      );
    }, AGENT_CODE_COLORIZE_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, colorizer, language, requested]);

  if (!requested || result === null) return null;
  if (result.colorizer !== colorizer || result.code !== code || result.language !== language) {
    return null;
  }
  return result.lines;
}

function lineCountWithin(code: string, limit: number): boolean {
  let lines = 1;
  for (let index = code.indexOf("\n"); index >= 0; index = code.indexOf("\n", index + 1)) {
    lines += 1;
    if (lines > limit) return false;
  }
  return true;
}
