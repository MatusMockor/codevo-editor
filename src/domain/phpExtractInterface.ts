import {
  parsePhpClassStructure,
  type PhpMethodMember,
  type PhpStructuredParameter,
} from "./phpClassStructure";
import { phpCurrentNamespace } from "./phpAddImport";

/**
 * Pure planner for the PhpStorm "Extract Interface" refactor.
 *
 * Given a PHP class and a cursor offset that sits on (or inside) the class
 * declaration, it synthesises:
 *  - the full text of a NEW interface file (`<?php namespace ...; interface
 *    <Class>Interface { <public signatures>; }`) carrying the signatures of the
 *    class's PUBLIC INSTANCE methods, and
 *  - the path of that new file (PSR-4 sibling of the source class), and
 *  - the single in-place edit that adds `implements <Class>Interface` to the
 *    class declaration (creating the `implements` clause or extending an
 *    existing one).
 *
 * Design / safety constraints (deliberately CONSERVATIVE - returns `null`
 * rather than risk corrupting a file):
 *  - Pure string synthesis. No I/O, no side-effects.
 *  - Only a concrete `class` qualifies. `abstract class`, `interface`, `trait`
 *    and `enum` are rejected (an interface cannot meaningfully be extracted from
 *    them / they already are interfaces).
 *  - Only PUBLIC INSTANCE methods are lifted. Constructors, magic methods
 *    (`__*`), `static`, `abstract`, `private` and `protected` methods are
 *    omitted (PhpStorm's Extract Interface offers instance API only).
 *  - When NO method qualifies, or the declaration cannot be parsed, returns
 *    `null` so the action is never offered where it would create an empty or
 *    malformed interface.
 *  - Signatures are rendered from the precise structural model
 *    (`parsePhpClassStructure`), which already normalises nullable / union
 *    types, variadics, by-ref, defaults and multiline signatures - so the
 *    emitted interface is always a valid single-line declaration.
 */

export interface PhpExtractInterfaceEdit {
  offset: number;
  text: string;
}

export interface PhpExtractInterfacePlan {
  className: string;
  implementsEdit: PhpExtractInterfaceEdit;
  interfaceFilePath: string;
  interfaceName: string;
  interfaceText: string;
}

const INDENT = "    ";

export function planExtractInterface(
  source: string,
  cursorOffset: number,
  sourcePath: string,
): PhpExtractInterfacePlan | null {
  const declaration = locateEnclosingClassDeclaration(source, cursorOffset);

  if (!declaration) {
    return null;
  }

  const structure = parsePhpClassStructure(source, declaration.name);

  if (structure.kind !== "class") {
    return null;
  }

  const methods = structure.methods.filter(isExtractableMethod);

  if (methods.length === 0) {
    return null;
  }

  const interfaceName = `${declaration.name}Interface`;
  const interfaceFilePath = siblingInterfacePath(sourcePath, interfaceName);

  if (!interfaceFilePath) {
    return null;
  }

  const namespace = phpCurrentNamespace(source);
  const interfaceText = renderInterfaceFile(namespace, interfaceName, methods);
  const implementsEdit = buildImplementsEdit(
    source,
    declaration,
    interfaceName,
  );

  if (!implementsEdit) {
    return null;
  }

  return {
    className: declaration.name,
    implementsEdit,
    interfaceFilePath,
    interfaceName,
    interfaceText,
  };
}

interface ClassDeclaration {
  /**
   * Offset of the class body's opening `{`.
   */
  bodyStart: number;
  /**
   * Offset of the class body's matching closing `}`.
   */
  bodyEnd: number;
  /**
   * Offset of the keyword that opens the declaration (`class`, or the leading
   * `abstract` / `final` modifier when present).
   */
  keywordStart: number;
  name: string;
}

/**
 * Finds the `class` declaration whose body encloses `cursorOffset`, or - when
 * the cursor sits on the `class` keyword / name / modifiers line itself, before
 * the body opens - the declaration immediately at the cursor. Returns `null`
 * when the cursor is not within any class (e.g. a free function or the file
 * header) so the refactor is never offered out of context.
 *
 * Only `class` declarations are matched here; abstract classes are matched too
 * (so the caller can reject them via the structural `kind`, keeping the
 * "not a plain class" guard in one place). `interface` / `trait` / `enum` are
 * not matched, so a cursor inside those yields `null`.
 */
