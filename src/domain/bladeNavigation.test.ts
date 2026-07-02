import { describe, expect, it } from "vitest";
import {
  BLADE_DIRECTIVES,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
  bladeComponentCandidateRelativePaths,
  bladeComponentCandidateWorkspacePaths,
  bladeComponentClassCandidatePaths,
  bladeReferenceCandidateWorkspacePaths,
  bladeViewCandidateRelativePaths,
  bladeViewCandidateWorkspacePaths,
} from "./bladeNavigation";

/**
 * Returns the offset of the FIRST occurrence of `needle` in `source`, advanced
 * by `withinOffset` characters so a test can target a precise cursor position
 * inside a construct.
 */
function offsetOf(source: string, needle: string, withinOffset = 0): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index + withinOffset;
}

describe("detectBladeReferenceAt", () => {
  it("detects an @include literal as a view reference", () => {
    const source = "@include('admin.partials.header')";
    const offset = offsetOf(source, "admin.partials.header", 2);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "view",
      name: "admin.partials.header",
      nameStart: source.indexOf("admin.partials.header"),
      nameEnd: source.indexOf("admin.partials.header") + "admin.partials.header".length,
    });
  });

  it("detects an @extends literal as a view reference", () => {
    const source = "@extends('layouts.app')";
    const offset = offsetOf(source, "layouts.app", 1);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "view",
      name: "layouts.app",
      nameStart: source.indexOf("layouts.app"),
      nameEnd: source.indexOf("layouts.app") + "layouts.app".length,
    });
  });

  it("detects an @includeIf literal as a view reference", () => {
    const source = "@includeIf('partials.alert')";
    const offset = offsetOf(source, "partials.alert", 1);

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("view");
    expect(detectBladeReferenceAt(source, offset)?.name).toBe("partials.alert");
  });

  it("detects an @includeWhen literal (second-position view literal)", () => {
    const source = "@includeWhen($cond, 'partials.alert', ['x' => 1])";
    const offset = offsetOf(source, "partials.alert", 1);

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("view");
    expect(detectBladeReferenceAt(source, offset)?.name).toBe("partials.alert");
  });

  it("detects an @each first-argument view literal", () => {
    const source = "@each('view.name', $jobs, 'job')";
    const offset = offsetOf(source, "view.name", 1);

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("view");
    expect(detectBladeReferenceAt(source, offset)?.name).toBe("view.name");
  });

  it("detects an @component literal as a view reference", () => {
    const source = "@component('components.alert')";
    const offset = offsetOf(source, "components.alert", 1);

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("view");
    expect(detectBladeReferenceAt(source, offset)?.name).toBe("components.alert");
  });

  it("detects an <x-...> component tag as a component reference", () => {
    const source = "<x-forms.input name=\"email\" />";
    const offset = offsetOf(source, "forms.input", 2);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "component",
      name: "forms.input",
      nameStart: source.indexOf("forms.input"),
      nameEnd: source.indexOf("forms.input") + "forms.input".length,
    });
  });

  it("detects a single-segment <x-alert> component tag", () => {
    const source = "<x-alert>";
    const offset = offsetOf(source, "alert", 1);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "component",
      name: "alert",
      nameStart: source.indexOf("alert"),
      nameEnd: source.indexOf("alert") + "alert".length,
    });
  });

  it("matches with the cursor immediately after the component name", () => {
    const source = "<x-alert>";
    const offset = source.indexOf("alert") + "alert".length;

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("component");
  });

  it("returns null with the cursor on the x- prefix, not the name", () => {
    const source = "<x-forms.input />";
    const offset = source.indexOf("x-") + 1;

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("returns null with the cursor past the component name", () => {
    const source = "<x-alert >";
    const offset = source.indexOf(">");

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("detects a closing </x-...> component tag", () => {
    const source = "</x-forms.input>";
    const offset = offsetOf(source, "forms.input", 1);

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("component");
    expect(detectBladeReferenceAt(source, offset)?.name).toBe("forms.input");
  });

  it("declines a package-namespaced <x-ns::name> component on the namespace", () => {
    const source = "<x-mail::message />";
    const offset = offsetOf(source, "mail");

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("declines a package-namespaced <x-ns::name> component on the name", () => {
    const source = "<x-mail::message />";
    const offset = offsetOf(source, "message");

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("declines a closing package-namespaced </x-ns::name> component", () => {
    const source = "</x-mail::message>";
    const offset = offsetOf(source, "mail");

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("still resolves a dotted <x-foo.bar> component", () => {
    const source = "<x-foo.bar />";
    const offset = offsetOf(source, "foo.bar", 2);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "component",
      name: "foo.bar",
      nameStart: source.indexOf("foo.bar"),
      nameEnd: source.indexOf("foo.bar") + "foo.bar".length,
    });
  });

  it("still resolves a hyphenated dotted <x-input.text-field> component", () => {
    const source = "<x-input.text-field />";
    const offset = offsetOf(source, "input.text-field", 2);

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("component");
    expect(detectBladeReferenceAt(source, offset)?.name).toBe(
      "input.text-field",
    );
  });

  it("detects nested <x-...> component tags", () => {
    const source = "<x-layouts.nav.item :active=\"$active\" />";
    const offset = offsetOf(source, "layouts.nav.item", 8);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "component",
      name: "layouts.nav.item",
      nameStart: source.indexOf("layouts.nav.item"),
      nameEnd: source.indexOf("layouts.nav.item") + "layouts.nav.item".length,
    });
  });

  it("detects @yield as a section reference", () => {
    const source = "@yield('content')";
    const offset = offsetOf(source, "content", 1);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "section",
      name: "content",
      nameStart: source.indexOf("content"),
      nameEnd: source.indexOf("content") + "content".length,
    });
  });

  it("detects @section as a section reference", () => {
    const source = "@section('content')";
    const offset = offsetOf(source, "content", 1);

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("section");
    expect(detectBladeReferenceAt(source, offset)?.name).toBe("content");
  });

  it("detects @push as a stack reference", () => {
    const source = "@push('scripts')";
    const offset = offsetOf(source, "scripts", 1);

    expect(detectBladeReferenceAt(source, offset)?.kind).toBe("stack");
    expect(detectBladeReferenceAt(source, offset)?.name).toBe("scripts");
  });

  it("detects @stack as a stack reference", () => {
    const source = "@stack('scripts')";
    const offset = offsetOf(source, "scripts", 1);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "stack",
      name: "scripts",
      nameStart: source.indexOf("scripts"),
      nameEnd: source.indexOf("scripts") + "scripts".length,
    });
  });

  it("returns null when the offset is outside any construct", () => {
    const source = "<div>plain html here</div>";
    const offset = offsetOf(source, "plain", 2);

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("returns null inside a Blade comment", () => {
    const source = "{{-- @include('admin.partials.header') --}}";
    const offset = offsetOf(source, "admin.partials.header", 2);

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("returns null for an unrelated directive like @if", () => {
    const source = "@if('something')";
    const offset = offsetOf(source, "something", 2);

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("returns null for a vendor-namespaced view literal", () => {
    const source = "@include('package::partials.header')";
    const offset = offsetOf(source, "package::partials.header", 2);

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("returns null when the cursor is on the directive name, not the literal", () => {
    const source = "@include('admin.partials.header')";
    const offset = offsetOf(source, "@include", 3);

    expect(detectBladeReferenceAt(source, offset)).toBeNull();
  });

  it("supports double-quoted view literals", () => {
    const source = "@include(\"admin.partials.header\")";
    const offset = offsetOf(source, "admin.partials.header", 2);

    expect(detectBladeReferenceAt(source, offset)?.name).toBe(
      "admin.partials.header",
    );
  });
});

describe("detectBladeDirectiveCompletionAt", () => {
  it("returns an empty prefix immediately after @", () => {
    const source = "<div>@</div>";
    const offset = offsetOf(source, "@") + 1;

    expect(detectBladeDirectiveCompletionAt(source, offset)).toEqual({
      directivePrefix: "",
      start: source.indexOf("@"),
    });
  });

  it("returns the partial directive prefix being typed", () => {
    const source = "<div>@for</div>";
    const offset = offsetOf(source, "@for") + "@for".length;

    expect(detectBladeDirectiveCompletionAt(source, offset)).toEqual({
      directivePrefix: "for",
      start: source.indexOf("@"),
    });
  });

  it("returns null when not after a directive at-sign", () => {
    const source = "<div>plain</div>";
    const offset = offsetOf(source, "plain") + 2;

    expect(detectBladeDirectiveCompletionAt(source, offset)).toBeNull();
  });

  it("returns null inside a Blade comment", () => {
    const source = "{{-- @inc --}}";
    const offset = offsetOf(source, "@inc") + "@inc".length;

    expect(detectBladeDirectiveCompletionAt(source, offset)).toBeNull();
  });

  it("returns null once a non-identifier character follows the directive", () => {
    const source = "@if(true)";
    const offset = offsetOf(source, "(") + 1;

    expect(detectBladeDirectiveCompletionAt(source, offset)).toBeNull();
  });

  it("does not treat an @ inside an email address as a directive", () => {
    const source = "user@example";
    const offset = source.length;

    expect(detectBladeDirectiveCompletionAt(source, offset)).toBeNull();
  });
});

describe("BLADE_DIRECTIVES", () => {
  it("contains key control-flow and Laravel directives", () => {
    for (const directive of [
      "if",
      "foreach",
      "extends",
      "section",
      "include",
      "php",
      "auth",
      "can",
      "yield",
      "stack",
      "push",
    ]) {
      expect(BLADE_DIRECTIVES).toContain(directive);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(BLADE_DIRECTIVES).size).toBe(BLADE_DIRECTIVES.length);
  });
});

describe("bladeViewCandidateRelativePaths", () => {
  it("reuses the Laravel view resolver to produce blade candidates", () => {
    expect(bladeViewCandidateRelativePaths("admin.partials.header")).toEqual([
      "resources/views/admin/partials/header.blade.php",
      "resources/views/admin/partials/header.php",
    ]);
  });

  it("returns an empty list for an unusable view name", () => {
    expect(bladeViewCandidateRelativePaths("package::view")).toEqual([]);
  });
});

describe("bladeViewCandidateWorkspacePaths", () => {
  it("maps Blade view names to workspace-bound candidates", () => {
    expect(
      bladeViewCandidateWorkspacePaths("/workspace-a", "comments.index"),
    ).toEqual([
      {
        path: "/workspace-a/resources/views/comments/index.blade.php",
        relativePath: "resources/views/comments/index.blade.php",
      },
      {
        path: "/workspace-a/resources/views/comments/index.php",
        relativePath: "resources/views/comments/index.php",
      },
    ]);
  });

  it("returns no candidates for views that cannot be resolved locally", () => {
    expect(
      bladeViewCandidateWorkspacePaths("/workspace", "package::comments.index"),
    ).toEqual([]);
  });
});

describe("bladeComponentCandidateRelativePaths", () => {
  it("maps a dotted component name to a views/components blade candidate", () => {
    expect(bladeComponentCandidateRelativePaths("forms.input")).toContain(
      "resources/views/components/forms/input.blade.php",
    );
  });

  it("maps a nested component name to a nested views/components candidate", () => {
    expect(bladeComponentCandidateRelativePaths("layouts.nav.item")).toEqual([
      "resources/views/components/layouts/nav/item.blade.php",
      "resources/views/components/layouts/nav/item/index.blade.php",
    ]);
  });

  it("maps a single-segment component name to a blade candidate", () => {
    expect(bladeComponentCandidateRelativePaths("alert")).toContain(
      "resources/views/components/alert.blade.php",
    );
  });

  it("returns an empty list for an unusable component name", () => {
    expect(bladeComponentCandidateRelativePaths("")).toEqual([]);
  });

  it("still returns only blade candidates (no PHP class paths)", () => {
    expect(bladeComponentCandidateRelativePaths("alert")).toEqual([
      "resources/views/components/alert.blade.php",
      "resources/views/components/alert/index.blade.php",
    ]);
  });
});

describe("bladeComponentCandidateWorkspacePaths", () => {
  it("maps anonymous and class-based component candidates under one root", () => {
    expect(bladeComponentCandidateWorkspacePaths("/workspace-a", "ui.button")).toEqual([
      {
        path: "/workspace-a/resources/views/components/ui/button.blade.php",
        relativePath: "resources/views/components/ui/button.blade.php",
      },
      {
        path: "/workspace-a/resources/views/components/ui/button/index.blade.php",
        relativePath: "resources/views/components/ui/button/index.blade.php",
      },
      {
        path: "/workspace-a/app/View/Components/Ui/Button.php",
        relativePath: "app/View/Components/Ui/Button.php",
      },
    ]);
  });

  it("keeps each workspace root isolated", () => {
    expect(bladeComponentCandidateWorkspacePaths("/workspace-a", "alert")[0]).toEqual({
      path: "/workspace-a/resources/views/components/alert.blade.php",
      relativePath: "resources/views/components/alert.blade.php",
    });
    expect(bladeComponentCandidateWorkspacePaths("/workspace-b", "alert")[0]).toEqual({
      path: "/workspace-b/resources/views/components/alert.blade.php",
      relativePath: "resources/views/components/alert.blade.php",
    });
  });

  it("returns no candidates for package-namespaced components", () => {
    expect(bladeComponentCandidateWorkspacePaths("/workspace", "mail::message")).toEqual(
      [],
    );
  });
});

describe("bladeReferenceCandidateWorkspacePaths", () => {
  it("resolves detected view and component references through the shared API", () => {
    expect(
      bladeReferenceCandidateWorkspacePaths("/workspace", {
        kind: "view",
        name: "comments.index",
      }),
    ).toEqual([
      {
        path: "/workspace/resources/views/comments/index.blade.php",
        relativePath: "resources/views/comments/index.blade.php",
      },
      {
        path: "/workspace/resources/views/comments/index.php",
        relativePath: "resources/views/comments/index.php",
      },
    ]);

    expect(
      bladeReferenceCandidateWorkspacePaths("/workspace", {
        kind: "component",
        name: "alert",
      })[0],
    ).toEqual({
      path: "/workspace/resources/views/components/alert.blade.php",
      relativePath: "resources/views/components/alert.blade.php",
    });
  });

  it("does not resolve section or stack references to files", () => {
    expect(
      bladeReferenceCandidateWorkspacePaths("/workspace", {
        kind: "section",
        name: "content",
      }),
    ).toEqual([]);
    expect(
      bladeReferenceCandidateWorkspacePaths("/workspace", {
        kind: "stack",
        name: "scripts",
      }),
    ).toEqual([]);
  });
});

describe("bladeComponentClassCandidatePaths", () => {
  it("maps a single-segment name to a View/Components class path", () => {
    expect(bladeComponentClassCandidatePaths("alert")).toEqual([
      "app/View/Components/Alert.php",
    ]);
  });

  it("maps a dotted name to nested PascalCase directories and class", () => {
    expect(bladeComponentClassCandidatePaths("forms.input")).toEqual([
      "app/View/Components/Forms/Input.php",
    ]);
  });

  it("PascalCases kebab-case segments", () => {
    expect(bladeComponentClassCandidatePaths("my-alert")).toEqual([
      "app/View/Components/MyAlert.php",
    ]);
  });

  it("PascalCases kebab-case segments in a dotted name", () => {
    expect(bladeComponentClassCandidatePaths("forms.text-input")).toEqual([
      "app/View/Components/Forms/TextInput.php",
    ]);
  });

  it("PascalCases underscore-separated segments", () => {
    expect(bladeComponentClassCandidatePaths("forms.text_input")).toEqual([
      "app/View/Components/Forms/TextInput.php",
    ]);
  });

  it("returns an empty list for an unusable component name", () => {
    expect(bladeComponentClassCandidatePaths("")).toEqual([]);
    expect(bladeComponentClassCandidatePaths("package::alert")).toEqual([]);
    expect(bladeComponentClassCandidatePaths(".alert")).toEqual([]);
    expect(bladeComponentClassCandidatePaths("forms..input")).toEqual([]);
  });
});
