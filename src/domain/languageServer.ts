import type { JavaScriptTypeScriptVersionPreference } from "./settings";

export type LanguageServerProvider = "phpactor" | "typeScriptLanguageServer";

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

export interface LanguageServerGateway {
  planPhpLanguageServer(rootPath: string): Promise<LanguageServerPlan>;
  planJavaScriptTypeScriptLanguageServer(
    rootPath: string,
    typeScriptVersionPreference?: JavaScriptTypeScriptVersionPreference,
  ): Promise<LanguageServerPlan>;
}
