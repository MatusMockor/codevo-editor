import type {
  JavaScriptTypeScriptVersionPreference,
  PhpBackendPreference,
} from "./settings";

export type LanguageServerProvider =
  | "intelephense"
  | "phpactor"
  | "typeScriptLanguageServer";

export type LanguageServerPlanStatus = "blocked" | "ready" | "unavailable";

export interface LanguageServerPlan {
  provider: LanguageServerProvider;
  status: LanguageServerPlanStatus;
  message: string;
  command: LanguageServerCommand | null;
  initializeRequest: JsonRpcRequest | null;
}

export interface LanguageServerCommand {
  executable: string;
  args: string[];
  workingDirectory: string;
}

export interface JsonRpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown;
}

export interface JavaScriptTypeScriptLanguageServerPlanOptions {
  autoImportsEnabled?: boolean;
  automaticTypeAcquisitionEnabled?: boolean;
  codeLensEnabled?: boolean;
  inlayHintsEnabled?: boolean;
  typeScriptVersionPreference?: JavaScriptTypeScriptVersionPreference;
  validationEnabled?: boolean;
}

export interface PhpLanguageServerPlanOptions {
  intelephensePath?: string | null;
  phpBackend?: PhpBackendPreference;
  phpactorPath?: string | null;
}

export interface LanguageServerGateway {
  planPhpLanguageServer(
    rootPath: string,
    options?: PhpLanguageServerPlanOptions,
  ): Promise<LanguageServerPlan>;
  planJavaScriptTypeScriptLanguageServer(
    rootPath: string,
    options?: JavaScriptTypeScriptLanguageServerPlanOptions,
  ): Promise<LanguageServerPlan>;
}
