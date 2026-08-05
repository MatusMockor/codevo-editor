import ts from "typescript";

export interface FrontendTauriCommandReference {
  readonly command: string;
  readonly line: number;
  readonly source: "invoke-literal" | "named-command-map";
}

// Every currently registered application command is multi-word snake_case.
// Requiring a separator keeps map metadata such as `kind: "tsserver"` out.
const COMMAND_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const NAMED_COMMAND_MAP = /(?:^COMMANDS$|_COMMANDS$)/;

/**
 * Extracts the identifiers registered in the application's
 * `tauri::generate_handler![...]` invocation.
 *
 * This intentionally models the current, flat handler list. It is not a Rust
 * parser and will reject macro entries that are not plain identifiers (or
 * module-qualified identifiers) optionally preceded by Rust `cfg` attributes,
 * so an unsupported registration shape fails loudly instead of silently
 * weakening the architecture test.
 */
export function parseRegisteredTauriCommands(rustSource: string): string[] {
  const macroStart = rustSource.indexOf("tauri::generate_handler![");
  if (macroStart < 0) {
    throw new Error("Missing tauri::generate_handler![...] registration.");
  }

  const listStart = rustSource.indexOf("[", macroStart);
  const listEnd = findMatchingBracket(rustSource, listStart);
  const entries = splitGenerateHandlerEntries(rustSource.slice(listStart + 1, listEnd));

  return entries.map((entry) => {
    const handler = stripCfgAttributes(entry);
    if (!/^(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*$/.test(handler)) {
      throw new Error(`Unsupported generate_handler entry: ${entry}`);
    }
    const segments = handler.split("::");
    return segments[segments.length - 1];
  });
}

function splitGenerateHandlerEntries(source: string): string[] {
  const entries: string[] = [];
  let entryStart = 0;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses -= 1;
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets -= 1;
    } else if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces -= 1;
    } else if (character === "," && parentheses === 0 && brackets === 0 && braces === 0) {
      const entry = source.slice(entryStart, index).trim();
      if (!entry) {
        throw new Error("Malformed tauri::generate_handler![...] registration.");
      }
      entries.push(entry);
      entryStart = index + 1;
    }

    if (parentheses < 0 || brackets < 0 || braces < 0) {
      throw new Error("Malformed tauri::generate_handler![...] registration.");
    }
  }

  if (quote !== null || parentheses !== 0 || brackets !== 0 || braces !== 0) {
    throw new Error("Malformed tauri::generate_handler![...] registration.");
  }
  const finalEntry = source.slice(entryStart).trim();
  if (finalEntry) {
    entries.push(finalEntry);
  } else if (entries.length === 0) {
    throw new Error("Malformed tauri::generate_handler![...] registration.");
  }
  return entries;
}

function stripCfgAttributes(entry: string): string {
  let remainder = entry.trim();
  while (remainder.startsWith("#[")) {
    const attributeEnd = findMatchingBracket(remainder, 1);
    const attribute = remainder.slice(2, attributeEnd).trim();
    if (!isCfgAttribute(attribute)) {
      throw new Error(`Unsupported generate_handler entry: ${entry}`);
    }
    remainder = remainder.slice(attributeEnd + 1).trim();
  }
  return remainder;
}

function isCfgAttribute(attribute: string): boolean {
  const cursor: CfgCursor = { source: attribute, index: 0 };
  if (readCfgIdentifier(cursor) !== "cfg" || !consumeCfgCharacter(cursor, "(")) return false;
  if (!parseCfgPredicate(cursor) || !consumeCfgCharacter(cursor, ")")) return false;
  skipCfgWhitespace(cursor);
  return cursor.index === cursor.source.length;
}

interface CfgCursor {
  readonly source: string;
  index: number;
}

