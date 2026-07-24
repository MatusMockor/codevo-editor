// Shared JetBrains-classic round kind badge used across the symbol palettes
// (File Structure, Class Open, Search Everywhere). The colour comes from the
// theme-aware --symbol-* tokens via the `.symbol-icon[data-kind=...]` rules in
// App.css, so this stays presentation only and works across all themes.
import { symbolKindLetter } from "../domain/symbolKind";

interface SymbolKindIconProps {
  kind: string;
}

export function SymbolKindIcon({ kind }: SymbolKindIconProps) {
  return (
    <span aria-hidden="true" className="symbol-icon" data-kind={kind}>
      {symbolKindLetter(kind)}
    </span>
  );
}
