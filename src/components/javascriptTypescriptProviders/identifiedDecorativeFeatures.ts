import type * as Monaco from "monaco-editor";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerCodeActionCommand,
  LanguageServerCodeLens,
  LanguageServerInlayHint,
} from "../../domain/languageServerFeatures";
import type {
  JavaScriptTypeScriptDocumentRequestAuthority,
  StoredJavaScriptTypeScriptDocumentAuthority,
} from "../javascriptTypescriptProviderDocumentAuthority";
import { emptyCodeLensList, emptyInlayHintList } from "../emptyMonacoLanguageProviderResults";
import {
  toJavaScriptTypeScriptMonacoLocations,
  toJavaScriptTypeScriptShowReferencesArguments,
} from "../javascriptTypescriptMonacoNavigationLocations";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete,
  runBoundedJavaScriptTypeScriptProviderRequest,
  type JavaScriptTypeScriptProviderRequestCancellationPort,
} from "./requestBoundary";
import { toMonacoLanguageServerCommand } from "./completion";
import { toMonacoRange, toMonacoTextEdit, toLanguageServerRange } from "./sharedMappings";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;

interface IdentifiedDecorativeFeatureContext {
  readonly cancelRequest?: JavaScriptTypeScriptProviderRequestCancellationPort;
  readonly featuresGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway;
}

type StoredDecorativeFeaturePayload = StoredJavaScriptTypeScriptDocumentAuthority & {
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
};

interface IdentifiedDecorativeFeatureRequest extends JavaScriptTypeScriptDocumentRequestAuthority {
  readonly sessionId: number;
}

interface LanguageServerBackedCodeLens
  extends Monaco.languages.CodeLens, StoredDecorativeFeaturePayload {
  __languageServerCodeLens?: LanguageServerCodeLens;
}

interface LanguageServerBackedInlayHint
  extends Monaco.languages.InlayHint, StoredDecorativeFeaturePayload {
  __languageServerInlayHint?: LanguageServerInlayHint;
}

export interface JavaScriptTypeScriptIdentifiedDecorativeFeatureBoundary<
  Context extends IdentifiedDecorativeFeatureContext,
> {
  attachStoredAuthority<T extends object>(
    payload: T,
    authority:
      JavaScriptTypeScriptDocumentRequestAuthority | StoredJavaScriptTypeScriptDocumentAuthority,
  ): T;
  canResolveInlayHint(context: Context, rootPath: string, sessionId: number): boolean;
  createDocumentRequest(
    context: Context,
    model: MonacoModel,
    feature: "codeLens" | "inlayHint",
  ): IdentifiedDecorativeFeatureRequest | null;
  flushActiveRequest(
    context: Context,
    request: IdentifiedDecorativeFeatureRequest,
  ): Promise<boolean>;
  flushStoredPayload(context: Context, payload: StoredDecorativeFeaturePayload): Promise<boolean>;
  isActiveRequest(context: Context, request: IdentifiedDecorativeFeatureRequest): boolean;
  isStoredPayloadActive(context: Context, payload: StoredDecorativeFeaturePayload): boolean;
  isStoredSessionActive(context: Context, rootPath: string, sessionId: number): boolean;
  reportActiveRequestError(
    context: Context,
    request: IdentifiedDecorativeFeatureRequest,
    error: unknown,
  ): void;
  reportStoredPayloadError(
    context: Context,
    payload: StoredDecorativeFeaturePayload,
    error: unknown,
  ): void;
}

export function createJavaScriptTypeScriptIdentifiedDecorativeFeatureProviders<
  Context extends IdentifiedDecorativeFeatureContext,
>(
  monaco: MonacoApi,
  context: Context,
  boundary: JavaScriptTypeScriptIdentifiedDecorativeFeatureBoundary<Context>,
  executeLanguageServerCommandId: string,
): Pick<
  MonacoLanguagesProviderSet,
  "provideCodeLenses" | "resolveCodeLens" | "provideInlayHints" | "resolveInlayHint"
> {
  return {
    provideCodeLenses: (model, token) =>
      provideCodeLenses(monaco, context, boundary, executeLanguageServerCommandId, model, token),
    resolveCodeLens: (_model, codeLens, token) =>
      resolveCodeLens(monaco, context, boundary, executeLanguageServerCommandId, codeLens, token),
    provideInlayHints: (model, range, token) =>
      provideInlayHints(monaco, context, boundary, model, range, token),
    resolveInlayHint: (hint, token) => resolveInlayHint(monaco, context, boundary, hint, token),
  };
}

interface MonacoLanguagesProviderSet {
  provideCodeLenses: Monaco.languages.CodeLensProvider["provideCodeLenses"];
  resolveCodeLens: NonNullable<Monaco.languages.CodeLensProvider["resolveCodeLens"]>;
  provideInlayHints: Monaco.languages.InlayHintsProvider["provideInlayHints"];
  resolveInlayHint: NonNullable<Monaco.languages.InlayHintsProvider["resolveInlayHint"]>;
}

