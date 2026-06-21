import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelMailMailerConfigPrefix = "mail.mailers.";
const mailMailerStaticCallMethods = {
  driver: "Mail::driver",
  mailer: "Mail::mailer",
} as const;

type MailMailerStaticMethodName = keyof typeof mailMailerStaticCallMethods;

export type PhpLaravelMailMailerReferenceCall =
  (typeof mailMailerStaticCallMethods)[MailMailerStaticMethodName];

export interface PhpLaravelMailMailerReferenceContext {
  call: PhpLaravelMailMailerReferenceCall;
  mailerName: string;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelMailMailerReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelMailMailerReferenceContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const mailerName = argument.closed ? argument.value : argument.prefix;

  if (
    !isMailMailerArgument(argument) ||
    !isUsableLaravelMailMailerName(argument.prefix) ||
    !isUsableLaravelMailMailerName(mailerName)
  ) {
    return null;
  }

  const call = laravelMailMailerReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  return {
    call,
    mailerName,
    position: argument.position,
    prefix: argument.prefix,
  };
}

export function phpLaravelMailMailerConfigKey(
  mailerName: string,
): string | null {
  return isUsableLaravelMailMailerName(mailerName)
    ? `${laravelMailMailerConfigPrefix}${mailerName}`
    : null;
}

export function phpLaravelMailMailerNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelMailMailerConfigPrefix)) {
    return null;
  }

  const mailerName = configKey.slice(laravelMailMailerConfigPrefix.length);

  return mailerName.includes(".") || !isUsableLaravelMailMailerName(mailerName)
    ? null
    : mailerName;
}

export function phpLaravelMailMailerCompletionInsertText(
  mailerName: string,
): string {
  return mailerName;
}

export function isUsableLaravelMailMailerName(mailerName: string): boolean {
  return (
    mailerName.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(mailerName) &&
    !mailerName.startsWith(".") &&
    !mailerName.endsWith(".") &&
    !mailerName.includes("..")
  );
}

function laravelMailMailerReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelMailMailerReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch = /\bMail\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const staticMethod = staticMatch?.[1]?.toLowerCase() ?? null;

  if (staticMethod && isMailMailerStaticMethodName(staticMethod)) {
    return mailMailerStaticCallMethods[staticMethod];
  }

  return null;
}

function isMailMailerStaticMethodName(
  methodName: string,
): methodName is MailMailerStaticMethodName {
  return methodName in mailMailerStaticCallMethods;
}

function isMailMailerArgument(argument: PhpStringArgumentContext): boolean {
  if (argument.argumentIndex === 0) {
    return true;
  }

  const argumentName = argument.argumentName?.toLowerCase();

  return (
    argumentName === "driver" ||
    argumentName === "mailer" ||
    argumentName === "name"
  );
}
