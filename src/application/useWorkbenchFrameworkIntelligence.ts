import { useCallback } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpFrameworkScopedStringCompletionContextAt } from "../domain/phpFrameworkProviders";
import { useBladeIntelligence } from "./useBladeIntelligence";
import { useLatteIntelligence } from "./useLatteIntelligence";
import { useNeonIntelligence } from "./useNeonIntelligence";
import type {
  WorkbenchFrameworkIntelligence,
  WorkbenchFrameworkIntelligenceDependencies,
} from "./workbenchFrameworkIntelligenceContracts";

/**
 * Mounts framework-specific intelligence providers behind one controller-facing
 * boundary. The workbench still owns the collaborators, while this hook owns the
 * provider lifecycle so Blade/Latte/NEON wiring does not keep growing inside the
 * main controller.
 */
export function useWorkbenchFrameworkIntelligence(
  dependencies: WorkbenchFrameworkIntelligenceDependencies,
): WorkbenchFrameworkIntelligence {
  const blade = useBladeIntelligence(dependencies.blade);
  const latte = useLatteIntelligence(dependencies.latte);
  const neon = useNeonIntelligence(dependencies.neon);

  const isPhpFrameworkStringCompletionContext = useCallback(
    (source: string, position: EditorPosition): boolean =>
      phpFrameworkScopedStringCompletionContextAt(
        source,
        position,
        dependencies.activePhpFrameworkProviders,
      ),
    [dependencies.activePhpFrameworkProviders],
  );

  return {
    ...blade,
    ...latte,
    ...neon,
    isPhpFrameworkStringCompletionContext,
  };
}