function parseCfgPredicate(cursor: CfgCursor): boolean {
  const name = readCfgIdentifier(cursor);
  if (name === null) return false;
  skipCfgWhitespace(cursor);

  if (cursor.source[cursor.index] === "=") {
    cursor.index += 1;
    skipCfgWhitespace(cursor);
    return parseCfgString(cursor);
  }
  if (cursor.source[cursor.index] !== "(") return true;
  if (name !== "all" && name !== "any" && name !== "not") return false;
  cursor.index += 1;
  skipCfgWhitespace(cursor);

  let count = 0;
  while (cursor.source[cursor.index] !== ")") {
    if (!parseCfgPredicate(cursor)) return false;
    count += 1;
    skipCfgWhitespace(cursor);
    if (cursor.source[cursor.index] === ")") break;
    if (cursor.source[cursor.index] !== ",") return false;
    cursor.index += 1;
    skipCfgWhitespace(cursor);
    if (cursor.source[cursor.index] === ")") break;
  }
  if (!consumeCfgCharacter(cursor, ")")) return false;
  return name !== "not" || count === 1;
}

function parseCfgString(cursor: CfgCursor): boolean {
  if (cursor.source[cursor.index] !== '"') return false;
  cursor.index += 1;
  while (cursor.index < cursor.source.length) {
    const character = cursor.source[cursor.index];
    cursor.index += 1;
    if (character === '"') return true;
    if (character === "\\") {
      if (cursor.index >= cursor.source.length) return false;
      cursor.index += 1;
    }
  }
  return false;
}

function readCfgIdentifier(cursor: CfgCursor): string | null {
  skipCfgWhitespace(cursor);
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(cursor.source.slice(cursor.index));
  if (!match) return null;
  cursor.index += match[0].length;
  return match[0];
}

function consumeCfgCharacter(cursor: CfgCursor, expected: string): boolean {
  skipCfgWhitespace(cursor);
  if (cursor.source[cursor.index] !== expected) return false;
  cursor.index += 1;
  return true;
}

function skipCfgWhitespace(cursor: CfgCursor): void {
  while (/\s/.test(cursor.source[cursor.index] ?? "")) cursor.index += 1;
}

/**
 * Finds only statically provable frontend IPC command references:
 *
 * - string literals passed to `invoke(...)` or an `invoke*Command(...)` port;
 * - string values inside constants explicitly named `COMMANDS`/`*_COMMANDS`.
 *
 * Dynamic command values and differently named maps are intentionally outside
 * this gate. Keeping the boundary explicit prevents unrelated snake_case UI,
 * event, status, and language-server command strings from becoming false IPC
 * positives.
 */
export function parseFrontendTauriCommandReferences(
  sourceText: string,
  fileName: string,
): FrontendTauriCommandReference[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: FrontendTauriCommandReference[] = [];

  const record = (
    literal: ts.StringLiteralLike,
    source: FrontendTauriCommandReference["source"],
  ) => {
    if (!COMMAND_NAME.test(literal.text)) return;
    references.push({
      command: literal.text,
      line: sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile)).line + 1,
      source,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const commandArgument = invokeCommandArgument(node);
      if (commandArgument && ts.isStringLiteralLike(commandArgument)) {
        record(commandArgument, "invoke-literal");
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      NAMED_COMMAND_MAP.test(node.name.text) &&
      node.initializer
    ) {
      collectStringLiterals(node.initializer, (literal) => record(literal, "named-command-map"));
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

function invokeCommandArgument(call: ts.CallExpression): ts.Expression | undefined {
  const expression = call.expression;
  const name = ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : null;
  if (name === "invoke" || (name !== null && /^invoke[A-Za-z]*Command$/.test(name))) {
    return call.arguments[0];
  }
  if (name !== null && /^invoke[A-Za-z]*Ipc$/.test(name)) {
    return call.arguments[1];
  }
  return undefined;
}

function collectStringLiterals(
  node: ts.Node,
  collect: (literal: ts.StringLiteralLike) => void,
): void {
  if (ts.isStringLiteralLike(node)) {
    collect(node);
    return;
  }
  ts.forEachChild(node, (child) => collectStringLiterals(child, collect));
}

function findMatchingBracket(source: string, openingBracket: number): number {
  let depth = 0;
  for (let index = openingBracket; index < source.length; index += 1) {
    if (source[index] === "[") depth += 1;
    if (source[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Unclosed tauri::generate_handler![...] registration.");
}
