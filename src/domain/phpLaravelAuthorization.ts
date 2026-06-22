import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArrayArgumentElementContextAt,
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
  type PhpStringArrayArgumentElementContext,
} from "./phpStringArgumentContext";

const gateStaticAbilityCallMethods = {
  allows: "Gate::allows",
  any: "Gate::any",
  authorize: "Gate::authorize",
  check: "Gate::check",
  denies: "Gate::denies",
  has: "Gate::has",
  inspect: "Gate::inspect",
  none: "Gate::none",
  raw: "Gate::raw",
} as const;
const userAbilityCallMethods = {
  can: "can",
  canany: "canAny",
  cannot: "cannot",
} as const;
const policyAuthorizeCallMethods = {
  authorize: "authorize",
  authorizeforuser: "authorizeForUser",
} as const;

type GateStaticAbilityMethodName = keyof typeof gateStaticAbilityCallMethods;
type UserAbilityMethodName = keyof typeof userAbilityCallMethods;
type PolicyAuthorizeMethodName = keyof typeof policyAuthorizeCallMethods;

const arrayAbilityCalls = new Set<PhpLaravelGateAbilityReferenceCall>([
  "Gate::any",
  "Gate::none",
  "canAny",
]);

export type PhpLaravelGateAbilityReferenceCall =
  | (typeof gateStaticAbilityCallMethods)[GateStaticAbilityMethodName]
  | (typeof userAbilityCallMethods)[UserAbilityMethodName]
  | (typeof policyAuthorizeCallMethods)[PolicyAuthorizeMethodName];

export interface PhpLaravelGateAbilityReferenceContext {
  ability: string;
  call: PhpLaravelGateAbilityReferenceCall;
  position: EditorPosition;
  prefix: string;
}

export interface PhpLaravelGateAbilityDefinition {
  name: string;
  position: EditorPosition;
}

interface PhpStringLiteral {
  closed: boolean;
  quote: "'" | "\"";
  quoteEnd: number;
  quoteStart: number;
  value: string;
}

export function phpLaravelGateAbilityReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelGateAbilityReferenceContext | null {
  const arrayArgument = phpStringArrayArgumentElementContextAt(source, position);

  if (arrayArgument) {
    return arrayAbilityReferenceContext(source, arrayArgument);
  }

  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const call = laravelGateAbilityReferenceCallAt(source, argument);
  const ability = argument.closed ? argument.value : argument.prefix;

  if (
    !call ||
    arrayAbilityCalls.has(call) ||
    !isAbilityArgument(argument, call) ||
    !isUsableLaravelGateAbilityName(argument.prefix) ||
    !isUsableLaravelGateAbilityName(ability)
  ) {
    return null;
  }

  return {
    ability,
    call,
    position: argument.position,
    prefix: argument.prefix,
  };
}

export function phpLaravelGateAbilityDefinitions(
  source: string,
): PhpLaravelGateAbilityDefinition[] {
  const definitions: PhpLaravelGateAbilityDefinition[] = [];
  const definePattern = /\bGate\s*::\s*define\s*\(/g;

  for (const match of source.matchAll(definePattern)) {
    const callStart = match.index ?? 0;

    if (!isPhpCodeOffset(source, callStart)) {
      continue;
    }

    const openParen = callStart + match[0].lastIndexOf("(");
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    const literal = firstAbilityLiteralArgumentAtOpenParen(
      source,
      openParen,
      closeParen,
    );

    if (!literal || !isUsableLaravelGateAbilityName(literal.value)) {
      continue;
    }

    definitions.push({
      name: literal.value,
      position: editorPositionAtOffset(source, literal.quoteStart + 1),
    });
  }

  return definitions;
}

export function isUsableLaravelGateAbilityName(ability: string): boolean {
  return (
    ability.length > 0 &&
    /^[A-Za-z0-9_.:-]+$/.test(ability) &&
    !ability.startsWith(".") &&
    !ability.endsWith(".") &&
    !ability.includes("..")
  );
}

function arrayAbilityReferenceContext(
  source: string,
  argument: PhpStringArrayArgumentElementContext,
): PhpLaravelGateAbilityReferenceContext | null {
  const call = laravelGateAbilityReferenceCallAt(source, argument);
  const ability = argument.closed ? argument.value : argument.prefix;

  if (
    !call ||
    !arrayAbilityCalls.has(call) ||
    argument.argumentIndex !== 0 ||
    (argument.argumentName !== null &&
      argument.argumentName.toLowerCase() !== "abilities") ||
    !isUsableLaravelGateAbilityName(argument.prefix) ||
    !isUsableLaravelGateAbilityName(ability)
  ) {
    return null;
  }

  return {
    ability,
    call,
    position: argument.position,
    prefix: argument.prefix,
  };
}

function laravelGateAbilityReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelGateAbilityReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch = /\bGate\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const staticMethod = staticMatch?.[1]?.toLowerCase() ?? null;

  if (staticMethod && isGateStaticAbilityMethodName(staticMethod)) {
    return gateStaticAbilityCallMethods[staticMethod];
  }

  const memberMatch = /(?:->|\?->)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const memberMethod = memberMatch?.[1]?.toLowerCase() ?? null;

  if (!memberMethod) {
    return null;
  }

  if (
    isGateStaticAbilityMethodName(memberMethod) &&
    isGateFacadeChainBefore(beforeCall, memberMatch?.index ?? beforeCall.length)
  ) {
    return gateStaticAbilityCallMethods[memberMethod];
  }

  if (isUserAbilityMethodName(memberMethod)) {
    return userAbilityCallMethods[memberMethod];
  }

  if (isPolicyAuthorizeMethodName(memberMethod)) {
    return policyAuthorizeCallMethods[memberMethod];
  }

  return null;
}

