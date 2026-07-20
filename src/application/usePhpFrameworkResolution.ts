import { useEffect, useMemo, useRef } from "react";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { WorkspaceDescriptor } from "../domain/workspace";
import {
  createPhpFrameworkIntelligence,
  type PhpFrameworkIntelligence,
} from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";
import { phpFrameworkPluginCatalog } from "./phpFrameworkPluginCatalog";
import { resolvePhpFrameworkProfile } from "./phpFrameworkResolution";

export interface UsePhpFrameworkResolutionOptions {
  providerCatalog?: readonly PhpFrameworkProvider[];
  workspaceDescriptor: WorkspaceDescriptor | null;
}

export interface PhpFrameworkResolutionApi {
  activeFrameworkActivityLabel: PhpFrameworkIntelligence["activityLabel"];
  activePhpFrameworkProviders: PhpFrameworkIntelligence["providers"];
  phpFrameworkIntelligence: PhpFrameworkIntelligence;
  phpFrameworkRuntimeContext: PhpFrameworkRuntimeContext;
}

export function usePhpFrameworkResolution({
  providerCatalog = phpFrameworkPluginCatalog,
  workspaceDescriptor,
}: UsePhpFrameworkResolutionOptions): PhpFrameworkResolutionApi {
  const warnedAmbiguitySignaturesByRoot = useRef<Map<string, Set<string>>>(
    new Map(),
  );
  // One detection pass per workspace: the active provider set and the exclusive
  // profile ("laravel" | "nette" | "generic") are derived from the same result,
  // so they can never disagree (no second source of truth).
  const phpFrameworkResolution = useMemo(
    () =>
      resolvePhpFrameworkProfile(
        workspaceDescriptor?.php ?? null,
        providerCatalog,
      ),
    [providerCatalog, workspaceDescriptor?.php],
  );
  const phpFrameworkIntelligence = useMemo(
    () => createPhpFrameworkIntelligence(phpFrameworkResolution),
    [phpFrameworkResolution],
  );
  const phpFrameworkRuntimeContext = useMemo(
    () => createPhpFrameworkRuntimeContext(phpFrameworkIntelligence),
    [phpFrameworkIntelligence],
  );
  const activePhpFrameworkProviders = phpFrameworkIntelligence.providers;
  // Provider-owned presentation for the exclusive winner.
  const activeFrameworkActivityLabel = phpFrameworkIntelligence.activityLabel;
  const workspaceRootPath = workspaceDescriptor?.rootPath ?? null;
  const matchedProviderIds = phpFrameworkIntelligence.matchedProviderIds;
  const ambiguitySignature =
    matchedProviderIds.length > 1 ? JSON.stringify(matchedProviderIds) : null;
  // Edge (spec 4.1): a project that declares several framework signals at once
  // (e.g. a Laravel app carrying latte/latte transitively in composer.lock)
  // resolves to a single exclusive profile by registry priority. Surface the
  // ambiguity once per workspace so the deterministic pick stays observable and
  // we never silently blend two frameworks' magic.
  useEffect(() => {
    if (!workspaceRootPath || !ambiguitySignature) {
      return;
    }

    const warnedSignatures =
      warnedAmbiguitySignaturesByRoot.current.get(workspaceRootPath) ??
      new Set<string>();
    if (warnedSignatures.has(ambiguitySignature)) {
      return;
    }

    warnedSignatures.add(ambiguitySignature);
    warnedAmbiguitySignaturesByRoot.current.set(
      workspaceRootPath,
      warnedSignatures,
    );
    console.warn(
      `Multiple PHP framework signals detected (${matchedProviderIds.join(
        ", ",
      )}); resolved exclusively to "${phpFrameworkIntelligence.profile}" by registry priority.`,
    );
  }, [
    ambiguitySignature,
    matchedProviderIds,
    phpFrameworkIntelligence.profile,
    workspaceRootPath,
  ]);

  return {
    activeFrameworkActivityLabel,
    activePhpFrameworkProviders,
    phpFrameworkIntelligence,
    phpFrameworkRuntimeContext,
  };
}
