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

  it("prefers current framework definition callbacks over Laravel aliases", async () => {
    const providePhpFrameworkDefinition = vi.fn(async () => true);
    const providePhpLaravelDefinition = vi.fn(async () => false);
    const resolved = resolveEditorSurfaceFrameworkProviders({
      providePhpFrameworkDefinition,
      providePhpLaravelDefinition,
    });

    await expect(
      resolved.providePhpFrameworkDefinition("source", 12),
    ).resolves.toBe(true);
    expect(providePhpFrameworkDefinition).toHaveBeenCalledWith("source", 12);
    expect(providePhpLaravelDefinition).not.toHaveBeenCalled();
  });

  it("keeps Laravel definition aliases available during migration", async () => {
    const providePhpLaravelDefinition = vi.fn(async () => true);
    const resolved = resolveEditorSurfaceFrameworkProviders({
      providePhpLaravelDefinition,
    });

    await expect(
      resolved.providePhpFrameworkDefinition("source", 15),
    ).resolves.toBe(true);
    expect(providePhpLaravelDefinition).toHaveBeenCalledWith("source", 15);
  });

  it("prefers current presenter-link callbacks over Nette aliases", async () => {
    const providePhpPresenterLinkDefinition = vi.fn(async () => true);
    const provideNettePhpLinkDefinition = vi.fn(async () => false);
    const providePhpPresenterLinkCompletions = vi.fn(async () => [
      { insertText: "Product:show", kind: "link" as const, label: "Product:show" },
    ]);
    const provideNettePhpLinkCompletions = vi.fn(async () => null);
    const resolved = resolveEditorSurfaceFrameworkProviders({
      frameworkIntelligenceProviders: {
        provideNettePhpLinkCompletions,
        provideNettePhpLinkDefinition,
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
    expect(provideNettePhpLinkDefinition).not.toHaveBeenCalled();
    expect(provideNettePhpLinkCompletions).not.toHaveBeenCalled();
  });

  it("keeps Nette presenter-link aliases available during migration", async () => {
    const provideNettePhpLinkDefinition = vi.fn(async () => true);
    const provideNettePhpLinkCompletions = vi.fn(async () => null);
    const resolved = resolveEditorSurfaceFrameworkProviders({
      frameworkIntelligenceProviders: {
        provideNettePhpLinkCompletions,
        provideNettePhpLinkDefinition,
      },
    });

    await expect(
      resolved.providePhpPresenterLinkDefinition("source", 7),
    ).resolves.toBe(true);
    await expect(
      resolved.providePhpPresenterLinkCompletions("source", 7),
    ).resolves.toBeNull();
    expect(provideNettePhpLinkDefinition).toHaveBeenCalledWith("source", 7);
    expect(provideNettePhpLinkCompletions).toHaveBeenCalledWith("source", 7);
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
