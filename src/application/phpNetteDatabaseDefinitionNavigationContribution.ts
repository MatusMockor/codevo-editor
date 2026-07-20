import type { EditorPosition } from "../domain/languageServerFeatures";
import { type PhpFrameworkDefinitionNavigationContribution } from "./phpFrameworkDefinitionNavigationContributions";
import type { PhpFrameworkExecutionScope } from "./phpFrameworkExtensionRegistry";
import type { NavigationRequest } from "./navigationRequest";
import {
  createPhpNetteDatabaseDefinitionNavigation,
  type PhpNetteDatabaseDefinitionNavigation,
} from "./phpNetteDatabaseDefinitionNavigation";
import { createPhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

export interface PhpNetteDatabaseDefinitionNavigationContributionDependencies {
  createDatabaseTypeResolver?: typeof createPhpNetteDatabaseTypeResolver;
  openPhpClassTarget(
    className: string,
    label: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  /**
   * Cancellation is cooperative: legacy gateways may ignore the optional
   * signal, so every await is also fenced before and after the operation.
   */
  readNavigationFileContent(
    path: string,
    signal?: AbortSignal,
  ): Promise<string>;
  resolvePhpClassSourcePaths(
    className: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
}

export function createPhpNetteDatabaseDefinitionNavigationContribution({
  createDatabaseTypeResolver = createPhpNetteDatabaseTypeResolver,
  openPhpClassTarget,
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
  resolvePhpExpressionType,
}: PhpNetteDatabaseDefinitionNavigationContributionDependencies): PhpFrameworkDefinitionNavigationContribution {
  return {
    id: "nette-database-definition-navigation",
    supports: (frameworkRuntime) =>
      frameworkRuntime.supports("netteDatabaseSemantics"),
    createProvider() {
      let disposed = false;
      let navigation: PhpNetteDatabaseDefinitionNavigation | null = null;
      let clearDatabaseTypeResolver: (() => void) | null = null;

      const navigationFor = (
        scope: PhpFrameworkExecutionScope,
      ): PhpNetteDatabaseDefinitionNavigation | null => {
        if (disposed || !scope.canCommit()) {
          return null;
        }

        if (navigation) {
          return navigation;
        }

        const isActive = () => !disposed && scope.canCommit();
        const databaseTypeResolver = createDatabaseTypeResolver({
          cachePolicy: "generation",
          isActive,
          readClassSource: (path) =>
            guardedAwait(isActive, () =>
              readNavigationFileContent(path, scope.signal),
            ),
          resolveClassSourcePaths: (className) =>
            guardedAwait(isActive, async () => [
              ...(await resolvePhpClassSourcePaths(className, scope.signal)),
            ]),
        });
        clearDatabaseTypeResolver = () => databaseTypeResolver.clear?.();
        navigation = createPhpNetteDatabaseDefinitionNavigation({
          databaseTypeResolver,
          isActive,
          openPhpClassTarget: (className, label, navigationRequest) => {
            if (!isActive()) {
              return Promise.resolve(false);
            }

            return openPhpClassTarget(className, label, {
              canNavigate: () =>
                isActive() && (navigationRequest?.canNavigate() ?? true),
            });
          },
          resolvePhpExpressionType: (navigationSource, position, expression) =>
            guardedAwait(isActive, () =>
              resolvePhpExpressionType(navigationSource, position, expression),
            ),
        });
        return navigation;
      };

      return {
        abort() {
          disposed = true;
          clearDatabaseTypeResolver?.();
          clearDatabaseTypeResolver = null;
          navigation = null;
        },
        async provideDefinition(source, offset, request, scope) {
          if (!scope?.canCommit()) {
            return false;
          }

          const activeNavigation = navigationFor(scope);

          if (!activeNavigation) {
            return false;
          }

          return activeNavigation.provideDefinition(source, offset, request);
        },
      };
    },
  };
}

async function guardedAwait<TResult>(
  isActive: () => boolean,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  if (!isActive()) {
    throw abortedFrameworkNavigationError();
  }

  const result = await operation();

  if (!isActive()) {
    throw abortedFrameworkNavigationError();
  }

  return result;
}

function abortedFrameworkNavigationError(): Error {
  const error = new Error("PHP framework navigation activation expired.");
  error.name = "AbortError";
  return error;
}
