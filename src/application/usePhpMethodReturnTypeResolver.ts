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
import { phpMethodReturnExpressions } from "../domain/phpTypeAnalysis";
import {
  phpFrameworkContainerExpressionClassName,
  phpFrameworkMethodCallReturnTypeFromSource,
} from "../domain/phpFrameworkProviders";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createPhpFrameworkMethodReturnTypeStrategyAdapters } from "./phpFrameworkMethodReturnTypeStrategyAdapters";
import { createPhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

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
  resolvePhpClassReference: (source: string, className: string) => string | null;
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

type PhpNetteRelationMethod = "ref" | "related";

function phpNetteRelationMethod(
  methodName: string,
): PhpNetteRelationMethod | null {
  const normalizedMethodName = methodName.toLowerCase();

  if (normalizedMethodName === "ref" || normalizedMethodName === "related") {
    return normalizedMethodName;
  }

  return null;
}

function isGeneratedPhpNetteRelationReturnType(
  returnType: string | null,
  relationMethod: PhpNetteRelationMethod,
  carrierClassName: string,
  resolveMappedType: (mappedType: string) => string | null,
): boolean {
  const normalizedReturnType = returnType?.trim() ?? "";
  const normalizedCarrierClassName = carrierClassName
    .trim()
    .replace(/^\\+/, "");
  const activeRowMarker = "\\ActiveRow\\";
  const activeRowMarkerIndex = normalizedCarrierClassName
    .toLowerCase()
    .indexOf(activeRowMarker.toLowerCase());

  if (
    !normalizedReturnType.startsWith("(") ||
    !/\$[A-Za-z_][A-Za-z0-9_]*\s+is\s+/i.test(normalizedReturnType) ||
    activeRowMarkerIndex < 0 ||
    !/ActiveRow$/i.test(normalizedCarrierClassName)
  ) {
    return false;
  }

  const familyPrefix = normalizedCarrierClassName.slice(
    0,
    activeRowMarkerIndex,
  );
  const familyMarker =
    relationMethod === "ref" ? "\\ActiveRow\\" : "\\Selection\\";
  const familySuffix = relationMethod === "ref" ? "ActiveRow" : "Selection";
  const mappedTypes = [
    ...normalizedReturnType.matchAll(
      /\?\s*(\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)(?:\|null)?\s*:/g,
    ),
  ].flatMap((match) => (match[1] ? [match[1].replace(/^\\+/, "")] : []));

  if (mappedTypes.length === 0) {
    return false;
  }

  const expectedFamilyPrefix = `${familyPrefix}${familyMarker}`.toLowerCase();
  const hasOnlyGeneratedFamilyMappings = mappedTypes.every((mappedType) => {
    const resolvedMappedType = resolveMappedType(mappedType)?.replace(
      /^\\+/,
      "",
    );

    if (!resolvedMappedType?.includes("\\")) {
      return false;
    }

    return (
      resolvedMappedType.toLowerCase().startsWith(expectedFamilyPrefix) &&
      resolvedMappedType.toLowerCase().endsWith(familySuffix.toLowerCase())
    );
  });

  if (!hasOnlyGeneratedFamilyMappings) {
    return false;
  }

  if (relationMethod === "ref") {
    return /:\s*\\?Nette\\Database\\Table\\ActiveRow(?:\|null)?\s*\)+(?:\|null)?$/i.test(
      normalizedReturnType,
    );
  }

  return /:\s*\\?Nette\\Database\\Table\\Selection\s*\)+(?:\|null)?$/i.test(
    normalizedReturnType,
  );
}

function isGenericPhpNetteRelationReturnType(
  returnType: string | null,
  relationMethod: PhpNetteRelationMethod,
  resolveDeclaredType: (declaredType: string) => string | null,
): boolean {
  const normalizedReturnType = (returnType ?? "").replace(/\s+/g, "");
  const expandedReturnType = normalizedReturnType.startsWith("?")
    ? `${normalizedReturnType.slice(1)}|null`
    : normalizedReturnType;
  const declaredTypes = expandedReturnType
    .split("|")
    .filter((typeName) => typeName.toLowerCase() !== "null");

  if (declaredTypes.length !== 1 || !declaredTypes[0]) {
    return false;
  }

  const resolvedDeclaredType = resolveDeclaredType(declaredTypes[0])
    ?.replace(/^\\+/, "")
    .toLowerCase();
  const expectedDeclaredType =
    relationMethod === "ref"
      ? "nette\\database\\table\\activerow"
      : "nette\\database\\table\\selection";

  return resolvedDeclaredType === expectedDeclaredType;
}

