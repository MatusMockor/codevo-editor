import { describe, expect, it, vi } from "vitest";
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import type {
  LanguageServerCompletionList,
  LanguageServerFeaturesGateway,
  LanguageServerHover,
  LanguageServerLocation,
} from "../domain/languageServerFeatures";
import type {
  LanguageServerCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";

describe("registerLanguageServerMonacoProviders", () => {
  it("registers php hover and completion providers and disposes them", () => {
    const registered = createRegisteredProviders();
    const context = providerContext();
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      context,
    );

    expect(registered.hoverLanguage).toBe("php");
    expect(registered.completionLanguage).toBe("php");

    disposable.dispose();

    expect(registered.hoverDispose).toHaveBeenCalled();
    expect(registered.completionDispose).toHaveBeenCalled();
  });

  it("does not request hover when the provider capability is disabled", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const context = providerContext({
      featuresGateway: gateway,
      runtimeStatus: runningStatus({ hover: false }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.hoverProvider.provideHover(model(), position()),
    ).resolves.toBeNull();
    expect(gateway.hover).not.toHaveBeenCalled();
  });

  it("flushes pending changes and maps hover responses", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      hover: { contents: "**User**" },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.hoverProvider.provideHover(model(), position()),
    ).resolves.toEqual({
      contents: [{ value: "**User**" }],
    });
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.hover).toHaveBeenCalledWith({
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("maps completion responses to Monaco suggestions", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "class",
            documentation: "A user",
            insertText: "User",
            label: "User",
          },
        ],
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(model(), position()),
    ).resolves.toEqual({
      suggestions: [
        {
          detail: "class",
          documentation: "A user",
          insertText: "User",
          kind: 1,
          label: "User",
          range: {
            endColumn: 5,
            endLineNumber: 11,
            startColumn: 2,
            startLineNumber: 11,
          },
        },
      ],
    });
    expect(gateway.completion).toHaveBeenCalledWith({
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });
});

function createRegisteredProviders() {
  const hoverDispose = vi.fn();
  const completionDispose = vi.fn();
  const registered: {
    completionDispose: ReturnType<typeof vi.fn>;
    completionLanguage: string | null;
    completionProvider: any;
    hoverDispose: ReturnType<typeof vi.fn>;
    hoverLanguage: string | null;
    hoverProvider: any;
    monaco: any;
  } = {
    completionDispose,
    completionLanguage: null,
    completionProvider: null,
    hoverDispose,
    hoverLanguage: null,
    hoverProvider: null,
    monaco: null,
  };
  registered.monaco = {
    languages: {
      CompletionItemKind: { Text: 1 },
      registerCompletionItemProvider: vi.fn((language, provider) => {
        registered.completionLanguage = language;
        registered.completionProvider = provider;
        return { dispose: completionDispose };
      }),
      registerHoverProvider: vi.fn((language, provider) => {
        registered.hoverLanguage = language;
        registered.hoverProvider = provider;
        return { dispose: hoverDispose };
      }),
    },
  };

  return registered;
}

function providerContext(
  overrides: Partial<{
    activeDocument: EditorDocument | null;
    featuresGateway: LanguageServerFeaturesGateway;
    flushPendingDocumentChange(path: string): Promise<void>;
    runtimeStatus: LanguageServerRuntimeStatus | null;
  }> = {},
) {
  const activeDocument = overrides.activeDocument ?? document();
  const runtimeStatus = overrides.runtimeStatus ?? runningStatus();

  return {
    featuresGateway: overrides.featuresGateway ?? featuresGateway(),
    flushPendingDocumentChange:
      overrides.flushPendingDocumentChange ?? vi.fn(async () => undefined),
    getActiveDocument: () => activeDocument,
    getRuntimeStatus: () => runtimeStatus,
    reportError: vi.fn(),
  };
}

function featuresGateway(
  responses: Partial<{
    completion: LanguageServerCompletionList;
    definition: LanguageServerLocation[];
    hover: LanguageServerHover | null;
  }> = {},
): LanguageServerFeaturesGateway {
  return {
    completion: vi.fn(async () =>
      responses.completion ?? {
        isIncomplete: false,
        items: [],
      },
    ),
    definition: vi.fn(async () => responses.definition ?? []),
    hover: vi.fn(async () => responses.hover ?? null),
  };
}

function runningStatus(
  capabilities: Partial<LanguageServerCapabilities> = {},
): LanguageServerRuntimeStatus {
  return {
    capabilities: {
      completion: true,
      definition: true,
      hover: true,
      ...capabilities,
    },
    kind: "running",
    sessionId: 1,
  };
}

function document(): EditorDocument {
  return {
    content: "<?php echo $user;",
    language: "php",
    name: "User.php",
    path: "/project/src/User.php",
    savedContent: "<?php echo $user;",
  };
}

function model() {
  return {
    getWordUntilPosition: vi.fn(() => ({
      endColumn: 5,
      startColumn: 2,
    })),
    uri: {
      fsPath: "/project/src/User.php",
      path: "/project/src/User.php",
    },
  };
}

function position() {
  return {
    column: 5,
    lineNumber: 11,
  };
}
