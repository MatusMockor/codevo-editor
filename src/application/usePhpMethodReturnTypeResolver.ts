import { useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpMixinClassNames,
  phpTraitClassNames,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import { phpSuperTypeReferences } from "../domain/phpNavigation";
import {
  phpMethodCallExpression,
  phpNewExpressionClassName,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
} from "../domain/phpSemanticEngine";
import { createPhpFrameworkSemanticTypeExtensions } from "./phpFrameworkSemanticTypeExtensions";
import { phpMethodReturnExpressions } from "../domain/phpTypeAnalysis";
import {
  phpFrameworkContainerExpressionClassName,
  phpFrameworkMethodCallReturnTypeFromSource,
} from "../domain/phpFrameworkProviders";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createPhpFrameworkMethodReturnTypeStrategyAdapters } from "./phpFrameworkMethodReturnTypeStrategyAdapters";

export interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

export type PhpMethodReturnTypeResolver = (
  className: string,
  methodName: string,
  visitedClassNames?: Set<string>,
  lateStaticClassName?: string,
  templateTypes?: ReadonlyMap<string, string>,
  callExpression?: string,
) => Promise<string | null>;

export interface UsePhpMethodReturnTypeResolverOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  readPhpClassMembersFromPath: (
    path: string,
    className: string,
  ) => Promise<PhpClassMemberReadResult>;
  resolvePhpClassReference: (
    source: string,
    className: string,
  ) => string | null;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  resolvePhpEloquentBuilderModelTypeRef: MutableRefObject<
    (
      source: string,
      position: EditorPosition,
      expression: string,
    ) => Promise<string | null>
  >;
  resolvePhpFrameworkBoundConcrete: (
    className: string,
  ) => Promise<string | null>;
  resolvePhpFrameworkReturnTypeReference: (
    source: string,
    typeName: string | null,
  ) => string | null;
  resolvePhpGenericTemplateTypesForInheritedClass: (
    source: string,
    inheritedClassName: string,
    inheritedTemplateTypes?: ReadonlyMap<string, string>,
  ) => Promise<ReadonlyMap<string, string>>;
  resolvePhpGenericTemplateTypesForMixinClass: (
    source: string,
    mixinClassName: string,
    inheritedTemplateTypes?: ReadonlyMap<string, string>,
  ) => Promise<ReadonlyMap<string, string>>;
  resolvePhpFrameworkProjectMorphMapModelType: () => Promise<string | null>;
  resolvePhpMethodDeclaredReturnType: (
    source: string,
    typeName: string | null,
    lateStaticClassName: string,
    templateTypes?: ReadonlyMap<string, string>,
  ) => string | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpMethodReturnTypeResolver({
  currentWorkspaceRootRef,
  frameworkRuntime,
  readPhpClassMembersFromPath,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpEloquentBuilderModelTypeRef,
  resolvePhpFrameworkBoundConcrete,
  resolvePhpFrameworkReturnTypeReference,
  resolvePhpGenericTemplateTypesForInheritedClass,
  resolvePhpGenericTemplateTypesForMixinClass,
  resolvePhpFrameworkProjectMorphMapModelType,
  resolvePhpMethodDeclaredReturnType,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpMethodReturnTypeResolverOptions) {
  const frameworkProviders = frameworkRuntime.providers;
  const typeExtensions = useMemo(
    () =>
      createPhpFrameworkSemanticTypeExtensions({
        providers: frameworkProviders,
      }),
    [frameworkProviders],
  );
  const returnTypeStrategy = useMemo(
    () =>
      createPhpFrameworkMethodReturnTypeStrategyAdapters({
        frameworkRuntime,
        isWorkspaceCurrent: () =>
          workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            workspaceRoot,
          ),
        readPhpClassSource: async (path, className) =>
          (await readPhpClassMembersFromPath(path, className)).content,
        resolvePhpClassSourcePaths,
        resolvePhpFrameworkBuilderModelType: (source, position, expression) =>
          resolvePhpEloquentBuilderModelTypeRef.current(
            source,
            position,
            expression,
          ),
        resolvePhpFrameworkProjectMorphMapModelType:
          resolvePhpFrameworkProjectMorphMapModelType,
      }),
    [
      currentWorkspaceRootRef,
      frameworkRuntime,
      readPhpClassMembersFromPath,
      resolvePhpClassSourcePaths,
      resolvePhpEloquentBuilderModelTypeRef,
      resolvePhpFrameworkProjectMorphMapModelType,
      workspaceRoot,
    ],
  );

  const resolvePhpMethodReturnType: PhpMethodReturnTypeResolver = useCallback(
    async (
      className: string,
      methodName: string,
      visitedClassNames = new Set<string>(),
      lateStaticClassName = className,
      templateTypes: ReadonlyMap<string, string> = new Map(),
      callExpression?: string,
    ): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const visitedKey = normalizedClassName.toLowerCase();
      const normalizedLateStaticClassName = lateStaticClassName
        .trim()
        .replace(/^\\+/, "");
      if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
        return null;
      }

      visitedClassNames.add(visitedKey);

      const facadeTargetClassName =
        returnTypeStrategy.facadeTargetClassName(normalizedClassName);

      if (facadeTargetClassName) {
        return resolvePhpMethodReturnType(
          facadeTargetClassName,
          methodName,
          visitedClassNames,
          facadeTargetClassName,
          new Map(),
          callExpression,
        );
      }

      const resolveKnownFrameworkReturnType = async (): Promise<
        string | null
      > => {
        const knownReturnType =
          await returnTypeStrategy.knownClassMethodReturnType({
            ...(callExpression ? { callExpression } : {}),
            className: normalizedLateStaticClassName || normalizedClassName,
            methodName,
          });

        return isRequestedRootActive() ? knownReturnType : null;
      };

      const resolveBoundConcreteReturnType = async (): Promise<
        string | null
      > => {
        const boundConcreteClassName =
          await resolvePhpFrameworkBoundConcrete(normalizedClassName);

        if (!isRequestedRootActive()) {
          return null;
        }

        if (
          !boundConcreteClassName ||
          boundConcreteClassName.toLowerCase() === visitedKey
        ) {
          return null;
        }

        const boundReturnType = await resolvePhpMethodReturnType(
          boundConcreteClassName,
          methodName,
          visitedClassNames,
          boundConcreteClassName,
          new Map(),
          callExpression,
        );

        if (!isRequestedRootActive()) {
          return null;
        }

        return boundReturnType;
      };

      const resolveReturnExpressionType = async (
        ownerSource: string,
        expression: string,
      ): Promise<string | null> => {
        const constructedClassName =
          phpNewExpressionClassName(expression) ??
          phpFrameworkContainerExpressionClassName(
            expression,
            frameworkProviders,
          );

        if (constructedClassName) {
          return resolvePhpClassReference(ownerSource, constructedClassName);
        }

        const methodCall = phpMethodCallExpression(expression);

        if (methodCall) {
          const directReceiverType = phpReceiverExpressionTypeInSource(
            ownerSource,
            { column: 1, lineNumber: 1 },
            methodCall.receiverExpression,
            { typeExtensions },
          );
          const constructedReceiverType =
            directReceiverType ??
            phpNewExpressionClassName(methodCall.receiverExpression) ??
            phpFrameworkContainerExpressionClassName(
              methodCall.receiverExpression,
              frameworkProviders,
            );
          const resolvedReceiverType = constructedReceiverType
            ? resolvePhpClassReference(ownerSource, constructedReceiverType)
            : null;
          const frameworkReturnType =
            phpFrameworkMethodCallReturnTypeFromSource(
              ownerSource,
              methodCall.methodName,
              resolvedReceiverType,
              methodCall.receiverExpression,
              frameworkProviders,
              expression,
            );
          const resolvedFrameworkReturnType = frameworkReturnType
            ? resolvePhpFrameworkReturnTypeReference(
                ownerSource,
                frameworkReturnType,
              )
            : null;

          if (resolvedFrameworkReturnType) {
            return resolvedFrameworkReturnType;
          }

          const strategyReturnType =
            await returnTypeStrategy.methodCallReturnType({
              methodName: methodCall.methodName,
              ownerSource,
              receiverExpression: methodCall.receiverExpression,
              receiverType: resolvedReceiverType,
            });

          if (strategyReturnType) {
            return strategyReturnType;
          }

          return resolvedReceiverType
            ? resolvePhpMethodReturnType(
                resolvedReceiverType,
                methodCall.methodName,
                visitedClassNames,
                undefined,
                undefined,
                expression,
              )
            : null;
        }

        const staticCall = phpStaticCallExpression(expression);

        if (staticCall) {
          const className = resolvePhpClassReference(
            ownerSource,
            staticCall.className,
          );

          const strategyReturnType = returnTypeStrategy.staticCallReturnType({
            className,
            methodName: staticCall.methodName,
          });

          if (strategyReturnType) {
            return strategyReturnType;
          }

          return className
            ? resolvePhpMethodReturnType(
                className,
                staticCall.methodName,
                visitedClassNames,
              )
            : null;
        }

        return null;
      };

      for (const path of await resolvePhpClassSourcePaths(
        normalizedClassName,
      )) {
        if (!isRequestedRootActive()) {
          return null;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return null;
          }

          const method = members.find(
            (candidate) =>
              candidate.name.toLowerCase() === methodName.toLowerCase(),
          );
          const methodReturnExpressions = method
            ? phpMethodReturnExpressions(content, method.name)
            : [];
          const returnType = method
            ? resolvePhpMethodDeclaredReturnType(
                content,
                method.returnType,
                normalizedLateStaticClassName || normalizedClassName,
                templateTypes,
              )
            : null;

          if (returnType) {
            const strategyReturnType =
              await returnTypeStrategy.resolveDeclaredMethodReturnType({
                ...(callExpression ? { callExpression } : {}),
                declaringClassName: normalizedClassName,
                lateStaticClassName:
                  normalizedLateStaticClassName || normalizedClassName,
                methodName,
                methodReturnExpressions,
                rawReturnType: method?.returnType ?? null,
                resolvedReturnType: returnType,
                resolveTypeReference: (typeName) =>
                  resolvePhpClassReference(content, typeName),
              });

            if (!isRequestedRootActive()) {
              return null;
            }

            return strategyReturnType;
          }

          if (method) {
            for (const expression of methodReturnExpressions) {
              const expressionReturnType = await resolveReturnExpressionType(
                content,
                expression,
              );

              if (!isRequestedRootActive()) {
                return null;
              }

              if (expressionReturnType) {
                return expressionReturnType;
              }
            }
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );
            const traitTemplateTypes = resolvedTraitName
              ? await resolvePhpGenericTemplateTypesForInheritedClass(
                  content,
                  resolvedTraitName,
                  templateTypes,
                )
              : new Map<string, string>();

            if (!isRequestedRootActive()) {
              return null;
            }

            const traitReturnType = resolvedTraitName
              ? await resolvePhpMethodReturnType(
                  resolvedTraitName,
                  methodName,
                  visitedClassNames,
                  normalizedLateStaticClassName || normalizedClassName,
                  traitTemplateTypes,
                  callExpression,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (traitReturnType) {
              return traitReturnType;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );
            const mixinTemplateTypes = resolvedMixinName
              ? await resolvePhpGenericTemplateTypesForMixinClass(
                  content,
                  resolvedMixinName,
                  templateTypes,
                )
              : new Map<string, string>();

            if (!isRequestedRootActive()) {
              return null;
            }

            const mixinReturnType = resolvedMixinName
              ? await resolvePhpMethodReturnType(
                  resolvedMixinName,
                  methodName,
                  visitedClassNames,
                  normalizedLateStaticClassName || normalizedClassName,
                  mixinTemplateTypes,
                  callExpression,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (mixinReturnType) {
              return mixinReturnType;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (!resolvedSuperTypeName) {
              continue;
            }

            const superTypeTemplateTypes =
              await resolvePhpGenericTemplateTypesForInheritedClass(
                content,
                resolvedSuperTypeName,
                templateTypes,
              );

            if (!isRequestedRootActive()) {
              return null;
            }

            const superTypeReturnType = await resolvePhpMethodReturnType(
              resolvedSuperTypeName,
              methodName,
              visitedClassNames,
              normalizedLateStaticClassName || normalizedClassName,
              superTypeTemplateTypes,
              callExpression,
            );

            if (!isRequestedRootActive()) {
              return null;
            }

            if (superTypeReturnType) {
              return superTypeReturnType;
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return null;
      }

      const knownFrameworkReturnType = await resolveKnownFrameworkReturnType();

      if (!isRequestedRootActive()) {
        return null;
      }

      if (knownFrameworkReturnType) {
        return knownFrameworkReturnType;
      }

      return resolveBoundConcreteReturnType();
    },
    [
      currentWorkspaceRootRef,
      frameworkRuntime,
      frameworkProviders,
      typeExtensions,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      resolvePhpFrameworkBoundConcrete,
      resolvePhpFrameworkReturnTypeReference,
      resolvePhpGenericTemplateTypesForInheritedClass,
      resolvePhpGenericTemplateTypesForMixinClass,
      resolvePhpMethodDeclaredReturnType,
      returnTypeStrategy,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return { resolvePhpMethodReturnType };
}
