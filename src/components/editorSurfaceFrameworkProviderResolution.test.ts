import { describe, expect, it, vi } from "vitest";
import {
  resolveEditorSurfaceFrameworkProviders,
  type EditorSurfaceFrameworkIntelligenceProviders,
} from "./editorSurfaceFrameworkProviderResolution";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpCodeActionRange } from "./languageServerMonacoProviders";

describe("editor surface framework provider resolution", () => {
  it("uses no-op providers when no framework callbacks are registered", async () => {
    const resolved = resolveEditorSurfaceFrameworkProviders({});

    await expect(resolved.providePhpFrameworkDefinition("", 0)).resolves.toBe(
      false,
    );
    await expect(
      resolved.templateLanguageProviders.blade.provideCodeActions("", range()),
    ).resolves.toEqual([]);
    await expect(
      resolved.templateLanguageProviders.blade.provideCompletions(
        "",
        position(),
      ),
    ).resolves.toEqual([]);
    await expect(
      resolved.templateLanguageProviders.blade.provideDefinition("", 0),
    ).resolves.toBe(false);
    await expect(
      resolved.templateLanguageProviders.latte.provideCompletions(
        "",
        position(),
      ),
    ).resolves.toEqual([]);
    await expect(
      resolved.templateLanguageProviders.latte.provideCodeActions("", range()),
    ).resolves.toEqual([]);
    await expect(
      resolved.templateLanguageProviders.latte.provideDefinition("", 0),
    ).resolves.toBe(false);
    await expect(
      resolved.templateLanguageProviders.neon.provideCompletions(
        "",
        position(),
      ),
    ).resolves.toEqual([]);
    await expect(
      resolved.templateLanguageProviders.neon.provideDefinition("", 0),
    ).resolves.toBe(false);
    await expect(
      resolved.providePhpPresenterLinkDefinition("", 0),
    ).resolves.toBe(false);
    await expect(
      resolved.providePhpPresenterLinkCompletions("", 0),
    ).resolves.toBeNull();
    expect(resolved.isPhpPresenterLinkCompletionContext("", 0)).toBe(false);
    expect(
      resolved.isPhpFrameworkStringCompletionContext("", position()),
    ).toBe(false);
  });

  it("uses the current framework definition callback when registered", async () => {
    const providePhpFrameworkDefinition = vi.fn(async () => true);
    const resolved = resolveEditorSurfaceFrameworkProviders({
      providePhpFrameworkDefinition,
    });

    await expect(
      resolved.providePhpFrameworkDefinition("source", 12),
    ).resolves.toBe(true);
    expect(providePhpFrameworkDefinition).toHaveBeenCalledWith("source", 12);
  });

  it("uses canonical presenter-link callbacks when registered", async () => {
    const providePhpPresenterLinkDefinition = vi.fn(async () => true);
    const providePhpPresenterLinkCompletions = vi.fn(async () => [
      { insertText: "Product:show", kind: "link" as const, label: "Product:show" },
    ]);
    const resolved = resolveEditorSurfaceFrameworkProviders({
      frameworkIntelligenceProviders: {
        providePhpPresenterLinkCompletions,
        providePhpPresenterLinkDefinition,
      },
    });

    await expect(
      resolved.providePhpPresenterLinkDefinition("source", 3),
    ).resolves.toBe(true);
    await expect(
      resolved.providePhpPresenterLinkCompletions("source", 3),
    ).resolves.toEqual([
      { insertText: "Product:show", kind: "link", label: "Product:show" },
    ]);
    expect(providePhpPresenterLinkDefinition).toHaveBeenCalledWith("source", 3);
    expect(providePhpPresenterLinkCompletions).toHaveBeenCalledWith("source", 3);
    expect(resolved.providePhpPresenterLinkDefinition).toBe(
      providePhpPresenterLinkDefinition,
    );
    expect(resolved.providePhpPresenterLinkCompletions).toBe(
      providePhpPresenterLinkCompletions,
    );
    expect(resolved.templateLanguageProviders.latte).not.toHaveProperty(
      "providePhpPresenterLinkDefinition",
    );
    expect(resolved.templateLanguageProviders.latte).not.toHaveProperty(
      "providePhpPresenterLinkCompletions",
    );
  });

  it("resolves exactly the blade, latte, and neon template languages", () => {
    const resolved = resolveEditorSurfaceFrameworkProviders({});

    expect(Object.keys(resolved.templateLanguageProviders).sort()).toEqual([
      "blade",
      "latte",
      "neon",
    ]);
  });

  it("passes registered template language callbacks through unchanged", () => {
    const providers = frameworkProviders({
      provideBladeCodeActions: vi.fn(async () => []),
      provideBladeCompletions: vi.fn(async () => []),
      provideBladeDefinition: vi.fn(async () => true),
      provideLatteCodeActions: vi.fn(async () => []),
      provideLatteCompletions: vi.fn(async () => []),
      provideLatteDefinition: vi.fn(async () => true),
      provideNeonCompletions: vi.fn(async () => []),
      provideNeonDefinition: vi.fn(async () => true),
    });

    const resolved = resolveEditorSurfaceFrameworkProviders({
      frameworkIntelligenceProviders: providers,
    });
    const registry = resolved.templateLanguageProviders;

    expect(registry.blade.provideCodeActions).toBe(
      providers.provideBladeCodeActions,
    );
    expect(registry.blade.provideCompletions).toBe(
      providers.provideBladeCompletions,
    );
    expect(registry.blade.provideDefinition).toBe(
      providers.provideBladeDefinition,
    );
    expect(registry.latte.provideCodeActions).toBe(
      providers.provideLatteCodeActions,
    );
    expect(registry.latte.provideCompletions).toBe(
      providers.provideLatteCompletions,
    );
    expect(registry.latte.provideDefinition).toBe(
      providers.provideLatteDefinition,
    );
    expect(registry.neon.provideCompletions).toBe(
      providers.provideNeonCompletions,
    );
    expect(registry.neon.provideDefinition).toBe(
      providers.provideNeonDefinition,
    );
  });

  it("preserves distinct callback identities for separate provider sets", () => {
    const firstProviders = frameworkProviders({
      provideBladeDefinition: vi.fn(async () => true),
    });
    const secondProviders = frameworkProviders({
      provideBladeDefinition: vi.fn(async () => false),
    });

    const first = resolveEditorSurfaceFrameworkProviders({
      frameworkIntelligenceProviders: firstProviders,
    });
    const second = resolveEditorSurfaceFrameworkProviders({
      frameworkIntelligenceProviders: secondProviders,
    });

    expect(first.templateLanguageProviders.blade.provideDefinition).toBe(
      firstProviders.provideBladeDefinition,
    );
    expect(second.templateLanguageProviders.blade.provideDefinition).toBe(
      secondProviders.provideBladeDefinition,
    );
    expect(first.templateLanguageProviders.blade.provideDefinition).not.toBe(
      second.templateLanguageProviders.blade.provideDefinition,
    );
  });
});

function frameworkProviders(
  providers: EditorSurfaceFrameworkIntelligenceProviders,
): EditorSurfaceFrameworkIntelligenceProviders {
  return providers;
}

function position(): EditorPosition {
  return { column: 1, lineNumber: 1 };
}

function range(): PhpCodeActionRange {
  return {
    end: 0,
    start: 0,
  };
}
