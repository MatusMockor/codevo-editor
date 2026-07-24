import type * as Monaco from "monaco-editor";
import type {
  LanguageServerCodeAction,
  LanguageServerCodeActionCommand,
  LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";

type MonacoModel = Monaco.editor.ITextModel;

export interface ProviderRegistrationAuthority {
  active: boolean;
}

export interface CodeActionAuthority {
  readonly model: MonacoModel;
  readonly modelVersionId: number | undefined;
  readonly path: string;
  readonly registration: ProviderRegistrationAuthority;
  readonly requestedOnly: string | null;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly workspaceId: string | null;
}

export interface ExecuteCodeActionCommandPayload {
  __codeActionAuthority?: CodeActionAuthority;
  command?: LanguageServerCodeActionCommand | null;
  edit?: LanguageServerWorkspaceEdit | null;
  path?: string;
  rootPath?: string;
  sessionId?: number;
}

export interface LanguageServerBackedCodeAction extends Monaco.languages.CodeAction {
  __codeActionAuthority?: CodeActionAuthority;
  __languageServerAction?: LanguageServerCodeAction;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceEditContext?: {
    path: string | null;
    versionId: number | undefined;
  };
  __workspaceRoot?: string;
}

export function createCodeActionAuthority(options: {
  model: MonacoModel;
  path: string;
  registration: ProviderRegistrationAuthority;
  requestedOnly: string | undefined;
  rootPath: string;
  sessionId: number;
  workspaceId: string | null;
}): CodeActionAuthority {
  return Object.freeze({
    ...options,
    modelVersionId:
      typeof options.model.getVersionId === "function" ? options.model.getVersionId() : undefined,
    requestedOnly: options.requestedOnly ?? null,
  });
}

export function codeActionAuthorityWithCurrentModelVersion(
  authority: CodeActionAuthority,
): CodeActionAuthority {
  return Object.freeze({
    ...authority,
    modelVersionId:
      typeof authority.model.getVersionId === "function"
        ? authority.model.getVersionId()
        : undefined,
  });
}

export function codeActionAuthorityMatches(
  authority: CodeActionAuthority,
  current: {
    activeDocumentPath: string | null;
    activeModel: MonacoModel | null | undefined;
    modelMatchesPath: boolean;
    rootAndSessionActive: boolean;
    workspaceId: string | null;
  },
  requireVersion = true,
): boolean {
  return (
    authority.registration.active &&
    current.rootAndSessionActive &&
    current.workspaceId === authority.workspaceId &&
    current.activeDocumentPath === authority.path &&
    current.modelMatchesPath &&
    (current.activeModel === undefined || current.activeModel === authority.model) &&
    (!requireVersion ||
      authority.modelVersionId === undefined ||
      authority.model.getVersionId() === authority.modelVersionId)
  );
}

export function attachPrivateCodeActionProperties(
  codeAction: LanguageServerBackedCodeAction,
  authority: CodeActionAuthority,
  action: LanguageServerCodeAction,
): void {
  Object.defineProperties(codeAction, {
    __codeActionAuthority: { value: authority },
    __languageServerAction: { value: Object.freeze({ ...action }) },
    __languageServerSessionId: { value: authority.sessionId },
    __sourcePath: { value: authority.path },
    __workspaceEditContext: {
      value: Object.freeze({
        path: authority.path,
        versionId: authority.modelVersionId,
      }),
    },
    __workspaceRoot: { value: authority.rootPath },
  });
}

export function privateCodeActionCommandPayload(
  authority: CodeActionAuthority,
  action: LanguageServerCodeAction,
): ExecuteCodeActionCommandPayload {
  const payload: ExecuteCodeActionCommandPayload = {};
  Object.defineProperties(payload, {
    __codeActionAuthority: { value: authority },
    command: { value: action.command },
    edit: { value: action.edit },
  });
  return Object.freeze(payload);
}
