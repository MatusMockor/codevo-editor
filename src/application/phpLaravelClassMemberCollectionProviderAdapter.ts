import {
  phpLaravelDynamicWhereCompletionsFromSource,
  phpLaravelRelationPropertyCompletionsFromSource,
} from "../domain/phpFrameworkLaravel";
import type {
  PhpFrameworkClassMemberCollectionProviderAdapter,
} from "./phpFrameworkClassMemberCollectionProviderAdapter";

export interface PhpLaravelClassMemberCollectionProviderAdapterDependencies {
  resolvePhpDeclaredType(
    source: string,
    typeName: string | null,
  ): string | null;
}

export function createPhpLaravelClassMemberCollectionProviderAdapter({
  resolvePhpDeclaredType,
}: PhpLaravelClassMemberCollectionProviderAdapterDependencies): PhpFrameworkClassMemberCollectionProviderAdapter {
  return {
    canCollectSyntheticMembers: true,
    dynamicWhereMethods: ({ className, options, source }) =>
      phpLaravelDynamicWhereCompletionsFromSource(source, className, options),
    relationCompletions: ({ className, source }) =>
      phpLaravelRelationPropertyCompletionsFromSource(source, className).map(
        (relation) => ({
          ...relation,
          returnType: phpLaravelNormalizedRelationReturnType(
            source,
            relation.returnType,
            resolvePhpDeclaredType,
          ),
        }),
      ),
  };
}

function phpLaravelNormalizedRelationReturnType(
  source: string,
  returnType: string | null,
  resolvePhpDeclaredType: PhpLaravelClassMemberCollectionProviderAdapterDependencies[
    "resolvePhpDeclaredType"
  ],
): string | null {
  if (
    phpLooksLikeQualifiedClassName(returnType) ||
    phpIsBuiltinDeclaredType(returnType)
  ) {
    return phpNormalizedDeclaredTypeName(returnType);
  }

  return resolvePhpDeclaredType(source, returnType) ?? returnType;
}

function phpLooksLikeQualifiedClassName(typeName: string | null): boolean {
  return Boolean(phpNormalizedDeclaredTypeName(typeName)?.includes("\\"));
}

function phpNormalizedDeclaredTypeName(typeName: string | null): string | null {
  return typeName?.trim().replace(/^\?/, "").replace(/^\\+/, "") || null;
}

function phpIsBuiltinDeclaredType(typeName: string | null): boolean {
  const normalizedTypeName =
    phpNormalizedDeclaredTypeName(typeName)?.toLowerCase();

  return Boolean(
    normalizedTypeName &&
      new Set([
        "array",
        "bool",
        "boolean",
        "callable",
        "false",
        "float",
        "int",
        "integer",
        "iterable",
        "mixed",
        "never",
        "null",
        "object",
        "resource",
        "self",
        "static",
        "string",
        "true",
        "void",
      ]).has(normalizedTypeName),
  );
}
