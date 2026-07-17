import {
  applyEslintFixes,
  type EslintFix,
} from "../domain/eslintDiagnostics";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";

export interface DocumentSaveParticipantContext {
  document: EditorDocument;
  requestedRoot: string;
  settings: WorkspaceSettings;
  isStale(): boolean;
}

export interface DocumentSaveParticipant {
  id: string;
  appliesTo(document: EditorDocument, settings: WorkspaceSettings): boolean;
  run(
    content: string,
    context: DocumentSaveParticipantContext,
  ): Promise<string>;
}

export interface DocumentSaveParticipantFailure {
  participantId: string;
  reason: "error" | "timeout";
  error: unknown;
}

export interface DocumentSaveParticipantsRun {
  content: string;
  failures: DocumentSaveParticipantFailure[];
}

export interface RunDocumentSaveParticipantsOptions {
  participants: readonly DocumentSaveParticipant[];
  content: string;
  context: DocumentSaveParticipantContext;
  timeoutMs?: number;
}

export const DEFAULT_DOCUMENT_SAVE_PARTICIPANT_TIMEOUT_MS = 2_000;

export async function runDocumentSaveParticipants(
  options: RunDocumentSaveParticipantsOptions,
): Promise<DocumentSaveParticipantsRun> {
  const { participants, context } = options;
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_DOCUMENT_SAVE_PARTICIPANT_TIMEOUT_MS;
  const failures: DocumentSaveParticipantFailure[] = [];
  let content = options.content;

  for (const participant of participants) {
    if (context.isStale()) {
      return { content: options.content, failures };
    }
    if (!participant.appliesTo(context.document, context.settings)) {
      continue;
    }

    const outcome = await runParticipantWithTimeout(
      participant,
      content,
      context,
      timeoutMs,
    );
    if (outcome.status !== "ok") {
      failures.push(outcome.failure);
      continue;
    }
    if (context.isStale()) {
      return { content: options.content, failures };
    }

    content = outcome.content;
  }

  return { content, failures };
}

type ParticipantOutcome =
  | { status: "ok"; content: string }
  | { status: "failed"; failure: DocumentSaveParticipantFailure };

async function runParticipantWithTimeout(
  participant: DocumentSaveParticipant,
  content: string,
  context: DocumentSaveParticipantContext,
  timeoutMs: number,
): Promise<ParticipantOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ status: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });

  try {
    const settled = await Promise.race([
      Promise.resolve()
        .then(() => participant.run(content, context))
        .then((next) => ({ status: "resolved" as const, next })),
      timeout,
    ]);
    if (settled.status === "timeout") {
      return {
        status: "failed",
        failure: {
          participantId: participant.id,
          reason: "timeout",
          error: new Error(
            `Save participant "${participant.id}" timed out after ${timeoutMs}ms.`,
          ),
        },
      };
    }
    if (typeof settled.next !== "string") {
      return {
        status: "failed",
        failure: {
          participantId: participant.id,
          reason: "error",
          error: new Error(
            `Save participant "${participant.id}" returned a non-string result.`,
          ),
        },
      };
    }

    return { status: "ok", content: settled.next };
  } catch (error) {
    return {
      status: "failed",
      failure: { participantId: participant.id, reason: "error", error },
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface DocumentSaveParticipantRegistry {
  eslintFixOnSave: DocumentSaveParticipant;
}

export function orderedDocumentSaveParticipants(
  registry: DocumentSaveParticipantRegistry,
): readonly DocumentSaveParticipant[] {
  return [registry.eslintFixOnSave];
}

export const eslintFixOnSaveParticipantId = "eslint.fixAll";

export interface EslintFixOnSaveParticipantDependencies {
  eslintFixesForFile(rootPath: string, path: string): readonly EslintFix[];
  isWorkspaceTrusted?(): boolean;
}

export function createEslintFixOnSaveParticipant(
  dependencies: EslintFixOnSaveParticipantDependencies,
): DocumentSaveParticipant {
  const { eslintFixesForFile, isWorkspaceTrusted = () => true } = dependencies;
  const appliedFixApplications = new Map<
    string,
    { signature: string; appliedToContent: string }
  >();

  return {
    id: eslintFixOnSaveParticipantId,
    appliesTo: (document, settings) =>
      settings.eslintFixOnSave &&
      isJavaScriptTypeScriptLanguageServerDocument(document),
    run: async (content, context) => {
      if (!isWorkspaceTrusted()) {
        return content;
      }
      if (content !== context.document.savedContent) {
        return content;
      }

      const fixes = eslintFixesForFile(
        context.requestedRoot,
        context.document.path,
      );
      if (fixes.length === 0) {
        return content;
      }

      const fileKey = `${context.requestedRoot}\n${context.document.path}`;
      const signature = JSON.stringify(fixes);
      const previous = appliedFixApplications.get(fileKey);
      if (
        previous &&
        previous.signature === signature &&
        previous.appliedToContent !== content
      ) {
        return content;
      }

      const applied = applyEslintFixes(content, fixes);
      if (applied.appliedCount === 0) {
        return content;
      }

      appliedFixApplications.set(fileKey, {
        signature,
        appliedToContent: content,
      });
      return applied.content;
    },
  };
}
