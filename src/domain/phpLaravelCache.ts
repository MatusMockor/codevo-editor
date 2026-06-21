import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelCacheStoreConfigPrefix = "cache.stores.";
const cacheStoreStaticCallMethods = {
  driver: "Cache::driver",
  store: "Cache::store",
} as const;
const cacheStoreHelperCallMethods = {
  driver: "cache()->driver",
  store: "cache()->store",
} as const;

type CacheStoreStaticMethodName = keyof typeof cacheStoreStaticCallMethods;
type CacheStoreHelperMethodName = keyof typeof cacheStoreHelperCallMethods;

export type PhpLaravelCacheStoreReferenceCall =
  | (typeof cacheStoreStaticCallMethods)[CacheStoreStaticMethodName]
  | (typeof cacheStoreHelperCallMethods)[CacheStoreHelperMethodName];

export interface PhpLaravelCacheStoreReferenceContext {
  call: PhpLaravelCacheStoreReferenceCall;
  position: EditorPosition;
  prefix: string;
  storeName: string;
}

export function phpLaravelCacheStoreReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelCacheStoreReferenceContext | null {
  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const storeName = argument.closed ? argument.value : argument.prefix;

  if (
    !isCacheStoreArgument(argument) ||
    !isUsableLaravelCacheStoreName(argument.prefix) ||
    !isUsableLaravelCacheStoreName(storeName)
  ) {
    return null;
  }

  const call = laravelCacheStoreReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  return {
    call,
    position: argument.position,
    prefix: argument.prefix,
    storeName,
  };
}

export function phpLaravelCacheStoreConfigKey(storeName: string): string | null {
  return isUsableLaravelCacheStoreName(storeName)
    ? `${laravelCacheStoreConfigPrefix}${storeName}`
    : null;
}

export function phpLaravelCacheStoreNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelCacheStoreConfigPrefix)) {
    return null;
  }

  const storeName = configKey.slice(laravelCacheStoreConfigPrefix.length);

  return storeName.includes(".") || !isUsableLaravelCacheStoreName(storeName)
    ? null
    : storeName;
}

export function phpLaravelCacheStoreCompletionInsertText(
  storeName: string,
): string {
  return storeName;
}

export function isUsableLaravelCacheStoreName(storeName: string): boolean {
  return (
    storeName.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(storeName) &&
    !storeName.startsWith(".") &&
    !storeName.endsWith(".") &&
    !storeName.includes("..")
  );
}

function laravelCacheStoreReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelCacheStoreReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const staticMatch = /\bCache\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const staticMethod = staticMatch?.[1]?.toLowerCase() ?? null;

  if (staticMethod && isCacheStoreStaticMethodName(staticMethod)) {
    return cacheStoreStaticCallMethods[staticMethod];
  }

  const helperMatch =
    /\bcache\s*\(\s*\)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeCall);
  const helperMethod = helperMatch?.[1]?.toLowerCase() ?? null;

  if (helperMethod && isCacheStoreHelperMethodName(helperMethod)) {
    return cacheStoreHelperCallMethods[helperMethod];
  }

  return null;
}

function isCacheStoreStaticMethodName(
  methodName: string,
): methodName is CacheStoreStaticMethodName {
  return methodName in cacheStoreStaticCallMethods;
}

function isCacheStoreHelperMethodName(
  methodName: string,
): methodName is CacheStoreHelperMethodName {
  return methodName in cacheStoreHelperCallMethods;
}

function isCacheStoreArgument(argument: PhpStringArgumentContext): boolean {
  if (argument.argumentIndex === 0) {
    return true;
  }

  const argumentName = argument.argumentName?.toLowerCase();

  return (
    argumentName === "driver" ||
    argumentName === "name" ||
    argumentName === "store"
  );
}
