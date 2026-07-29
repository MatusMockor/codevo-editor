import type * as Monaco from "monaco-editor";
import type { DocumentHighlightRequestTracker } from "../../domain/documentHighlightRequestTracker";
import {
  toLanguageServerTextDocumentPosition,
  type IdentifiedLanguageServerRequestsPort,
  type LanguageServerLocation,
  type LanguageServerTextDocumentPosition,
} from "../../domain/languageServerFeatures";
import { providePhpFrameworkDefinitionBeforeLsp } from "../phpFrameworkMonacoProviders";
import {
  toLanguageServerFormattingOptions,
  toLanguageServerRange,
  toMonacoDocumentHighlight,
  toMonacoDocumentSymbol,
  toMonacoFoldingRange,
  toMonacoLinkedEditingRanges,
  toMonacoRange,
  toMonacoTextEdit,
} from "../languageServerMonacoMappings";
import type { LanguageServerMonacoProviderContext } from "./languageServerProviderContext";
import {
  FEATURE_REQUEST_CANCELLED,
  FEATURE_REQUEST_TIMED_OUT,
  featureDocumentRequestContext,
  featureRequestContext,
  flushPendingDocumentChangeForActiveRequest,
  isDocumentLifecyclePayloadActive,
  isFeatureRequestActive,
  reportErrorForActiveRequest,
  runOptionalIdentifiedFeatureRequest,
  shouldSkipLargePhpSmartProviders,
  workspaceSymbolRequestContext,
} from "./providerRequestLifecycle";
import {
  toMonacoDocumentLink,
  toMonacoLocation,
  toMonacoWorkspaceEdit,
  toMonacoWorkspaceSymbol,
  workspaceEditContext,
  type LanguageServerBackedLink,
} from "./providerProjections";
import type { MonacoWorkspaceSymbol } from "./providerRegistrationTypes";
import { applyWorkspaceEditWithOpenModels } from "./workspaceEditApplication";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

