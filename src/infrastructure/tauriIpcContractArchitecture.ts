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
 * module-qualified identifiers), so an unsupported registration shape fails
 * loudly instead of silently weakening the architecture test.
 */
export function parseRegisteredTauriCommands(rustSource: string): string[] {
  const macroStart = rustSource.indexOf("tauri::generate_handler![");
  if (macroStart < 0) {
    throw new Error("Missing tauri::generate_handler![...] registration.");
  }

  const listStart = rustSource.indexOf("[", macroStart);
  const listEnd = findMatchingBracket(rustSource, listStart);
  const entries = rustSource
    .slice(listStart + 1, listEnd)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.map((entry) => {
    if (!/^(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*$/.test(entry)) {
      throw new Error(`Unsupported generate_handler entry: ${entry}`);
    }
    const segments = entry.split("::");
    return segments[segments.length - 1];
  });
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
