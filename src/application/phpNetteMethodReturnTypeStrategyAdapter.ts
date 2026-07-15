import {
  phpNetteDatabaseTypeKind,
  phpNetteLiteralTableArgument,
} from "../domain/phpNetteDatabaseTypes";
import type { PhpMethodReturnTypeStrategy } from "./phpMethodReturnTypeStrategy";
import type { PhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

export function createPhpNetteMethodReturnTypeStrategyAdapter(
  resolver: PhpNetteDatabaseTypeResolver,
): PhpMethodReturnTypeStrategy {
  return {
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
        return selectionMethodType(normalizedMethod, types);
      }

      if (kind !== "activeRow") {
        return null;
      }

      const tableName = phpNetteLiteralTableArgument(callExpression);

      if (!tableName || (normalizedMethod !== "ref" && normalizedMethod !== "related")) {
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
    staticCallReturnType() {
      return null;
    },
  };
}

function repositoryMethodType(
  methodName: string,
  types: { activeRowType: string; selectionType: string },
): string | null {
  if (methodName === "gettable") {
    return types.selectionType;
  }

  if (methodName === "find" || methodName === "findby" || methodName === "insert") {
    return `${types.activeRowType}|null`;
  }

  return null;
}

function selectionMethodType(
  methodName: string,
  types: { activeRowType: string; selectionType: string },
): string | null {
  if (["fetch", "get", "offsetget"].includes(methodName)) {
    return `${types.activeRowType}|null`;
  }

  if (methodName === "current") {
    return `${types.activeRowType}|false|null`;
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

  if (/^(?:\\?Nette\\Database\\Table\\)?ActiveRow(?:\|null)?$|^\?ActiveRow$/i.test(returnType)) {
    return inferred.includes(types.activeRowType) ? inferred : null;
  }

  if (/^(?:\\?Nette\\Database\\Table\\)?Selection$|^Selection$/i.test(returnType)) {
    return inferred === types.selectionType ? inferred : null;
  }

  return null;
}
