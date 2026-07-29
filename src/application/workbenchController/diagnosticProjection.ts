import type { LanguageServerDiagnostic } from "../../domain/languageServerDiagnostics";
import type { PhpFileOutline } from "../../domain/phpFileOutline";

export function mergeDiagnosticsByPath(
  ...maps: Array<Record<string, LanguageServerDiagnostic[]>>
): Record<string, LanguageServerDiagnostic[]> {
  const merged: Record<string, LanguageServerDiagnostic[]> = {};

  maps.forEach((map) => {
    Object.entries(map).forEach(([path, diagnostics]) => {
      merged[path] = [...(merged[path] ?? []), ...diagnostics];
    });
  });

  return merged;
}

export function mergePhpFileOutlines(
  currentOutline: PhpFileOutline | null,
  inheritedOutline: PhpFileOutline | null,
): PhpFileOutline | null {
  if (!currentOutline && !inheritedOutline) return null;

  return {
    nodes: [...(currentOutline?.nodes ?? []), ...(inheritedOutline?.nodes ?? [])],
  };
}
