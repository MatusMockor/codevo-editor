import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelBroadcastConnectionConfigPrefix = "broadcasting.connections.";
const broadcastConnectionStaticCallMethods = {
  connection: "Broadcast::connection",
  driver: "Broadcast::driver",
  purge: "Broadcast::purge",
  setdefaultdriver: "Broadcast::setDefaultDriver",
} as const;

type BroadcastConnectionStaticMethodName =
  keyof typeof broadcastConnectionStaticCallMethods;

export type PhpLaravelBroadcastConnectionReferenceCall =
  (typeof broadcastConnectionStaticCallMethods)[
    BroadcastConnectionStaticMethodName
  ];

export interface PhpLaravelBroadcastConnectionReferenceContext {
  call: PhpLaravelBroadcastConnectionReferenceCall;
  connectionName: string;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelBroadcastConnectionReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelBroadcastConnectionReferenceContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const connectionName = argument.closed ? argument.value : argument.prefix;

  if (
    !isBroadcastConnectionArgument(argument) ||
    !isUsableLaravelBroadcastConnectionName(argument.prefix) ||
    !isUsableLaravelBroadcastConnectionName(connectionName)
  ) {
    return null;
  }

  const call = laravelBroadcastConnectionReferenceCallAt(source, argument);

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

export function phpLaravelBroadcastConnectionConfigKey(
  connectionName: string,
): string | null {
  return isUsableLaravelBroadcastConnectionName(connectionName)
    ? `${laravelBroadcastConnectionConfigPrefix}${connectionName}`
    : null;
}

export function phpLaravelBroadcastConnectionNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelBroadcastConnectionConfigPrefix)) {
    return null;
  }

  const connectionName = configKey.slice(
    laravelBroadcastConnectionConfigPrefix.length,
  );

  return connectionName.includes(".") ||
    !isUsableLaravelBroadcastConnectionName(connectionName)
    ? null
    : connectionName;
}

export function phpLaravelBroadcastConnectionCompletionInsertText(
  connectionName: string,
): string {
  return connectionName;
}

export function isUsableLaravelBroadcastConnectionName(
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

function laravelBroadcastConnectionReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelBroadcastConnectionReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch = /\bBroadcast\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const staticMethod = staticMatch?.[1]?.toLowerCase() ?? null;

  if (staticMethod && isBroadcastConnectionStaticMethodName(staticMethod)) {
    return broadcastConnectionStaticCallMethods[staticMethod];
  }

  return null;
}

function isBroadcastConnectionStaticMethodName(
  methodName: string,
): methodName is BroadcastConnectionStaticMethodName {
  return methodName in broadcastConnectionStaticCallMethods;
}

function isBroadcastConnectionArgument(
  argument: PhpStringArgumentContext,
): boolean {
  if (argument.argumentIndex === 0) {
    return true;
  }

  const argumentName = argument.argumentName?.toLowerCase();

  return (
    argumentName === "connection" ||
    argumentName === "driver" ||
    argumentName === "name"
  );
}
