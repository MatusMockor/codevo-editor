import type { JavaScriptTypeScriptVersionPreference } from "./settings";

export interface LanguageServerCapabilities {
  codeAction: boolean;
  hover: boolean;
  completion: boolean;
  definition: boolean;
  documentHighlight: boolean;
  documentLink: boolean;
  documentSymbol: boolean;
  foldingRange: boolean;
  formatting: boolean;
  implementation: boolean;
  inlayHint: boolean;
  prepareRename: boolean;
  rangeFormatting: boolean;
  references: boolean;
  rename: boolean;
  selectionRange: boolean;
  signatureHelp: boolean;
  workspaceSymbol: boolean;
}

export type LanguageServerRuntimeStatus =
  | { kind: "starting"; rootPath?: string; sessionId: number }
  | {
      kind: "running";
      rootPath?: string;
      sessionId: number;
      capabilities: LanguageServerCapabilities;
    }
  | { kind: "stopped"; rootPath?: string }
  | { kind: "crashed"; message: string; rootPath?: string };

export type UnsubscribeFn = () => void;

export interface LanguageServerRuntimeStartOptions {
  autoImportsEnabled?: boolean;
  inlayHintsEnabled?: boolean;
  typeScriptVersionPreference?: JavaScriptTypeScriptVersionPreference;
}

export interface LanguageServerRuntimeGateway {
  getStatus(rootPath: string): Promise<LanguageServerRuntimeStatus>;
  start(
    rootPath: string,
    options?: LanguageServerRuntimeStartOptions,
  ): Promise<LanguageServerRuntimeStatus>;
  stop(rootPath: string): Promise<LanguageServerRuntimeStatus>;
  subscribeStatus(
    listener: (status: LanguageServerRuntimeStatus) => void,
  ): Promise<UnsubscribeFn>;
}

export function languageServerStatusLabel(
  status: LanguageServerRuntimeStatus | null,
  serverName = "PHPactor",
): string | null {
  if (!status) {
    return null;
  }

  if (status.kind === "starting") {
    return `${serverName}: starting`;
  }

  if (status.kind === "running") {
    return `${serverName}: running`;
  }

  if (status.kind === "crashed") {
    return `${serverName}: crashed`;
  }

  return null;
}

export function languageServerCrashMessage(
  status: LanguageServerRuntimeStatus,
): string | null {
  if (status.kind !== "crashed") {
    return null;
  }

  return status.message;
}

export function isLanguageServerActive(
  status: LanguageServerRuntimeStatus | null,
): boolean {
  if (!status) {
    return false;
  }

  return status.kind === "starting" || status.kind === "running";
}

export function languageServerCapabilities(
  status: LanguageServerRuntimeStatus | null,
): LanguageServerCapabilities {
  if (status?.kind !== "running") {
    return emptyLanguageServerCapabilities();
  }

  return status.capabilities;
}

export function languageServerCapabilityLabels(
  status: LanguageServerRuntimeStatus | null,
): string[] {
  const capabilities = languageServerCapabilities(status);
  const labels: string[] = [];

  if (capabilities.hover) {
    labels.push("hover");
  }

  if (capabilities.completion) {
    labels.push("completion");
  }

  if (capabilities.definition) {
    labels.push("definition");
  }

  if (capabilities.documentSymbol) {
    labels.push("document symbols");
  }

  if (capabilities.documentHighlight) {
    labels.push("document highlights");
  }

  if (capabilities.documentLink) {
    labels.push("document links");
  }

  if (capabilities.foldingRange) {
    labels.push("folding");
  }

  if (capabilities.implementation) {
    labels.push("implementation");
  }

  if (capabilities.inlayHint) {
    labels.push("inlay hints");
  }

  if (capabilities.prepareRename) {
    labels.push("prepare rename");
  }

  if (capabilities.rangeFormatting) {
    labels.push("range formatting");
  }

  if (capabilities.references) {
    labels.push("references");
  }

  if (capabilities.rename) {
    labels.push("rename");
  }

  if (capabilities.selectionRange) {
    labels.push("smart selection");
  }

  if (capabilities.signatureHelp) {
    labels.push("signature help");
  }

  if (capabilities.workspaceSymbol) {
    labels.push("workspace symbols");
  }

  if (capabilities.codeAction) {
    labels.push("code actions");
  }

  if (capabilities.formatting) {
    labels.push("formatting");
  }

  return labels;
}

export function emptyLanguageServerCapabilities(): LanguageServerCapabilities {
  return {
    codeAction: false,
    completion: false,
    definition: false,
    documentHighlight: false,
    documentLink: false,
    documentSymbol: false,
    foldingRange: false,
    formatting: false,
    hover: false,
    implementation: false,
    inlayHint: false,
    prepareRename: false,
    rangeFormatting: false,
    references: false,
    rename: false,
    selectionRange: false,
    signatureHelp: false,
    workspaceSymbol: false,
  };
}
