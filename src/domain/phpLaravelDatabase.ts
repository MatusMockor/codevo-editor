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

type DatabaseConnectionStaticMethodName =
  keyof typeof databaseConnectionStaticCallMethods;
type DatabaseSchemaStaticMethodName =
  keyof typeof databaseSchemaStaticCallMethods;
type DatabaseHelperMethodName = keyof typeof databaseHelperCallMethods;

export type PhpLaravelDatabaseConnectionReferenceCall =
  | (typeof databaseConnectionStaticCallMethods)[
      DatabaseConnectionStaticMethodName
    ]
  | (typeof databaseSchemaStaticCallMethods)[DatabaseSchemaStaticMethodName]
  | (typeof databaseHelperCallMethods)[DatabaseHelperMethodName];

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
