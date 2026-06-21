import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArrayArgumentElementContextAt,
  phpStringArgumentContextAt,
  type PhpStringArrayArgumentElementContext,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelBroadcastConnectionConfigPrefix = "broadcasting.connections.";
const broadcastConnectionStaticCallMethods = {
  connection: "Broadcast::connection",
  driver: "Broadcast::driver",
  purge: "Broadcast::purge",
  setdefaultdriver: "Broadcast::setDefaultDriver",
} as const;
const broadcastViaMemberCallMethods = {
  broadcastvia: "broadcastVia",
  via: "via",
} as const;

type BroadcastConnectionStaticMethodName =
  keyof typeof broadcastConnectionStaticCallMethods;
type BroadcastViaMemberMethodName = keyof typeof broadcastViaMemberCallMethods;

export type PhpLaravelBroadcastConnectionReferenceCall =
  | (typeof broadcastConnectionStaticCallMethods)[
      BroadcastConnectionStaticMethodName
    ]
  | (typeof broadcastViaMemberCallMethods)[BroadcastViaMemberMethodName];

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
  const arrayArgument = phpStringArrayArgumentElementContextAt(source, position);

  if (arrayArgument) {
    const connectionName = arrayArgument.closed
      ? arrayArgument.value
      : arrayArgument.prefix;

    if (
      isBroadcastViaArrayArgument(arrayArgument) &&
      isUsableLaravelBroadcastConnectionName(arrayArgument.prefix) &&
      isUsableLaravelBroadcastConnectionName(connectionName)
    ) {
      const call = laravelBroadcastArrayConnectionReferenceCallAt(
        source,
        arrayArgument,
      );

      if (call) {
        return {
          call,
          connectionName,
          position: arrayArgument.position,
          prefix: arrayArgument.prefix,
        };
      }
    }
  }

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

  const memberMatch =
    /(?:->|\?->|::)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeCall);
  const memberMethod = memberMatch?.[1]?.toLowerCase() ?? null;

  if (memberMethod && isBroadcastViaMemberMethodName(memberMethod)) {
    const call = broadcastViaMemberCallMethods[memberMethod];

    return isSupportedBroadcastViaCallAt(source, argument, call) ? call : null;
  }

  return null;
}

function laravelBroadcastArrayConnectionReferenceCallAt(
  source: string,
  argument: PhpStringArrayArgumentElementContext,
): PhpLaravelBroadcastConnectionReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const memberMatch =
    /(?:->|\?->|::)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeCall);
  const memberMethod = memberMatch?.[1]?.toLowerCase() ?? null;

  if (!memberMethod || !isBroadcastViaMemberMethodName(memberMethod)) {
    return null;
  }

  const call = broadcastViaMemberCallMethods[memberMethod];

  return isSupportedBroadcastViaCallAt(source, argument, call) ? call : null;
}

function isBroadcastConnectionStaticMethodName(
  methodName: string,
): methodName is BroadcastConnectionStaticMethodName {
  return methodName in broadcastConnectionStaticCallMethods;
}

function isBroadcastViaMemberMethodName(
  methodName: string,
): methodName is BroadcastViaMemberMethodName {
  return methodName in broadcastViaMemberCallMethods;
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

function isBroadcastViaArrayArgument(
  argument: PhpStringArrayArgumentElementContext,
): boolean {
  const argumentName = argument.argumentName?.toLowerCase();

  return argumentName
    ? argumentName === "connection"
    : argument.argumentIndex === 0;
}

function isSupportedBroadcastViaCallAt(
  source: string,
  argument: PhpStringArgumentContext,
  call: PhpLaravelBroadcastConnectionReferenceCall,
): boolean {
  const beforeMemberCall = source.slice(0, argument.openParen);

  if (call === "broadcastVia") {
    return /(?:^|[^A-Za-z0-9_$])(?:\$this|self|static)\s*(?:->|::)\s*broadcastVia\s*$/.test(
      beforeMemberCall,
    );
  }

  return (
    /\b(?:broadcast|broadcast_if|broadcast_unless)\s*\([\s\S]*\)\s*->\s*via\s*$/.test(
      beforeMemberCall,
    ) ||
    /\bBroadcast\s*::\s*(?:event|on|private|presence)\s*\([\s\S]*\)\s*->\s*via\s*$/.test(
      beforeMemberCall,
    )
  );
}
