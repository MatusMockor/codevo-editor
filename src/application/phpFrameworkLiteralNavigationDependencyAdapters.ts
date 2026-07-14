import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { isPhpFrameworkProviderActive } from "../domain/phpFrameworkProviders";
import type { FileEntry } from "../domain/workspace";
import type { PhpFrameworkLiteralNavigationDependencies } from "./phpFrameworkLiteralNavigation";
import { usePhpLaravelLiteralNavigationDependencyAdapter } from "./phpLaravelLiteralNavigationDependencyAdapter";
import { usePhpNetteLiteralNavigationDependencyAdapter } from "./phpNetteLiteralNavigationDependencyAdapter";

export interface PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies {
  currentWorkspaceRootRef: { readonly current: string | null };
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  readNavigationFileContent: (path: string) => Promise<string>;
  readWorkspaceDirectory: (path: string) => Promise<FileEntry[]>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  workspaceRoot: string | null;
}

export type PhpFrameworkLiteralNavigationDependencyAdapterExtras = Partial<
  Pick<
    PhpFrameworkLiteralNavigationDependencies,
    "findInertiaComponentTarget" | "findNetteRedrawControlSnippetTarget"
  >
>;

interface PhpFrameworkLiteralNavigationDependencyAdapterContribution {
  readonly providerId: string;
  useAdapter(
    dependencies: PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies,
  ): PhpFrameworkLiteralNavigationDependencyAdapterExtras;
}

interface PhpFrameworkLiteralNavigationDependencyAdapterResult {
  readonly extras: PhpFrameworkLiteralNavigationDependencyAdapterExtras;
  readonly providerId: string;
}

const PHP_FRAMEWORK_LITERAL_NAVIGATION_DEPENDENCY_ADAPTERS: readonly PhpFrameworkLiteralNavigationDependencyAdapterContribution[] =
  [
    {
      providerId: "laravel",
      useAdapter: usePhpLaravelLiteralNavigationDependencyAdapter,
    },
    {
      providerId: "nette",
      useAdapter: usePhpNetteLiteralNavigationDependencyAdapter,
    },
  ];

export function usePhpFrameworkLiteralNavigationDependencyAdapterResults(
  dependencies: PhpFrameworkLiteralNavigationDependencyAdapterHookDependencies,
): readonly PhpFrameworkLiteralNavigationDependencyAdapterResult[] {
  return PHP_FRAMEWORK_LITERAL_NAVIGATION_DEPENDENCY_ADAPTERS.map(
    (adapter) => ({
      extras: adapter.useAdapter(dependencies),
      providerId: adapter.providerId,
    }),
  );
}

export function phpFrameworkLiteralNavigationDependencyExtrasForProviders(
  providers: readonly PhpFrameworkProvider[],
  adapterResults: readonly PhpFrameworkLiteralNavigationDependencyAdapterResult[],
): PhpFrameworkLiteralNavigationDependencyAdapterExtras {
  const activeAdapter = adapterResults.find((adapter) =>
    isPhpFrameworkProviderActive(providers, adapter.providerId),
  );

  return activeAdapter?.extras ?? {};
}