function locateEnclosingClassDeclaration(
  source: string,
  cursorOffset: number,
): ClassDeclaration | null {
  const masked = maskStringsAndComments(source);
  const pattern = /\b(?:abstract\s+|final\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/g;

  for (
    let match = pattern.exec(masked);
    match;
    match = pattern.exec(masked)
  ) {
    const name = match[1];
    const keywordStart = match.index ?? 0;

    if (!name) {
      continue;
    }

    const bodyStart = masked.indexOf("{", keywordStart + match[0].length);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingBrace(masked, bodyStart);

    if (bodyEnd === null) {
      continue;
    }

    if (cursorOffset >= keywordStart && cursorOffset <= bodyEnd) {
      return { bodyEnd, bodyStart, keywordStart, name };
    }
  }

  return null;
}

/**
 * A method is part of the extracted interface only when it is a public instance
 * method that is NOT a constructor, magic method, static or abstract method.
 */
function isExtractableMethod(method: PhpMethodMember): boolean {
  if (method.visibility !== "public") {
    return false;
  }

  if (method.isStatic || method.isAbstract) {
    return false;
  }

  return !isMagicOrConstructor(method.name);
}

function isMagicOrConstructor(name: string): boolean {
  return name.startsWith("__");
}

function renderInterfaceFile(
  namespace: string | null,
  interfaceName: string,
  methods: PhpMethodMember[],
): string {
  const header = namespace ? `<?php\n\nnamespace ${namespace};\n\n` : "<?php\n\n";
  const signatures = methods
    .map((method) => `${INDENT}${renderInterfaceSignature(method)}`)
    .join("\n");

  return `${header}interface ${interfaceName}\n{\n${signatures}\n}\n`;
}

function renderInterfaceSignature(method: PhpMethodMember): string {
  const params = method.parameters.map(renderParameter).join(", ");
  const returnSuffix = method.returnType ? `: ${method.returnType}` : "";

  return `public function ${method.name}(${params})${returnSuffix};`;
}

function renderParameter(parameter: PhpStructuredParameter): string {
  const typePrefix = parameter.type ? `${parameter.type} ` : "";
  const byRef = parameter.isByRef ? "&" : "";
  const variadic = parameter.isVariadic ? "..." : "";
  const defaultSuffix =
    parameter.defaultValue === null ? "" : ` = ${parameter.defaultValue}`;

  return `${typePrefix}${byRef}${variadic}${parameter.name}${defaultSuffix}`;
}

/**
 * Builds the single in-place edit that adds `implements <interfaceName>` to the
 * class declaration. The edit is a pure insertion (zero-length original range):
 *  - no existing `implements` -> insert ` implements <interfaceName>` right
 *    after the class header (after the name, or after an `extends X` clause),
 *  - an existing `implements A, B` -> append `, <interfaceName>` to the list.
 *
 * Returns `null` when the class header before the body cannot be parsed
 * (defensive; the body was already located so this should not happen for a
 * well-formed class).
 */
function buildImplementsEdit(
  source: string,
  declaration: ClassDeclaration,
  interfaceName: string,
): PhpExtractInterfaceEdit | null {
  const existingImplements = findImplementsClauseEnd(source, declaration);

  if (existingImplements !== null) {
    return { offset: existingImplements, text: `, ${interfaceName}` };
  }

  return {
    offset: headerEndOffset(source, declaration),
    text: ` implements ${interfaceName}`,
  };
}

/**
 * Offset where the `implements` insertion goes when there is no existing
 * clause: immediately after the class header content (the last non-whitespace
 * character before the body `{`). Anchoring on the trimmed header end (rather
 * than the `{` itself) keeps the inserted clause adjacent to `extends X` / the
 * class name instead of being pushed up against the brace across any
 * whitespace/newline that separates the header from the body.
 */
function headerEndOffset(
  source: string,
  declaration: ClassDeclaration,
): number {
  let index = declaration.bodyStart - 1;

  while (index > declaration.keywordStart && /\s/.test(source[index] || "")) {
    index -= 1;
  }

  return index + 1;
}

/**
 * When the class header (everything between `keywordStart` and the body `{`)
 * already carries an `implements` clause, returns the offset immediately after
 * its last listed interface name (so a `, <new>` can be appended). Returns
 * `null` when there is no `implements` clause.
 *
 * Runs against the MASKED header so a `{` or comment in the header cannot
 * mis-place the insertion. The offset is the trimmed end of the header, which
 * for a header ending in `implements A, B` is the character just past `B`.
 */
function findImplementsClauseEnd(
  source: string,
  declaration: ClassDeclaration,
): number | null {
  const masked = maskStringsAndComments(source);
  const header = masked.slice(declaration.keywordStart, declaration.bodyStart);

  if (!/\bimplements\b/.test(header)) {
    return null;
  }

  return headerEndOffset(source, declaration);
}

function maskStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";
      if (character === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";
      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";
      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : " ";
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#") {
      output += " ";
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

function matchingBrace(masked: string, openOffset: number): number | null {
  let depth = 0;

  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function siblingInterfacePath(
  sourcePath: string,
  interfaceName: string,
): string | null {
  const separator = sourcePath.includes("\\") ? "\\" : "/";
  const lastSeparator = sourcePath.lastIndexOf(separator);

  if (lastSeparator < 0) {
    return `${interfaceName}.php`;
  }

  const directory = sourcePath.slice(0, lastSeparator);

  return `${directory}${separator}${interfaceName}.php`;
}
