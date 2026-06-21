import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelDatabaseConnectionConfigPrefix = "database.connections.";
const databaseConnectionStaticCallMethods = {
  connection: "DB::connection",
  disconnect: "DB::disconnect",
  purge: "DB::purge",
  reconnect: "DB::reconnect",
} as const;
const databaseSchemaStaticCallMethods = {
  connection: "Schema::connection",
} as const;
const databaseHelperCallMethods = {
  connection: "db()->connection",
} as const;
const databaseModelPropertyCalls = {
  connection: "Model::$connection",
} as const;

type DatabaseConnectionStaticMethodName =
  keyof typeof databaseConnectionStaticCallMethods;
type DatabaseSchemaStaticMethodName =
  keyof typeof databaseSchemaStaticCallMethods;
type DatabaseHelperMethodName = keyof typeof databaseHelperCallMethods;
type DatabaseModelPropertyName = keyof typeof databaseModelPropertyCalls;

export type PhpLaravelDatabaseConnectionReferenceCall =
  | (typeof databaseConnectionStaticCallMethods)[
      DatabaseConnectionStaticMethodName
    ]
  | (typeof databaseSchemaStaticCallMethods)[DatabaseSchemaStaticMethodName]
  | (typeof databaseHelperCallMethods)[DatabaseHelperMethodName]
  | (typeof databaseModelPropertyCalls)[DatabaseModelPropertyName];

export interface PhpLaravelDatabaseConnectionReferenceContext {
  call: PhpLaravelDatabaseConnectionReferenceCall;
  connectionName: string;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelDatabaseConnectionReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelDatabaseConnectionReferenceContext | null {
  const modelProperty = phpLaravelModelConnectionPropertyContextAt(
    source,
    position,
  );

  if (modelProperty) {
    return modelProperty;
  }

  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const connectionName = argument.closed ? argument.value : argument.prefix;

  if (
    !isDatabaseConnectionArgument(argument) ||
    !isUsableLaravelDatabaseConnectionName(argument.prefix) ||
    !isUsableLaravelDatabaseConnectionName(connectionName)
  ) {
    return null;
  }

  const call = laravelDatabaseConnectionReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  return {
    call,
    connectionName,
    position: argument.position,
    prefix: argument.prefix,
  };
}

function phpLaravelModelConnectionPropertyContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelDatabaseConnectionReferenceContext | null {
  const literal = phpStringLiteralContextAt(source, position);

  if (!literal) {
    return null;
  }

  const connectionName = literal.closed ? literal.value : literal.prefix;

  if (
    !isUsableLaravelDatabaseConnectionName(literal.prefix) ||
    !isUsableLaravelDatabaseConnectionName(connectionName) ||
    !isEloquentModelConnectionPropertyAt(source, literal.quoteStart)
  ) {
    return null;
  }

  return {
    call: databaseModelPropertyCalls.connection,
    connectionName,
    position: literal.position,
    prefix: literal.prefix,
  };
}

export function phpLaravelDatabaseConnectionConfigKey(
  connectionName: string,
): string | null {
  return isUsableLaravelDatabaseConnectionName(connectionName)
    ? `${laravelDatabaseConnectionConfigPrefix}${connectionName}`
    : null;
}

export function phpLaravelDatabaseConnectionNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelDatabaseConnectionConfigPrefix)) {
    return null;
  }

  const connectionName = configKey.slice(
    laravelDatabaseConnectionConfigPrefix.length,
  );

  return connectionName.includes(".") ||
    !isUsableLaravelDatabaseConnectionName(connectionName)
    ? null
    : connectionName;
}

export function phpLaravelDatabaseConnectionCompletionInsertText(
  connectionName: string,
): string {
  return connectionName;
}

export function isUsableLaravelDatabaseConnectionName(
  connectionName: string,
): boolean {
  return (
    connectionName.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(connectionName) &&
    !connectionName.startsWith(".") &&
    !connectionName.endsWith(".") &&
    !connectionName.includes("..")
  );
}

function laravelDatabaseConnectionReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelDatabaseConnectionReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch =
    /\b(DB|Schema)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeCall);
  const staticFacade = staticMatch?.[1] ?? null;
  const staticMethod = staticMatch?.[2]?.toLowerCase() ?? null;

  if (staticFacade === "DB" && staticMethod) {
    return isDatabaseConnectionStaticMethodName(staticMethod)
      ? databaseConnectionStaticCallMethods[staticMethod]
      : null;
  }

  if (staticFacade === "Schema" && staticMethod) {
    return isDatabaseSchemaStaticMethodName(staticMethod)
      ? databaseSchemaStaticCallMethods[staticMethod]
      : null;
  }

  const helperMatch =
    /\bdb\s*\(\s*\)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeCall);
  const helperMethod = helperMatch?.[1]?.toLowerCase() ?? null;

  if (helperMethod && isDatabaseHelperMethodName(helperMethod)) {
    return databaseHelperCallMethods[helperMethod];
  }

  return null;
}

