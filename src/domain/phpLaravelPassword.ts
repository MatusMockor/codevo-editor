import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelPasswordBrokerConfigPrefix = "auth.passwords.";
const passwordBrokerStaticCallMethods = {
  broker: "Password::broker",
  setdefaultdriver: "Password::setDefaultDriver",
} as const;

type PasswordBrokerStaticMethodName =
  keyof typeof passwordBrokerStaticCallMethods;

export type PhpLaravelPasswordBrokerReferenceCall =
  (typeof passwordBrokerStaticCallMethods)[PasswordBrokerStaticMethodName];

export interface PhpLaravelPasswordBrokerReferenceContext {
  brokerName: string;
  call: PhpLaravelPasswordBrokerReferenceCall;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelPasswordBrokerReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelPasswordBrokerReferenceContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const brokerName = argument.closed ? argument.value : argument.prefix;

  if (
    !isPasswordBrokerArgument(argument) ||
    !isUsableLaravelPasswordBrokerName(argument.prefix) ||
    !isUsableLaravelPasswordBrokerName(brokerName)
  ) {
    return null;
  }

  const call = laravelPasswordBrokerReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  return {
    brokerName,
    call,
    position: argument.position,
    prefix: argument.prefix,
  };
}

export function phpLaravelPasswordBrokerConfigKey(
  brokerName: string,
): string | null {
  return isUsableLaravelPasswordBrokerName(brokerName)
    ? `${laravelPasswordBrokerConfigPrefix}${brokerName}`
    : null;
}

export function phpLaravelPasswordBrokerNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelPasswordBrokerConfigPrefix)) {
    return null;
  }

  const brokerName = configKey.slice(laravelPasswordBrokerConfigPrefix.length);

  return brokerName.includes(".") ||
    !isUsableLaravelPasswordBrokerName(brokerName)
    ? null
    : brokerName;
}

export function phpLaravelPasswordBrokerCompletionInsertText(
  brokerName: string,
): string {
  return brokerName;
}

export function isUsableLaravelPasswordBrokerName(brokerName: string): boolean {
  return (
    brokerName.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(brokerName) &&
    !brokerName.startsWith(".") &&
    !brokerName.endsWith(".") &&
    !brokerName.includes("..")
  );
}

function laravelPasswordBrokerReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelPasswordBrokerReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const match = /\bPassword\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const methodName = match?.[1]?.toLowerCase() ?? null;

  if (!methodName || !isPasswordBrokerStaticMethodName(methodName)) {
    return null;
  }

  return passwordBrokerStaticCallMethods[methodName];
}

function isPasswordBrokerStaticMethodName(
  methodName: string,
): methodName is PasswordBrokerStaticMethodName {
  return methodName in passwordBrokerStaticCallMethods;
}

function isPasswordBrokerArgument(
  argument: PhpStringArgumentContext,
): boolean {
  const argumentName = argument.argumentName?.toLowerCase();

  return argumentName ? argumentName === "name" : argument.argumentIndex === 0;
}
