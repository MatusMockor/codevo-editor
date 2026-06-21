import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelQueueConnectionConfigPrefix = "queue.connections.";
const queueConnectionStaticCallMethods = {
  connection: "Queue::connection",
  connected: "Queue::connected",
  route: "Queue::route",
} as const;
const queueConnectionMemberCallMethods = {
  allonconnection: "allOnConnection",
  onconnection: "onConnection",
} as const;

type QueueConnectionStaticMethodName =
  keyof typeof queueConnectionStaticCallMethods;
type QueueConnectionMemberMethodName =
  keyof typeof queueConnectionMemberCallMethods;

export type PhpLaravelQueueConnectionReferenceCall =
  | (typeof queueConnectionStaticCallMethods)[QueueConnectionStaticMethodName]
  | (typeof queueConnectionMemberCallMethods)[QueueConnectionMemberMethodName];

export interface PhpLaravelQueueConnectionReferenceContext {
  call: PhpLaravelQueueConnectionReferenceCall;
  connectionName: string;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelQueueConnectionReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelQueueConnectionReferenceContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const call = laravelQueueConnectionReferenceCallAt(source, argument);
  const connectionName = argument.closed ? argument.value : argument.prefix;

  if (
    !call ||
    !isQueueConnectionArgument(argument, call) ||
    !isUsableLaravelQueueConnectionName(argument.prefix) ||
    !isUsableLaravelQueueConnectionName(connectionName)
  ) {
    return null;
  }

  return {
    call,
    connectionName,
    position: argument.position,
    prefix: argument.prefix,
  };
}

export function phpLaravelQueueConnectionConfigKey(
  connectionName: string,
): string | null {
  return isUsableLaravelQueueConnectionName(connectionName)
    ? `${laravelQueueConnectionConfigPrefix}${connectionName}`
    : null;
}

export function phpLaravelQueueConnectionNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelQueueConnectionConfigPrefix)) {
    return null;
  }

  const connectionName = configKey.slice(
    laravelQueueConnectionConfigPrefix.length,
  );

  return connectionName.includes(".") ||
    !isUsableLaravelQueueConnectionName(connectionName)
    ? null
    : connectionName;
}

export function phpLaravelQueueConnectionCompletionInsertText(
  connectionName: string,
): string {
  return connectionName;
}

export function isUsableLaravelQueueConnectionName(
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

function laravelQueueConnectionReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelQueueConnectionReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch = /\bQueue\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const staticMethod = staticMatch?.[1]?.toLowerCase() ?? null;

  if (staticMethod && isQueueConnectionStaticMethodName(staticMethod)) {
    return queueConnectionStaticCallMethods[staticMethod];
  }

  const memberMatch =
    /(?:->|\?->)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeCall);
  const memberMethod = memberMatch?.[1]?.toLowerCase() ?? null;

  if (memberMethod && isQueueConnectionMemberMethodName(memberMethod)) {
    return queueConnectionMemberCallMethods[memberMethod];
  }

  return null;
}

function isQueueConnectionStaticMethodName(
  methodName: string,
): methodName is QueueConnectionStaticMethodName {
  return methodName in queueConnectionStaticCallMethods;
}

function isQueueConnectionMemberMethodName(
  methodName: string,
): methodName is QueueConnectionMemberMethodName {
  return methodName in queueConnectionMemberCallMethods;
}

function isQueueConnectionArgument(
  argument: PhpStringArgumentContext,
  call: PhpLaravelQueueConnectionReferenceCall,
): boolean {
  const argumentName = argument.argumentName?.toLowerCase();

  if (call === "Queue::route") {
    return argumentName === "connection" || argument.argumentIndex === 2;
  }

  if (argument.argumentIndex === 0) {
    return true;
  }

  return argumentName === "connection" || argumentName === "name";
}
