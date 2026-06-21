import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArrayArgumentElementContextAt,
  phpStringAttributeArgumentContextAt,
  phpStringArgumentContextAt,
  type PhpStringArrayArgumentElementContext,
  type PhpStringAttributeArgumentContext,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelAuthGuardConfigPrefix = "auth.guards.";
const laravelAuthAttributeClass = "Illuminate\\Container\\Attributes\\Auth";
const laravelAuthenticatedAttributeClass =
  "Illuminate\\Container\\Attributes\\Authenticated";
const laravelCurrentUserAttributeClass =
  "Illuminate\\Container\\Attributes\\CurrentUser";
const authGuardStaticCallMethods = {
  guard: "Auth::guard",
  setdefaultdriver: "Auth::setDefaultDriver",
  shoulduse: "Auth::shouldUse",
} as const;
const authGuardHelperCallMethods = {
  auth: "auth",
  guard: "auth()->guard",
} as const;
const authGuardRequestCallMethods = {
  user: "request()->user",
} as const;
const authGuardMiddlewareCallMethods = {
  auth: "Route::middleware(auth)",
  guest: "Route::middleware(guest)",
} as const;

type AuthGuardStaticMethodName = keyof typeof authGuardStaticCallMethods;
type AuthGuardHelperMethodName = keyof typeof authGuardHelperCallMethods;
type AuthGuardRequestMethodName = keyof typeof authGuardRequestCallMethods;
type AuthGuardMiddlewareName = keyof typeof authGuardMiddlewareCallMethods;

