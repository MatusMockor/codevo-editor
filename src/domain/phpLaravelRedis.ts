import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelRedisConnectionConfigPrefix = "database.redis.";
const reservedRedisConfigKeys = new Set(["client", "clusters", "options"]);
const redisConnectionStaticCallMethods = {
  connection: "Redis::connection",
} as const;

type RedisConnectionStaticMethodName =
  keyof typeof redisConnectionStaticCallMethods;

export type PhpLaravelRedisConnectionReferenceCall =
  (typeof redisConnectionStaticCallMethods)[RedisConnectionStaticMethodName];

export interface PhpLaravelRedisConnectionReferenceContext {
  call: PhpLaravelRedisConnectionReferenceCall;
  connectionName: string;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelRedisConnectionReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelRedisConnectionReferenceContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const connectionName = argument.closed ? argument.value : argument.prefix;

  if (
    !isRedisConnectionArgument(argument) ||
    !isUsableLaravelRedisConnectionName(argument.prefix) ||
    !isUsableLaravelRedisConnectionName(connectionName)
  ) {
    return null;
  }

  const call = laravelRedisConnectionReferenceCallAt(source, argument);

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

export function phpLaravelRedisConnectionConfigKey(
  connectionName: string,
): string | null {
  return isUsableLaravelRedisConnectionName(connectionName)
    ? `${laravelRedisConnectionConfigPrefix}${connectionName}`
    : null;
}

export function phpLaravelRedisConnectionNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelRedisConnectionConfigPrefix)) {
    return null;
  }

  const connectionName = configKey.slice(
    laravelRedisConnectionConfigPrefix.length,
  );
  const normalizedName = connectionName.toLowerCase();

  return connectionName.includes(".") ||
    reservedRedisConfigKeys.has(normalizedName) ||
    !isUsableLaravelRedisConnectionName(connectionName)
    ? null
    : connectionName;
}

export function phpLaravelRedisConnectionCompletionInsertText(
  connectionName: string,
): string {
  return connectionName;
}

export function isUsableLaravelRedisConnectionName(
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

function laravelRedisConnectionReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelRedisConnectionReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch = /\bRedis\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const staticMethod = staticMatch?.[1]?.toLowerCase() ?? null;

  if (staticMethod && isRedisConnectionStaticMethodName(staticMethod)) {
    return redisConnectionStaticCallMethods[staticMethod];
  }

  return null;
}

function isRedisConnectionStaticMethodName(
  methodName: string,
): methodName is RedisConnectionStaticMethodName {
  return methodName in redisConnectionStaticCallMethods;
}

function isRedisConnectionArgument(
  argument: PhpStringArgumentContext,
): boolean {
  const argumentName = argument.argumentName?.toLowerCase();

  return argumentName ? argumentName === "name" : argument.argumentIndex === 0;
}
