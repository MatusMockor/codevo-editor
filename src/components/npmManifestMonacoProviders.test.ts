import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { NpmPackageDescriptor } from "../domain/workspace";
import {
  registerNpmManifestMonacoProviders,
  type NpmManifestWorkspace,
} from "./npmManifestMonacoProviders";

describe("npm manifest Monaco providers", () => {
  it("registers JSON hover and completion providers", () => {
    const registered = monacoRegistration();
    const disposable = registerNpmManifestMonacoProviders(registered.monaco, {
      getWorkspace: () => workspace("/workspace", []),
    });

    expect(registered.hoverLanguage).toBe("json");
    expect(registered.completionLanguage).toBe("json");
    disposable.dispose();
    expect(registered.disposeHover).toHaveBeenCalledOnce();
    expect(registered.disposeCompletion).toHaveBeenCalledOnce();
  });

  it.each([
    "/workspace/composer.json",
    "/other/package.json",
    "/workspace/package.json.backup",
  ])("stays inactive for %s", (path) => {
    const registered = configuredRegistration();
    const source = '{"dependencies":{"react":"^19"}}';
    const position = positionAt(source, source.indexOf("react"));

    expect(registered.hoverProvider?.provideHover(model(path, source), position, {} as never)).toBeNull();
    expect(registered.completionProvider?.provideCompletionItems(model(path, source), position, {} as never, {} as never)).toBeNull();
  });

  it("shows declared and installed package metadata", () => {
    const registered = configuredRegistration();
    const source = '{"dependencies":{"react":"^19"}}';
    const result = registered.hoverProvider?.provideHover(
      model("/workspace/package.json", source),
      positionAt(source, source.indexOf("react") + 2),
      {} as never,
    ) as Monaco.languages.Hover;

    expect(result.contents[0]).toEqual({
      value: "**react**\n\nDeclared range: `^19`\n\nInstalled version: `19.1.0`\n\nDevelopment dependency: No",
    });
  });

  it("offers packages while excluding names already present in the active section", () => {
    const registered = configuredRegistration();
    const markedSource = `{
  "dependencies": { "react": "^19" },
  "devDependencies": { "rea|": "*" }
}`;
    const { offset, source } = sourceAtMarker(markedSource);
    const result = registered.completionProvider?.provideCompletionItems(
      model("/workspace/package.json", source),
      positionAt(source, offset),
      {} as never,
      {} as never,
    ) as Monaco.languages.CompletionList;

    expect(result.suggestions.map((item) => item.label)).toEqual(["react", "vitest"]);
  });

  it("uses the active workspace snapshot after a workspace switch", () => {
    const registered = monacoRegistration();
    let activeWorkspace = workspace("/one", [npmPackage("one")]);
    registerNpmManifestMonacoProviders(registered.monaco, {
      getWorkspace: () => activeWorkspace,
    });
    const markedSource = '{"dependencies":{"|":"*"}}';
    const { offset, source } = sourceAtMarker(markedSource);

    expect(completionLabels(registered, "/one/package.json", source, offset)).toEqual(["one"]);
    activeWorkspace = workspace("/two", [npmPackage("two")]);
    expect(completionLabels(registered, "/one/package.json", source, offset)).toEqual([]);
    expect(completionLabels(registered, "/two/package.json", source, offset)).toEqual(["two"]);
  });
});

function configuredRegistration() {
  const registered = monacoRegistration();
  registerNpmManifestMonacoProviders(registered.monaco, {
    getWorkspace: () => workspace("/workspace", [npmPackage("react"), npmPackage("vitest", true)]),
  });
  return registered;
}

function completionLabels(registered: ReturnType<typeof monacoRegistration>, path: string, source: string, offset: number) {
  const result = registered.completionProvider?.provideCompletionItems(model(path, source), positionAt(source, offset), {} as never, {} as never) as Monaco.languages.CompletionList | null;
  return result?.suggestions.map((suggestion) => suggestion.label) ?? [];
}

function workspace(rootPath: string, packages: NpmPackageDescriptor[]): NpmManifestWorkspace {
  return { packages, rootPath };
}

function npmPackage(name: string, dev = false): NpmPackageDescriptor {
  return { declaredRange: "^19.0.0", dev, installedVersion: "19.1.0", installPath: `/workspace/node_modules/${name}`, name };
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
      registerCompletionItemProvider: vi.fn((language, provider) => { completionLanguage = language; completionProvider = provider; return { dispose: disposeCompletion }; }),
      registerHoverProvider: vi.fn((language, provider) => { hoverLanguage = language; hoverProvider = provider; return { dispose: disposeHover }; }),
    },
    Range: class Range {
      constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
    },
  } as unknown as typeof Monaco;
  return { disposeCompletion, disposeHover, monaco, get completionProvider() { return completionProvider; }, get hoverProvider() { return hoverProvider; }, get completionLanguage() { return completionLanguage; }, get hoverLanguage() { return hoverLanguage; } };
}

function model(path: string, source: string): Monaco.editor.ITextModel {
  return { getOffsetAt: (position: Monaco.IPosition) => offsetAt(source, position), getPositionAt: (offset: number) => positionAt(source, offset), getValue: () => source, uri: { fsPath: path, path, scheme: "file", toString: () => `file://${path}` } } as Monaco.editor.ITextModel;
}

function sourceAtMarker(markedSource: string) {
  const offset = markedSource.indexOf("|");
  return { offset, source: markedSource.slice(0, offset) + markedSource.slice(offset + 1) };
}

function positionAt(source: string, offset: number): Monaco.Position {
  const lines = source.slice(0, offset).split("\n");
  return { column: (lines[lines.length - 1]?.length ?? 0) + 1, lineNumber: lines.length } as Monaco.Position;
}

function offsetAt(source: string, position: Monaco.IPosition): number {
  const lines = source.split("\n");
  let offset = 0;
  for (let line = 1; line < position.lineNumber; line += 1) {
    offset += (lines[line - 1]?.length ?? 0) + 1;
  }
  return offset + position.column - 1;
}
