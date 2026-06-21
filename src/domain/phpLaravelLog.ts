import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelLogChannelConfigPrefix = "logging.channels.";
const logChannelStaticCallMethods = {
  channel: "Log::channel",
  driver: "Log::driver",
} as const;

type LogChannelStaticMethodName = keyof typeof logChannelStaticCallMethods;

export type PhpLaravelLogChannelReferenceCall =
  (typeof logChannelStaticCallMethods)[LogChannelStaticMethodName];

export interface PhpLaravelLogChannelReferenceContext {
  call: PhpLaravelLogChannelReferenceCall;
  channelName: string;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelLogChannelReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelLogChannelReferenceContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const channelName = argument.closed ? argument.value : argument.prefix;

  if (
    !isLogChannelArgument(argument) ||
    !isUsableLaravelLogChannelName(argument.prefix) ||
    !isUsableLaravelLogChannelName(channelName)
  ) {
    return null;
  }

  const call = laravelLogChannelReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  return {
    call,
    channelName,
    position: argument.position,
    prefix: argument.prefix,
  };
}

export function phpLaravelLogChannelConfigKey(
  channelName: string,
): string | null {
  return isUsableLaravelLogChannelName(channelName)
    ? `${laravelLogChannelConfigPrefix}${channelName}`
    : null;
}

export function phpLaravelLogChannelNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelLogChannelConfigPrefix)) {
    return null;
  }

  const channelName = configKey.slice(laravelLogChannelConfigPrefix.length);

  return channelName.includes(".") || !isUsableLaravelLogChannelName(channelName)
    ? null
    : channelName;
}

export function phpLaravelLogChannelCompletionInsertText(
  channelName: string,
): string {
  return channelName;
}

export function isUsableLaravelLogChannelName(channelName: string): boolean {
  return (
    channelName.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(channelName) &&
    !channelName.startsWith(".") &&
    !channelName.endsWith(".") &&
    !channelName.includes("..")
  );
}

function laravelLogChannelReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelLogChannelReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch = /\bLog\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const staticMethod = staticMatch?.[1]?.toLowerCase() ?? null;

  if (staticMethod && isLogChannelStaticMethodName(staticMethod)) {
    return logChannelStaticCallMethods[staticMethod];
  }

  return null;
}

function isLogChannelStaticMethodName(
  methodName: string,
): methodName is LogChannelStaticMethodName {
  return methodName in logChannelStaticCallMethods;
}

function isLogChannelArgument(argument: PhpStringArgumentContext): boolean {
  if (argument.argumentIndex === 0) {
    return true;
  }

  const argumentName = argument.argumentName?.toLowerCase();

  return (
    argumentName === "channel" ||
    argumentName === "driver" ||
    argumentName === "name"
  );
}
