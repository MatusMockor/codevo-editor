import {
  applyEslintFixes,
  type EslintAnalysisResult,
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
  timeoutMs?: number;
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
      participant.timeoutMs ?? timeoutMs,
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
  prettierFormatOnSave: DocumentSaveParticipant;
}

export function orderedDocumentSaveParticipants(
  registry: DocumentSaveParticipantRegistry,
): readonly DocumentSaveParticipant[] {
  return [registry.eslintFixOnSave, registry.prettierFormatOnSave];
}

export const eslintFixOnSaveParticipantId = "eslint.fixAll";
export const ESLINT_FIX_ON_SAVE_TIMEOUT_MS = 1_800;

export interface EslintFixOnSaveParticipantDependencies {
  analyseDocument(
    rootPath: string,
    path: string,
    content: string,
    binaryPath: string | null,
  ): Promise<EslintAnalysisResult>;
  isWorkspaceTrusted?(): boolean;
}

export function createEslintFixOnSaveParticipant(
  dependencies: EslintFixOnSaveParticipantDependencies,
): DocumentSaveParticipant {
  const { analyseDocument, isWorkspaceTrusted = () => true } = dependencies;

  return {
    id: eslintFixOnSaveParticipantId,
    timeoutMs: ESLINT_FIX_ON_SAVE_TIMEOUT_MS,
    appliesTo: (document, settings) =>
      settings.eslintFixOnSave &&
      isJavaScriptTypeScriptLanguageServerDocument(document),
    run: async (content, context) => {
      if (!isWorkspaceTrusted()) {
        return content;
      }
      if (context.isStale()) {
        return content;
      }

      const result = await analyseDocument(
        context.requestedRoot,
        context.document.path,
        content,
        context.settings.eslintPath,
      );
      if (
        context.isStale() ||
        !isWorkspaceTrusted() ||
        result.status !== "ok"
      ) {
        return content;
      }

      const fixes = result.diagnostics.flatMap((diagnostic) =>
        diagnostic.fix ? [diagnostic.fix] : [],
      );

      const applied = applyEslintFixes(content, fixes);
      return applied.appliedCount > 0 ? applied.content : content;
    },
  };
}