function isGateFacadeChainBefore(
  beforeCall: string,
  memberAccessOffset: number,
): boolean {
  let depth = 0;
  let chainStart = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = memberAccessOffset - 1; index >= 0; index -= 1) {
    const character = beforeCall[index] ?? "";

    if (quote) {
      if (character === quote && beforeCall[index - 1] !== "\\") {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth += 1;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      if (depth === 0) {
        chainStart = index + 1;
        break;
      }

      depth -= 1;
      continue;
    }

    if (depth > 0) {
      continue;
    }

    if (character === ";" || character === ",") {
      chainStart = index + 1;
      break;
    }
  }

  const chain = beforeCall.slice(chainStart, memberAccessOffset);
  const chainHead = /(\\?[A-Za-z_][A-Za-z0-9_\\]*)\s*::/.exec(chain);

  return chainHead?.[1]?.replace(/^\\+/, "") === "Gate";
}

function isGateStaticAbilityMethodName(
  methodName: string,
): methodName is GateStaticAbilityMethodName {
  return methodName in gateStaticAbilityCallMethods;
}

function isUserAbilityMethodName(
  methodName: string,
): methodName is UserAbilityMethodName {
  return methodName in userAbilityCallMethods;
}

function isPolicyAuthorizeMethodName(
  methodName: string,
): methodName is PolicyAuthorizeMethodName {
  return methodName in policyAuthorizeCallMethods;
}

function isAbilityArgument(
  argument: PhpStringArgumentContext,
  call: PhpLaravelGateAbilityReferenceCall,
): boolean {
  const argumentName = argument.argumentName?.toLowerCase();

  if (argumentName) {
    return argumentName === "ability";
  }

  if (call === "authorizeForUser") {
    return argument.argumentIndex === 1;
  }

  return argument.argumentIndex === 0;
}

function firstAbilityLiteralArgumentAtOpenParen(
  source: string,
  openParen: number,
  closeParen: number,
): PhpStringLiteral | null {
  const argumentStart = skipWhitespace(source, openParen + 1);
  const namedValueStart = namedArgumentValueStartAt(source, argumentStart, [
    "ability",
  ]);
  const hasUnsupportedNamedArgument =
    namedValueStart === null &&
    /^[A-Za-z_][A-Za-z0-9_]*\s*:(?!:)/.test(
      source.slice(argumentStart, closeParen),
    );

  if (hasUnsupportedNamedArgument) {
    return null;
  }

  const literal = stringLiteralStartingAt(
    source,
    namedValueStart ?? argumentStart,
  );

  if (!literal?.closed) {
    return null;
  }

  if (literal.quote === "\"" && hasPhpVariableInterpolation(literal.value)) {
    return null;
  }

  const afterLiteral = source.slice(literal.quoteEnd + 1, closeParen);

  return /^\s*(?:,|$)/.test(afterLiteral) ? literal : null;
}

function namedArgumentValueStartAt(
  source: string,
  argumentStart: number,
  allowedNames: readonly string[],
): number | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/.exec(
    source.slice(argumentStart, argumentStart + 96),
  );

  if (!match?.[0] || !match[1]) {
    return null;
  }

  const normalizedName = match[1].toLowerCase();

  if (!allowedNames.some((name) => name.toLowerCase() === normalizedName)) {
    return null;
  }

  return argumentStart + match[0].length;
}

function stringLiteralStartingAt(
  source: string,
  quoteStart: number,
): PhpStringLiteral | null {
  const quote = source[quoteStart];

  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  for (let index = quoteStart + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character !== quote) {
      continue;
    }

    return {
      closed: true,
      quote,
      quoteEnd: index,
      quoteStart,
      value: source.slice(quoteStart + 1, index),
    };
  }

  return {
    closed: false,
    quote,
    quoteEnd: source.length,
    quoteStart,
    value: source.slice(quoteStart + 1),
  };
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: "(" | "[" | "{",
  close: ")" | "]" | "}",
): number | null {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function isPhpCodeOffset(source: string, offset: number): boolean {
  let quote: "'" | "\"" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }

      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }

      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#" && next !== "[") {
      lineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
    }
  }

  return !quote && !lineComment && !blockComment;
}

function hasPhpVariableInterpolation(value: string): boolean {
  return /(^|[^\\])\$(?:[A-Za-z_]|[{])/.test(value);
}

function skipWhitespace(source: string, startOffset: number): number {
  let index = startOffset;

  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