export type PhpLaravelAuthGuardReferenceCall =
  | "#[Auth]"
  | "#[Authenticated]"
  | "#[CurrentUser]"
  | (typeof authGuardStaticCallMethods)[AuthGuardStaticMethodName]
  | (typeof authGuardHelperCallMethods)[AuthGuardHelperMethodName]
  | (typeof authGuardRequestCallMethods)[AuthGuardRequestMethodName]
  | (typeof authGuardMiddlewareCallMethods)[AuthGuardMiddlewareName];

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
  const attributeContext = phpLaravelAuthAttributeGuardReferenceContextAt(
    source,
    position,
  );

  if (attributeContext) {
    return attributeContext;
  }

  const arrayArgument = phpStringArrayArgumentElementContextAt(source, position);

  if (arrayArgument) {
    const context = phpLaravelAuthMiddlewareGuardReferenceContext(
      source,
      arrayArgument,
    );

    if (context) {
      return context;
    }
  }

  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const middlewareContext = phpLaravelAuthMiddlewareGuardReferenceContext(
    source,
    argument,
  );

  if (middlewareContext) {
    return middlewareContext;
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

function phpLaravelAuthAttributeGuardReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelAuthGuardReferenceContext | null {
  const argument = phpStringAttributeArgumentContextAt(source, position, [
    laravelAuthAttributeClass,
    laravelAuthenticatedAttributeClass,
    laravelCurrentUserAttributeClass,
  ]);

  if (!argument) {
    return null;
  }

  const guardName = argument.closed ? argument.value : argument.prefix;

  if (
    !isAuthAttributeGuardArgument(argument) ||
    !isUsableLaravelAuthGuardName(argument.prefix) ||
    !isUsableLaravelAuthGuardName(guardName)
  ) {
    return null;
  }

  return {
    call: laravelAuthAttributeGuardCall(argument.resolvedAttributeName),
    guardName,
    position: argument.position,
    prefix: argument.prefix,
  };
}

function laravelAuthAttributeGuardCall(
  attributeName: string,
): Extract<
  PhpLaravelAuthGuardReferenceCall,
  "#[Auth]" | "#[Authenticated]" | "#[CurrentUser]"
> {
  const normalizedAttributeName = attributeName.toLowerCase();

  if (
    normalizedAttributeName === laravelAuthenticatedAttributeClass.toLowerCase()
  ) {
    return "#[Authenticated]";
  }

  if (
    normalizedAttributeName === laravelCurrentUserAttributeClass.toLowerCase()
  ) {
    return "#[CurrentUser]";
  }

  return "#[Auth]";
}

function phpLaravelAuthMiddlewareGuardReferenceContext(
  source: string,
  argument: PhpStringArgumentContext | PhpStringArrayArgumentElementContext,
): PhpLaravelAuthGuardReferenceContext | null {
  if (
    !isRouteMiddlewareArgument(argument) ||
    !isRouteMiddlewareCallAt(source, argument)
  ) {
    return null;
  }

  const segment = authGuardMiddlewareSegment(argument);

  if (
    !segment ||
    !isUsableLaravelAuthGuardName(segment.prefix) ||
    !isUsableLaravelAuthGuardName(segment.guardName)
  ) {
    return null;
  }

  return {
    call: authGuardMiddlewareCallMethods[segment.middleware],
    guardName: segment.guardName,
    position: argument.position,
    prefix: segment.prefix,
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

  const requestUserMatch =
    /(?:^|[^A-Za-z0-9_$>:\\])(?:\$request|request\s*\(\s*\))\s*(?:->|\?->)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
      beforeCall,
    );
  const requestUserMethod = requestUserMatch?.[1]?.toLowerCase() ?? null;

  if (requestUserMethod && isAuthGuardRequestMethodName(requestUserMethod)) {
    return authGuardRequestCallMethods[requestUserMethod];
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

function isAuthGuardRequestMethodName(
  methodName: string,
): methodName is AuthGuardRequestMethodName {
  return methodName in authGuardRequestCallMethods;
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

  if (call === "request()->user") {
    return argumentName
      ? argumentName === "guard"
      : argument.argumentIndex === 0;
  }

  if (argumentName) {
    return argumentName === "name";
  }

  return argument.argumentIndex === 0;
}

function isAuthAttributeGuardArgument(
  argument: PhpStringAttributeArgumentContext,
): boolean {
  return argument.argumentName
    ? argument.argumentName.toLowerCase() === "guard"
    : argument.argumentIndex === 0;
}

function isRouteMiddlewareArgument(
  argument: PhpStringArgumentContext | PhpStringArrayArgumentElementContext,
): boolean {
  if (argument.argumentName) {
    return argument.argumentName.toLowerCase() === "middleware";
  }

  return argument.argumentIndex === 0;
}

function isRouteMiddlewareCallAt(
  source: string,
  argument: PhpStringArgumentContext | PhpStringArrayArgumentElementContext,
): boolean {
  const beforeCall = source.slice(0, argument.openParen);

  if (
    !/(?:^|[^A-Za-z0-9_])(?:Route\s*::|->|\?->)\s*middleware\s*$/.test(
      beforeCall,
    )
  ) {
    return false;
  }

  return /\bRoute\s*::/.test(beforeCall);
}

function authGuardMiddlewareSegment(
  argument: PhpStringArgumentContext | PhpStringArrayArgumentElementContext,
): {
  guardName: string;
  middleware: AuthGuardMiddlewareName;
  prefix: string;
} | null {
  const middlewareMatch = /^(auth|guest):/i.exec(argument.prefix);

  if (!middlewareMatch) {
    return null;
  }

  const middleware = middlewareMatch[1]?.toLowerCase();

  if (!middleware || !isAuthGuardMiddlewareName(middleware)) {
    return null;
  }

  const guardListStart = middlewareMatch[0].length;
  const prefixGuardList = argument.prefix.slice(guardListStart);
  const currentSegmentStart = prefixGuardList.lastIndexOf(",") + 1;
  const prefix = prefixGuardList.slice(currentSegmentStart);
  const guardList = (argument.closed ? argument.value : argument.prefix).slice(
    guardListStart,
  );
  const guardName = argument.closed
    ? (guardList.slice(currentSegmentStart).split(",")[0] ?? "")
    : prefix;

  return { guardName, middleware, prefix };
}

function isAuthGuardMiddlewareName(
  middleware: string,
): middleware is AuthGuardMiddlewareName {
  return middleware in authGuardMiddlewareCallMethods;
}
