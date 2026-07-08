import { useCallback, useEffect, type MutableRefObject } from "react";
import {
  filterPhpLanguageServerDiagnostics,
  phpMemberMethodDiagnosticKey,
  phpMemberPropertyDiagnosticKey,
  phpMethodDiagnosticKey,
  phpTraitHostConstantDiagnosticContext,
  phpTraitHostConstantDiagnosticKey,
  phpTraitHostMethodDiagnosticContext,
  phpTraitHostMethodDiagnosticKey,
  phpTraitHostPropertyDiagnosticContext,
  phpTraitHostPropertyDiagnosticKey,
  phpUnresolvedMemberMethodDiagnosticContext,
  phpUnresolvedMemberPropertyDiagnosticContext,
  phpUnresolvedStaticMethodDiagnosticContext,
} from "../domain/phpLanguageServerDiagnosticFilters";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { phpCurrentClassName, phpPropertyAccessExpression } from "../domain/phpSemanticEngine";
import { phpCurrentTypeKind } from "../domain/phpNavigation";
import type {
  PhpFrameworkProvider,
  PhpFrameworkSourceContext,
} from "../domain/phpFrameworkProviders";

interface DiagnosticEditorPosition {
  column: number;
  lineNumber: number;
}

interface PhpFrameworkSourceRegistryContext {
  workspaceSources: readonly string[];
}

export type PhpContextualDiagnosticsFilter = (
  path: string,
  diagnostics: LanguageServerDiagnostic[],
) => Promise<LanguageServerDiagnostic[]>;

