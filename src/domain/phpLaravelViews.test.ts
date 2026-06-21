import { describe, expect, it } from "vitest";
import {
  isUsableLaravelViewName,
  phpLaravelViewCompletionInsertText,
  phpLaravelViewNameCandidateRelativePaths,
  phpLaravelViewNameFromRelativePath,
  phpLaravelViewReferenceContextAt,
} from "./phpLaravelViews";

describe("phpLaravelViews", () => {
  it("detects Laravel view helper strings", () => {
    const source = `<?php

return view('comments.show');
`;

    expect(
      phpLaravelViewReferenceContextAt(source, positionAfter(source, "comments.sh")),
    ).toEqual({
      call: "view",
      name: "comments.show",
      position: { column: 14, lineNumber: 3 },
      prefix: "comments.sh",
    });
  });

  it("detects supported Laravel view factory strings", () => {
    const samples = [
      ["View::make('comments.show')", "View::make"],
      ["view()->make('comments.show')", "view()->make"],
      ["response()->view('comments.show')", "response()->view"],
      ["View::exists('comments.show')", "View::exists"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelViewReferenceContextAt(
          source,
          positionAfter(source, "comments.sh"),
        )?.call,
      ).toBe(call);
    }
  });

  it("detects Route::view view-name arguments", () => {
    const positional = `<?php\n\nRoute::view('/dashboard', 'dashboard');\n`;
    const named = `<?php\n\nRoute::view(uri: '/dashboard', view: 'dashboard');\n`;

    expect(
      phpLaravelViewReferenceContextAt(
        positional,
        positionAfter(positional, "', 'dashboard"),
      ),
    ).toMatchObject({
      call: "Route::view",
      name: "dashboard",
      prefix: "dashboard",
    });
    expect(
      phpLaravelViewReferenceContextAt(named, positionAfter(named, "view: 'dashboard")),
    ).toMatchObject({
      call: "Route::view",
      name: "dashboard",
      prefix: "dashboard",
    });
  });

  it("ignores package namespaces, interpolation, and non-view calls", () => {
    const packageView = `<?php\n\nreturn view('vendor::admin.dashboard');\n`;
    const interpolated = `<?php\n\nreturn view("comments.$name");\n`;
    const wrongCall = `<?php\n\nreturn trans('comments.show');\n`;

    expect(
      phpLaravelViewReferenceContextAt(
        packageView,
        positionAfter(packageView, "admin.dashboard"),
      ),
    ).toBeNull();
    expect(
      phpLaravelViewReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "comments."),
      ),
    ).toBeNull();
    expect(
      phpLaravelViewReferenceContextAt(wrongCall, positionAfter(wrongCall, "comments.sh")),
    ).toBeNull();
  });

  it("maps view names and local view paths", () => {
    expect(phpLaravelViewNameCandidateRelativePaths("comments.show")).toEqual([
      "resources/views/comments/show.blade.php",
      "resources/views/comments/show.php",
    ]);
    expect(
      phpLaravelViewNameFromRelativePath("resources/views/comments/show.blade.php"),
    ).toBe("comments.show");
    expect(phpLaravelViewNameFromRelativePath("resources/views/dashboard.php")).toBe(
      "dashboard",
    );
    expect(phpLaravelViewNameFromRelativePath("storage/framework/views/a.php")).toBe(
      null,
    );
    expect(isUsableLaravelViewName("vendor::dashboard")).toBe(false);
  });

  it("uses dotted-prefix suffix insert text", () => {
    expect(phpLaravelViewCompletionInsertText("comments.show", "comments.sh")).toBe(
      "show",
    );
    expect(phpLaravelViewCompletionInsertText("dashboard", "dash")).toBe(
      "dashboard",
    );
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
