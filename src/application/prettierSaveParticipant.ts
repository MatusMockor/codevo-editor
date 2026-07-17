import type { PrettierFormattingGateway } from "../domain/prettierFormatting";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import type { DocumentSaveParticipant } from "./documentSaveParticipants";

export const prettierSaveParticipantId = "prettier.formatOnSave";

export const PRETTIER_SAVE_PARTICIPANT_TIMEOUT_MS = 5_000;

export const prettierFormattableExtensions = [
  "js",
  "jsx",
  "cjs",
  "mjs",
  "ts",
  "tsx",
  "cts",
  "mts",
  "json",
  "css",
  "scss",
] as const;

const formattableExtensions: ReadonlySet<string> = new Set(
  prettierFormattableExtensions,
);

export function isPrettierFormattableDocument(
  document: EditorDocument,
): boolean {
  const fileName = document.path.split("/").pop() ?? "";
  const separatorIndex = fileName.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return false;
  }

  const extension = fileName.slice(separatorIndex + 1).toLowerCase();

  return formattableExtensions.has(extension);
}

export interface PrettierSaveParticipantDependencies {
  prettierFormatting: PrettierFormattingGateway;
  isWorkspaceTrusted?(): boolean;
}

export function createPrettierSaveParticipant(
  dependencies: PrettierSaveParticipantDependencies,
): DocumentSaveParticipant {
  const { prettierFormatting, isWorkspaceTrusted = () => true } = dependencies;

  return {
    id: prettierSaveParticipantId,
    timeoutMs: PRETTIER_SAVE_PARTICIPANT_TIMEOUT_MS,
    appliesTo: (document, settings) =>
      settings.prettierFormatOnSave && isPrettierFormattableDocument(document),
    run: async (content, context) => {
      if (!isWorkspaceTrusted()) {
        return content;
      }

      const relativePath = workspaceRelativePath(
        context.requestedRoot,
        context.document.path,
      );
      if (!relativePath) {
        return content;
      }

      const result = await prettierFormatting.format(
        context.requestedRoot,
        relativePath,
        content,
      );
      if (context.isStale()) {
        return content;
      }
      if (result.status === "ok") {
        return result.formatted;
      }
      if (result.status === "unavailable") {
        return content;
      }
      if (result.kind === "syntax") {
        return content;
      }

      throw new Error(result.message);
    },
  };
}
