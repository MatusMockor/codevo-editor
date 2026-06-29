import type {
  JavaScriptTypeScriptImportModuleSpecifierPreference,
  JavaScriptTypeScriptQuotePreference,
  JavaScriptTypeScriptVersionPreference,
  PhpBackendPreference,
} from "./settings";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

export interface LanguageServerCapabilities {
  callHierarchy: boolean;
  codeAction: boolean;
  codeActionResolve: boolean;
  codeLens: boolean;
  declaration: boolean;
  hover: boolean;
  completion: boolean;
  definition: boolean;
  documentHighlight: boolean;
  documentLink: boolean;
  documentSymbol: boolean;
  didCreateFiles?: boolean;
  didDeleteFiles?: boolean;
  didRenameFiles: boolean;
  foldingRange: boolean;
  formatting: boolean;
  implementation: boolean;
  inlayHint: boolean;
  linkedEditingRange: boolean;
  onTypeFormatting: boolean;
  prepareRename: boolean;
  rangeFormatting: boolean;
  references: boolean;
  rename: boolean;
  selectionRange: boolean;
  semanticTokens: boolean;
  signatureHelp: boolean;
  sourceDefinition: boolean;
  typeDefinition: boolean;
  typeHierarchy: boolean;
  willCreateFiles?: boolean;
  willDeleteFiles?: boolean;
  willRenameFiles: boolean;
  workspaceSymbol: boolean;
}

export interface LanguageServerSemanticTokensLegend {
  tokenModifiers: string[];
  tokenTypes: string[];
}

export interface LanguageServerRuntimeCapabilities
  extends LanguageServerCapabilities {
  onTypeFormattingTriggerCharacters?: string[] | null;
  semanticTokensLegend?: LanguageServerSemanticTokensLegend | null;
}

export type LanguageServerRuntimeStatus =
  | { kind: "starting"; rootPath?: string; sessionId: number }
  | {
      kind: "running";
      rootPath?: string;
      sessionId: number;
      capabilities: LanguageServerRuntimeCapabilities;
    }
  | { kind: "stopped"; rootPath?: string }
  | { kind: "crashed"; message: string; rootPath?: string };

export type UnsubscribeFn = () => void;

export interface LanguageServerRuntimeStartOptions {
  autoImportsEnabled?: boolean;
  automaticTypeAcquisitionEnabled?: boolean;
  codeLensEnabled?: boolean;
  inlayHintsEnabled?: boolean;
  importModuleSpecifierPreference?: JavaScriptTypeScriptImportModuleSpecifierPreference;
  intelephensePath?: string | null;
  preferTypeOnlyAutoImports?: boolean;
  phpBackend?: PhpBackendPreference;
  phpactorPath?: string | null;
  quotePreference?: JavaScriptTypeScriptQuotePreference;
  typeScriptVersionPreference?: JavaScriptTypeScriptVersionPreference;
  validationEnabled?: boolean;
}

export interface LanguageServerRuntimeGateway {
  getStatus(rootPath: string): Promise<LanguageServerRuntimeStatus>;
  start(
    rootPath: string,
    options?: LanguageServerRuntimeStartOptions,
  ): Promise<LanguageServerRuntimeStatus>;
  stop(rootPath: string): Promise<LanguageServerRuntimeStatus>;
  openLog(rootPath: string): Promise<string | null>;
  subscribeStatus(
    listener: (status: LanguageServerRuntimeStatus) => void,
  ): Promise<UnsubscribeFn>;
}

export interface LanguageServerStatusLabelOptions {
  workspaceRoot?: string | null;
}

export function languageServerStatusLabel(
  status: LanguageServerRuntimeStatus | null,
  serverName = "PHPactor",
  options: LanguageServerStatusLabelOptions = {},
): string | null {
  if (!status) {
    return null;
  }

  if (!languageServerStatusBelongsToWorkspace(status, options.workspaceRoot)) {
    return null;
  }

  const projectSuffix = languageServerProjectStatusSuffix(status, serverName);

  if (status.kind === "starting") {
    return `${serverName}: starting${projectSuffix}`;
  }

  if (status.kind === "running") {
    return `${serverName}: running${projectSuffix}`;
  }

  if (status.kind === "crashed") {
    return `${serverName}: crashed${projectSuffix}`;
  }

  return null;
}

export function languageServerStatusBelongsToWorkspace(
  status: LanguageServerRuntimeStatus,
  workspaceRoot: string | null | undefined,
): boolean {
  if (!workspaceRoot) {
    return true;
  }

  if (!status.rootPath) {
    return false;
  }

  return (
    normalizedWorkspaceRootKey(status.rootPath) ===
    normalizedWorkspaceRootKey(workspaceRoot)
  );
}

function languageServerProjectStatusSuffix(
  status: LanguageServerRuntimeStatus,
  serverName: string,
): string {
  if (serverName !== "TS Server" || !status.rootPath) {
    return "";
  }

  return " for this project";
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

  if (capabilities.callHierarchy) {
    labels.push("call hierarchy");
  }

  if (capabilities.hover) {
    labels.push("hover");
  }

  if (capabilities.completion) {
    labels.push("completion");
  }

  if (capabilities.definition) {
    labels.push("definition");
  }

  if (capabilities.declaration) {
    labels.push("declaration");
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

  if (capabilities.linkedEditingRange) {
    labels.push("linked editing");
  }

  if (capabilities.onTypeFormatting) {
    labels.push("on-type formatting");
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

  if (capabilities.semanticTokens) {
    labels.push("semantic tokens");
  }

  if (capabilities.signatureHelp) {
    labels.push("signature help");
  }

  if (capabilities.sourceDefinition) {
    labels.push("source definition");
  }

  if (capabilities.typeDefinition) {
    labels.push("type definition");
  }

  if (capabilities.typeHierarchy) {
    labels.push("type hierarchy");
  }

  if (capabilities.willCreateFiles) {
    labels.push("file create edits");
  }

  if (capabilities.didCreateFiles) {
    labels.push("file create notifications");
  }

  if (capabilities.willRenameFiles) {
    labels.push("file rename edits");
  }

  if (capabilities.didRenameFiles) {
    labels.push("file rename notifications");
  }

  if (capabilities.willDeleteFiles) {
    labels.push("file delete edits");
  }

  if (capabilities.didDeleteFiles) {
    labels.push("file delete notifications");
  }

  if (capabilities.workspaceSymbol) {
    labels.push("workspace symbols");
  }

  if (capabilities.codeAction) {
    labels.push("code actions");
  }

  if (capabilities.codeLens) {
    labels.push("code lens");
  }

  if (capabilities.formatting) {
    labels.push("formatting");
  }

  return labels;
}

export function emptyLanguageServerCapabilities(): LanguageServerCapabilities {
  return {
    callHierarchy: false,
    codeAction: false,
    codeActionResolve: false,
    codeLens: false,
    declaration: false,
    completion: false,
    definition: false,
    documentHighlight: false,
    documentLink: false,
    documentSymbol: false,
    didCreateFiles: false,
    didDeleteFiles: false,
    didRenameFiles: false,
    foldingRange: false,
    formatting: false,
    hover: false,
    implementation: false,
    inlayHint: false,
    linkedEditingRange: false,
    onTypeFormatting: false,
    prepareRename: false,
    rangeFormatting: false,
    references: false,
    rename: false,
    selectionRange: false,
    semanticTokens: false,
    signatureHelp: false,
    sourceDefinition: false,
    typeDefinition: false,
    typeHierarchy: false,
    willCreateFiles: false,
    willDeleteFiles: false,
    willRenameFiles: false,
    workspaceSymbol: false,
  };
}
