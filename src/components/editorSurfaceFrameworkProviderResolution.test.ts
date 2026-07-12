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
    await expect(resolved.provideBladeCodeActions("", range())).resolves.toEqual(
      [],
    );
    await expect(
      resolved.provideBladeCompletions("", position()),
    ).resolves.toEqual([]);
    await expect(resolved.provideBladeDefinition("", 0)).resolves.toBe(false);
    await expect(
      resolved.provideLatteCompletions("", position()),
    ).resolves.toEqual([]);
    await expect(resolved.provideLatteDefinition("", 0)).resolves.toBe(false);
    await expect(
      resolved.provideNeonCompletions("", position()),
    ).resolves.toEqual([]);
    await expect(resolved.provideNeonDefinition("", 0)).resolves.toBe(false);
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

    expect(first.provideBladeDefinition).toBe(
      firstProviders.provideBladeDefinition,
    );
    expect(second.provideBladeDefinition).toBe(
      secondProviders.provideBladeDefinition,
    );
    expect(first.provideBladeDefinition).not.toBe(second.provideBladeDefinition);
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
