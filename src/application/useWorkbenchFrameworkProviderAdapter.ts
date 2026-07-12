import { useMemo } from "react";
import type { WorkbenchFrameworkIntelligence } from "./workbenchFrameworkIntelligenceContracts";

/**
 * Adapts the framework intelligence API mounted by the workbench into the
 * provider bundle consumed by EditorSurface. Keeping this adapter separate
 * prevents the controller from growing whenever another framework surface is
 * wired into Monaco.
 */
export function useWorkbenchFrameworkProviderAdapter(
  intelligence: WorkbenchFrameworkIntelligence,
) {
  return useMemo(
    () => ({
      provideBladeCodeActions: intelligence.provideBladeCodeActions,
      provideBladeCompletions: intelligence.provideBladeCompletions,
      provideBladeDefinition: intelligence.provideBladeDefinition,
      provideLatteCompletions: intelligence.provideLatteCompletions,
      provideLatteDefinition: intelligence.provideLatteDefinition,
      provideNeonCompletions: intelligence.provideNeonCompletions,
      provideNeonDefinition: intelligence.provideNeonDefinition,
      providePhpPresenterLinkCompletions:
        intelligence.providePhpPresenterLinkCompletions,
      isPhpPresenterLinkCompletionContext:
        intelligence.isPhpPresenterLinkCompletionContext,
      providePhpPresenterLinkDefinition:
        intelligence.providePhpPresenterLinkDefinition,
      isPhpFrameworkStringCompletionContext:
        intelligence.isPhpFrameworkStringCompletionContext,
    }),
    [
      intelligence.isPhpFrameworkStringCompletionContext,
      intelligence.isPhpPresenterLinkCompletionContext,
      intelligence.provideBladeCodeActions,
      intelligence.provideBladeCompletions,
      intelligence.provideBladeDefinition,
      intelligence.provideLatteCompletions,
      intelligence.provideLatteDefinition,
      intelligence.provideNeonCompletions,
      intelligence.provideNeonDefinition,
      intelligence.providePhpPresenterLinkCompletions,
      intelligence.providePhpPresenterLinkDefinition,
    ],
  );
}
