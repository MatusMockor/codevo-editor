import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type {
  IdentifiedLanguageServerRequest,
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerHover,
} from "../../domain/languageServerFeatures";
import { projectLanguageServerHover, provideJavaScriptTypeScriptHover } from "./hover";
import type {
  JavaScriptTypeScriptProviderRequestCancellationPort,
  JavaScriptTypeScriptFeatureRequest,
  JavaScriptTypeScriptProviderRequestBoundary,
} from "./requestBoundary";

interface TestContext {
  readonly cancelRequest: JavaScriptTypeScriptProviderRequestCancellationPort;
  readonly featuresGateway: Pick<JavaScriptTypeScriptLanguageServerFeaturesGateway, "hover">;
}

describe("JavaScript/TypeScript hover projection", () => {
  it("preserves structured markdown, plaintext, fenced code and the exact LSP range", () => {
    expect(
      projectHover({
        contents: [
          { kind: "markdown", value: "**User**\n\n[docs](https://example.test)" },
          { kind: "plaintext", value: "value * is [literal]" },
          {
            kind: "code",
            language: "typescript",
            value: "const fence = ```;",
          },
        ],
        range: {
          end: { character: 11, line: 4 },
          start: { character: 3, line: 4 },
        },
      }),
    ).toEqual({
      contents: [
        {
          isTrusted: false,
          supportHtml: false,
          supportThemeIcons: false,
          value: "**User**\n\n[docs](https://example.test)",
        },
        {
          isTrusted: false,
          supportHtml: false,
          supportThemeIcons: false,
          value: "value \\* is \\[literal\\]",
        },
        {
          isTrusted: false,
          supportHtml: false,
          supportThemeIcons: false,
          value: "````typescript\nconst fence = ```;\n````",
        },
      ],
      range: {
        endColumn: 12,
        endLineNumber: 5,
        startColumn: 4,
        startLineNumber: 5,
      },
    });
  });

  it("fails closed for malformed, reversed and oversized projections", () => {
    expect(
      projectHover({
        contents: [{ kind: "code", value: "missing language" }],
      }),
    ).toBeNull();
    expect(
      projectHover({
        contents: [{ kind: "markdown", value: "hover" }],
        range: {
          end: { character: 1, line: 1 },
          start: { character: 2, line: 1 },
        },
      }),
    ).toBeNull();
    expect(
      projectHover({
        contents: [{ kind: "plaintext", value: "ž".repeat(8 * 1024 + 1) }],
      }),
    ).toBeNull();
    expect(
      projectHover({
        contents: Array.from({ length: 33 }, () => ({
          kind: "markdown" as const,
          value: "bounded",
        })),
      }),
    ).toBeNull();
    expect(
      projectHover({
        contents: Array.from({ length: 5 }, () => ({
          kind: "markdown" as const,
          value: "x".repeat(14 * 1024),
        })),
      }),
    ).toBeNull();
    expect(
      projectHover({
        contents: [{ kind: "unknown", value: "hover" }],
      } as unknown as LanguageServerHover),
    ).toBeNull();
  });

  it("retains the bounded legacy string projection during contract rollout", () => {
    expect(projectHover({ contents: "type User = { id: string }" })).toEqual({
      contents: [{ value: "type User = { id: string }" }],
      range: {
        endColumn: 5,
        endLineNumber: 5,
        startColumn: 5,
        startLineNumber: 5,
      },
    });
  });

  it("rejects a server range outside the current model or requested position", () => {
    expect(
      projectHover({
        contents: [{ kind: "markdown", value: "wrong symbol" }],
        range: {
          end: { character: 8, line: 2 },
          start: { character: 1, line: 2 },
        },
      }),
    ).toBeNull();
    expect(
      projectLanguageServerHover(
        {
          contents: [{ kind: "markdown", value: "outside document" }],
          range: {
            end: { character: 3, line: 99 },
            start: { character: 1, line: 99 },
          },
        },
        hoverModel(),
        hoverPosition(),
      ),
    ).toBeNull();
  });
});

