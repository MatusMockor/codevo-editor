import { describe, expect, it } from "vitest";
import type { PhpFrameworkSemanticProvider } from "./phpFrameworkSemanticContracts";
import {
  phpFrameworkMethodCallReturnTypeFromSource,
  phpFrameworkPropertyTypeFromSource,
  phpFrameworkQueryCallbackContextForVariable,
  phpFrameworkSuppressesSameSourceMethodReturnFallback,
} from "./phpFrameworkSemanticCapabilities";

describe("PHP framework semantic capability dispatch", () => {
  const provider: PhpFrameworkSemanticProvider = {
    id: "minimal-semantic-fixture",
    semantics: {
      methodCallReturnTypeFromSource: ({ methodName }) =>
        methodName === "fetch" ? "App\\Row" : null,
      propertyTypeFromSource: ({ propertyName }) =>
        propertyName === "name" ? "string" : null,
      queryCallbackContextForVariable: ({ variableName }) =>
        variableName === "$query"
          ? {
              methodName: "where",
              modelClassName: "App\\Model",
              receiverExpression: "$model",
              relationName: null,
            }
          : null,
      suppressesSameSourceMethodReturnFallback: ({ methodName }) =>
        methodName === "fetch",
    },
  };

  it("dispatches through the narrow semantic provider projection", () => {
    expect(
      phpFrameworkPropertyTypeFromSource("<?php", "name", [provider], null),
    ).toBe("string");
    expect(
      phpFrameworkMethodCallReturnTypeFromSource("<?php", "fetch", null, null, [
        provider,
      ]),
    ).toBe("App\\Row");
    expect(
      phpFrameworkQueryCallbackContextForVariable(
        "<?php",
        { column: 1, lineNumber: 1 },
        "$query",
        [provider],
      )?.modelClassName,
    ).toBe("App\\Model");
    expect(
      phpFrameworkSuppressesSameSourceMethodReturnFallback("fetch", [provider]),
    ).toBe(true);
  });

  it("keeps core-only fallback suppression inert without providers", () => {
    expect(
      phpFrameworkSuppressesSameSourceMethodReturnFallback("findOrFail", []),
    ).toBe(false);
  });
});
