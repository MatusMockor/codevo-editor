import { describe, expect, it, vi } from "vitest";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { phpNetteFrameworkPlugin } from "./phpNetteFrameworkPlugin";
import { phpFrameworkLegacyFeatures } from "./phpFrameworkLegacyProviderAdapter";

describe("phpNetteFrameworkPlugin", () => {
  it("projects the Nette provider into core and narrow feature groups", () => {
    const features = phpFrameworkLegacyFeatures(phpNetteFrameworkPlugin);

    expect(phpNetteFrameworkPlugin.provider.id).toBe(
      phpNetteFrameworkProvider.id,
    );
    expect(features?.semantics).toStrictEqual(
      phpNetteFrameworkProvider.semantics,
    );
    expect(features?.latte).toStrictEqual(
      phpNetteFrameworkProvider.latte,
    );
  });

  it("owns Nette-specific capability definitions", () => {
    expect(
      phpNetteFrameworkPlugin.capabilityDefinitions?.map(({ token }) => token),
    ).toEqual([
      "netteDatabaseSemantics",
      "netteRedrawControlSnippetCompletions",
    ]);
  });

  it("contributes Nette database definition navigation", () => {
    const contributions = phpNetteFrameworkPlugin.navigation?.({
      openPhpClassTarget: vi.fn(async () => false),
      readNavigationFileContent: vi.fn(async () => ""),
      resolvePhpClassSourcePaths: vi.fn(async () => []),
      resolvePhpExpressionType: vi.fn(async () => null),
    });

    expect(contributions?.map(({ id }) => id)).toEqual([
      "nette-database-definition-navigation",
    ]);
  });

  it("contributes Latte active-document diagnostics", () => {
    const contributions = phpNetteFrameworkPlugin.diagnostics?.({
      collectTemplateRelativePaths: vi.fn(async () => []),
      collectTemplateTargets: vi.fn(async () => []),
      provideTemplateLinkDiagnostics: vi.fn(async () => []),
    });

    expect(contributions?.map(({ id }) => id)).toEqual([
      "latteTemplateReferences",
      "lattePresenterLinks",
    ]);
  });

  it("contributes the presenter-link code action adapter", () => {
    const contributions = phpNetteFrameworkPlugin.codeActions?.({
      collectTemplateTargets: vi.fn(async () => []),
      readFileIfExists: vi.fn(async () => null),
      workspaceRoot: "/workspace",
    });

    expect(contributions?.map(({ id }) => id)).toEqual([
      "nette-presenter-link-method",
    ]);
  });

  it("contributes Latte and Neon file-change invalidations", () => {
    const contributions = phpNetteFrameworkPlugin.invalidations?.({
      invalidateComponentNames: vi.fn(),
      invalidateConfiguration: vi.fn(),
      invalidateTemplateExpressions: vi.fn(),
      invalidateTemplateViewData: vi.fn(),
    });

    expect(contributions?.map(({ id }) => id)).toEqual([
      "latte-expression-data",
      "neon-config",
    ]);
  });

  it("does not declare framework semantics", () => {
    expect(phpNetteFrameworkPlugin.semantics).toBeUndefined();
  });
});
