import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpLaravelFrameworkPlugin } from "./phpLaravelFrameworkPlugin";
import { phpFrameworkLegacyFeatures } from "./phpFrameworkLegacyProviderAdapter";

describe("phpLaravelFrameworkPlugin", () => {
  it("projects the Laravel provider into core and narrow feature groups", () => {
    const features = phpFrameworkLegacyFeatures(phpLaravelFrameworkPlugin);

    expect(phpLaravelFrameworkPlugin.provider.id).toBe(
      phpLaravelFrameworkProvider.id,
    );
    expect(features?.semantics).toStrictEqual(
      phpLaravelFrameworkProvider.semantics,
    );
    expect(features?.blade).toStrictEqual(
      phpLaravelFrameworkProvider.blade,
    );
  });

  it("owns Laravel member completions and Eloquent capability definitions", () => {
    expect(phpLaravelFrameworkPlugin.memberCompletions?.map(({ id }) => id)).toEqual([
      "laravel.member-completions",
    ]);
    expect(
      phpLaravelFrameworkPlugin.capabilityDefinitions?.map(({ token }) => token),
    ).toEqual(["eloquentModelSemantics"]);
  });

  it("contributes Blade active-document diagnostics", () => {
    const contributions = phpLaravelFrameworkPlugin.diagnostics?.({
      collectTemplateRelativePaths: vi.fn(async () => []),
      collectTemplateTargets: vi.fn(async () => []),
      provideTemplateLinkDiagnostics: vi.fn(async () => []),
    });

    expect(contributions?.map(({ id }) => id)).toEqual(["bladeViewReferences"]);
  });

  it("contributes Blade file-change invalidations", () => {
    const contributions = phpLaravelFrameworkPlugin.invalidations?.({
      invalidateComponentNames: vi.fn(),
      invalidateConfiguration: vi.fn(),
      invalidateTemplateExpressions: vi.fn(),
      invalidateTemplateViewData: vi.fn(),
    });

    expect(contributions?.map(({ id }) => id)).toEqual([
      "blade-component-names",
      "blade-view-data-entries",
    ]);
  });

  it("contributes the missing-template-file code action adapter", () => {
    const contributions = phpLaravelFrameworkPlugin.codeActions?.({
      collectTemplateTargets: vi.fn(async () => []),
      readFileIfExists: vi.fn(async () => null),
      workspaceRoot: "/workspace",
    });

    expect(contributions?.map(({ id }) => id)).toEqual([
      "missing-template-file",
    ]);
  });

  it("declares Eloquent model source semantics behind the capability gate", () => {
    const contribution = phpLaravelFrameworkPlugin.semantics?.modelSource;

    expect(contribution?.capability).toBe("eloquentModelSemantics");
    expect(contribution?.createAdapter().morphMapEntriesFromSource("")).toEqual(
      [],
    );
  });

  it("declares Eloquent method completion semantics behind the capability gate", () => {
    const contribution = phpLaravelFrameworkPlugin.semantics?.methodCompletion?.(
      {
        collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => []),
        resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
      },
    );

    expect(contribution?.capability).toBe("eloquentModelSemantics");
    expect(
      contribution
        ?.createAdapter()
        .facadeTargetClassName("Illuminate\\Support\\Facades\\Cache"),
    ).toBe("Illuminate\\Cache\\CacheManager");
  });

  it("contributes contextual member navigation through its semantic descriptor", () => {
    const contribution =
      phpLaravelFrameworkPlugin.semantics?.contextualMemberNavigation?.({
        openDirectMethodTarget: vi.fn(async () => false),
        openDynamicMethodTarget: vi.fn(async () => false),
        resolveBuilderModelType: vi.fn(async () => null),
        resolveExpressionType: vi.fn(async () => null),
        resolveRelationPathOwnerType: vi.fn(async () => null),
      });

    expect(contribution?.id).toBe(
      "laravel-contextual-member-definition-navigation",
    );
    expect(contribution?.providerId).toBe("laravel");
  });
});
