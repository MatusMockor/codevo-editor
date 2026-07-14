import {
  activePhpFrameworkSourceRegistryProviders,
  phpFrameworkSourceRegistryContributionDescriptors,
  type PhpFrameworkSourceRegistryAdapter,
} from "./phpFrameworkSourceRegistryAdapters";
import type { WorkspaceFileGateway } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { MutableRefObject } from "react";

export interface PhpFrameworkSourceRegistryContext {
  signature: string;
  workspaceSources: readonly string[];
}

export interface UsePhpFrameworkSourceRegistriesDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  onSourcesLoaded(rootPath: string): void;
  workspaceFiles: Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">;
}

export interface PhpFrameworkSourceRegistryProvider {
  currentPhpFrameworkSourceContextForRoot(
    rootPath: string,
  ): PhpFrameworkSourceRegistryContext;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  invalidatePhpFrameworkSourcePathForRoot(rootPath: string, path: string): void;
  resetPhpFrameworkSourceRegistries(): void;
}

export interface PhpFrameworkSourceRegistries {
  currentPhpFrameworkSourceContext(): PhpFrameworkSourceRegistryContext;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  invalidatePhpFrameworkSourcePath(root: string, path: string): void;
  resetPhpFrameworkSourceRegistries(): void;
}

function usePhpFrameworkSourceRegistryAdapters(
  dependencies: UsePhpFrameworkSourceRegistriesDependencies,
): readonly PhpFrameworkSourceRegistryAdapter[] {
  return phpFrameworkSourceRegistryContributionDescriptors.map((descriptor) =>
    descriptor.useSourceRegistryAdapter(dependencies),
  );
}

export function usePhpFrameworkSourceRegistries(
  dependencies: UsePhpFrameworkSourceRegistriesDependencies,
): PhpFrameworkSourceRegistries {
  const { currentWorkspaceRootRef, frameworkRuntime } = dependencies;
  const sourceRegistryAdapters =
    usePhpFrameworkSourceRegistryAdapters(dependencies);
  const sourceRegistryProviders = sourceRegistryAdapters.map((adapter) =>
    adapter.provider,
  );
  const activeSourceRegistryProviders =
    activePhpFrameworkSourceRegistryProviders(
      frameworkRuntime,
      sourceRegistryAdapters,
    );

  return {
    currentPhpFrameworkSourceContext: () =>
      currentPhpFrameworkSourceContextForRoot(
        currentWorkspaceRootRef.current,
        activeSourceRegistryProviders,
      ),
    ensurePhpFrameworkSourceCollectionsLoaded: async (rootPath: string) => {
      await Promise.all(
        activeSourceRegistryProviders.map((sourceRegistryProvider) =>
          sourceRegistryProvider.ensurePhpFrameworkSourceCollectionsLoaded(
            rootPath,
          ),
        ),
      );
    },
    invalidatePhpFrameworkSourcePath: (root: string, path: string) => {
      sourceRegistryProviders.forEach((sourceRegistryProvider) => {
        sourceRegistryProvider.invalidatePhpFrameworkSourcePathForRoot(
          root,
          path,
        );
      });
    },
    resetPhpFrameworkSourceRegistries: () => {
      sourceRegistryProviders.forEach((sourceRegistryProvider) => {
        sourceRegistryProvider.resetPhpFrameworkSourceRegistries();
      });
    },
  };
}

function currentPhpFrameworkSourceContextForRoot(
  rootPath: string | null,
  sourceRegistryProviders: readonly PhpFrameworkSourceRegistryProvider[],
): PhpFrameworkSourceRegistryContext {
  if (!rootPath) {
    return { signature: "", workspaceSources: [] };
  }

  const sourceContexts = sourceRegistryProviders.map((sourceRegistryProvider) =>
    sourceRegistryProvider.currentPhpFrameworkSourceContextForRoot(rootPath),
  );

  if (sourceContexts.length === 0) {
    return { signature: "", workspaceSources: [] };
  }

  if (sourceContexts.length === 1) {
    return sourceContexts[0] ?? { signature: "", workspaceSources: [] };
  }

  return {
    signature: sourceContexts
      .map((sourceContext) => sourceContext.signature)
      .join("|"),
    workspaceSources: sourceContexts.flatMap(
      (sourceContext) => sourceContext.workspaceSources,
    ),
  };
}
