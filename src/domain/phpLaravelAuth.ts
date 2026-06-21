import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelAuthGuardConfigPrefix = "auth.guards.";
const authGuardStaticCallMethods = {
  guard: "Auth::guard",
  setdefaultdriver: "Auth::setDefaultDriver",
  shoulduse: "Auth::shouldUse",
} as const;
const authGuardHelperCallMethods = {
  auth: "auth",
  guard: "auth()->guard",
} as const;

type AuthGuardStaticMethodName = keyof typeof authGuardStaticCallMethods;
type AuthGuardHelperMethodName = keyof typeof authGuardHelperCallMethods;

export type PhpLaravelAuthGuardReferenceCall =
  | (typeof authGuardStaticCallMethods)[AuthGuardStaticMethodName]
  | (typeof authGuardHelperCallMethods)[AuthGuardHelperMethodName];

export interface PhpLaravelAuthGuardReferenceContext {
  call: PhpLaravelAuthGuardReferenceCall;
  guardName: string;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelAuthGuardReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelAuthGuardReferenceContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const call = laravelAuthGuardReferenceCallAt(source, argument);
  const guardName = argument.closed ? argument.value : argument.prefix;

  if (
    !call ||
    !isAuthGuardArgument(argument, call) ||
    !isUsableLaravelAuthGuardName(argument.prefix) ||
    !isUsableLaravelAuthGuardName(guardName)
  ) {
    return null;
  }

  return {
    call,
    guardName,
    position: argument.position,
    prefix: argument.prefix,
  };
}

export function phpLaravelAuthGuardConfigKey(
  guardName: string,
): string | null {
  return isUsableLaravelAuthGuardName(guardName)
    ? `${laravelAuthGuardConfigPrefix}${guardName}`
    : null;
}

export function phpLaravelAuthGuardNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelAuthGuardConfigPrefix)) {
    return null;
  }

  const guardName = configKey.slice(laravelAuthGuardConfigPrefix.length);

  return guardName.includes(".") || !isUsableLaravelAuthGuardName(guardName)
    ? null
    : guardName;
}

export function phpLaravelAuthGuardCompletionInsertText(
  guardName: string,
): string {
  return guardName;
}

export function isUsableLaravelAuthGuardName(guardName: string): boolean {
  return (
    guardName.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(guardName) &&
    !guardName.startsWith(".") &&
    !guardName.endsWith(".") &&
    !guardName.includes("..")
  );
}

function laravelAuthGuardReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelAuthGuardReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch = /\bAuth\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const staticMethod = staticMatch?.[1]?.toLowerCase() ?? null;

  if (staticMethod && isAuthGuardStaticMethodName(staticMethod)) {
    return authGuardStaticCallMethods[staticMethod];
  }

  const helperMemberMatch =
    /(?:^|[^A-Za-z0-9_$>:\\])auth\s*\(\s*\)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
      beforeCall,
    );
  const helperMemberMethod = helperMemberMatch?.[1]?.toLowerCase() ?? null;

  if (
    helperMemberMethod &&
    isAuthGuardHelperMethodName(helperMemberMethod)
  ) {
    return authGuardHelperCallMethods[helperMemberMethod];
  }

  if (/(?:^|[^A-Za-z0-9_$>:\\])auth\s*$/.test(beforeCall)) {
    return authGuardHelperCallMethods.auth;
  }

  return null;
}

function isAuthGuardStaticMethodName(
  methodName: string,
): methodName is AuthGuardStaticMethodName {
  return methodName in authGuardStaticCallMethods;
}

function isAuthGuardHelperMethodName(
  methodName: string,
): methodName is AuthGuardHelperMethodName {
  return methodName in authGuardHelperCallMethods;
}

function isAuthGuardArgument(
  argument: PhpStringArgumentContext,
  call: PhpLaravelAuthGuardReferenceCall,
): boolean {
  const argumentName = argument.argumentName?.toLowerCase();

  if (call === "auth") {
    return argumentName
      ? argumentName === "guard"
      : argument.argumentIndex === 0;
  }

  if (argumentName) {
    return argumentName === "name";
  }

  return argument.argumentIndex === 0;
}
