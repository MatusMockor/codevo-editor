import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { describe, expect, it } from "vitest";
import {
  BLADE_DIRECTIVES,
  bladeComponentNavigationCandidateRelativePaths,
  bladeReferenceCandidateWorkspacePaths,
  detectBladeComponentAttributeCompletionAt,
  detectBladeComponentCompletionAt,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
} from "../domain/bladeNavigation";
import {
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { createBladeFrameworkCapabilities } from "./bladeFrameworkCapabilities";

const CUSTOM_BLADE_PROVIDER: PhpFrameworkProvider = {
  id: "custom-blade",
  blade: {
    directiveCompletionAt: ({ offset, source }) => ({
      directivePrefix: source.slice(1, offset),
      start: 0,
    }),
    directiveNames: ["customdirective"],
    referenceAt: () => ({
      kind: "view",
      name: "custom.view",
      nameEnd: 1,
      nameStart: 0,
    }),
  },
};

const BLADE_LESS_PROVIDER: PhpFrameworkProvider = {
  id: "custom-no-blade",
};

describe("createBladeFrameworkCapabilities", () => {
  it("derives blade grammar from the active Laravel provider", () => {
    const capabilities = createBladeFrameworkCapabilities(() => [
      phpLaravelFrameworkProvider,
    ]);

    expect(capabilities.directiveCompletionAt("@if", 3)).toEqual(
      detectBladeDirectiveCompletionAt("@if", 3),
    );
    expect(capabilities.directiveCompletionAt("@if", 3)).toMatchObject({
      directivePrefix: "if",
      start: 0,
    });
    expect(capabilities.directiveNames).toEqual(BLADE_DIRECTIVES);

    const includeSource = "@include('partials.alert')";
    const includeOffset = includeSource.indexOf("partials.alert") + 3;
    expect(capabilities.referenceAt(includeSource, includeOffset)).toEqual(
      detectBladeReferenceAt(includeSource, includeOffset),
    );
    expect(capabilities.referenceAt(includeSource, includeOffset)).toMatchObject(
      { kind: "view", name: "partials.alert" },
    );

    const componentSource = "<x-al";
    expect(
      capabilities.componentCompletionAt(componentSource, componentSource.length),
    ).toEqual(
      detectBladeComponentCompletionAt(componentSource, componentSource.length),
    );

    const attributeSource = '<x-alert ty';
    expect(
      capabilities.componentAttributeCompletionAt(
        attributeSource,
        attributeSource.length,
      ),
    ).toEqual(
      detectBladeComponentAttributeCompletionAt(
        attributeSource,
        attributeSource.length,
      ),
    );

    const commentSource = "{{-- @if --}}";
    expect(
      capabilities.isInsideComment(commentSource, commentSource.indexOf("@if")),
    ).toBe(true);
    expect(capabilities.isInsideComment("@if", 1)).toBe(false);

    expect(
      capabilities.componentNavigationCandidateRelativePaths("forms.text-input"),
    ).toEqual(
      bladeComponentNavigationCandidateRelativePaths("forms.text-input"),
    );
    expect(
      capabilities.referenceCandidateWorkspacePaths("/ws", {
        kind: "view",
        name: "users.index",
      }),
    ).toEqual(
      bladeReferenceCandidateWorkspacePaths("/ws", {
        kind: "view",
        name: "users.index",
      }),
    );
  });

  it("sources blade grammar from a custom provider's blade capability", () => {
    const capabilities = createBladeFrameworkCapabilities(() => [
      CUSTOM_BLADE_PROVIDER,
    ]);

    expect(capabilities.directiveCompletionAt("@cu", 3)).toEqual({
      directivePrefix: "cu",
      start: 0,
    });
    expect(capabilities.directiveNames).toEqual(["customdirective"]);
    expect(capabilities.referenceAt("anything", 0)).toMatchObject({
      kind: "view",
      name: "custom.view",
    });
  });

  it("keeps declared-but-missing blade functions inert on a blade-capable provider", () => {
    const capabilities = createBladeFrameworkCapabilities(() => [
      CUSTOM_BLADE_PROVIDER,
    ]);

    expect(capabilities.componentCompletionAt("<x-al", 5)).toBeNull();
    expect(capabilities.componentAttributeCompletionAt("<x-alert ty", 11)).toBeNull();
    expect(capabilities.isInsideComment("{{-- x --}}", 5)).toBe(false);
    expect(capabilities.componentNavigationCandidateRelativePaths("alert")).toEqual(
      [],
    );
    expect(
      capabilities.referenceCandidateWorkspacePaths("/ws", {
        kind: "view",
        name: "users.index",
      }),
    ).toEqual([]);
  });

  it("falls back to the built-in Blade grammar when no provider declares blade", () => {
    for (const providers of [[], [BLADE_LESS_PROVIDER]] as const) {
      const capabilities = createBladeFrameworkCapabilities(() => providers);

      expect(capabilities.directiveCompletionAt("@if", 3)).toEqual(
        detectBladeDirectiveCompletionAt("@if", 3),
      );
      expect(capabilities.directiveNames).toEqual(BLADE_DIRECTIVES);

      const componentSource = "<x-alert>";
      const componentOffset = componentSource.indexOf("alert");
      expect(capabilities.referenceAt(componentSource, componentOffset)).toEqual(
        detectBladeReferenceAt(componentSource, componentOffset),
      );
      expect(
        capabilities.componentNavigationCandidateRelativePaths("alert"),
      ).toEqual(bladeComponentNavigationCandidateRelativePaths("alert"));
    }
  });

  it("reads the provider registry at call time, not capture time", () => {
    const providers: PhpFrameworkProvider[] = [];
    const capabilities = createBladeFrameworkCapabilities(() => providers);

    expect(capabilities.directiveNames).toEqual(BLADE_DIRECTIVES);
    expect(capabilities.directiveCompletionAt("@cu", 3)).toEqual(
      detectBladeDirectiveCompletionAt("@cu", 3),
    );

    providers.push(CUSTOM_BLADE_PROVIDER);

    expect(capabilities.directiveNames).toEqual(["customdirective"]);
    expect(capabilities.directiveCompletionAt("@cu", 3)).toEqual({
      directivePrefix: "cu",
      start: 0,
    });
  });
});
