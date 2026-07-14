import type { PhpFrameworkProviderCapability } from "../domain/phpFrameworkProviders";
import type { NetteSnippetCompletionTarget } from "./netteAjaxSnippetCompletions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { usePhpNetteMethodCompletionProviderDependencyAdapter } from "./phpNetteMethodCompletionProviderDependencyAdapter";

export interface PhpFrameworkMethodCompletionProviderDependencyAdapterHookDependencies {
  currentWorkspaceRootRef: { readonly current: string | null };
  joinWorkspacePath(rootPath: string, relativePath: string): string;
  readNavigationFileContent(path: string): Promise<string>;
  relativeWorkspacePath(workspaceRoot: string, path: string): string;
  workspaceRoot: string | null;
}

export interface PhpFrameworkMethodCompletionProviderDependencyAdapterExtras {
  collectNetteRedrawControlSnippetTargets?(
    currentPhpPath: string,
  ): Promise<readonly NetteSnippetCompletionTarget[]>;
}

interface PhpFrameworkMethodCompletionProviderDependencyAdapterContribution {
  readonly capability: PhpFrameworkProviderCapability;
  useAdapter(
    dependencies: PhpFrameworkMethodCompletionProviderDependencyAdapterHookDependencies,
  ): PhpFrameworkMethodCompletionProviderDependencyAdapterExtras;
}

export interface PhpFrameworkMethodCompletionProviderDependencyAdapterResult {
  readonly capability: PhpFrameworkProviderCapability;
  readonly extras: PhpFrameworkMethodCompletionProviderDependencyAdapterExtras;
}

const PHP_FRAMEWORK_METHOD_COMPLETION_PROVIDER_DEPENDENCY_ADAPTERS: readonly PhpFrameworkMethodCompletionProviderDependencyAdapterContribution[] =
  [
    {
      capability: "netteRedrawControlSnippetCompletions",
      useAdapter: usePhpNetteMethodCompletionProviderDependencyAdapter,
    },
  ];

export function usePhpFrameworkMethodCompletionProviderDependencyAdapterResults(
  dependencies: PhpFrameworkMethodCompletionProviderDependencyAdapterHookDependencies,
): readonly PhpFrameworkMethodCompletionProviderDependencyAdapterResult[] {
  return PHP_FRAMEWORK_METHOD_COMPLETION_PROVIDER_DEPENDENCY_ADAPTERS.map(
    (adapter) => ({
      capability: adapter.capability,
      extras: adapter.useAdapter(dependencies),
    }),
  );
}

export function phpFrameworkMethodCompletionProviderDependencyExtrasForRuntime(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "supports">,
  adapterResults: readonly PhpFrameworkMethodCompletionProviderDependencyAdapterResult[],
): PhpFrameworkMethodCompletionProviderDependencyAdapterExtras {
  return adapterResults
    .filter((adapter) => frameworkRuntime.supports(adapter.capability))
    .reduce<PhpFrameworkMethodCompletionProviderDependencyAdapterExtras>(
      (extras, adapter) => ({
        ...extras,
        ...adapter.extras,
      }),
      {},
    );
}
