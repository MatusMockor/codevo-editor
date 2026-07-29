import type { LanguageServerWorkspaceEdit } from "../../domain/languageServerFeatures";
import {
  codeActionAuthorityWithCurrentModelVersion,
  type CodeActionAuthority,
  type ExecuteCodeActionCommandPayload,
} from "../javascriptTypescriptCodeActionAuthority";
import type { AppliedJavaScriptTypeScriptWorkspaceEditCommit } from "../javascriptTypescriptWorkspaceEditApplication";
import {
  createJavaScriptTypeScriptWorkspaceEditCommitReceipt,
  type JavaScriptTypeScriptWorkspaceEditCommitReceipt,
} from "../javascriptTypescriptWorkspaceEditContinuation";
import { javaScriptTypeScriptWorkspaceEditIsExactDocumentContinuation } from "../javascriptTypescriptWorkspaceEditScope";
import type { StoredJavaScriptTypeScriptDocumentAuthority } from "../javascriptTypescriptProviderDocumentAuthority";

export type JavaScriptTypeScriptExecuteCommandPayload = ExecuteCodeActionCommandPayload &
  StoredJavaScriptTypeScriptDocumentAuthority;

interface CommandExecutionContext {
  applyWorkspaceEdit?: unknown;
  featuresGateway: {
    executeCommand(
      rootPath: string,
      command: NonNullable<JavaScriptTypeScriptExecuteCommandPayload["command"]>,
    ): Promise<LanguageServerWorkspaceEdit | null>;
  };
  flushPendingDocumentChange(path: string): Promise<void>;
  getActiveJavaScriptTypeScriptOwnerEpoch(): number;
  getActiveJavaScriptTypeScriptOwnerIdentity(): object | null;
}

export interface JavaScriptTypeScriptCommandExecutionDependencies {
  applyWorkspaceEdit(
    edit: LanguageServerWorkspaceEdit,
    rootPath: string,
    isStillActive?: () => boolean,
    onApplied?: (commit: AppliedJavaScriptTypeScriptWorkspaceEditCommit) => void,
  ): Promise<boolean>;
  consumeWorkspaceEditContinuation(
    payload: JavaScriptTypeScriptExecuteCommandPayload,
    rootPath: string,
    sessionId: number,
    authority: CodeActionAuthority | undefined,
    receipt: JavaScriptTypeScriptWorkspaceEditCommitReceipt,
  ): boolean;
  flushStoredPayload(payload: JavaScriptTypeScriptExecuteCommandPayload): Promise<boolean>;
  isCodeActionAuthorityActive(authority: CodeActionAuthority, requireVersion?: boolean): boolean;
  isExecutableWorkspaceEditContinuationActive(
    payload: JavaScriptTypeScriptExecuteCommandPayload,
    rootPath: string,
    sessionId: number,
    authority: CodeActionAuthority | undefined,
    receipt: JavaScriptTypeScriptWorkspaceEditCommitReceipt,
  ): boolean;
  isPayloadActive(
    payload: JavaScriptTypeScriptExecuteCommandPayload,
    authority: CodeActionAuthority | undefined,
    requireVersion?: boolean,
  ): boolean;
  refreshPayloadAuthority(
    payload: JavaScriptTypeScriptExecuteCommandPayload,
    rootPath: string,
    sessionId: number,
  ): boolean;
  reportError(payload: JavaScriptTypeScriptExecuteCommandPayload, error: unknown): void;
}

export function createJavaScriptTypeScriptExecuteCommandHandler(
  context: CommandExecutionContext,
  dependencies: JavaScriptTypeScriptCommandExecutionDependencies,
): (payload: JavaScriptTypeScriptExecuteCommandPayload | undefined) => Promise<void> {
  return async (payload) => {
    if (!payload) {
      return;
    }
    const authority = payload.__codeActionAuthority;
    const rootPath = authority?.rootPath ?? payload.rootPath;
    const sessionId = authority?.sessionId ?? payload.sessionId;
    if (!rootPath || sessionId == null || !dependencies.isPayloadActive(payload, authority)) {
      return;
    }

    try {
      if (!(await dependencies.flushStoredPayload(payload))) {
        return;
      }
      if (!dependencies.isPayloadActive(payload, authority)) {
        return;
      }

      let commandAuthority = authority;
      if (payload.edit && context.applyWorkspaceEdit) {
        const continuationPath = authority?.path ?? payload.path;
        const continuationOwnerEpoch = context.getActiveJavaScriptTypeScriptOwnerEpoch();
        const continuationOwnerIdentity = context.getActiveJavaScriptTypeScriptOwnerIdentity();
        let commitReceipt: JavaScriptTypeScriptWorkspaceEditCommitReceipt | null = null;
        if (
          payload.command &&
          (!continuationPath ||
            !javaScriptTypeScriptWorkspaceEditIsExactDocumentContinuation(
              payload.edit,
              rootPath,
              continuationPath,
            ))
        ) {
          return;
        }
        const applied = await dependencies.applyWorkspaceEdit(
          payload.edit,
          rootPath,
          () =>
            commitReceipt
              ? dependencies.isExecutableWorkspaceEditContinuationActive(
                  payload,
                  rootPath,
                  sessionId,
                  authority,
                  commitReceipt,
                )
              : dependencies.isPayloadActive(payload, authority),
          (commit) => {
            commitReceipt = createJavaScriptTypeScriptWorkspaceEditCommitReceipt(
              authority,
              continuationPath,
              continuationOwnerEpoch,
              continuationOwnerIdentity,
              commit,
            );
          },
        );
        if (!applied) {
          return;
        }
        if (payload.command) {
          if (!continuationPath) {
            return;
          }
          await context.flushPendingDocumentChange(continuationPath);
          if (
            !commitReceipt ||
            !dependencies.consumeWorkspaceEditContinuation(
              payload,
              rootPath,
              sessionId,
              authority,
              commitReceipt,
            ) ||
            !dependencies.refreshPayloadAuthority(payload, rootPath, sessionId) ||
            (authority && !dependencies.isCodeActionAuthorityActive(authority, false))
          ) {
            return;
          }
        }
        commandAuthority = authority
          ? codeActionAuthorityWithCurrentModelVersion(authority)
          : undefined;
      }

      if (!dependencies.isPayloadActive(payload, commandAuthority) || !payload.command) {
        return;
      }
      const edit = await context.featuresGateway.executeCommand(rootPath, payload.command);
      if (!dependencies.isPayloadActive(payload, commandAuthority)) {
        return;
      }
      if (edit) {
        await dependencies.applyWorkspaceEdit(edit, rootPath, () =>
          dependencies.isPayloadActive(payload, commandAuthority, false),
        );
      }
    } catch (error) {
      dependencies.reportError(payload, error);
    }
  };
}
