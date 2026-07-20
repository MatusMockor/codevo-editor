import { describe, expect, it } from "vitest";
import * as facade from "./phpFrameworkProviders";
import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import * as dispatch from "./phpFrameworkTemplateDispatch";

const position = { column: 8, lineNumber: 3 };

describe("PHP framework template dispatch", () => {
  it("preserves first-match and aggregate behavior across providers", () => {
    const providers: readonly PhpFrameworkProvider[] = [
      { id: "inert" },
      {
        id: "primary",
        php: {
          presenterLinkAt: () => ({
            call: "link",
            target: "User:detail",
            targetEnd: 20,
            targetStart: 9,
          }),
          presenterLinkCompletionAt: () => ({
            prefix: "User",
            replaceEnd: 13,
            replaceStart: 9,
          }),
        },
        targetCollections: [{ kind: "viewData", searchQueries: ["render("] }],
        templating: {
          missingTargetMessage: ({ name }) => `view:${name}`,
          referenceAt: () => ({
            call: "view",
            name: "users.index",
            position,
            prefix: "users",
          }),
          resolveLiteralTarget: ({ literal }) => ({ literal }),
          templateNameFromRelativePath: ({ relativePath }) =>
            `primary:${relativePath}`,
        },
        viewData: {
          entryFromSource: ({ source }) => ({ bindings: [], source }),
          searchQueries: ["legacy-primary"],
        },
      },
      {
        id: "secondary",
        targetCollections: [{ kind: "viewData", searchQueries: ["template("] }],
        templating: {
          referenceAt: () => ({
            call: "secondary",
            name: "ignored",
            position,
            prefix: "",
          }),
          templateNameFromRelativePath: () => "secondary",
        },
        viewData: { searchQueries: ["legacy-secondary"] },
      },
      {
        id: "legacy",
        viewData: { searchQueries: ["legacy-only"] },
      },
    ];
    const source = "<?php return view('users.index');";
    const calls: readonly [string, () => unknown, () => unknown][] = [
      [
        "reference",
        () => dispatch.phpFrameworkViewReferenceAt(source, position, providers),
        () => facade.phpFrameworkViewReferenceAt(source, position, providers),
      ],
      [
        "context",
        () =>
          dispatch.phpFrameworkViewCompletionContextAt(
            source,
            position,
            providers,
          ),
        () =>
          facade.phpFrameworkViewCompletionContextAt(
            source,
            position,
            providers,
          ),
      ],
      [
        "literal",
        () => dispatch.phpFrameworkViewLiteralTarget("users.index", providers),
        () => facade.phpFrameworkViewLiteralTarget("users.index", providers),
      ],
      [
        "message",
        () =>
          dispatch.phpFrameworkViewMissingTargetMessage(
            "users.index",
            providers,
          ),
        () =>
          facade.phpFrameworkViewMissingTargetMessage("users.index", providers),
      ],
      [
        "template name",
        () =>
          dispatch.phpFrameworkTemplateNameFromRelativePath(
            "users/index.blade.php",
            providers,
          ),
        () =>
          facade.phpFrameworkTemplateNameFromRelativePath(
            "users/index.blade.php",
            providers,
          ),
      ],
      [
        "view data",
        () => dispatch.phpFrameworkViewDataEntryFromSource(source, providers),
        () => facade.phpFrameworkViewDataEntryFromSource(source, providers),
      ],
      [
        "search queries",
        () => dispatch.phpFrameworkViewDataSearchQueries(providers),
        () => facade.phpFrameworkViewDataSearchQueries(providers),
      ],
      [
        "presenter link",
        () => dispatch.phpFrameworkPhpPresenterLinkAt(source, 12, providers),
        () => facade.phpFrameworkPhpPresenterLinkAt(source, 12, providers),
      ],
      [
        "presenter completion",
        () =>
          dispatch.phpFrameworkPhpPresenterLinkCompletionAt(
            source,
            12,
            providers,
          ),
        () =>
          facade.phpFrameworkPhpPresenterLinkCompletionAt(
            source,
            12,
            providers,
          ),
      ],
    ];

    for (const [label, actual, expected] of calls) {
      expect(actual(), label).toEqual(expected());
    }

    expect(
      dispatch.phpFrameworkViewReferenceAt(source, position, providers)?.call,
    ).toBe("view");
    expect(dispatch.phpFrameworkViewDataSearchQueries(providers)).toEqual([
      "render(",
      "template(",
      "legacy-only",
    ]);
    expect(
      dispatch.phpFrameworkViewReferenceAt(source, position, []),
    ).toBeNull();
  });
});
