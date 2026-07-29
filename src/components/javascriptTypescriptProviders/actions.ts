import type * as Monaco from "monaco-editor";
import type {
  LanguageServerCodeAction,
  LanguageServerWorkspaceEdit,
} from "../../domain/languageServerFeatures";
import {
  attachPrivateCodeActionProperties,
  privateCodeActionCommandPayload,
  type CodeActionAuthority,
  type LanguageServerBackedCodeAction,
} from "../javascriptTypescriptCodeActionAuthority";

export function toJavaScriptTypeScriptMonacoCodeAction(
  monaco: typeof Monaco,
  commandId: string,
  appliesEditThroughWorkspaceApplier: boolean,
  authority: CodeActionAuthority,
  action: LanguageServerCodeAction,
  context: Monaco.languages.CodeActionContext,
  toWorkspaceEdit: (
    monaco: typeof Monaco,
    context: { path: string | null; versionId: number | undefined },
    edit: LanguageServerWorkspaceEdit,
    rootPath: string,
  ) => Monaco.languages.WorkspaceEdit,
): Monaco.languages.CodeAction[] {
  if (!action.edit && !action.command && action.data == null && !action.disabled) {
    return [];
  }
  const codeAction: LanguageServerBackedCodeAction = {
    diagnostics: context.markers,
    ...(action.command || action.edit
      ? {
          command: {
            arguments: [privateCodeActionCommandPayload(authority, action)],
            id: commandId,
            title: action.command?.title || action.title,
          },
        }
      : {}),
    ...(action.edit && !appliesEditThroughWorkspaceApplier
      ? {
          edit: toWorkspaceEdit(
            monaco,
            { path: authority.path, versionId: authority.modelVersionId },
            action.edit,
            authority.rootPath,
          ),
        }
      : {}),
    ...(action.disabled ? { disabled: action.disabled.reason } : {}),
    isPreferred: action.isPreferred,
    kind: action.kind ?? "quickfix",
    title: action.title,
  };
  attachPrivateCodeActionProperties(codeAction, authority, action);
  return [codeAction];
}
