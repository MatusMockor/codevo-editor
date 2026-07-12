import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { ComposerPackageDescriptor } from "../domain/workspace";
import {
  registerComposerManifestMonacoProviders,
  type ComposerManifestWorkspace,
} from "./composerManifestMonacoProviders";

describe("composer manifest Monaco providers", () => {
  it("registers JSON hover and completion providers", () => {
    const registered = monacoRegistration();

    const disposable = registerComposerManifestMonacoProviders(
      registered.monaco,
      { getWorkspace: () => workspace("/workspace", []) },
    );

    expect(registered.hoverLanguage).toBe("json");
    expect(registered.completionLanguage).toBe("json");

    disposable.dispose();
    expect(registered.disposeHover).toHaveBeenCalledOnce();
    expect(registered.disposeCompletion).toHaveBeenCalledOnce();
  });

  it("stays inactive for non-composer JSON files", () => {
    const registered = monacoRegistration();
    registerComposerManifestMonacoProviders(registered.monaco, {
      getWorkspace: () =>
        workspace("/workspace", [composerPackage("symfony/console", "7.3.1")]),
    });
    const source = '{"require":{"symfony/console":"^7"}}';
    const jsonModel = model("/workspace/package.json", source);
    const position = positionAt(source, source.indexOf("symfony/console"));

    expect(registered.hoverProvider?.provideHover(jsonModel, position, {} as never)).toBeNull();
    expect(
      registered.completionProvider?.provideCompletionItems(
        jsonModel,
        position,
        {} as never,
        {} as never,
      ),
    ).toBeNull();
  });

  it("offers installed packages with versions and excludes existing dependency keys", () => {
    const registered = monacoRegistration();
    registerComposerManifestMonacoProviders(registered.monaco, {
      getWorkspace: () =>
        workspace("/workspace", [
          composerPackage("symfony/console", "7.3.1"),
          composerPackage("psr/log", "3.0.2"),
          composerPackage("phpunit/phpunit", "11.5.0", true),
        ]),
    });
    const markedSource = `{
  "require": {
    "symfony/console": "^7",
    "|": "*"
  },
  "require-dev": {
    "phpunit/phpunit": "^11"
  }
}`;
    const { offset, source } = sourceAtMarker(markedSource);
    const result = registered.completionProvider?.provideCompletionItems(
      model("/workspace/composer.json", source),
      positionAt(source, offset),
      {} as never,
      {} as never,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        detail: "Installed version: 3.0.2",
        insertText: "psr/log",
        label: "psr/log",
      }),
    ]);
  });

  it("uses the active workspace package snapshot after a workspace switch", () => {
    const registered = monacoRegistration();
    let activeWorkspace = workspace("/one", [
      composerPackage("vendor/one", "1.0.0"),
    ]);
    registerComposerManifestMonacoProviders(registered.monaco, {
      getWorkspace: () => activeWorkspace,
    });
    const markedSource = '{"require":{"|":"*"}}';
    const { offset, source } = sourceAtMarker(markedSource);

    expect(completionLabels(registered, "/one/composer.json", source, offset)).toEqual([
      "vendor/one",
    ]);

    activeWorkspace = workspace("/two", [
      composerPackage("vendor/two", "2.0.0"),
    ]);

    expect(completionLabels(registered, "/one/composer.json", source, offset)).toEqual([]);
    expect(completionLabels(registered, "/two/composer.json", source, offset)).toEqual([
      "vendor/two",
    ]);
  });
});

function completionLabels(
  registered: ReturnType<typeof monacoRegistration>,
  path: string,
  source: string,
  offset: number,
) {
  const result = registered.completionProvider?.provideCompletionItems(
    model(path, source),
    positionAt(source, offset),
    {} as never,
    {} as never,
  ) as Monaco.languages.CompletionList | null;

  return result?.suggestions.map((suggestion) => suggestion.label) ?? [];
}

function workspace(
  rootPath: string,
  packages: ComposerPackageDescriptor[],
): ComposerManifestWorkspace {
  return { packages, rootPath };
}

function composerPackage(
  name: string,
  version: string,
  dev = false,
): ComposerPackageDescriptor {
  return {
    classmapRoots: [],
    dev,
    installPath: `${name.startsWith("/") ? "" : "/workspace/vendor/"}${name}`,
    name,
    packageType: "library",
    psr4Roots: [],
    version,
  };
}

function monacoRegistration() {
  let hoverProvider: Monaco.languages.HoverProvider | null = null;
  let completionProvider: Monaco.languages.CompletionItemProvider | null = null;
  let hoverLanguage: string | null = null;
  let completionLanguage: string | null = null;
  const disposeHover = vi.fn();
  const disposeCompletion = vi.fn();
  const monaco = {
    languages: {
      CompletionItemKind: { Module: 8 },
      registerCompletionItemProvider: vi.fn((language, provider) => {
        completionLanguage = language;
        completionProvider = provider;
        return { dispose: disposeCompletion };
      }),
      registerHoverProvider: vi.fn((language, provider) => {
        hoverLanguage = language;
        hoverProvider = provider;
        return { dispose: disposeHover };
      }),
    },
    Range: class Range {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
  } as unknown as typeof Monaco;

  return {
    disposeCompletion,
    disposeHover,
    monaco,
    get completionProvider() {
      return completionProvider;
    },
    get hoverProvider() {
      return hoverProvider;
    },
    get completionLanguage() {
      return completionLanguage;
    },
    get hoverLanguage() {
      return hoverLanguage;
    },
  };
}

function model(path: string, source: string): Monaco.editor.ITextModel {
  return {
    getOffsetAt: (position: Monaco.IPosition) => offsetAt(source, position),
    getPositionAt: (offset: number) => positionAt(source, offset),
    getValue: () => source,
    uri: {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    },
  } as Monaco.editor.ITextModel;
}

function sourceAtMarker(markedSource: string) {
  const offset = markedSource.indexOf("|");

  return {
    offset,
    source: markedSource.slice(0, offset) + markedSource.slice(offset + 1),
  };
}

function positionAt(source: string, offset: number): Monaco.Position {
  const lines = source.slice(0, offset).split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  } as Monaco.Position;
}

function offsetAt(source: string, position: Monaco.IPosition): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let line = 1; line < position.lineNumber; line += 1) {
    offset += (lines[line - 1]?.length ?? 0) + 1;
  }

  return offset + position.column - 1;
}
