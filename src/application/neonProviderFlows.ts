import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  provideNeonCompletions as provideNeonCompletionsFromProvider,
} from "./neonCompletionProvider";
import type { NeonCompletionItem } from "./neonCompletionItems";
import {
  provideNeonDefinition as provideNeonDefinitionFromProvider,
} from "./neonDefinitionProvider";
import {
  type NeonIntelligence,
  type NeonIntelligenceDependencies,
} from "./neonIntelligenceContracts";
import type { NavigationRequest } from "./navigationRequest";
import { createNeonRequestContext } from "./neonIntelligenceRuntime";
import {
  invalidateNeonConfigCacheForPath,
  type NeonConfigCache,
  type NeonConfigInFlight,
} from "./neonProjectConfigDiscovery";
import { providePhpNetteInjectionDefinition as providePhpNetteInjectionDefinitionFromProvider } from "./phpNetteInjectionDefinitionProvider";

/**
 * Builds the NEON intelligence API from an accessor to the current dependencies
 * (read fresh on every call so gating flags and the workspace root are always
 * current). Exported for direct unit testing; the React hook is a thin, stable
 * wrapper around it.
 */
export function createNeonIntelligence(
  getDependencies: () => NeonIntelligenceDependencies,
  configCache: NeonConfigCache = {},
): NeonIntelligence {
  /**
   * Per-instance in-flight registry for the cross-file config scan, so concurrent
   * completion requests (Monaco fires one per keystroke) share ONE scan per root
   * instead of launching parallel directory reads.
   */
  const configInFlight: NeonConfigInFlight = new Map();

  const provideNeonDefinition = async (
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean> => {
    const context = createNeonRequestContext(
      getDependencies(),
      configCache,
      configInFlight,
    );

    if (!context) {
      return false;
    }

    return provideNeonDefinitionFromProvider(context, source, offset, request);
  };

  const provideNeonCompletions = async (
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletionItem[]> => {
    const context = createNeonRequestContext(
      getDependencies(),
      configCache,
      configInFlight,
    );

    if (!context) {
      return [];
    }

    return provideNeonCompletionsFromProvider(context, source, position);
  };

  const providePhpNetteInjectionDefinition = async (
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean> => {
    const context = createNeonRequestContext(
      getDependencies(),
      configCache,
      configInFlight,
    );

    if (!context) {
      return false;
    }

    return providePhpNetteInjectionDefinitionFromProvider(
      context,
      source,
      offset,
      request,
    );
  };

  const invalidateNeonConfigForPath = (rootPath: string, path: string): void => {
    invalidateNeonConfigCacheForPath(configCache, configInFlight, rootPath, path);
  };

  return {
    invalidateNeonConfigForPath,
    provideNeonCompletions,
    provideNeonDefinition,
    providePhpNetteInjectionDefinition,
  };
}