export interface PhpDiagnosticContextFilterDependencies {
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  contextualDiagnosticsFilterRef: MutableRefObject<PhpContextualDiagnosticsFilter>;
  currentPhpFrameworkSourceContext(): PhpFrameworkSourceRegistryContext;
  currentWorkspaceRoot(): string | null;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  isLaravelFrameworkActive: boolean;
  isPhpPath(path: string): boolean;
  phpClassHasLaravelDynamicWhere(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  phpClassHasLaravelLocalScope(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  phpClassHierarchyHasMethod(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  phpClassHierarchyHasProperty(
    className: string,
    propertyName: string,
  ): Promise<boolean>;
  phpClassHierarchyHasStaticMethod(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  phpTraitHostConstantExists(
    traitClassName: string,
    constantName: string,
  ): Promise<boolean>;
  phpTraitHostMethodExists(
    traitClassName: string,
    methodName: string,
  ): Promise<boolean>;
  phpTraitHostPropertyExists(
    traitClassName: string,
    propertyName: string,
  ): Promise<boolean>;
  phpTraitHostPropertyMethodExists(
    traitClassName: string,
    propertyName: string,
    methodName: string,
  ): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassReference(source: string, className: string): string | null;
  resolvePhpEloquentBuilderModelType(
    source: string,
    position: DiagnosticEditorPosition,
    receiverExpression: string,
  ): Promise<string | null>;
  resolvePhpExpressionType(
    source: string,
    position: DiagnosticEditorPosition,
    receiverExpression: string,
  ): Promise<string | null>;
}

export function usePhpDiagnosticContextFilter(
  dependencies: PhpDiagnosticContextFilterDependencies,
): PhpContextualDiagnosticsFilter {
  const {
    activePhpFrameworkProviders,
    contextualDiagnosticsFilterRef,
    currentPhpFrameworkSourceContext,
    currentWorkspaceRoot,
    ensurePhpFrameworkSourceCollectionsLoaded,
    isLaravelFrameworkActive,
    isPhpPath,
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
    phpClassHierarchyHasMethod,
    phpClassHierarchyHasProperty,
    phpClassHierarchyHasStaticMethod,
    phpTraitHostConstantExists,
    phpTraitHostMethodExists,
    phpTraitHostPropertyExists,
    phpTraitHostPropertyMethodExists,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
  } = dependencies;

  const filterPhpDiagnosticsWithContext = useCallback(
    async (
      path: string,
      diagnostics: LanguageServerDiagnostic[],
    ): Promise<LanguageServerDiagnostic[]> => {
      if (!isPhpPath(path)) {
        return diagnostics;
      }

      let source = "";

      try {
        source = await readNavigationFileContent(path);
      } catch {
        return diagnostics;
      }

      const contextualTraitHostMethods = new Set<string>();
      const contextualTraitHostProperties = new Set<string>();
      const contextualTraitHostConstants = new Set<string>();
      const contextualExistingMethods = new Set<string>();
      const contextualMemberMethods = new Set<string>();
      const contextualMemberProperties = new Set<string>();

      for (const diagnostic of diagnostics) {
        const staticMethodContext = phpUnresolvedStaticMethodDiagnosticContext(
          source,
          diagnostic,
        );

        if (staticMethodContext) {
          const resolvedClassName = resolvePhpClassReference(
            source,
            staticMethodContext.className,
          );
          const hasContextualScopeMethod =
            resolvedClassName && isLaravelFrameworkActive
              ? await phpClassHasLaravelLocalScope(
                  resolvedClassName,
                  staticMethodContext.methodName,
                )
              : false;
          const hasContextualDynamicWhereMethod =
            isLaravelFrameworkActive && resolvedClassName
              ? await phpClassHasLaravelDynamicWhere(
                  resolvedClassName,
                  staticMethodContext.methodName,
                )
              : false;
          const hasContextualExistingStaticMethod = resolvedClassName
            ? await phpClassHierarchyHasStaticMethod(
                resolvedClassName,
                staticMethodContext.methodName,
              )
            : false;

          if (
            hasContextualScopeMethod ||
            hasContextualDynamicWhereMethod ||
            hasContextualExistingStaticMethod
          ) {
            contextualExistingMethods.add(
              phpMethodDiagnosticKey(
                staticMethodContext.className,
                staticMethodContext.methodName,
              ),
            );
          }
        }

        const memberMethodContext = phpUnresolvedMemberMethodDiagnosticContext(
          source,
          diagnostic,
        );

        if (memberMethodContext) {
          const diagnosticPosition = diagnosticPositionFromDiagnostic(diagnostic);
          const builderModelType = isLaravelFrameworkActive
            ? await resolvePhpEloquentBuilderModelType(
                source,
                diagnosticPosition,
                memberMethodContext.receiverExpression,
              )
            : null;
          const hasContextualScopeMethod =
            builderModelType && isLaravelFrameworkActive
              ? await phpClassHasLaravelLocalScope(
                  builderModelType,
                  memberMethodContext.methodName,
                )
              : false;
          const hasContextualDynamicWhereMethod =
            isLaravelFrameworkActive && builderModelType
              ? await phpClassHasLaravelDynamicWhere(
                  builderModelType,
                  memberMethodContext.methodName,
                )
              : false;
          const receiverType = await resolvePhpExpressionType(
            source,
            diagnosticPosition,
            memberMethodContext.receiverExpression,
          );
          const hasContextualExistingMemberMethod = receiverType
            ? await phpClassHierarchyHasMethod(
                receiverType,
                memberMethodContext.methodName,
              )
            : false;
          const receiverPropertyAccess =
            phpCurrentTypeKind(source) === "trait"
              ? phpPropertyAccessExpression(
                  memberMethodContext.receiverExpression,
                )
              : null;
          const traitClassName =
            receiverPropertyAccess &&
            phpNormalizedReceiverExpressionIsThis(
              receiverPropertyAccess.receiverExpression,
            )
              ? phpCurrentClassName(source)
              : null;
          const hasContextualTraitHostPropertyMethod =
            traitClassName && receiverPropertyAccess
              ? await phpTraitHostPropertyMethodExists(
                  traitClassName,
                  receiverPropertyAccess.propertyName,
                  memberMethodContext.methodName,
                )
              : false;

          if (
            hasContextualScopeMethod ||
            hasContextualDynamicWhereMethod ||
            hasContextualExistingMemberMethod ||
            hasContextualTraitHostPropertyMethod
          ) {
            contextualMemberMethods.add(
              phpMemberMethodDiagnosticKey(
                memberMethodContext.receiverExpression,
                memberMethodContext.methodName,
              ),
            );
          }
        }

        const memberPropertyContext =
          phpUnresolvedMemberPropertyDiagnosticContext(source, diagnostic);

        if (memberPropertyContext) {
          const diagnosticPosition = diagnosticPositionFromDiagnostic(diagnostic);
          const receiverType = await resolvePhpExpressionType(
            source,
            diagnosticPosition,
            memberPropertyContext.receiverExpression,
          );
          const hasContextualProperty = receiverType
            ? await phpClassHierarchyHasProperty(
                receiverType,
                memberPropertyContext.propertyName,
              )
            : false;

          if (hasContextualProperty) {
            contextualMemberProperties.add(
              phpMemberPropertyDiagnosticKey(
                memberPropertyContext.receiverExpression,
                memberPropertyContext.propertyName,
              ),
            );
          }
        }

        const traitMethodContext = phpTraitHostMethodDiagnosticContext(
          source,
          diagnostic,
        );

        if (traitMethodContext) {
          const traitClassName = resolveTraitClassName(
            source,
            traitMethodContext.traitName,
            resolvePhpClassReference,
          );

          if (
            await phpTraitHostMethodExists(
              traitClassName,
              traitMethodContext.methodName,
            )
          ) {
            contextualTraitHostMethods.add(
              phpTraitHostMethodDiagnosticKey(
                traitMethodContext.traitName,
                traitMethodContext.methodName,
              ),
            );
            contextualTraitHostMethods.add(
              phpTraitHostMethodDiagnosticKey(
                traitClassName,
                traitMethodContext.methodName,
              ),
            );
          }
        }

        const traitConstantContext = phpTraitHostConstantDiagnosticContext(
          source,
          diagnostic,
        );

        if (traitConstantContext) {
          const traitClassName = resolveTraitClassName(
            source,
            traitConstantContext.traitName,
            resolvePhpClassReference,
          );

          if (
            await phpTraitHostConstantExists(
              traitClassName,
              traitConstantContext.constantName,
            )
          ) {
            contextualTraitHostConstants.add(
              phpTraitHostConstantDiagnosticKey(
                traitConstantContext.traitName,
                traitConstantContext.constantName,
              ),
            );
            contextualTraitHostConstants.add(
              phpTraitHostConstantDiagnosticKey(
                traitClassName,
                traitConstantContext.constantName,
              ),
            );
          }
        }

        const traitPropertyContext = phpTraitHostPropertyDiagnosticContext(
          source,
          diagnostic,
        );

        if (traitPropertyContext) {
          const traitClassName = resolveTraitClassName(
            source,
            traitPropertyContext.traitName,
            resolvePhpClassReference,
          );

          if (
            await phpTraitHostPropertyExists(
              traitClassName,
              traitPropertyContext.propertyName,
            )
          ) {
            contextualTraitHostProperties.add(
              phpTraitHostPropertyDiagnosticKey(
                traitPropertyContext.traitName,
                traitPropertyContext.propertyName,
              ),
            );
            contextualTraitHostProperties.add(
              phpTraitHostPropertyDiagnosticKey(
                traitClassName,
                traitPropertyContext.propertyName,
              ),
            );
          }
        }
      }

      const workspaceRoot = currentWorkspaceRoot();

      if (isLaravelFrameworkActive && workspaceRoot) {
        void ensurePhpFrameworkSourceCollectionsLoaded(workspaceRoot);
      }

      const { workspaceSources } = currentPhpFrameworkSourceContext();

      return filterPhpLanguageServerDiagnostics(source, diagnostics, {
        contextualExistingMethods,
        contextualMemberMethods,
        contextualMemberProperties,
        contextualTraitHostConstants,
        contextualTraitHostMethods,
        contextualTraitHostProperties,
        frameworkProviders: activePhpFrameworkProviders,
        frameworkSourceContext:
          workspaceSources.length > 0
            ? frameworkSourceContextFromSources(workspaceSources)
            : undefined,
        path,
      });
    },
    [
      activePhpFrameworkProviders,
      currentPhpFrameworkSourceContext,
      currentWorkspaceRoot,
      ensurePhpFrameworkSourceCollectionsLoaded,
      isLaravelFrameworkActive,
      isPhpPath,
      phpClassHasLaravelDynamicWhere,
      phpClassHasLaravelLocalScope,
      phpClassHierarchyHasMethod,
      phpClassHierarchyHasProperty,
      phpClassHierarchyHasStaticMethod,
      phpTraitHostConstantExists,
      phpTraitHostMethodExists,
      phpTraitHostPropertyExists,
      phpTraitHostPropertyMethodExists,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType,
    ],
  );

  useEffect(() => {
    contextualDiagnosticsFilterRef.current = filterPhpDiagnosticsWithContext;
  }, [contextualDiagnosticsFilterRef, filterPhpDiagnosticsWithContext]);

  return filterPhpDiagnosticsWithContext;
}

function diagnosticPositionFromDiagnostic(
  diagnostic: LanguageServerDiagnostic,
): DiagnosticEditorPosition {
  return {
    column: diagnostic.character + 1,
    lineNumber: diagnostic.line + 1,
  };
}

function frameworkSourceContextFromSources(
  workspaceSources: readonly string[],
): PhpFrameworkSourceContext {
  return { workspaceSources };
}

function resolveTraitClassName(
  source: string,
  traitName: string,
  resolvePhpClassReference: (
    source: string,
    className: string,
  ) => string | null,
): string {
  const normalizedTraitName = traitName.replace(/^\\+/, "");

  if (normalizedTraitName.includes("\\")) {
    return normalizedTraitName;
  }

  return resolvePhpClassReference(source, traitName) ?? normalizedTraitName;
}

function phpNormalizedReceiverExpressionIsThis(
  receiverExpression: string,
): boolean {
  return receiverExpression.trim().replace(/\?->/g, "->") === "$this";
}
