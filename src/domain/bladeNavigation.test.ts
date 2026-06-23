import { describe, expect, it } from "vitest";
import {
  BLADE_DIRECTIVES,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
  bladeComponentCandidateRelativePaths,
  bladeViewCandidateRelativePaths,
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

describe("bladeComponentCandidateRelativePaths", () => {
  it("maps a dotted component name to a views/components blade candidate", () => {
    expect(bladeComponentCandidateRelativePaths("forms.input")).toContain(
      "resources/views/components/forms/input.blade.php",
    );
  });

  it("maps a single-segment component name to a blade candidate", () => {
    expect(bladeComponentCandidateRelativePaths("alert")).toContain(
      "resources/views/components/alert.blade.php",
    );
  });

  it("returns an empty list for an unusable component name", () => {
    expect(bladeComponentCandidateRelativePaths("")).toEqual([]);
  });
});