function isDatabaseConnectionStaticMethodName(
  methodName: string,
): methodName is DatabaseConnectionStaticMethodName {
  return methodName in databaseConnectionStaticCallMethods;
}

function isDatabaseSchemaStaticMethodName(
  methodName: string,
): methodName is DatabaseSchemaStaticMethodName {
  return methodName in databaseSchemaStaticCallMethods;
}

function isDatabaseHelperMethodName(
  methodName: string,
): methodName is DatabaseHelperMethodName {
  return methodName in databaseHelperCallMethods;
}

function isDatabaseConnectionArgument(
  argument: PhpStringArgumentContext,
): boolean {
  if (argument.argumentIndex === 0) {
    return true;
  }

  const argumentName = argument.argumentName?.toLowerCase();

  return argumentName === "connection" || argumentName === "name";
}

interface PhpStringLiteralContext {
  closed: boolean;
  position: EditorPosition;
  prefix: string;
  quoteStart: number;
  value: string;
}

function isEloquentModelConnectionPropertyAt(
  source: string,
  quoteStart: number,
): boolean {
  if (!isConnectionPropertyDeclarationBeforeOffset(source, quoteStart)) {
    return false;
  }

  const classMatch = nearestClassDeclarationBeforeOffset(source, quoteStart);
  const parentClass = classMatch?.[1] ?? null;

  return Boolean(parentClass && isEloquentModelParentClass(parentClass));
}

function isConnectionPropertyDeclarationBeforeOffset(
  source: string,
  quoteStart: number,
): boolean {
  const beforeLiteral = source.slice(0, quoteStart);
  const statementStart = Math.max(
    beforeLiteral.lastIndexOf(";"),
    beforeLiteral.lastIndexOf("{"),
    beforeLiteral.lastIndexOf("}"),
  );
  const statementPrefix = beforeLiteral.slice(statementStart + 1);

  return /^\s*(?:public|protected)\s+(?:static\s+)?(?:\??[A-Za-z_\\][A-Za-z0-9_\\]*\s+)?\$connection\s*=\s*$/.test(
    statementPrefix,
  );
}

function nearestClassDeclarationBeforeOffset(
  source: string,
  offset: number,
): RegExpExecArray | null {
  const classPattern =
    /\bclass\s+[A-Za-z_][A-Za-z0-9_]*\s+extends\s+((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)/g;
  const beforeOffset = source.slice(0, offset);
  let current: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = classPattern.exec(beforeOffset))) {
    current = match;
  }

  return current;
}

function isEloquentModelParentClass(parentClass: string): boolean {
  const normalizedClassName = parentClass.replace(/^\\/, "").toLowerCase();

  return (
    normalizedClassName === "model" ||
    normalizedClassName === "illuminate\\database\\eloquent\\model"
  );
}

function phpStringLiteralContextAt(
  source: string,
  position: EditorPosition,
): PhpStringLiteralContext | null {
  const offset = offsetAtPosition(source, position);
  let quote: "'" | "\"" | null = null;
  let quoteStart = -1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character !== quote) {
        continue;
      }

      if (offset > quoteStart && offset <= index) {
        const value = source.slice(quoteStart + 1, index);

        if (quote === "\"" && hasPhpVariableInterpolation(value)) {
          return null;
        }

        return {
          closed: true,
          position: editorPositionAtOffset(source, quoteStart + 1),
          prefix: source.slice(quoteStart + 1, Math.min(offset, index)),
          quoteStart,
          value,
        };
      }

      quote = null;
      quoteStart = -1;
      continue;
    }

    if (character !== "'" && character !== "\"") {
      continue;
    }

    quote = character;
    quoteStart = index;
  }

  if (!quote || offset <= quoteStart) {
    return null;
  }

  const value = source.slice(quoteStart + 1);

  if (quote === "\"" && hasPhpVariableInterpolation(value)) {
    return null;
  }

  return {
    closed: false,
    position: editorPositionAtOffset(source, quoteStart + 1),
    prefix: source.slice(quoteStart + 1, offset),
    quoteStart,
    value,
  };
}

function hasPhpVariableInterpolation(value: string): boolean {
  return /(^|[^\\])\$(?:[A-Za-z_]|[{])/.test(value);
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let lineNumber = 1;
  let column = 1;

  for (let offset = 0; offset < source.length; offset += 1) {
    if (lineNumber === position.lineNumber && column === position.column) {
      return offset;
    }

    if (source[offset] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}

function editorPositionAtOffset(
  source: string,
  targetOffset: number,
): EditorPosition {
  let lineNumber = 1;
  let column = 1;

  for (
    let offset = 0;
    offset < source.length && offset < targetOffset;
    offset += 1
  ) {
    if (source[offset] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