async function provideCodeLenses<Context extends IdentifiedDecorativeFeatureContext>(
  monaco: MonacoApi,
  context: Context,
  boundary: JavaScriptTypeScriptIdentifiedDecorativeFeatureBoundary<Context>,
  executeCommandId: string,
  model: MonacoModel,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.CodeLensList> {
  const request = boundary.createDocumentRequest(context, model, "codeLens");
  if (!request || token?.isCancellationRequested) {
    return emptyCodeLensList();
  }

  try {
    if (!(await boundary.flushActiveRequest(context, request)) || token?.isCancellationRequested) {
      return emptyCodeLensList();
    }
    const lenses = await runBoundedJavaScriptTypeScriptProviderRequest(
      context.featuresGateway.codeLenses(request.rootPath, request.path, request.sessionId),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(lenses) ||
      token?.isCancellationRequested ||
      !boundary.isActiveRequest(context, request)
    ) {
      return emptyCodeLensList();
    }
    return {
      lenses: lenses.map((lens) =>
        boundary.attachStoredAuthority(
          toMonacoCodeLens(
            monaco,
            executeCommandId,
            request.rootPath,
            request.sessionId,
            request.path,
            lens,
          ),
          request,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportActiveRequestError(context, request, error);
    }
    return emptyCodeLensList();
  }
}

async function resolveCodeLens<Context extends IdentifiedDecorativeFeatureContext>(
  monaco: MonacoApi,
  context: Context,
  boundary: JavaScriptTypeScriptIdentifiedDecorativeFeatureBoundary<Context>,
  executeCommandId: string,
  codeLens: Monaco.languages.CodeLens,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.CodeLens> {
  const backedCodeLens = codeLens as LanguageServerBackedCodeLens;
  if (
    token?.isCancellationRequested ||
    !backedCodeLens.__languageServerCodeLens ||
    !backedCodeLens.__workspaceRoot ||
    backedCodeLens.__languageServerSessionId == null ||
    !boundary.isStoredSessionActive(
      context,
      backedCodeLens.__workspaceRoot,
      backedCodeLens.__languageServerSessionId,
    )
  ) {
    return codeLens;
  }

  try {
    if (
      !(await boundary.flushStoredPayload(context, backedCodeLens)) ||
      token?.isCancellationRequested
    ) {
      return codeLens;
    }
    const resolved = await runBoundedJavaScriptTypeScriptProviderRequest(
      context.featuresGateway.resolveCodeLens(
        backedCodeLens.__workspaceRoot,
        backedCodeLens.__languageServerCodeLens,
        backedCodeLens.__languageServerSessionId,
      ),
      backedCodeLens.__languageServerSessionId,
      token,
      backedCodeLens.__workspaceRoot,
      undefined,
      context.cancelRequest,
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(resolved) ||
      token?.isCancellationRequested ||
      !boundary.isStoredPayloadActive(context, backedCodeLens)
    ) {
      return codeLens;
    }
    return boundary.attachStoredAuthority(
      {
        ...codeLens,
        ...toMonacoCodeLens(
          monaco,
          executeCommandId,
          backedCodeLens.__workspaceRoot,
          backedCodeLens.__languageServerSessionId,
          backedCodeLens.__sourcePath,
          resolved,
        ),
      },
      backedCodeLens,
    );
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportStoredPayloadError(context, backedCodeLens, error);
    }
    return codeLens;
  }
}

async function provideInlayHints<Context extends IdentifiedDecorativeFeatureContext>(
  monaco: MonacoApi,
  context: Context,
  boundary: JavaScriptTypeScriptIdentifiedDecorativeFeatureBoundary<Context>,
  model: MonacoModel,
  range: Monaco.Range,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.InlayHintList> {
  const request = boundary.createDocumentRequest(context, model, "inlayHint");
  if (!request || token?.isCancellationRequested) {
    return emptyInlayHintList();
  }

  try {
    if (!(await boundary.flushActiveRequest(context, request)) || token?.isCancellationRequested) {
      return emptyInlayHintList();
    }
    const hints = await runBoundedJavaScriptTypeScriptProviderRequest(
      context.featuresGateway.inlayHints(
        request.rootPath,
        request.path,
        toLanguageServerRange(range),
        request.sessionId,
      ),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(hints) ||
      token?.isCancellationRequested ||
      !boundary.isActiveRequest(context, request)
    ) {
      return emptyInlayHintList();
    }
    return {
      hints: hints.map((hint) =>
        boundary.attachStoredAuthority(
          toMonacoInlayHint(monaco, hint, request.rootPath, request.sessionId, request.path),
          request,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportActiveRequestError(context, request, error);
    }
    return emptyInlayHintList();
  }
}

async function resolveInlayHint<Context extends IdentifiedDecorativeFeatureContext>(
  monaco: MonacoApi,
  context: Context,
  boundary: JavaScriptTypeScriptIdentifiedDecorativeFeatureBoundary<Context>,
  hint: Monaco.languages.InlayHint,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.InlayHint> {
  const backedHint = hint as LanguageServerBackedInlayHint;
  if (
    token?.isCancellationRequested ||
    !backedHint.__languageServerInlayHint ||
    !backedHint.__workspaceRoot ||
    backedHint.__languageServerSessionId == null ||
    !boundary.isStoredSessionActive(
      context,
      backedHint.__workspaceRoot,
      backedHint.__languageServerSessionId,
    ) ||
    !boundary.canResolveInlayHint(
      context,
      backedHint.__workspaceRoot,
      backedHint.__languageServerSessionId,
    )
  ) {
    return hint;
  }

  try {
    if (
      !(await boundary.flushStoredPayload(context, backedHint)) ||
      token?.isCancellationRequested
    ) {
      return hint;
    }
    const resolvedHint = await runBoundedJavaScriptTypeScriptProviderRequest(
      context.featuresGateway.resolveInlayHint(
        backedHint.__workspaceRoot,
        backedHint.__languageServerInlayHint,
        backedHint.__languageServerSessionId,
      ),
      backedHint.__languageServerSessionId,
      token,
      backedHint.__workspaceRoot,
      undefined,
      context.cancelRequest,
    );
    if (
      javaScriptTypeScriptProviderRequestDidNotComplete(resolvedHint) ||
      token?.isCancellationRequested ||
      !boundary.isStoredPayloadActive(context, backedHint)
    ) {
      return hint;
    }
    return boundary.attachStoredAuthority(
      toMonacoInlayHint(
        monaco,
        resolvedHint,
        backedHint.__workspaceRoot,
        backedHint.__languageServerSessionId,
        backedHint.__sourcePath,
      ),
      backedHint,
    );
  } catch (error) {
    if (!token?.isCancellationRequested) {
      boundary.reportStoredPayloadError(context, backedHint, error);
    }
    return hint;
  }
}

function toMonacoCodeLens(
  monaco: MonacoApi,
  executeCommandId: string,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  lens: LanguageServerCodeLens,
): LanguageServerBackedCodeLens {
  return {
    __languageServerCodeLens: lens,
    __languageServerSessionId: sessionId,
    __sourcePath: sourcePath,
    __workspaceRoot: rootPath,
    ...(lens.command
      ? {
          command: toMonacoCodeLensCommand(
            monaco,
            executeCommandId,
            rootPath,
            sessionId,
            sourcePath,
            lens.command,
          ),
        }
      : {}),
    range: toMonacoRange(monaco, lens.range),
  };
}

function toMonacoCodeLensCommand(
  monaco: MonacoApi,
  executeCommandId: string,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  command: LanguageServerCodeActionCommand,
): Monaco.languages.Command {
  if (command.command === "editor.action.showReferences") {
    return {
      arguments: toJavaScriptTypeScriptShowReferencesArguments(
        monaco,
        command.arguments ?? [],
        rootPath,
      ),
      id: command.command,
      title: command.title,
    };
  }
  return {
    arguments: [{ command, ...(sourcePath ? { path: sourcePath } : {}), rootPath, sessionId }],
    id: executeCommandId,
    title: command.title || command.command,
  };
}

function toMonacoInlayHint(
  monaco: MonacoApi,
  hint: LanguageServerInlayHint,
  rootPath: string,
  sessionId: number,
  sourcePath?: string,
): Monaco.languages.InlayHint {
  const monacoHint: Monaco.languages.InlayHint = {
    kind: monacoInlayHintKindFromLspKind(monaco, hint.kind),
    label: toMonacoInlayHintLabel(monaco, hint.label, rootPath, sessionId, sourcePath),
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
    position: { column: hint.position.character + 1, lineNumber: hint.position.line + 1 },
    ...(hint.textEdits?.length
      ? { textEdits: hint.textEdits.map((edit) => toMonacoTextEdit(monaco, edit)) }
      : {}),
    tooltip: hint.tooltip || undefined,
  };
  Object.defineProperties(monacoHint, {
    __languageServerInlayHint: { value: hint },
    __languageServerSessionId: { value: sessionId },
    __sourcePath: { value: sourcePath },
    __workspaceRoot: { value: rootPath },
  });
  return monacoHint;
}

function toMonacoInlayHintLabel(
  monaco: MonacoApi,
  label: LanguageServerInlayHint["label"],
  rootPath: string,
  sessionId: number,
  sourcePath?: string,
): Monaco.languages.InlayHint["label"] {
  if (typeof label === "string") {
    return label;
  }
  return label.map((part) => {
    const [location] = part.location
      ? toJavaScriptTypeScriptMonacoLocations(monaco, [part.location], rootPath)
      : [];
    return {
      label: part.label,
      ...(part.command
        ? { command: toMonacoLanguageServerCommand(rootPath, sessionId, sourcePath, part.command) }
        : {}),
      ...(location ? { location } : {}),
      ...(part.tooltip ? { tooltip: part.tooltip } : {}),
    };
  });
}

function monacoInlayHintKindFromLspKind(
  monaco: MonacoApi,
  kind: number | null,
): Monaco.languages.InlayHintKind {
  if (kind === 2) {
    return monaco.languages.InlayHintKind.Parameter;
  }
  return monaco.languages.InlayHintKind.Type;
}
