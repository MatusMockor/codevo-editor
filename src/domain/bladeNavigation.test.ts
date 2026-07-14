import { describe, expect, it } from "vitest";
import {
  BLADE_DIRECTIVES,
  detectBladeComponentAttributeCompletionAt,
  detectBladeComponentCompletionAt,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
  bladeComponentCandidateRelativePaths,
  bladeComponentCandidateWorkspacePaths,
  bladeComponentClassCandidatePaths,
  bladeComponentNameFromClassRelativePath,
  bladeComponentNavigationCandidateRelativePaths,
  bladeReferenceCandidateWorkspacePaths,
  bladeViewCandidateRelativePaths,
  bladeViewCandidateWorkspacePaths,
  isBladeComponentSourcePath,
  isInsideMaskedRegion,
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

  it("detects an @include literal when the cursor is just after the closing quote", () => {
    const source = "@include('admin.partials.header')";
    const offset = source.indexOf("')") + 1;

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "view",
      name: "admin.partials.header",
      nameStart: source.indexOf("admin.partials.header"),
      nameEnd:
        source.indexOf("admin.partials.header") +
        "admin.partials.header".length,
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

  it("detects a normal Livewire component tag", () => {
    const source = "<livewire:admin.users />";

    expect(
      detectBladeReferenceAt(source, offsetOf(source, "admin.users", 2)),
    ).toMatchObject({ kind: "livewire", name: "admin.users" });
  });

  it("detects a normal @livewire directive", () => {
    const source = "@livewire('admin.users')";

    expect(
      detectBladeReferenceAt(source, offsetOf(source, "admin.users", 2)),
    ).toMatchObject({ kind: "livewire", name: "admin.users" });
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

  it("masks component and Livewire tags inside HTML comments", () => {
    const source = "<!-- <x-old/> <livewire:admin.users/> -->";

    expect(detectBladeReferenceAt(source, offsetOf(source, "old", 1))).toBeNull();
    expect(
      detectBladeReferenceAt(source, offsetOf(source, "admin.users", 2)),
    ).toBeNull();
  });

  it("resolves a real component immediately after a closed HTML comment", () => {
    const source = "<!-- <x-old/> --><x-real/>";
    const offset = offsetOf(source, "real", 2);

    expect(detectBladeReferenceAt(source, offset)).toEqual({
      kind: "component",
      name: "real",
      nameStart: source.indexOf("real"),
      nameEnd: source.indexOf("real") + "real".length,
    });
  });

  it("masks tag references inside quoted HTML attribute values", () => {
    const source = "<div data-x=\"<x-foo/>\" data-y='<livewire:admin.users/>'>";

    expect(detectBladeReferenceAt(source, offsetOf(source, "foo", 1))).toBeNull();
    expect(
      detectBladeReferenceAt(source, offsetOf(source, "admin.users", 2)),
    ).toBeNull();
  });

  it("does not treat an attribute value containing --> as an HTML comment close", () => {
    const source = "<div data-x=\"a-->b<x-foo/>\">";

    expect(detectBladeReferenceAt(source, offsetOf(source, "foo", 1))).toBeNull();
  });

  it("masks from an unclosed attribute quote through EOF", () => {
    const source = "<div data-x=\"prefix <x-foo/>";

    expect(detectBladeReferenceAt(source, offsetOf(source, "foo", 1))).toBeNull();
    expect(isInsideMaskedRegion(source, source.length)).toBe(true);
  });

  it("treats backslash-escaped attribute quotes as part of the value", () => {
    const source = '<div data-x="a\\"b<x-foo/>">';

    expect(detectBladeReferenceAt(source, offsetOf(source, "foo", 1))).toBeNull();
  });

  it("does not mask a tag-like substring in a Blade echo string because the quote is outside an HTML tag", () => {
    const source = "{{ '<x-foo>' }}";

    expect(detectBladeReferenceAt(source, offsetOf(source, "foo", 1))?.name).toBe(
      "foo",
    );
  });

  it("resolves a multiline component tag when the target is on a later line", () => {
    const source = "<div>\n<x-forms.input\n  name=\"email\"\n/>";

    expect(
      detectBladeReferenceAt(source, offsetOf(source, "forms.input", 3)),
    ).toMatchObject({ kind: "component", name: "forms.input" });
  });

  it("masks @livewire and view directives inside HTML comments", () => {
    const source = "<!-- @livewire('admin.users') @include('partials.card') -->";

    expect(
      detectBladeReferenceAt(source, offsetOf(source, "admin.users", 2)),
    ).toBeNull();
    expect(
      detectBladeReferenceAt(source, offsetOf(source, "partials.card", 2)),
    ).toBeNull();
  });

  it("masks a Blade directive inside a quoted attribute value", () => {
    const source = "<div data-view=\"@include('partials.card')\">";

    expect(
      detectBladeReferenceAt(source, offsetOf(source, "partials.card", 2)),
    ).toBeNull();
  });

  it("handles CRLF masking without blocking a later real reference", () => {
    const source = "<!--\r\n<x-old/>\r\n-->\r\n<x-real/>";

    expect(detectBladeReferenceAt(source, offsetOf(source, "old", 1))).toBeNull();
    expect(
      detectBladeReferenceAt(source, offsetOf(source, "real", 1)),
    ).toMatchObject({ kind: "component", name: "real" });
  });
});

describe("isInsideMaskedRegion", () => {
  it("lets Blade comments take precedence when HTML comment syntax is nested inside", () => {
    const source = "{{-- <!-- <x-old/> --}}<x-real/>";

    expect(isInsideMaskedRegion(source, offsetOf(source, "old", 1))).toBe(true);
    expect(isInsideMaskedRegion(source, offsetOf(source, "real", 1))).toBe(false);
  });

  it("lets an unclosed Blade comment nested in an HTML comment mask through EOF", () => {
    const source = "<!-- {{-- <x-old/> --> <x-still-masked/>";

    expect(isInsideMaskedRegion(source, offsetOf(source, "still-masked", 2))).toBe(
      true,
    );
  });

  it("pins HTML comment mask delimiter boundaries", () => {
    const source = "<!-- body -->";
    const openStart = source.indexOf("<!--");
    const closeStart = source.indexOf("-->");

    expect(isInsideMaskedRegion(source, openStart)).toBe(false);
    expect(isInsideMaskedRegion(source, openStart + 3)).toBe(true);
    expect(isInsideMaskedRegion(source, closeStart)).toBe(true);
    expect(isInsideMaskedRegion(source, closeStart + 2)).toBe(true);
  });

  it("masks an unterminated trailing HTML comment through EOF", () => {
    const source = "prefix <!-- <x-old/>";

    expect(isInsideMaskedRegion(source, source.length)).toBe(true);
  });

  it("does not mask quotes that occur in plain text outside an HTML tag", () => {
    const source = 'He said "hello" before <x-real/>';

    expect(isInsideMaskedRegion(source, offsetOf(source, "real", 1))).toBe(false);
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

describe("bladeComponentNavigationCandidateRelativePaths", () => {
  it("probes the class-based component before the anonymous blade views (PhpStorm parity)", () => {
    expect(bladeComponentNavigationCandidateRelativePaths("alert")).toEqual([
      "app/View/Components/Alert.php",
      "resources/views/components/alert.blade.php",
      "resources/views/components/alert/index.blade.php",
    ]);
  });

  it("orders dotted kebab-case names class-first as well", () => {
    expect(
      bladeComponentNavigationCandidateRelativePaths("forms.text-input"),
    ).toEqual([
      "app/View/Components/Forms/TextInput.php",
      "resources/views/components/forms/text-input.blade.php",
      "resources/views/components/forms/text-input/index.blade.php",
    ]);
  });

  it("returns no candidates for an unusable component name", () => {
    expect(bladeComponentNavigationCandidateRelativePaths("")).toEqual([]);
    expect(
      bladeComponentNavigationCandidateRelativePaths("mail::message"),
    ).toEqual([]);
  });
});

describe("bladeComponentNameFromClassRelativePath", () => {
  it("maps a top-level component class to its tag name", () => {
    expect(bladeComponentNameFromClassRelativePath("Alert.php")).toBe("alert");
  });

  it("kebab-cases multi-word class names", () => {
    expect(bladeComponentNameFromClassRelativePath("UserProfile.php")).toBe(
      "user-profile",
    );
  });

  it("maps nested directories to dotted kebab-case segments", () => {
    expect(
      bladeComponentNameFromClassRelativePath("Forms/TextInput.php"),
    ).toBe("forms.text-input");
  });

  it("round-trips through the class candidate resolver", () => {
    const name = bladeComponentNameFromClassRelativePath("Forms/TextInput.php");

    expect(name).not.toBeNull();
    expect(bladeComponentClassCandidatePaths(name ?? "")).toEqual([
      "app/View/Components/Forms/TextInput.php",
    ]);
  });

  it("returns null for non-PHP files", () => {
    expect(bladeComponentNameFromClassRelativePath(".gitkeep")).toBeNull();
    expect(bladeComponentNameFromClassRelativePath("Alert.blade.php")).toBeNull();
  });

  it("returns null for names that do not round-trip to a component class (conservative)", () => {
    expect(bladeComponentNameFromClassRelativePath("index.php")).toBeNull();
    expect(bladeComponentNameFromClassRelativePath("myHelper.php")).toBeNull();
    expect(bladeComponentNameFromClassRelativePath("Text_Input.php")).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(bladeComponentNameFromClassRelativePath("")).toBeNull();
    expect(bladeComponentNameFromClassRelativePath(".php")).toBeNull();
  });
});

describe("detectBladeComponentCompletionAt", () => {
  it("offers completion with an empty prefix right after <x-", () => {
    const source = "<x-";

    expect(detectBladeComponentCompletionAt(source, source.length)).toEqual({
      prefix: "",
      replaceStart: 3,
      replaceEnd: 3,
    });
  });

  it("captures the typed prefix inside an opening tag", () => {
    const source = "<x-fo\n";
    const offset = offsetOf(source, "fo", 2);

    expect(detectBladeComponentCompletionAt(source, offset)).toEqual({
      prefix: "fo",
      replaceStart: offsetOf(source, "fo"),
      replaceEnd: offsetOf(source, "fo") + 2,
    });
  });

  it("keeps offering completion after a trailing dot (<x-forms.)", () => {
    const source = "<x-forms.";

    expect(detectBladeComponentCompletionAt(source, source.length)).toEqual({
      prefix: "forms.",
      replaceStart: 3,
      replaceEnd: source.length,
    });
  });

  it("offers completion inside a closing tag", () => {
    const source = "</x-al";

    expect(detectBladeComponentCompletionAt(source, source.length)).toEqual({
      prefix: "al",
      replaceStart: 4,
      replaceEnd: source.length,
    });
  });

  it("replaces the full component name when the cursor sits mid-name", () => {
    const source = "<x-forms.input />";
    const offset = offsetOf(source, "forms.input", 2);

    expect(detectBladeComponentCompletionAt(source, offset)).toEqual({
      prefix: "fo",
      replaceStart: offsetOf(source, "forms.input"),
      replaceEnd: offsetOf(source, "forms.input") + "forms.input".length,
    });
  });

  it("does not fire before the dash (<x)", () => {
    const source = "<x";

    expect(detectBladeComponentCompletionAt(source, source.length)).toBeNull();
  });

  it("does not fire in ordinary HTML tags", () => {
    const source = "<div class=\"x-\">";

    expect(detectBladeComponentCompletionAt(source, offsetOf(source, "div", 2))).toBeNull();
  });

  it("does not fire inside the attribute area of a component tag", () => {
    const source = "<x-alert type=\"info\"";

    expect(
      detectBladeComponentCompletionAt(source, offsetOf(source, "type", 2)),
    ).toBeNull();
  });

  it("declines package-namespaced components (<x-mail::...)", () => {
    const source = "<x-mail::message";

    expect(
      detectBladeComponentCompletionAt(source, offsetOf(source, "mail", 4)),
    ).toBeNull();
  });

  it("does not fire inside Blade comments", () => {
    const source = "{{-- <x-al --}}";

    expect(
      detectBladeComponentCompletionAt(source, offsetOf(source, "al", 2)),
    ).toBeNull();
  });

  it("does not fire inside HTML comments", () => {
    const source = "<!-- <x-al -->";

    expect(
      detectBladeComponentCompletionAt(source, offsetOf(source, "al", 2)),
    ).toBeNull();
  });

  it("does not fire inside quoted attribute values", () => {
    const source = "<div data-x=\"<x-al\">";

    expect(
      detectBladeComponentCompletionAt(source, offsetOf(source, "al", 2)),
    ).toBeNull();
  });

  it("does not fire after the tag closed", () => {
    const source = "<x-alert> text";

    expect(
      detectBladeComponentCompletionAt(source, offsetOf(source, "text", 2)),
    ).toBeNull();
  });
});

describe("detectBladeComponentAttributeCompletionAt", () => {
  it("offers attribute completion with an empty prefix inside an opening tag", () => {
    const source = "<x-alert ";

    expect(
      detectBladeComponentAttributeCompletionAt(source, source.length),
    ).toEqual({
      componentName: "alert",
      existingAttributeNames: [],
      prefix: "",
      replaceStart: source.length,
      replaceEnd: source.length,
    });
  });

  it("captures the typed attribute prefix", () => {
    const source = "<x-alert ty";
    const offset = source.length;

    expect(
      detectBladeComponentAttributeCompletionAt(source, offset),
    ).toEqual({
      componentName: "alert",
      existingAttributeNames: [],
      prefix: "ty",
      replaceStart: offsetOf(source, "ty"),
      replaceEnd: offset,
    });
  });

  it("captures a bound attribute prefix starting with a colon", () => {
    const source = "<x-alert :ty";

    expect(
      detectBladeComponentAttributeCompletionAt(source, source.length),
    ).toEqual({
      componentName: "alert",
      existingAttributeNames: [],
      prefix: ":ty",
      replaceStart: offsetOf(source, ":ty"),
      replaceEnd: source.length,
    });
  });

  it("lists attributes already present on the tag", () => {
    const source = '<x-alert type="info" :message="$m" ic />';
    const offset = offsetOf(source, "ic", 2);

    expect(
      detectBladeComponentAttributeCompletionAt(source, offset),
    ).toEqual({
      componentName: "alert",
      existingAttributeNames: ["type", "message"],
      prefix: "ic",
      replaceStart: offsetOf(source, "ic"),
      replaceEnd: offsetOf(source, "ic") + 2,
    });
  });

  it("does not fire inside the component name", () => {
    const source = "<x-alert ";

    expect(
      detectBladeComponentAttributeCompletionAt(source, offsetOf(source, "alert", 2)),
    ).toBeNull();
  });

  it("does not fire outside a component tag", () => {
    const source = "<div ";

    expect(
      detectBladeComponentAttributeCompletionAt(source, source.length),
    ).toBeNull();
  });

  it("does not fire after the tag closed", () => {
    const source = "<x-alert> te";

    expect(
      detectBladeComponentAttributeCompletionAt(source, source.length),
    ).toBeNull();
  });

  it("does not fire inside a closing component tag", () => {
    const source = "</x-alert ";

    expect(
      detectBladeComponentAttributeCompletionAt(source, source.length),
    ).toBeNull();
  });

  it("does not fire inside an attribute value string", () => {
    const source = '<x-alert type="inf';

    expect(
      detectBladeComponentAttributeCompletionAt(source, source.length),
    ).toBeNull();
  });

  it("does not fire after an unquoted equals sign", () => {
    const source = "<x-alert type=inf";

    expect(
      detectBladeComponentAttributeCompletionAt(source, source.length),
    ).toBeNull();
  });

  it("declines package-namespaced components", () => {
    const source = "<x-mail::message ty";

    expect(
      detectBladeComponentAttributeCompletionAt(source, source.length),
    ).toBeNull();
  });

  it("does not fire inside Blade comments", () => {
    const source = "{{-- <x-alert ty --}}";

    expect(
      detectBladeComponentAttributeCompletionAt(source, offsetOf(source, "ty", 2)),
    ).toBeNull();
  });
});

describe("isBladeComponentSourcePath", () => {
  it("matches files under resources/views/components", () => {
    expect(
      isBladeComponentSourcePath(
        "/workspace",
        "/workspace/resources/views/components/alert.blade.php",
      ),
    ).toBe(true);
    expect(
      isBladeComponentSourcePath(
        "/workspace",
        "/workspace/resources/views/components/forms/input/index.blade.php",
      ),
    ).toBe(true);
  });

  it("matches files under app/View/Components", () => {
    expect(
      isBladeComponentSourcePath(
        "/workspace",
        "/workspace/app/View/Components/Alert.php",
      ),
    ).toBe(true);
    expect(
      isBladeComponentSourcePath(
        "/workspace",
        "/workspace/app/View/Components/Forms/TextInput.php",
      ),
    ).toBe(true);
  });

  it("matches the component directories themselves (rename/delete of the dir)", () => {
    expect(
      isBladeComponentSourcePath(
        "/workspace",
        "/workspace/resources/views/components",
      ),
    ).toBe(true);
    expect(
      isBladeComponentSourcePath("/workspace", "/workspace/app/View/Components"),
    ).toBe(true);
  });

  it("does not match other workspace paths", () => {
    expect(
      isBladeComponentSourcePath(
        "/workspace",
        "/workspace/resources/views/welcome.blade.php",
      ),
    ).toBe(false);
    expect(
      isBladeComponentSourcePath("/workspace", "/workspace/app/Models/User.php"),
    ).toBe(false);
    expect(
      isBladeComponentSourcePath(
        "/workspace",
        "/workspace/resources/views/componentsextra/a.blade.php",
      ),
    ).toBe(false);
  });

  it("does not match paths from another workspace root (isolation)", () => {
    expect(
      isBladeComponentSourcePath(
        "/workspace-a",
        "/workspace-b/resources/views/components/alert.blade.php",
      ),
    ).toBe(false);
  });
});
