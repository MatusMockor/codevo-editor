import type { EditorPosition } from "../domain/languageServerFeatures";
import type {
  PhpMemberAccessCompletionContext,
  PhpMethodCompletion,
  PhpStaticAccessCompletionContext,
} from "../domain/phpMethodCompletions";

export interface PhpFrameworkMethodCompletionProviderAdapter {
  ensureSourceCollectionsLoadedForAccess(
    context: PhpMethodCompletionAccessAdapterContext,
  ): void;
  relationStringCompletions(
    context: PhpMethodCompletionRequestAdapterContext,
  ): Promise<PhpMethodCompletion[] | null>;
  routeActionCompletions(
    context: PhpMethodCompletionRequestAdapterContext,
  ): Promise<PhpMethodCompletion[] | null>;
}

export interface PhpMethodCompletionRequestAdapterContext {
  isRequestStillCurrent: () => boolean;
  position: EditorPosition;
  source: string;
}

export interface PhpMethodCompletionAccessAdapterContext {
  accessContext: PhpMemberAccessCompletionContext | null;
  rootPath: string;
  staticAccessContext: PhpStaticAccessCompletionContext | null;
}

export const genericPhpFrameworkMethodCompletionProviderAdapter: PhpFrameworkMethodCompletionProviderAdapter =
  {
    ensureSourceCollectionsLoadedForAccess: () => undefined,
    relationStringCompletions: async () => null,
    routeActionCompletions: async () => null,
  };
