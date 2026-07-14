import { detectNetteRedrawControlCompletionAt } from "../domain/netteAjaxSnippets";
import {
  phpNetteRedrawControlSnippetNameCompletions,
  type NetteSnippetCompletionTarget,
} from "./netteAjaxSnippetCompletions";
import type { PhpFrameworkMethodCompletionProviderAdapter } from "./phpFrameworkMethodCompletionProviderAdapter";

export interface PhpNetteMethodCompletionProviderAdapterDependencies {
  collectNetteRedrawControlSnippetTargets(
    currentPhpPath: string,
  ): Promise<readonly NetteSnippetCompletionTarget[]>;
}

export function createPhpNetteMethodCompletionProviderAdapter({
  collectNetteRedrawControlSnippetTargets,
}: PhpNetteMethodCompletionProviderAdapterDependencies): PhpFrameworkMethodCompletionProviderAdapter {
  return {
    ensureSourceCollectionsLoadedForAccess: () => undefined,
    literalStringCompletions: async ({
      activeDocumentPath,
      isRequestStillCurrent,
      position,
      source,
    }) => {
      const offset = offsetAtPosition(source, position);

      if (!detectNetteRedrawControlCompletionAt(source, offset)) {
        return null;
      }

      if (!activeDocumentPath) {
        return [];
      }

      const targets =
        await collectNetteRedrawControlSnippetTargets(activeDocumentPath);

      if (!isRequestStillCurrent()) {
        return [];
      }

      return (
        phpNetteRedrawControlSnippetNameCompletions(source, offset, targets) ??
        []
      );
    },
    relationStringCompletions: async () => null,
    routeActionCompletions: async () => null,
  };
}

function offsetAtPosition(source: string, position: {
  column: number;
  lineNumber: number;
}): number {
  let line = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}
