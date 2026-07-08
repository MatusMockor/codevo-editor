import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  provideNeonCompletions as provideNeonCompletionsFromProvider,
  type NeonCompletionItem,
} from "./neonCompletionProvider";
import {
  provideNeonDefinition as provideNeonDefinitionFromProvider,
} from "./neonDefinitionProvider";
import {
  type NeonIntelligence,
  type NeonIntelligenceDependencies,
} from "./neonIntelligenceContracts";
import { createNeonRequestContext } from "./neonIntelligenceRuntime";
import {
  type NeonConfigCache,
  type NeonConfigInFlight,
} from "./neonProjectConfigDiscovery";

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
  ): Promise<boolean> => {
    const context = createNeonRequestContext(
      getDependencies(),
      configCache,
      configInFlight,
    );

    if (!context) {
      return false;
    }

    return provideNeonDefinitionFromProvider(context, source, offset);
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

  return { provideNeonCompletions, provideNeonDefinition };
}
