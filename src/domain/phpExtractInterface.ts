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
  const useStatements = collectSignatureUseStatements(source, methods);
  const interfaceText = renderInterfaceFile(
    namespace,
    interfaceName,
    methods,
    useStatements,
  );
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
  useStatements: string[],
): string {
  const header = namespace ? `<?php\n\nnamespace ${namespace};\n\n` : "<?php\n\n";
  const useBlock =
    useStatements.length > 0 ? `${useStatements.join("\n")}\n\n` : "";
  const signatures = methods
    .map((method) => `${INDENT}${renderInterfaceSignature(method)}`)
    .join("\n");

  return `${header}${useBlock}interface ${interfaceName}\n{\n${signatures}\n}\n`;
}

/**
 * The `use` statements the generated interface needs so the types in its method
 * signatures resolve, copied VERBATIM from the source class's own imports
 * (preserving aliases). PhpStorm's Extract Interface copies the relevant imports
 * the same way.
 *
 * Conservative by construction:
 *  - only short names that appear in a parameter or return type are considered;
 *  - built-in scalar / pseudo types, fully-qualified (`\App\Foo`) signature
 *    types, and types already in the current namespace need no import and are
 *    skipped;
 *  - a short name is emitted ONLY when the source declares a matching `use`
 *    import for it (matched by its alias / last segment). A type with no import
 *    in the source is left WITHOUT a `use` - a missing import (still
 *    syntactically valid) over a guessed, possibly wrong one.
 *
 * The result is the de-duplicated, alphabetically sorted set of source `use`
 * statements whose alias is referenced by the lifted signatures.
 */
function collectSignatureUseStatements(
  source: string,
  methods: PhpMethodMember[],
): string[] {
  const shortNames = collectSignatureShortNames(methods);

  if (shortNames.size === 0) {
    return [];
  }

  const imports = sourceUseImports(source);
  const statements = new Set<string>();

  for (const shortName of shortNames) {
    const statement = imports.get(shortName);

    if (statement) {
      statements.add(statement);
    }
  }

  return [...statements].sort((a, b) => a.localeCompare(b));
}

/**
 * The set of SHORT class-name tokens used in the lifted methods' parameter and
 * return types that could require an import: every identifier component of each
 * type with built-ins, `self`/`static`/`parent`, and fully-qualified (leading
 * `\`) names excluded. A union / nullable / intersection type contributes each
 * of its component names.
 */
function collectSignatureShortNames(methods: PhpMethodMember[]): Set<string> {
  const names = new Set<string>();

  for (const method of methods) {
    addTypeShortNames(names, method.returnType);

    for (const parameter of method.parameters) {
      addTypeShortNames(names, parameter.type);
    }
  }

  return names;
}

const BUILTIN_TYPES = new Set([
  "array",
  "bool",
  "callable",
  "false",
  "float",
  "int",
  "iterable",
  "mixed",
  "never",
  "null",
  "object",
  "parent",
  "self",
  "static",
  "string",
  "true",
  "void",
]);

function addTypeShortNames(names: Set<string>, type: string | null): void {
  if (!type) {
    return;
  }

  for (const component of type.split(/[|&]/)) {
    const shortName = importableShortName(component);

    if (shortName) {
      names.add(shortName);
    }
  }
}

/**
 * The importable short name of a single type component, or `null` when it needs
 * no `use`: a built-in / pseudo type, or a fully-qualified name (a leading `\`
 * means the type is already absolute and self-resolving). A leading `?`
 * nullable marker is stripped. A namespaced-but-not-absolute component
 * (`Models\Foo`) keeps its first segment as the importable short name.
 */
function importableShortName(component: string): string | null {
  const trimmed = component.trim().replace(/^\?/, "");

  if (!trimmed || trimmed.startsWith("\\")) {
    return null;
  }

  if (BUILTIN_TYPES.has(trimmed.toLowerCase())) {
    return null;
  }

  const firstSegment = trimmed.split("\\")[0] ?? "";

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(firstSegment)) {
    return null;
  }

  return firstSegment;
}

/**
 * Maps the short name each top-level `use` import is referenced by (its alias,
 * or the last FQN segment) to the VERBATIM `use ...;` statement, so a lifted
 * signature type can be matched to the exact import (alias preserved) to copy.
 * Only single, non-grouped, non-comma-list class imports are indexed; grouped /
 * comma-list / `use function` / `use const` forms are skipped (conservative -
 * they are rare in signature-type position and copying them verbatim risks
 * dragging in unrelated symbols).
 */
function sourceUseImports(source: string): Map<string, string> {
  const masked = maskStringsAndComments(source);
  const limit = firstTypeBodyOffset(masked);
  const imports = new Map<string, string>();

  for (const match of masked.matchAll(/(^|\n)[ \t]*use\b([^;{]*);/g)) {
    const start = (match.index ?? 0) + match[1].length;

    if (start >= limit || braceDepthAt(masked, start) !== 0) {
      continue;
    }

    const body = (match[2] ?? "").trim();
    const indexed = indexSingleClassImport(body);

    if (indexed) {
      imports.set(indexed.shortName, indexed.statement);
    }
  }

  return imports;
}

/**
 * Indexes a single non-grouped, non-comma-list class import body (the text
 * between `use` and `;`) as `{ shortName, statement }`, or `null` for grouped
 * (`A\{B, C}`), comma-list (`A, B`), `use function` / `use const`, or malformed
 * forms. The short name is the alias when present, else the last FQN segment.
 */
function indexSingleClassImport(
  body: string,
): { shortName: string; statement: string } | null {
  if (
    !body ||
    body.includes("{") ||
    body.includes(",") ||
    /^(?:function|const)\b/.test(body)
  ) {
    return null;
  }

  const aliasMatch = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(body);
  const fqn = (aliasMatch?.[1] ?? body).trim().replace(/^\\+/, "");

  if (!fqn) {
    return null;
  }

  const lastSegment = fqn.split("\\").pop() ?? fqn;
  const shortName = aliasMatch?.[2]?.trim() || lastSegment;

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(shortName)) {
    return null;
  }

  return { shortName, statement: `use ${body};` };
}

/**
 * Offset just past the opening `{` of the first top-level type body, bounding
 * `use`-statement parsing so a trait `use` inside a class body is never indexed
 * as an import. Returns the source length when no type declaration is found.
 */
function firstTypeBodyOffset(masked: string): number {
  const match =
    /(?<![:\\$>A-Za-z0-9_])(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/.exec(
      masked,
    );

  if (!match) {
    return masked.length;
  }

  const bodyStart = masked.indexOf("{", match.index + match[0].length);

  return bodyStart < 0 ? masked.length : bodyStart + 1;
}

function braceDepthAt(text: string, offset: number): number {
  let depth = 0;

  for (let index = 0; index < offset && index < text.length; index += 1) {
    const character = text[index];

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth;
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
