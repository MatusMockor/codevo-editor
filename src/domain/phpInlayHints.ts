import type { PhpMethodParameter } from "./phpMethodCompletions";
import { phpNormalizeReceiverExpression } from "./phpReceiverExpressions";

/**
 * A 0-based inclusive line span describing the editor viewport that inlay hints
 * are requested for. Mirrors the LSP `Range` the Monaco provider hands down,
 * reduced to whole lines because a call's name hints are anchored to the line
 * its opening parenthesis sits on.
 */
export interface PhpInlayLineRange {
  endLine: number;
  startLine: number;
}

/**
 * One positional argument of a PHP call expression located inside the requested
 * range. Positions are 0-based (line / character) so they map cleanly onto LSP /
 * Monaco coordinates. `isNamed` flags PHP 8 named arguments (`count: 5`) which
 * already carry the parameter name and must never receive a hint.
 */
export interface PhpCallArgumentInlay {
  character: number;
  isLiteral: boolean;
  isNamed: boolean;
  line: number;
  variableName: string | null;
}

/**
 * A call expression whose opening parenthesis falls inside the requested range,
 * paired with the receiver / class context needed to resolve its target
 * signature (reusing the same resolution the signature-help feature performs).
 */
export interface PhpCallArgumentInlayContext {
  arguments: PhpCallArgumentInlay[];
  className: string | null;
  methodName: string;
  receiverExpression: string | null;
  variableName: string | null;
}

/**
 * A resolved parameter-name hint anchored before a positional argument:
 * `foo(5)` -> `foo(count: 5)` renders `name` ("count") at (`line`, `character`).
 */
export interface PhpParameterNameInlayHint {
  character: number;
  line: number;
  name: string;
}

const PHP_CALL_KEYWORDS = new Set([
  "array",
  "catch",
  "die",
  "do",
  "echo",
  "else",
  "elseif",
  "empty",
  "endfor",
  "endforeach",
  "endif",
  "endswitch",
  "endwhile",
  "eval",
  "exit",
  "for",
  "foreach",
  "function",
  "if",
  "include",
  "include_once",
  "isset",
  "list",
  "match",
  "print",
  "require",
  "require_once",
  "return",
  "switch",
  "unset",
  "while",
]);

