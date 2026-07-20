import { describe, expect, it } from "vitest";
import * as facade from "./phpFrameworkProviders";
import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import * as dispatch from "./phpFrameworkMemberDispatch";

describe("PHP framework member dispatch", () => {
  it("preserves provider ordering, diagnostic sources, and fallbacks", () => {
    const providers: readonly PhpFrameworkProvider[] = [
      {
        diagnostics: {
          isKnownMemberMethod: () => false,
          isKnownMemberProperty: () => false,
          isKnownStaticMethod: () => false,
          magicSource: "first",
        },
        id: "first",
      },
      {
        diagnostics: {
          isKnownMemberMethod: ({ methodName }) => methodName === "dynamic",
          isKnownMemberProperty: ({ propertyName }) =>
            propertyName === "virtual",
          isKnownStaticMethod: ({ methodName }) => methodName === "scope",
          magicSource: "second-magic",
        },
        id: "second",
      },
      {
        diagnostics: {
          isKnownMemberMethod: () => true,
          isKnownMemberProperty: () => true,
          isKnownStaticMethod: () => true,
          magicSource: "third-magic",
        },
        id: "third",
      },
    ];

    const cases = [
      [
        "static match",
        dispatch.phpFrameworkStaticMethodMagicDiagnostic(
          "<?php",
          "Model",
          "scope",
          providers,
        ),
        facade.phpFrameworkStaticMethodMagicDiagnostic(
          "<?php",
          "Model",
          "scope",
          providers,
        ),
      ],
      [
        "member match",
        dispatch.phpFrameworkMemberMethodMagicDiagnostic(
          "<?php",
          "$model",
          "dynamic",
          providers,
        ),
        facade.phpFrameworkMemberMethodMagicDiagnostic(
          "<?php",
          "$model",
          "dynamic",
          providers,
        ),
      ],
      [
        "property match",
        dispatch.phpFrameworkMemberPropertyMagicDiagnostic(
          "<?php",
          "$model",
          "virtual",
          providers,
        ),
        facade.phpFrameworkMemberPropertyMagicDiagnostic(
          "<?php",
          "$model",
          "virtual",
          providers,
        ),
      ],
      [
        "missing member",
        dispatch.phpFrameworkMemberMethodMagicDiagnostic(
          "<?php",
          "$model",
          "missing",
          providers.slice(0, 2),
        ),
        facade.phpFrameworkMemberMethodMagicDiagnostic(
          "<?php",
          "$model",
          "missing",
          providers.slice(0, 2),
        ),
      ],
    ] as const;

    for (const [label, actual, expected] of cases) {
      expect(actual, label).toEqual(expected);
    }

    expect(cases[0][1]).toEqual({ source: "second-magic" });
    expect(
      dispatch.isKnownPhpFrameworkStaticMethod(
        "<?php",
        "Model",
        "scope",
        providers,
      ),
    ).toBe(
      facade.isKnownPhpFrameworkStaticMethod(
        "<?php",
        "Model",
        "scope",
        providers,
      ),
    );
    expect(
      dispatch.isKnownPhpFrameworkMemberMethod(
        "<?php",
        "$model",
        "missing",
        [],
      ),
    ).toBe(false);
  });
});
