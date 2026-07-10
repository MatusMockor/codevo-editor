import { renderAccessors } from "../domain/phpAccessorCodeGen";
import type {
  PhpClassStructure,
  PhpMethodMember,
  PhpPropertyMember,
} from "../domain/phpClassStructure";
import { renderConstructor } from "../domain/phpConstructorCodeGen";
import { planPhpConstructorPromotion } from "../domain/phpConstructorPromotion";
import {
  generatedPhpDocHasContent,
  renderGeneratedPhpDoc,
} from "../domain/phpDocGen";
import {
  detectClassMemberIndent,
  findClassBodyInsertionOffset,
  indentLines,
  offsetToPosition,
  type ClassBodySelector,
} from "../domain/phpInsertionPoint";
import {
  phpReplacementEdit,
  zeroLengthPhpEditRange,
} from "./phpCodeActionEdits";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

/**
 * Offers "Generate getters and setters" for instance properties that are still
 * missing an accessor.
 */
export function phpGenerateAccessorsCodeAction(
  source: string,
  structure: PhpClassStructure,
): PhpCodeActionDescriptor | null {
  const instanceProperties = structure.properties.filter(
    (property) => !property.isStatic,
  );

  if (instanceProperties.length === 0) {
    return null;
  }

  const methodNames = new Set(
    structure.methods.map((method) => method.name.toLowerCase()),
  );
  const missingProperties = instanceProperties.filter(
    (property) => !phpPropertyHasAllAccessors(property, methodNames),
  );

  if (missingProperties.length === 0) {
    return null;
  }

  return phpClassBodyInsertionAction(
    source,
    renderAccessors(missingProperties, { mode: "both" }),
    "Generate getters and setters",
  );
}

export function phpGenerateConstructorCodeAction(
  source: string,
  structure: PhpClassStructure,
): PhpCodeActionDescriptor | null {
  const instanceProperties = structure.properties.filter(
    (property) => !property.isStatic,
  );

  if (instanceProperties.length === 0 || phpClassHasConstructor(structure)) {
    return null;
  }

  return phpClassBodyInsertionAction(
    source,
    renderConstructor(instanceProperties),
    "Generate constructor",
  );
}

export function phpGenerateConstructorWithPromotionCodeAction(
  source: string,
  structure: PhpClassStructure,
): PhpCodeActionDescriptor | null {
  const plan = planPhpConstructorPromotion(source, structure);

  if (!plan) {
    return null;
  }

  return {
    edits: plan.edits.map((edit) =>
      phpReplacementEdit(source, edit.start, edit.end, edit.text),
    ),
    kind: "refactor.rewrite",
    title: "Generate constructor with promotion",
  };
}

export function phpGeneratePhpDocCodeAction(
  source: string,
  structure: PhpClassStructure,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const method = phpMethodAtOffset(structure, range.start);

  if (!method || method.phpDoc || !generatedPhpDocHasContent(method)) {
    return null;
  }

  const lineStart = phpLineStartOffset(source, method.declarationOffset);
  const indent = phpLeadingIndent(source, lineStart);
  const docBlock = renderGeneratedPhpDoc(method, indent);
  const insertionPosition = offsetToPosition(source, lineStart);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: `${docBlock}\n`,
      },
    ],
    kind: "refactor.rewrite",
    title: "Generate PHPDoc",
  };
}

export function phpClassBodyInsertionAction(
  source: string,
  block: string,
  title: string,
  target?: string | ClassBodySelector,
): PhpCodeActionDescriptor | null {
  const insertionPoint = findClassBodyInsertionOffset(source, target);

  if (!insertionPoint) {
    return null;
  }

  const indentedBlock = indentLines(
    block,
    detectClassMemberIndent(source, target),
  );
  const leadingBlankLine = insertionPoint.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertionPoint.needsTrailingBlankLine ? "\n" : "";
  const insertionPosition = offsetToPosition(source, insertionPoint.offset);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: `${leadingBlankLine}${indentedBlock}\n${trailingBlankLine}`,
      },
    ],
    kind: "refactor.rewrite",
    title,
  };
}

function phpPropertyHasAllAccessors(
  property: PhpPropertyMember,
  methodNames: ReadonlySet<string>,
): boolean {
  const pascalName = phpPascalCasePropertyName(property.name);
  const hasGetter =
    methodNames.has(`get${pascalName}`.toLowerCase()) ||
    methodNames.has(`is${pascalName}`.toLowerCase());

  if (!hasGetter) {
    return false;
  }

  if (property.isReadonly) {
    return true;
  }

  return methodNames.has(`set${pascalName}`.toLowerCase());
}

function phpPascalCasePropertyName(name: string): string {
  return name
    .split(/[_\s-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

function phpClassHasConstructor(structure: PhpClassStructure): boolean {
  return structure.methods.some(
    (method) => method.name.toLowerCase() === "__construct",
  );
}

function phpMethodAtOffset(
  structure: PhpClassStructure,
  offset: number,
): PhpMethodMember | null {
  const ordered = [...structure.methods].sort(
    (a, b) => a.memberStartOffset - b.memberStartOffset,
  );

  let match: PhpMethodMember | null = null;

  for (const method of ordered) {
    if (method.memberStartOffset > offset) {
      break;
    }

    match = method;
  }

  return match;
}

function phpLineStartOffset(source: string, offset: number): number {
  const previousNewline = source.lastIndexOf("\n", offset - 1);

  return previousNewline + 1;
}

function phpLeadingIndent(source: string, lineStart: number): string {
  const indentMatch = /^[ \t]*/.exec(source.slice(lineStart));

  return indentMatch?.[0] ?? "";
}