describe("JavaScript/TypeScript hover request authority", () => {
  it("cancels an already-cancelled request through the existing backend cancellation port", async () => {
    const context = testContext(
      identifiedResponse(
        {
          contents: [{ kind: "markdown", value: "**stale**" }],
        },
        9,
        41,
      ),
    );
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    };

    await expect(
      provideJavaScriptTypeScriptHover(
        context,
        requestBoundary(),
        textModel(),
        { column: 2, lineNumber: 1 } as Monaco.Position,
        token,
      ),
    ).resolves.toBeNull();
    expect(context.cancelRequest).toHaveBeenCalledWith("/project", 9, 41);
  });

  it("drops a late hover after the exact session authority becomes stale", async () => {
    const pending = deferred<LanguageServerHover | null>();
    const request = identifiedPending(pending.promise, 9, 42);
    const context = testContext(request);
    let active = true;
    const boundary = requestBoundary(() => active);
    const result = provideJavaScriptTypeScriptHover(context, boundary, textModel(), {
      column: 2,
      lineNumber: 1,
    } as Monaco.Position);

    await vi.waitFor(() => expect(context.featuresGateway.hover).toHaveBeenCalledOnce());
    active = false;
    pending.resolve({
      contents: [{ kind: "markdown", value: "**stale session**" }],
    });

    await expect(result).resolves.toBeNull();
  });
});

function testContext(
  response: IdentifiedLanguageServerRequest<LanguageServerHover | null>,
): TestContext {
  return {
    cancelRequest: vi.fn(async () => undefined),
    featuresGateway: {
      hover: vi.fn(() => response),
    },
  };
}

function requestBoundary(
  isActive: () => boolean = () => true,
): JavaScriptTypeScriptProviderRequestBoundary<TestContext> {
  const request: JavaScriptTypeScriptFeatureRequest = {
    access: "full",
    model: textModel(),
    modelVersion: 1,
    ownerEpoch: 1,
    path: "/project/src/user.ts",
    position: {
      character: 1,
      line: 0,
      path: "/project/src/user.ts",
    },
    registrationLease: { active: true },
    rootPath: "/project",
    sessionId: 9,
    syncVersion: 1,
  };
  return {
    attachStoredAuthority: (payload) => payload,
    createFeatureRequest: () => request,
    flushActiveRequest: async () => isActive(),
    flushStoredPayload: async () => isActive(),
    isActiveRequest: () => isActive(),
    isStoredPayloadActive: () => isActive(),
    isStoredSessionActive: () => isActive(),
    reportActiveRequestError: vi.fn(),
    reportStoredPayloadError: vi.fn(),
  };
}

function identifiedResponse<T>(
  value: T,
  sessionId: number,
  requestId: number,
): IdentifiedLanguageServerRequest<T> {
  return identifiedPending(Promise.resolve(value), sessionId, requestId);
}

function identifiedPending<T>(
  promise: Promise<T>,
  sessionId: number,
  requestId: number,
): IdentifiedLanguageServerRequest<T> {
  return Object.assign(promise, { requestId, sessionId });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function textModel(): Monaco.editor.ITextModel {
  return {} as Monaco.editor.ITextModel;
}

function projectHover(hover: LanguageServerHover): Monaco.languages.Hover | null {
  return projectLanguageServerHover(hover, hoverModel(), hoverPosition());
}

function hoverPosition(): Monaco.Position {
  return { column: 5, lineNumber: 5 } as Monaco.Position;
}

function hoverModel(): Monaco.editor.ITextModel {
  return {
    isValidRange: (range: Monaco.IRange) =>
      range.startLineNumber >= 1 &&
      range.endLineNumber <= 10 &&
      range.startColumn >= 1 &&
      range.endColumn <= 100,
  } as Monaco.editor.ITextModel;
}