function genericPhpNetteRelationReturnType(
  relationMethod: PhpNetteRelationMethod,
): string {
  if (relationMethod === "ref") {
    return "Nette\\Database\\Table\\ActiveRow";
  }

  return "Nette\\Database\\Table\\Selection";
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
  const netteDatabaseTypeResolver = useMemo(
    () =>
      createPhpNetteDatabaseTypeResolver({
        isActive: () =>
          frameworkRuntime.hasProvider("nette") &&
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot),
        readClassSource: async (path, className) =>
          (await readPhpClassMembersFromPath(path, className)).content,
        resolveClassSourcePaths: resolvePhpClassSourcePaths,
      }),
    [
      currentWorkspaceRootRef,
      frameworkRuntime,
      readPhpClassMembersFromPath,
      resolvePhpClassSourcePaths,
      workspaceRoot,
    ],
  );
  const returnTypeStrategy = useMemo(
    () =>
      createPhpFrameworkMethodReturnTypeStrategyAdapters({
        frameworkRuntime,
        netteDatabaseTypeResolver,
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
      frameworkRuntime,
      netteDatabaseTypeResolver,
      resolvePhpEloquentBuilderModelTypeRef,
      resolvePhpFrameworkProjectMorphMapModelType,
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
      const netteRelationMethod = frameworkRuntime.supports(
        "netteDatabaseSemantics",
      )
        ? phpNetteRelationMethod(methodName)
        : null;

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

      const resolveKnownFrameworkReturnType = async (): Promise<string | null> => {
        const knownReturnType =
          await returnTypeStrategy.knownClassMethodReturnType({
            ...(callExpression ? { callExpression } : {}),
            className: normalizedLateStaticClassName || normalizedClassName,
            methodName,
          });

        return isRequestedRootActive() ? knownReturnType : null;
      };

      const resolveBoundConcreteReturnType = async (): Promise<string | null> => {
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
            { frameworkProviders },
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

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
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
            const isInheritedDeclaration =
              normalizedClassName.toLowerCase() !==
              normalizedLateStaticClassName.toLowerCase();
            const isConcreteNetteDeclaration =
              frameworkRuntime.supports("netteDatabaseSemantics") &&
              !isInheritedDeclaration;
            const strategyReturnType = !isConcreteNetteDeclaration
              ? await returnTypeStrategy.declaredReturnTypeOverride({
                  lateStaticClassName:
                    normalizedLateStaticClassName || normalizedClassName,
                  methodName,
                  methodReturnExpressions,
                  returnType,
                })
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (strategyReturnType) {
              return strategyReturnType;
            }

            const isConditionalNetteRelationDeclaration = Boolean(
              netteRelationMethod &&
                isGeneratedPhpNetteRelationReturnType(
                  method?.returnType ?? null,
                  netteRelationMethod,
                  normalizedLateStaticClassName || normalizedClassName,
                  (mappedType) =>
                    resolvePhpClassReference(content, mappedType),
                ),
            );
            const isGenericNetteRelationDeclaration = Boolean(
              netteRelationMethod &&
                isGenericPhpNetteRelationReturnType(
                  method?.returnType ?? null,
                  netteRelationMethod,
                  (declaredType) =>
                    resolvePhpClassReference(content, declaredType),
                ),
            );

            if (
              callExpression &&
              (isConditionalNetteRelationDeclaration ||
                isGenericNetteRelationDeclaration)
            ) {
              const knownReturnType = await resolveKnownFrameworkReturnType();

              if (!isRequestedRootActive()) {
                return null;
              }

              if (knownReturnType) {
                return knownReturnType;
              }
            }

            if (
              isConditionalNetteRelationDeclaration &&
              netteRelationMethod
            ) {
              return genericPhpNetteRelationReturnType(netteRelationMethod);
            }

            return returnType;
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
            const resolvedTraitName = resolvePhpClassReference(content, traitName);
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
            const resolvedMixinName = resolvePhpClassReference(content, mixinName);
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
