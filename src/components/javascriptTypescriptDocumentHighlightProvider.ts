import type * as Monaco from "monaco-editor";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerDocumentHighlight,
  LanguageServerTextDocumentPosition,
} from "../domain/languageServerFeatures";
import {
  MAX_DOCUMENT_HIGHLIGHT_RESULTS,
  type DocumentHighlightRequestTracker,
} from "../domain/documentHighlightRequestTracker";
import { DOCUMENT_HIGHLIGHT_REQUEST_TIMEOUT_MS } from "./languageServerRequestCancellation";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete,
  runBoundedJavaScriptTypeScriptProviderRequest,
} from "./javascriptTypescriptProviderRequestBoundary";

interface DocumentHighlightRequestAuthority {
  readonly ownerEpoch: number;
  readonly path: string;
  readonly position: LanguageServerTextDocumentPosition;
  readonly rootPath: string;
  readonly sessionId: number;
}

interface DocumentHighlightModel {
  getVersionId(): number;
  getWordAtPosition(position: Monaco.IPosition): { readonly word: string } | null;
}

type CancelRequest = (rootPath: string, sessionId: number, requestId: number) => Promise<void>;

export async function provideJavaScriptTypeScriptDocumentHighlights({
  cancelRequest,
  featuresGateway,
  flushPendingDocumentChange,
  isRequestActive,
  model,
  monaco,
  position,
  reportError,
  request,
  token,
  tracker,
}: {
  readonly cancelRequest?: CancelRequest;
  readonly featuresGateway: Pick<
    JavaScriptTypeScriptLanguageServerFeaturesGateway,
    "documentHighlights"
  >;
  readonly flushPendingDocumentChange: () => Promise<boolean>;
  readonly isRequestActive: () => boolean;
  readonly model: DocumentHighlightModel;
  readonly monaco: typeof Monaco;
  readonly position: Monaco.IPosition;
  readonly reportError: (error: unknown) => void;
  readonly request: DocumentHighlightRequestAuthority;
  readonly token?: Monaco.CancellationToken;
  readonly tracker: DocumentHighlightRequestTracker<Monaco.languages.DocumentHighlight>;
}): Promise<Monaco.languages.DocumentHighlight[] | null> {
  const word = model.getWordAtPosition(position)?.word ?? null;
  const version = model.getVersionId();
  const cacheKey =
    word === null
      ? null
      : JSON.stringify([
          word,
          request.position.line,
          request.position.character,
          request.sessionId,
          request.ownerEpoch,
        ]);
  const isCancelled = () => token?.isCancellationRequested === true;

  try {
    if (!(await flushPendingDocumentChange())) {
      return null;
    }
    if (isCancelled() || !isRequestActive()) {
      return null;
    }

    const cached = cacheKey === null ? undefined : tracker.cached(request.path, cacheKey, version);
    if (cached) {
      return cached;
    }

    const highlights = await runBoundedJavaScriptTypeScriptProviderRequest(
      featuresGateway.documentHighlights(request.rootPath, request.position, request.sessionId),
      request.sessionId,
      token,
      request.rootPath,
      DOCUMENT_HIGHLIGHT_REQUEST_TIMEOUT_MS,
      cancelRequest,
    );

    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(highlights) ||
      highlights.length > MAX_DOCUMENT_HIGHLIGHT_RESULTS ||
      isCancelled() ||
      !isRequestActive()
    ) {
      return null;
    }

    const mapped = highlights.map((highlight) => toMonacoDocumentHighlight(monaco, highlight));

    if (cacheKey !== null && !isCancelled() && isRequestActive()) {
      tracker.remember(request.path, cacheKey, version, mapped);
    }
    return mapped;
  } catch (error) {
    reportError(error);
    return null;
  }
}

function toMonacoDocumentHighlight(
  monaco: typeof Monaco,
  highlight: LanguageServerDocumentHighlight,
): Monaco.languages.DocumentHighlight {
  let kind = monaco.languages.DocumentHighlightKind.Text;
  if (highlight.kind === 2) {
    kind = monaco.languages.DocumentHighlightKind.Read;
  } else if (highlight.kind === 3) {
    kind = monaco.languages.DocumentHighlightKind.Write;
  }
  return {
    kind,
    range: new monaco.Range(
      highlight.range.start.line + 1,
      highlight.range.start.character + 1,
      highlight.range.end.line + 1,
      highlight.range.end.character + 1,
    ),
  };
}
