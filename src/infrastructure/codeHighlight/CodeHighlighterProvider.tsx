import { useEffect, useMemo, type JSX, type ReactNode } from "react";
import {
  CodeHighlighterContext,
  CodeHighlightThemeContext,
  type CodeHighlighter,
} from "../../application/codeHighlight/codeHighlighter";
import type { MonacoAppTheme } from "../../domain/settings";
import { createWorkerCodeHighlighter } from "./workerCodeHighlighter";

export interface CodeHighlighterProviderProps {
  readonly theme: MonacoAppTheme;
  readonly highlighter?: CodeHighlighter;
  readonly children: ReactNode;
}

export function CodeHighlighterProvider({
  theme,
  highlighter,
  children,
}: CodeHighlighterProviderProps): JSX.Element {
  const owned = useMemo(
    () => (highlighter === undefined ? createWorkerCodeHighlighter() : null),
    [highlighter],
  );
  useEffect(() => {
    if (owned === null) return undefined;
    return () => owned.dispose();
  }, [owned]);
  const active = highlighter ?? owned;
  return (
    <CodeHighlighterContext.Provider value={active}>
      <CodeHighlightThemeContext.Provider value={theme}>
        {children}
      </CodeHighlightThemeContext.Provider>
    </CodeHighlighterContext.Provider>
  );
}