async function provideNavigationLocations(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature: "declaration" | "definition" | "implementation" | "references" | "typeDefinition",
  requestLocations: (
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ) => Promise<LanguageServerLocation[]>,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  const request = featureRequestContext(context, model, position, feature);

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const locations = await runOptionalIdentifiedFeatureRequest(
      context.featuresGateway,
      request.rootPath,
      request.sessionId,
      token,
      undefined,
      () => requestLocations(request.rootPath, request.position),
      (port, sessionId) =>
        identifiedNavigationRequest(port, feature, request.rootPath, request.position, sessionId),
    );

    if (locations === FEATURE_REQUEST_TIMED_OUT || locations === FEATURE_REQUEST_CANCELLED) {
      return null;
    }

    if (token?.isCancellationRequested) {
      return null;
    }

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return locations.flatMap((location) =>
      toMonacoLocation(
        monaco,
        request.rootPath,
        location,
        context.limitNavigationResultsToOpenModels === true,
      ),
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

function identifiedNavigationRequest(
  requests: IdentifiedLanguageServerRequestsPort,
  feature: "declaration" | "definition" | "implementation" | "references" | "typeDefinition",
  rootPath: string,
  position: LanguageServerTextDocumentPosition,
  sessionId: number,
): ReturnType<IdentifiedLanguageServerRequestsPort["definition"]> {
  switch (feature) {
    case "declaration":
      return requests.declaration(rootPath, position, sessionId);
    case "definition":
      return requests.definition(rootPath, position, sessionId);
    case "implementation":
      return requests.implementation(rootPath, position, sessionId);
    case "references":
      return requests.references(rootPath, position, sessionId);
    case "typeDefinition":
      return requests.typeDefinition(rootPath, position, sessionId);
  }
}

function defaultRenameLocation(
  model: MonacoModel,
  position: MonacoPosition,
): (Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null {
  const word = model.getWordAtPosition(position);

  if (!word) {
    return {
      rejectReason: "Cannot rename this symbol.",
    } as Monaco.languages.RenameLocation & Monaco.languages.Rejection;
  }

  return {
    range: {
      endColumn: word.endColumn,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      startLineNumber: position.lineNumber,
    },
    text: word.word,
  };
}

function documentLinkList(links: Monaco.languages.ILink[] = []): Monaco.languages.ILinksList {
  return {
    dispose: () => undefined,
    links,
  };
}
export async function prepareRename(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<(Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null> {
  const request = featureRequestContext(context, model, position, "prepareRename");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const prepareRename = await context.featuresGateway.prepareRename(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    if (!prepareRename?.range || prepareRename.defaultBehavior) {
      return defaultRenameLocation(model, position);
    }

    const range = toMonacoRange(monaco, prepareRename.range);

    return {
      range,
      text: prepareRename.placeholder ?? model.getValueInRange(range),
    };
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

export async function provideRenameEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  newName: string,
): Promise<Monaco.languages.WorkspaceEdit | null> {
  const request = featureRequestContext(context, model, position, "rename");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const edit = await context.featuresGateway.rename(request.rootPath, request.position, newName);

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    if (!edit) {
      return null;
    }

    if (context.applyWorkspaceEdit) {
      await applyWorkspaceEditWithOpenModels(monaco, context, edit, request.rootPath, {
        isStillActive: () => isFeatureRequestActive(context, request),
      });

      if (!isFeatureRequestActive(context, request)) {
        return null;
      }

      return { edits: [] };
    }

    return toMonacoWorkspaceEdit(monaco, workspaceEditContext(model), edit, request.rootPath);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

export async function provideReferences(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "references",
    (rootPath, requestPosition) => context.featuresGateway.references(rootPath, requestPosition),
    token,
  );
}

export async function provideDeclaration(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "declaration",
    (rootPath, requestPosition) => context.featuresGateway.declaration(rootPath, requestPosition),
    token,
  );
}

export async function provideDefinition(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  if (shouldSkipLargePhpSmartProviders(context, model)) {
    return null;
  }

  if (await providePhpFrameworkDefinitionBeforeLsp(context, model, position)) {
    return null;
  }

  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "definition",
    (rootPath, requestPosition) => context.featuresGateway.definition(rootPath, requestPosition),
    token,
  );
}

export async function provideImplementation(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "implementation",
    (rootPath, requestPosition) =>
      context.featuresGateway.implementation(rootPath, requestPosition),
    token,
  );
}

export async function provideTypeDefinition(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "typeDefinition",
    (rootPath, requestPosition) =>
      context.featuresGateway.typeDefinition(rootPath, requestPosition),
    token,
  );
}

export async function provideDocumentHighlights(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  tracker: DocumentHighlightRequestTracker<Monaco.languages.DocumentHighlight>,
  model: MonacoModel,
  position: MonacoPosition,
  token: Monaco.CancellationToken,
): Promise<Monaco.languages.DocumentHighlight[] | null> {
  const request = featureRequestContext(context, model, position, "documentHighlight");

  if (!request) {
    return null;
  }

  const word = model.getWordAtPosition(position)?.word ?? null;
  const version = model.getVersionId();

  if (word !== null) {
    const cached = tracker.cached(request.path, word, version);

    if (cached) {
      return cached;
    }
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const highlights = await context.featuresGateway.documentHighlights(
      request.rootPath,
      request.position,
    );

    if (token.isCancellationRequested) {
      return null;
    }

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    const mapped = highlights.map((highlight) => toMonacoDocumentHighlight(monaco, highlight));

    if (word !== null) {
      tracker.remember(request.path, word, version, mapped);
    }

    return mapped;
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

export async function provideFoldingRanges(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.FoldingRange[] | null> {
  const request = featureDocumentRequestContext(context, model, "foldingRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const ranges = await context.featuresGateway.foldingRanges(request.rootPath, request.path);

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return ranges.map((range) => toMonacoFoldingRange(monaco, range));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

export async function provideDocumentFormattingEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = featureDocumentRequestContext(context, model, "formatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return [];
    }

    const edits = await context.featuresGateway.formatting(
      request.rootPath,
      request.path,
      toLanguageServerFormattingOptions(options),
    );

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

export async function provideDocumentRangeFormattingEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = featureDocumentRequestContext(context, model, "rangeFormatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return [];
    }

    const edits = await context.featuresGateway.rangeFormatting(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      toLanguageServerFormattingOptions(options),
    );

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

export async function provideOnTypeFormattingEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  ch: string,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = featureDocumentRequestContext(context, model, "onTypeFormatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return [];
    }

    const edits = await context.featuresGateway.onTypeFormatting(
      request.rootPath,
      request.path,
      toLanguageServerTextDocumentPosition(request.path, position),
      ch,
      toLanguageServerFormattingOptions(options),
    );

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

export async function provideDocumentSymbols(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.DocumentSymbol[] | null> {
  const request = featureDocumentRequestContext(context, model, "documentSymbol");

  if (!request) {
    return null;
  }

  // BUG 2: skip the request until the document has been opened on the server.
  // An outline / breadcrumb DocumentSymbol fetch can otherwise fire before the
  // document's `didOpen` is sent, which phpactor answers with UnknownDocument.
  if (
    !context.requestDocumentLease &&
    context.isDocumentSynced &&
    !context.isDocumentSynced(request.rootPath, request.path)
  ) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const load = () => context.featuresGateway.documentSymbols(request.rootPath, request.path);
    const symbols = await (request.lifecycleIdentity == null
      ? load()
      : (context.coordinatePhpDocumentSymbols?.(
          {
            ...request,
            content: model.getValue(),
            lifecycleIdentity: request.lifecycleIdentity,
            runtimeIdentity: context.featuresGateway,
          },
          load,
        ) ?? load()));

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return symbols.map((symbol) => toMonacoDocumentSymbol(monaco, symbol));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

export async function provideWorkspaceSymbols(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  query: string,
): Promise<MonacoWorkspaceSymbol[]> {
  const request = workspaceSymbolRequestContext(context);

  if (!request) {
    return [];
  }

  try {
    const symbols = await context.featuresGateway.workspaceSymbols(request.rootPath, query);

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return symbols.flatMap((symbol) => toMonacoWorkspaceSymbol(monaco, request.rootPath, symbol));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

export async function provideLinkedEditingRanges(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.LinkedEditingRanges | null> {
  const request = featureRequestContext(context, model, position, "linkedEditingRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const ranges = await context.featuresGateway.linkedEditingRanges(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoLinkedEditingRanges(monaco, ranges);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

export async function provideDocumentLinks(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.ILinksList> {
  const request = featureDocumentRequestContext(context, model, "documentLink");

  if (!request) {
    return documentLinkList();
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return documentLinkList();
    }

    const links = await context.featuresGateway.documentLinks(request.rootPath, request.path);

    if (!isFeatureRequestActive(context, request)) {
      return documentLinkList();
    }

    return documentLinkList(
      links.map((link) =>
        toMonacoDocumentLink(
          monaco,
          request.rootPath,
          request.path,
          request.sessionId,
          request.lifecycleIdentity,
          link,
        ),
      ),
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return documentLinkList();
  }
}

export async function resolveDocumentLink(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  link: Monaco.languages.ILink,
): Promise<Monaco.languages.ILink> {
  const backedLink = link as LanguageServerBackedLink;

  if (
    !backedLink.__languageServerLink ||
    !backedLink.__sourcePath ||
    !backedLink.__workspaceRoot ||
    backedLink.__languageServerSessionId == null ||
    !isDocumentLifecyclePayloadActive(
      context,
      backedLink.__workspaceRoot,
      backedLink.__languageServerSessionId,
      backedLink.__sourcePath,
      backedLink.__documentLifecycleIdentity,
    )
  ) {
    return link;
  }

  try {
    await context.flushPendingDocumentChange(backedLink.__sourcePath);

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedLink.__workspaceRoot,
        backedLink.__languageServerSessionId,
        backedLink.__sourcePath,
        backedLink.__documentLifecycleIdentity,
      )
    ) {
      return link;
    }

    const resolved = await context.featuresGateway.resolveDocumentLink(
      backedLink.__workspaceRoot,
      backedLink.__languageServerLink,
    );

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedLink.__workspaceRoot,
        backedLink.__languageServerSessionId,
        backedLink.__sourcePath,
        backedLink.__documentLifecycleIdentity,
      )
    ) {
      return link;
    }

    return {
      ...link,
      ...toMonacoDocumentLink(
        monaco,
        backedLink.__workspaceRoot,
        backedLink.__sourcePath,
        backedLink.__languageServerSessionId,
        backedLink.__documentLifecycleIdentity,
        resolved,
      ),
    };
  } catch (error) {
    if (
      isDocumentLifecyclePayloadActive(
        context,
        backedLink.__workspaceRoot,
        backedLink.__languageServerSessionId,
        backedLink.__sourcePath,
        backedLink.__documentLifecycleIdentity,
      )
    ) {
      context.reportError(error);
    }

    return link;
  }
}
