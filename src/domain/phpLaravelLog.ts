import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArrayArgumentElementContextAt,
  phpStringAttributeArgumentContextAt,
  phpStringArgumentContextAt,
  type PhpStringArrayArgumentElementContext,
  type PhpStringAttributeArgumentContext,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelLogChannelConfigPrefix = "logging.channels.";
const laravelLogAttributeClass = "Illuminate\\Container\\Attributes\\Log";
const logChannelStaticCallMethods = {
  channel: "Log::channel",
  driver: "Log::driver",
} as const;
const logStackCall = "Log::stack";

type LogChannelStaticMethodName = keyof typeof logChannelStaticCallMethods;

export type PhpLaravelLogChannelReferenceCall =
  | "#[Log]"
  | (typeof logChannelStaticCallMethods)[LogChannelStaticMethodName]
  | typeof logStackCall;

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
  const attributeContext = phpLaravelLogAttributeChannelReferenceContextAt(
    source,
    position,
  );

  if (attributeContext) {
    return attributeContext;
  }

  const arrayArgument = phpStringArrayArgumentElementContextAt(source, position);

  if (arrayArgument) {
    const channelName = arrayArgument.closed
      ? arrayArgument.value
      : arrayArgument.prefix;

    if (
      isLogStackChannelsArgument(arrayArgument) &&
      isUsableLaravelLogChannelName(arrayArgument.prefix) &&
      isUsableLaravelLogChannelName(channelName) &&
      isLaravelLogStackCallAt(source, arrayArgument)
    ) {
      return {
        call: logStackCall,
        channelName,
        position: arrayArgument.position,
        prefix: arrayArgument.prefix,
      };
    }
  }

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

function phpLaravelLogAttributeChannelReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelLogChannelReferenceContext | null {
  const argument = phpStringAttributeArgumentContextAt(source, position, [
    laravelLogAttributeClass,
  ]);

  if (!argument) {
    return null;
  }

  const channelName = argument.closed ? argument.value : argument.prefix;

  if (
    !isLogAttributeChannelArgument(argument) ||
    !isUsableLaravelLogChannelName(argument.prefix) ||
    !isUsableLaravelLogChannelName(channelName)
  ) {
    return null;
  }

  return {
    call: "#[Log]",
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

function isLaravelLogStackCallAt(
  source: string,
  argument: PhpStringArrayArgumentElementContext,
): boolean {
  const beforeCall = source.slice(0, argument.openParen);

  return /\bLog\s*::\s*stack\s*$/.test(beforeCall);
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

function isLogAttributeChannelArgument(
  argument: PhpStringAttributeArgumentContext,
): boolean {
  return argument.argumentName
    ? argument.argumentName.toLowerCase() === "channel"
    : argument.argumentIndex === 0;
}

function isLogStackChannelsArgument(
  argument: PhpStringArrayArgumentElementContext,
): boolean {
  const argumentName = argument.argumentName?.toLowerCase();

  return argumentName
    ? argumentName === "channels"
    : argument.argumentIndex === 0;
}
