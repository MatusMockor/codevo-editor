import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringAttributeArgumentContextAt,
  phpStringArgumentContextAt,
  type PhpStringAttributeArgumentContext,
  type PhpStringArgumentContext,
} from "./phpStringArgumentContext";

const laravelStorageDiskConfigPrefix = "filesystems.disks.";
const storageDiskCallMethods = {
  disk: "Storage::disk",
  drive: "Storage::drive",
  fake: "Storage::fake",
  persistentfake: "Storage::persistentFake",
} as const;

type StorageDiskMethodName = keyof typeof storageDiskCallMethods;

export type PhpLaravelStorageDiskReferenceCall =
  | "#[Storage]"
  | (typeof storageDiskCallMethods)[StorageDiskMethodName];

export interface PhpLaravelStorageDiskReferenceContext {
  call: PhpLaravelStorageDiskReferenceCall;
  diskName: string;
  position: EditorPosition;
  prefix: string;
}

export function phpLaravelStorageDiskReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelStorageDiskReferenceContext | null {
  const attributeContext = phpLaravelStorageAttributeDiskReferenceContextAt(
    source,
    position,
  );

  if (attributeContext) {
    return attributeContext;
  }

  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  const diskName = argument.closed ? argument.value : argument.prefix;

  if (
    !isStorageDiskArgument(argument) ||
    !isUsableLaravelStorageDiskName(argument.prefix) ||
    !isUsableLaravelStorageDiskName(diskName)
  ) {
    return null;
  }

  const call = laravelStorageDiskReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  return {
    call,
    diskName,
    position: argument.position,
    prefix: argument.prefix,
  };
}

function phpLaravelStorageAttributeDiskReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelStorageDiskReferenceContext | null {
  const argument = phpStringAttributeArgumentContextAt(source, position, [
    "Storage",
  ]);

  if (!argument) {
    return null;
  }

  const diskName = argument.closed ? argument.value : argument.prefix;

  if (
    !isStorageAttributeDiskArgument(argument) ||
    !isUsableLaravelStorageDiskName(argument.prefix) ||
    !isUsableLaravelStorageDiskName(diskName)
  ) {
    return null;
  }

  return {
    call: "#[Storage]",
    diskName,
    position: argument.position,
    prefix: argument.prefix,
  };
}

export function phpLaravelStorageDiskConfigKey(diskName: string): string | null {
  return isUsableLaravelStorageDiskName(diskName)
    ? `${laravelStorageDiskConfigPrefix}${diskName}`
    : null;
}

export function phpLaravelStorageDiskNameFromConfigKey(
  configKey: string,
): string | null {
  if (!configKey.startsWith(laravelStorageDiskConfigPrefix)) {
    return null;
  }

  const diskName = configKey.slice(laravelStorageDiskConfigPrefix.length);

  return diskName.includes(".") || !isUsableLaravelStorageDiskName(diskName)
    ? null
    : diskName;
}

export function phpLaravelStorageDiskCompletionInsertText(
  diskName: string,
): string {
  return diskName;
}

export function isUsableLaravelStorageDiskName(diskName: string): boolean {
  return (
    diskName.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(diskName) &&
    !diskName.startsWith(".") &&
    !diskName.endsWith(".") &&
    !diskName.includes("..")
  );
}

function laravelStorageDiskReferenceCallAt(
  source: string,
  argument: PhpStringArgumentContext,
): PhpLaravelStorageDiskReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);
  const match = /\bStorage\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );
  const methodName = match?.[1]?.toLowerCase() ?? null;

  if (!methodName || !isStorageDiskMethodName(methodName)) {
    return null;
  }

  return storageDiskCallMethods[methodName];
}

function isStorageDiskMethodName(
  methodName: string,
): methodName is StorageDiskMethodName {
  return methodName in storageDiskCallMethods;
}

function isStorageDiskArgument(argument: PhpStringArgumentContext): boolean {
  if (argument.argumentIndex === 0) {
    return true;
  }

  const argumentName = argument.argumentName?.toLowerCase();

  return argumentName === "name" || argumentName === "disk";
}

function isStorageAttributeDiskArgument(
  argument: PhpStringAttributeArgumentContext,
): boolean {
  return argument.argumentName
    ? argument.argumentName.toLowerCase() === "disk"
    : argument.argumentIndex === 0;
}
