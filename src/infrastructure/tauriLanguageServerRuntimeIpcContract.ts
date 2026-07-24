import type { InvokeArgs } from "@tauri-apps/api/core";
import type {
  LanguageServerRuntimeCapabilities,
  LanguageServerRuntimeStartOptions,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";

interface LanguageServerRuntimeIpcContract {
  readonly getStatus: {
    readonly args: { readonly rootPath: string };
    readonly result: LanguageServerRuntimeStatus;
  };
  readonly start: {
    readonly args: { readonly rootPath: string } & LanguageServerRuntimeStartOptions;
    readonly result: LanguageServerRuntimeStatus;
  };
  readonly stop: {
    readonly args: { readonly rootPath: string };
    readonly result: LanguageServerRuntimeStatus;
  };
  readonly openLog: {
    readonly args: {
      readonly kind: "phpactor" | "tsserver";
      readonly rootPath: string;
    };
    readonly result: string;
  };
}

export type LanguageServerRuntimeIpcOperation = keyof LanguageServerRuntimeIpcContract;
export type LanguageServerRuntimeIpcArgs<Operation extends LanguageServerRuntimeIpcOperation> =
  LanguageServerRuntimeIpcContract[Operation]["args"];
export type LanguageServerRuntimeIpcResult<Operation extends LanguageServerRuntimeIpcOperation> =
  LanguageServerRuntimeIpcContract[Operation]["result"];

export type LanguageServerRuntimeCommandProfile = {
  readonly [Operation in Exclude<LanguageServerRuntimeIpcOperation, "openLog">]: string;
} & { readonly openLog?: string };

export type InvokeLanguageServerRuntimeCommand = (
  command: string,
  args?: InvokeArgs,
) => Promise<unknown>;

/** Associates a configurable PHP/TS command name with one stable operation contract. */
export function invokeLanguageServerRuntimeIpc<Operation extends LanguageServerRuntimeIpcOperation>(
  invokeCommand: InvokeLanguageServerRuntimeCommand,
  profile: LanguageServerRuntimeCommandProfile,
  operation: Operation,
  args: LanguageServerRuntimeIpcArgs<Operation>,
): Promise<LanguageServerRuntimeIpcResult<Operation>> {
  const command = profile[operation];
  if (!command) {
    return Promise.reject(new Error(`Missing command for language-server operation ${operation}.`));
  }
  return invokeCommand(command, args as InvokeArgs) as Promise<
    LanguageServerRuntimeIpcResult<Operation>
  >;
}

export function decodeLanguageServerRuntimeStatus(value: unknown): LanguageServerRuntimeStatus {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw invalidRuntimeStatus("expected a tagged object");
  }
  validateOptionalRootPath(value.rootPath);

  if (value.kind === "stopped") {
    return value as unknown as LanguageServerRuntimeStatus;
  }

  if (value.kind === "crashed") {
    if (typeof value.message !== "string") {
      throw invalidRuntimeStatus("crashed.message must be a string");
    }
    return value as unknown as LanguageServerRuntimeStatus;
  }

  if (value.kind === "starting") {
    validateSessionId(value.sessionId, "starting.sessionId");
    return value as unknown as LanguageServerRuntimeStatus;
  }

  if (value.kind === "running") {
    validateSessionId(value.sessionId, "running.sessionId");
    validateCapabilities(value.capabilities);
    return value as unknown as LanguageServerRuntimeStatus;
  }

  throw invalidRuntimeStatus(`unknown kind ${JSON.stringify(value.kind)}`);
}

export function decodeLanguageServerRuntimeLogPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Invalid language-server log IPC response: expected a string path.");
  }
  return value;
}

const REQUIRED_BOOLEAN_CAPABILITIES = [
  "callHierarchy",
  "codeAction",
  "codeActionResolve",
  "codeLens",
  "declaration",
  "hover",
  "completion",
  "definition",
  "documentHighlight",
  "documentLink",
  "documentSymbol",
  "didRenameFiles",
  "foldingRange",
  "formatting",
  "implementation",
  "inlayHint",
  "linkedEditingRange",
  "onTypeFormatting",
  "prepareRename",
  "rangeFormatting",
  "references",
  "rename",
  "selectionRange",
  "semanticTokens",
  "signatureHelp",
  "sourceDefinition",
  "typeDefinition",
  "typeHierarchy",
  "willRenameFiles",
  "workspaceSymbol",
] as const satisfies readonly (keyof LanguageServerRuntimeCapabilities)[];

const OPTIONAL_BOOLEAN_CAPABILITIES = [
  "didCreateFiles",
  "didDeleteFiles",
  "inlayHintResolve",
  "willCreateFiles",
  "willDeleteFiles",
] as const satisfies readonly (keyof LanguageServerRuntimeCapabilities)[];

function validateCapabilities(value: unknown): void {
  if (!isRecord(value)) {
    throw invalidRuntimeStatus("running.capabilities must be an object");
  }

  for (const key of REQUIRED_BOOLEAN_CAPABILITIES) {
    if (typeof value[key] !== "boolean") {
      throw invalidRuntimeStatus(`running.capabilities.${key} must be a boolean`);
    }
  }

  for (const key of OPTIONAL_BOOLEAN_CAPABILITIES) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      throw invalidRuntimeStatus(`running.capabilities.${key} must be a boolean when present`);
    }
  }

  if (
    value.onTypeFormattingTriggerCharacters !== undefined &&
    value.onTypeFormattingTriggerCharacters !== null &&
    (!Array.isArray(value.onTypeFormattingTriggerCharacters) ||
      value.onTypeFormattingTriggerCharacters.some((item) => typeof item !== "string"))
  ) {
    throw invalidRuntimeStatus(
      "running.capabilities.onTypeFormattingTriggerCharacters must be a string array or null",
    );
  }

  if (value.semanticTokensLegend !== undefined && value.semanticTokensLegend !== null) {
    if (
      !isRecord(value.semanticTokensLegend) ||
      !isStringArray(value.semanticTokensLegend.tokenModifiers) ||
      !isStringArray(value.semanticTokensLegend.tokenTypes)
    ) {
      throw invalidRuntimeStatus(
        "running.capabilities.semanticTokensLegend must contain string-array token fields",
      );
    }
  }
}

function validateOptionalRootPath(value: unknown): void {
  if (value !== undefined && typeof value !== "string") {
    throw invalidRuntimeStatus("rootPath must be a string when present");
  }
}

function validateSessionId(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidRuntimeStatus(`${field} must be a non-negative safe integer`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function invalidRuntimeStatus(reason: string): TypeError {
  return new TypeError(`Invalid language-server runtime IPC status: ${reason}.`);
}