const PHP_IDENTIFIER_CALL_PATTERN =
  /(?:(\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

const PHP_NAMED_ARGUMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\s*:(?!:)/;
const PHP_LITERAL_ARGUMENT_PATTERN =
  /^(?:[+-]?(?:0[xXbBoO])?[0-9][0-9_]*(?:\.[0-9_]+)?|true|false|null|'|")/;
const PHP_VARIABLE_ARGUMENT_PATTERN = /^(\$[A-Za-z_][A-Za-z0-9_]*)\s*$/;

/**
 * Finds every PHP call expression whose opening parenthesis sits on a line
 * inside `range` and returns the positional-argument metadata needed to attach
 * parameter-name hints. Strings and comments are masked (newlines preserved) so
 * a `(` inside a literal is never mistaken for a call. Receiver expressions and
 * class names are captured so the caller can resolve the target signature with
 * the existing signature-resolution flow; nothing here reads files or performs
 * I/O, keeping the function pure and viewport-scoped.
 */
export function phpCallArgumentInlayContexts(
  source: string,
  range: PhpInlayLineRange,
): PhpCallArgumentInlayContext[] {
  const masked = maskPreservingLayout(source);
  const lineStarts = lineStartOffsets(masked);
  const contexts: PhpCallArgumentInlayContext[] = [];

  for (const match of masked.matchAll(PHP_IDENTIFIER_CALL_PATTERN)) {
    const className = match[1] ? match[1].replace(/^\\+/, "") : null;
    const methodName = match[2];

    if (!methodName) {
      continue;
    }

    const openParenOffset = (match.index ?? 0) + match[0].length - 1;
    const openParenLine = lineNumberAtOffset(lineStarts, openParenOffset);

    if (openParenLine < range.startLine || openParenLine > range.endLine) {
      continue;
    }

    const receiverExpression = callReceiverExpressionBefore(
      masked,
      match.index ?? 0,
      className,
    );

    // The keyword filter only applies to bare calls (`die("x")`); a method named
    // like a keyword (`$obj->list(...)`, `Factory::list(...)`) is still a call.
    if (
      !className &&
      !receiverExpression &&
      PHP_CALL_KEYWORDS.has(methodName.toLowerCase())
    ) {
      continue;
    }
    const argumentsInlay = positionalArgumentInlays(
      source,
      masked,
      lineStarts,
      openParenOffset,
    );

    if (argumentsInlay.length === 0) {
      continue;
    }

    contexts.push({
      arguments: argumentsInlay,
      className,
      methodName,
      receiverExpression,
      variableName: receiverExpression
        ? simpleVariableName(receiverExpression)
        : null,
    });
  }

  return contexts;
}

/**
 * Maps a resolved parameter list onto a call's positional arguments and returns
 * the name hints to render. Conservative by design: already-named PHP 8
 * arguments are skipped, a variable argument whose name equals the parameter is
 * skipped (the name is already on screen), and arguments beyond the declared
 * parameters get no hint unless the final parameter is variadic (its name then
 * repeats). When no parameters resolve the list is empty, so an unresolved
 * target yields no hints rather than a wrong one.
 */
export function phpParameterNameInlayHints(
  call: PhpCallArgumentInlayContext,
  parameters: PhpMethodParameter[],
): PhpParameterNameInlayHint[] {
  if (parameters.length === 0) {
    return [];
  }

  const lastParameter = parameters[parameters.length - 1];
  const variadicName = isVariadicParameter(lastParameter)
    ? parameterDisplayName(lastParameter)
    : null;
  const hints: PhpParameterNameInlayHint[] = [];

  call.arguments.forEach((argument, index) => {
    if (argument.isNamed) {
      return;
    }

    const parameter = parameters[index] ?? null;
    const name = parameter
      ? parameterDisplayName(parameter)
      : index >= parameters.length
        ? variadicName
        : null;

    if (!name) {
      return;
    }

    if (argument.variableName && variableMatchesParameter(argument, name)) {
      return;
    }

    hints.push({ character: argument.character, line: argument.line, name });
  });

  return hints;
}

function positionalArgumentInlays(
  source: string,
  masked: string,
  lineStarts: number[],
  openParenOffset: number,
): PhpCallArgumentInlay[] {
  const argumentStarts = topLevelArgumentStartOffsets(
    source,
    masked,
    openParenOffset,
  );

  return argumentStarts.map((argumentOffset) => {
    const position = positionAtOffset(lineStarts, argumentOffset);
    const argumentText = source.slice(argumentOffset, argumentOffset + 64);
    const variableMatch = PHP_VARIABLE_ARGUMENT_PATTERN.exec(
      argumentText.split(/[,)]/)[0]?.trim() ?? "",
    );

    return {
      character: position.character,
      isLiteral: PHP_LITERAL_ARGUMENT_PATTERN.test(argumentText),
      isNamed: PHP_NAMED_ARGUMENT_PATTERN.test(argumentText),
      line: position.line,
      variableName: variableMatch?.[1] ?? null,
    };
  });
}

/**
 * Returns the 0-based source offset where each top-level argument expression
 * begins. Leading whitespace is skipped so the hint anchors on the argument
 * itself; nested parens / brackets / braces are tracked so a comma inside a
 * nested call does not split the outer argument. Returns an empty list for an
 * empty argument list (`run()`).
 */
function topLevelArgumentStartOffsets(
  source: string,
  masked: string,
  openParenOffset: number,
): number[] {
  const starts: number[] = [];
  let depth = 0;
  let sawContent = false;
  let expectArgument = true;

  for (let index = openParenOffset; index < masked.length; index += 1) {
    const structural = masked[index] ?? "";

    if (structural === "(" || structural === "[" || structural === "{") {
      if (depth === 1 && expectArgument) {
        starts.push(index);
        expectArgument = false;
        sawContent = true;
      }

      depth += 1;
      continue;
    }

    if (structural === ")" || structural === "]" || structural === "}") {
      depth -= 1;

      if (depth === 0) {
        break;
      }

      continue;
    }

    if (depth !== 1) {
      continue;
    }

    if (structural === ",") {
      expectArgument = true;
      continue;
    }

    // Use the original source for content detection: a masked string literal is
    // whitespace in `masked` but a real (non-whitespace) argument in `source`.
    if (isWhitespace(source[index] ?? "")) {
      continue;
    }

    sawContent = true;

    if (expectArgument) {
      starts.push(index);
      expectArgument = false;
    }
  }

  return sawContent ? starts : [];
}

function callReceiverExpressionBefore(
  masked: string,
  callStartOffset: number,
  className: string | null,
): string | null {
  if (className) {
    return null;
  }

  const before = masked.slice(0, callStartOffset);
  const match =
    /((?:\$[A-Za-z_][A-Za-z0-9_]*|\$this)(?:\s*\??->\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?)*)\s*\??->\s*$/.exec(
      before,
    );

  if (!match?.[1]) {
    return null;
  }

  return phpNormalizeReceiverExpression(match[1]);
}

function simpleVariableName(receiverExpression: string): string | null {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*$/.exec(receiverExpression.trim());

  return match ? match[0] : null;
}

function parameterDisplayName(parameter: PhpMethodParameter): string {
  return parameter.name.replace(/^\.\.\./, "").replace(/^&/, "").replace(/^\$/, "");
}

function isVariadicParameter(parameter: PhpMethodParameter): boolean {
  return parameter.name.startsWith("...") || /\.\.\.\s*\$/.test(parameter.raw);
}

function variableMatchesParameter(
  argument: PhpCallArgumentInlay,
  parameterName: string,
): boolean {
  if (!argument.variableName) {
    return false;
  }

  return (
    argument.variableName.replace(/^\$/, "").toLowerCase() ===
    parameterName.toLowerCase()
  );
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

/**
 * Masks string and comment contents with spaces while preserving every offset
 * and newline, so call scanning and offset→position mapping stay aligned with
 * the original source even across multi-line strings or block comments.
 */
function maskPreservingLayout(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";
      inLineComment = character !== "\n" && inLineComment;
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        inBlockComment = false;
        continue;
      }

      output += character === "\n" ? "\n" : " ";
      continue;
    }

    if (quote) {
      if (character === "\\" && quote !== "`") {
        output += "  ";
        index += 1;
        continue;
      }

      output += character === "\n" ? "\n" : " ";

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

    if (character === "#" && source[index - 1] !== "$") {
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

function lineStartOffsets(source: string): number[] {
  const starts = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

function lineNumberAtOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);

    if (lineStarts[mid] <= offset) {
      low = mid;
      continue;
    }

    high = mid - 1;
  }

  return low;
}

function positionAtOffset(
  lineStarts: number[],
  offset: number,
): { character: number; line: number } {
  const line = lineNumberAtOffset(lineStarts, offset);

  return { character: offset - lineStarts[line], line };
}
