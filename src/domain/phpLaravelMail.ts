import type { EditorPosition } from "./languageServerFeatures";
import {
  PHP_CLASS_NAME_PATTERN,
  phpStatementPrefixBeforeOffset,
} from "./phpReceiverExpressions";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelMailMailerConfigPrefix = "mail.mailers.";
const mailMailerStaticCallMethods = {
  driver: "Mail::driver",
  mailer: "Mail::mailer",
  purge: "Mail::purge",
  setdefaultdriver: "Mail::setDefaultDriver",
} as const;
const mailMailerMessageCallMethods = {
  mailer: "MailMessage::mailer",
} as const;

type MailMailerStaticMethodName = keyof typeof mailMailerStaticCallMethods;
type MailMailerMessageMethodName = keyof typeof mailMailerMessageCallMethods;

export type PhpLaravelMailMailerReferenceCall =
  | (typeof mailMailerStaticCallMethods)[MailMailerStaticMethodName]
  | (typeof mailMailerMessageCallMethods)[MailMailerMessageMethodName];

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
  const call = laravelMailMailerReferenceCallAt(source, argument);

  if (
    !call ||
    !isMailMailerArgument(argument, call) ||
    !isUsableLaravelMailMailerName(argument.prefix) ||
    !isUsableLaravelMailMailerName(mailerName)
  ) {
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

  const memberMatch = /(?:->|\?->)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const memberMethod = memberMatch?.[1]?.toLowerCase() ?? null;

  if (memberMethod && isMailMailerMessageMethodName(memberMethod)) {
    const call = mailMailerMessageCallMethods[memberMethod];

    return isSupportedMailMessageMailerCallAt(source, argument) ? call : null;
  }

  return null;
}

function isMailMailerStaticMethodName(
  methodName: string,
): methodName is MailMailerStaticMethodName {
  return methodName in mailMailerStaticCallMethods;
}

function isMailMailerMessageMethodName(
  methodName: string,
): methodName is MailMailerMessageMethodName {
  return methodName in mailMailerMessageCallMethods;
}

function isMailMailerArgument(
  argument: PhpStringArgumentContext,
  call: PhpLaravelMailMailerReferenceCall,
): boolean {
  const argumentName = argument.argumentName?.toLowerCase();

  if (call === "MailMessage::mailer") {
    return argumentName
      ? argumentName === "mailer"
      : argument.argumentIndex === 0;
  }

  if (argumentName) {
    return (
      argumentName === "driver" ||
      argumentName === "mailer" ||
      argumentName === "name"
    );
  }

  return argument.argumentIndex === 0;
}

const phpMailMessageClassReferencePattern = new RegExp(
  String.raw`new\s+(${PHP_CLASS_NAME_PATTERN})\s*(?:\([^)]*\))?`,
  "gi",
);

function isSupportedMailMessageMailerCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): boolean {
  const statementPrefix = phpStatementPrefixBeforeOffset(
    source,
    argument.openParen,
  );
  const matches = Array.from(
    statementPrefix.matchAll(phpMailMessageClassReferencePattern),
  );
  const match = matches[matches.length - 1];

  if (!match || match.index === undefined) {
    return false;
  }

  const className = match[1] ?? "";

  if (!isMailMessageClassName(className)) {
    return false;
  }

  const beforeNew = statementPrefix.slice(0, match.index);

  if (isNestedCallArgumentBeforeNew(beforeNew)) {
    return false;
  }

  const afterNew = statementPrefix.slice(match.index + match[0].length);

  return /^\s*\)?(?:\s*(?:->|\?->)\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?)*\s*(?:->|\?->)\s*mailer\s*$/.test(
    afterNew,
  );
}

function isMailMessageClassName(className: string): boolean {
  const normalizedClassName = className.replace(/^\\/, "").toLowerCase();

  return (
    normalizedClassName === "mailmessage" ||
    normalizedClassName === "illuminate\\notifications\\messages\\mailmessage"
  );
}

function isNestedCallArgumentBeforeNew(beforeNew: string): boolean {
  const trimmed = beforeNew.trimEnd();

  if (!trimmed.endsWith("(")) {
    return false;
  }

  const wrapperIndex = beforeNew.lastIndexOf("(");
  const previousCharacter =
    wrapperIndex > 0 ? beforeNew[wrapperIndex - 1] : "";

  return /[A-Za-z0-9_$)\]]/.test(previousCharacter);
}
