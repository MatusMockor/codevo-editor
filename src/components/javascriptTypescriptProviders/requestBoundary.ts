import type * as Monaco from "monaco-editor";
import type { LanguageServerTextDocumentPosition } from "../../domain/languageServerFeatures";
import type {
  JavaScriptTypeScriptDocumentRequestAuthority,
  StoredJavaScriptTypeScriptDocumentAuthority,
} from "../javascriptTypescriptProviderDocumentAuthority";

export type JavaScriptTypeScriptInteractiveFeature =
  | "completion"
  | "declaration"
  | "definition"
  | "hover"
  | "implementation"
  | "prepareRename"
  | "references"
  | "rename"
  | "signatureHelp"
  | "typeDefinition";

export interface JavaScriptTypeScriptFeatureRequest extends JavaScriptTypeScriptDocumentRequestAuthority {
  readonly position: LanguageServerTextDocumentPosition;
  readonly sessionId: number;
}

export interface JavaScriptTypeScriptStoredProviderPayload extends StoredJavaScriptTypeScriptDocumentAuthority {
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

export interface JavaScriptTypeScriptProviderRequestBoundary<Context> {
  attachStoredAuthority<T extends object>(
    payload: T,
    authority:
      JavaScriptTypeScriptDocumentRequestAuthority | StoredJavaScriptTypeScriptDocumentAuthority,
  ): T;
  createFeatureRequest(
    context: Context,
    model: Monaco.editor.ITextModel,
    position: Monaco.Position,
    feature: JavaScriptTypeScriptInteractiveFeature,
  ): JavaScriptTypeScriptFeatureRequest | null;
  flushActiveRequest(
    context: Context,
    request: JavaScriptTypeScriptFeatureRequest,
  ): Promise<boolean>;
  flushStoredPayload(
    context: Context,
    payload: JavaScriptTypeScriptStoredProviderPayload,
  ): Promise<boolean>;
  isActiveRequest(context: Context, request: JavaScriptTypeScriptFeatureRequest): boolean;
  isStoredPayloadActive(
    context: Context,
    payload: JavaScriptTypeScriptStoredProviderPayload,
  ): boolean;
  isStoredSessionActive(context: Context, rootPath: string, sessionId: number): boolean;
  reportActiveRequestError(
    context: Context,
    request: JavaScriptTypeScriptFeatureRequest,
    error: unknown,
  ): void;
  reportStoredPayloadError(
    context: Context,
    payload: JavaScriptTypeScriptStoredProviderPayload,
    error: unknown,
  ): void;
}
