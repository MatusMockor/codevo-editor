import {
  phpNetteDatabaseTypeKind,
  phpNetteFetchPairsReturnsRows,
  phpNetteLiteralTableArgument,
} from "../domain/phpNetteDatabaseTypes";
import type {
  PhpContextualMethodReturnTypeStrategy,
  PhpDeclaredMethodReturnTypeResolutionContext,
} from "./phpMethodReturnTypeStrategy";
import type { PhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

export function createPhpNetteMethodReturnTypeStrategyAdapter(
  resolver: PhpNetteDatabaseTypeResolver,
): PhpContextualMethodReturnTypeStrategy {
  const strategy: PhpContextualMethodReturnTypeStrategy = {
    async declaredReturnTypeOverride({
      lateStaticClassName,
      methodName,
      returnType,
    }) {
      if (!lateStaticClassName || !methodName) {
        return null;
      }

      const types = await resolver.resolveClassTypes(lateStaticClassName);

      if (!types) {
        return null;
      }

      return replaceGenericNetteReturnType(returnType, methodName, types);
    },
    facadeTargetClassName() {
      return null;
    },
    async knownClassMethodReturnType({
      callExpression,
      className,
      methodName,
    }) {
      const types = await resolver.resolveClassTypes(className);

      if (!types) {
        return null;
      }

      const normalizedMethod = methodName.toLowerCase();
      const kind = phpNetteDatabaseTypeKind(className);

      if (kind === "repository") {
        return repositoryMethodType(normalizedMethod, types);
      }

      if (kind === "selection") {
        return selectionMethodType(normalizedMethod, types, callExpression);
      }

      if (kind !== "activeRow") {
        return null;
      }

      const tableName = phpNetteLiteralTableArgument(callExpression);

      if (
        !tableName ||
        (normalizedMethod !== "ref" && normalizedMethod !== "related")
      ) {
        return null;
      }

      return resolver.resolveTableType(
        className,
        normalizedMethod === "ref" ? "activeRow" : "selection",
        tableName,
      );
    },
    async methodCallReturnType() {
      return null;
    },
    async resolveDeclaredMethodReturnType(context) {
      const relationMethod = phpNetteRelationMethod(context.methodName);

      if (relationMethod) {
        const relationReturnType = await resolveNetteRelationDeclaredReturnType(
          resolver,
          context,
          relationMethod,
        );

        if (relationReturnType) {
          return relationReturnType;
        }
      }

      if (!isInheritedDeclaration(context)) {
        return context.resolvedReturnType;
      }

      const override = await strategy.declaredReturnTypeOverride({
        lateStaticClassName: context.lateStaticClassName,
        methodName: context.methodName,
        methodReturnExpressions: context.methodReturnExpressions,
        returnType: context.resolvedReturnType,
      });

      return override ?? context.resolvedReturnType;
    },
    staticCallReturnType() {
      return null;
    },
  };

  return strategy;
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

async function resolveNetteRelationDeclaredReturnType(
  resolver: PhpNetteDatabaseTypeResolver,
  context: PhpDeclaredMethodReturnTypeResolutionContext,
  relationMethod: PhpNetteRelationMethod,
): Promise<string | null> {
  const isConditionalGeneratedType = isGeneratedNetteRelationReturnType(
    context.rawReturnType,
    relationMethod,
    context.lateStaticClassName,
    context.resolveTypeReference,
  );
  const isGenericType = isGenericNetteRelationReturnType(
    context.rawReturnType,
    relationMethod,
    context.resolveTypeReference,
  );

  if (!isConditionalGeneratedType && !isGenericType) {
    return null;
  }

  if (context.callExpression) {
    const knownReturnType = await knownNetteRelationReturnType(
      resolver,
      context,
    );

    if (knownReturnType) {
      return knownReturnType;
    }
  }

  if (isConditionalGeneratedType) {
    return genericNetteRelationReturnType(relationMethod);
  }

  return context.resolvedReturnType;
}

async function knownNetteRelationReturnType(
  resolver: PhpNetteDatabaseTypeResolver,
  context: PhpDeclaredMethodReturnTypeResolutionContext,
): Promise<string | null> {
  const types = await resolver.resolveClassTypes(context.lateStaticClassName);

  if (!types) {
    return null;
  }

  const tableName = phpNetteLiteralTableArgument(context.callExpression);

  if (!tableName) {
    return null;
  }

  return resolver.resolveTableType(
    context.lateStaticClassName,
    context.methodName.toLowerCase() === "ref" ? "activeRow" : "selection",
    tableName,
  );
}

function isInheritedDeclaration(
  context: PhpDeclaredMethodReturnTypeResolutionContext,
): boolean {
  return (
    context.declaringClassName.toLowerCase() !==
    context.lateStaticClassName.toLowerCase()
  );
}

function isGeneratedNetteRelationReturnType(
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

function isGenericNetteRelationReturnType(
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

function genericNetteRelationReturnType(
  relationMethod: PhpNetteRelationMethod,
): string {
  if (relationMethod === "ref") {
    return "Nette\\Database\\Table\\ActiveRow";
  }

  return "Nette\\Database\\Table\\Selection";
}

function repositoryMethodType(
  methodName: string,
  types: { activeRowType: string; selectionType: string },
): string | null {
  if (methodName === "gettable") {
    return types.selectionType;
  }

  if (
    methodName === "find" ||
    methodName === "findby" ||
    methodName === "insert"
  ) {
    return `${types.activeRowType}|null`;
  }

  return null;
}

function selectionMethodType(
  methodName: string,
  types: { activeRowType: string; selectionType: string },
  callExpression?: string,
): string | null {
  if (["fetch", "get", "offsetget"].includes(methodName)) {
    return `${types.activeRowType}|null`;
  }

  if (methodName === "current") {
    return `${types.activeRowType}|false|null`;
  }

  if (methodName === "fetchall") {
    return `${types.activeRowType}[]`;
  }

  if (
    methodName === "fetchpairs" &&
    phpNetteFetchPairsReturnsRows(callExpression)
  ) {
    return `${types.activeRowType}[]`;
  }

  if (
    [
      "alias",
      "group",
      "having",
      "joinwhere",
      "limit",
      "order",
      "page",
      "select",
      "where",
      "whereor",
      "whereprimary",
    ].includes(methodName)
  ) {
    return types.selectionType;
  }

  return null;
}

function replaceGenericNetteReturnType(
  returnType: string,
  methodName: string,
  types: { activeRowType: string; selectionType: string },
): string | null {
  const repositoryType = repositoryMethodType(methodName.toLowerCase(), types);
  const selectionType = selectionMethodType(methodName.toLowerCase(), types);
  const inferred = repositoryType ?? selectionType;

  if (!inferred) {
    return null;
  }

  if (
    /^(?:\\?Nette\\Database\\Table\\)?ActiveRow(?:\|null)?$|^\?ActiveRow$/i.test(
      returnType,
    )
  ) {
    return inferred.includes(types.activeRowType) ? inferred : null;
  }

  if (
    /^(?:\\?Nette\\Database\\Table\\)?Selection$|^Selection$/i.test(returnType)
  ) {
    return inferred === types.selectionType ? inferred : null;
  }

  if (
    /^(?:array|(?:\\?Nette\\Database\\Table\\)?ActiveRow\[\])$/i.test(
      returnType,
    )
  ) {
    return inferred === `${types.activeRowType}[]` ? inferred : null;
  }

  return null;
}
