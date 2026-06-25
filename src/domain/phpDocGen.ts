import type {
  PhpMethodMember,
  PhpStructuredParameter,
} from "./phpClassStructure";

/**
 * Pure PHP code generation for "Generate PHPDoc" (the PhpStorm
 * Generate -> PHPDoc action). Given a method from `parsePhpClassStructure`,
 * synthesizes a `/** ... *\/` docblock that documents every parameter and the
 * return type from the native signature.
 *
 * Design constraints:
 *  - Pure string rendering — no side-effects, no I/O.
 *  - This is an EXPLICIT user action (Cmd+. / Alt+Enter on a method without a
 *    docblock), so we always emit the full `@param` / `@return` set rather than
 *    applying the "adds value" heuristics used for automatic generation.
 *  - A parameter with no native type hint documents as `mixed`; the parameter
 *    name (with its leading `$`) is preserved verbatim.
 *  - The return type drives `@return`. A missing return type yields
 *    `@return mixed`; a `void` / `never` return omits `@return` entirely
 *    (documenting "returns nothing" with `@return void` is noise).
 *  - Every line is prefixed with the supplied method indent so the docblock
 *    aligns with the declaration it sits above.
 */

const NO_RETURN_TYPES = new Set(["void", "never"]);

export function renderGeneratedPhpDoc(
  member: PhpMethodMember,
  indent = "",
): string {
  const lines = [
    "/**",
    ...member.parameters.map(renderParamLine),
    ...renderReturnLines(member.returnType),
    " */",
  ];

  return lines.map((line) => `${indent}${line}`.trimEnd()).join("\n");
}

function renderParamLine(parameter: PhpStructuredParameter): string {
  const type = parameter.type ?? "mixed";

  return ` * @param ${type} ${parameter.name}`;
}

function renderReturnLines(returnType: string | null): string[] {
  if (isNoReturnType(returnType)) {
    return [];
  }

  const type = returnType ?? "mixed";

  return [` * @return ${type}`];
}

function isNoReturnType(returnType: string | null): boolean {
  if (!returnType) {
    return false;
  }

  return NO_RETURN_TYPES.has(returnType.toLowerCase());
}
