import type { EditorPosition } from "../domain/languageServerFeatures";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { phpFrameworkSupportsCapability } from "./phpFrameworkCapabilityGuards";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  evictOtherRootConfigCacheEntries,
  type NeonConfigCache,
  type NeonConfigInFlight,
  type NeonProjectConfigDiscoveryDependencies,
  type NeonProjectConfigRequestContext,
} from "./neonProjectConfigDiscovery";

export interface NeonRuntimeDependencies
  extends NeonProjectConfigDiscoveryDependencies {
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkIntelligence: PhpFrameworkIntelligence;
  isSemanticIntelligenceActive: boolean;
  workspaceRoot: string | null;
}

export type NeonRequestContext<
  Deps extends NeonRuntimeDependencies = NeonRuntimeDependencies,
> = NeonProjectConfigRequestContext<Deps>;

export function isNeonSemanticActive(deps: NeonRuntimeDependencies): boolean {
  return (
    deps.isSemanticIntelligenceActive &&
    phpFrameworkSupportsCapability(
      deps.frameworkIntelligence.providers,
      "neonConfigIntelligence",
    )
  );
}

export function createNeonRequestContext<Deps extends NeonRuntimeDependencies>(
  deps: Deps,
  configCache: NeonConfigCache,
  configInFlight: NeonConfigInFlight,
): NeonRequestContext<Deps> | null {
  evictOtherRootConfigCacheEntries(configCache, deps.workspaceRoot);

  if (!isNeonSemanticActive(deps)) {
    return null;
  }

  const requestedRoot = deps.workspaceRoot;

  if (!requestedRoot) {
    return null;
  }

  return {
    configCache,
    configInFlight,
    deps,
    isRequestedRootActive: () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot),
    requestedRoot,
  };
}

export function offsetAtEditorPosition(
  source: string,
  position: EditorPosition,
): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);

  if (targetLine >= lines.length) {
    return source.length;
  }

  let offset = 0;

  for (let line = 0; line < targetLine; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}
