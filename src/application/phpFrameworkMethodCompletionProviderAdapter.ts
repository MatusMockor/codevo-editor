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
  literalStringCompletions(
    context: PhpMethodCompletionLiteralStringRequestAdapterContext,
  ): Promise<PhpMethodCompletion[] | null>;
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

export interface PhpMethodCompletionLiteralStringRequestAdapterContext
  extends PhpMethodCompletionRequestAdapterContext {
  activeDocumentPath: string | null;
}

export interface PhpMethodCompletionAccessAdapterContext {
  accessContext: PhpMemberAccessCompletionContext | null;
  rootPath: string;
  staticAccessContext: PhpStaticAccessCompletionContext | null;
}

export const genericPhpFrameworkMethodCompletionProviderAdapter: PhpFrameworkMethodCompletionProviderAdapter =
  {
    ensureSourceCollectionsLoadedForAccess: () => undefined,
    literalStringCompletions: async () => null,
    relationStringCompletions: async () => null,
    routeActionCompletions: async () => null,
  };

export function composePhpFrameworkMethodCompletionProviderAdapters(
  adapters: readonly PhpFrameworkMethodCompletionProviderAdapter[],
): PhpFrameworkMethodCompletionProviderAdapter {
  if (adapters.length === 0) {
    return genericPhpFrameworkMethodCompletionProviderAdapter;
  }

  if (adapters.length === 1) {
    return adapters[0] ?? genericPhpFrameworkMethodCompletionProviderAdapter;
  }

  return {
    ensureSourceCollectionsLoadedForAccess: (context) => {
      for (const adapter of adapters) {
        adapter.ensureSourceCollectionsLoadedForAccess(context);
      }
    },
    literalStringCompletions: (context) =>
      firstHandledPhpMethodCompletionRequest(adapters, (adapter) =>
        adapter.literalStringCompletions(context),
      ),
    relationStringCompletions: (context) =>
      firstHandledPhpMethodCompletionRequest(adapters, (adapter) =>
        adapter.relationStringCompletions(context),
      ),
    routeActionCompletions: (context) =>
      firstHandledPhpMethodCompletionRequest(adapters, (adapter) =>
        adapter.routeActionCompletions(context),
      ),
  };
}

async function firstHandledPhpMethodCompletionRequest(
  adapters: readonly PhpFrameworkMethodCompletionProviderAdapter[],
  collectCompletions: (
    adapter: PhpFrameworkMethodCompletionProviderAdapter,
  ) => Promise<PhpMethodCompletion[] | null>,
): Promise<PhpMethodCompletion[] | null> {
  for (const adapter of adapters) {
    const completions = await collectCompletions(adapter);

    if (completions !== null) {
      return completions;
    }
  }

  return null;
}
