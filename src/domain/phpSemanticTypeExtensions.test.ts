import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  phpContainerExpressionTypeFromExtensions,
  phpMethodCallReturnTypeFromExtensions,
  phpPropertyTypeFromExtensions,
  phpSuppressesSameSourceMethodReturnFallback,
  type PhpSemanticTypeExtension,
} from "./phpSemanticTypeExtensions";

describe("PHP semantic type extensions", () => {
  it("keeps the synchronous semantic hot path separate from session lifecycle", () => {
    type ContainerResolver = NonNullable<
      PhpSemanticTypeExtension["containerExpressionType"]
    >;

    expectTypeOf<ReturnType<ContainerResolver>>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<Parameters<ContainerResolver>[0]>().not.toHaveProperty(
      "signal",
    );
    expectTypeOf<PhpSemanticTypeExtension>().not.toHaveProperty("ownerKey");
  });

  it("keeps the neutral core inert without extensions", () => {
    expect(
      phpContainerExpressionTypeFromExtensions([], {
        expression: "container()->get(Service::class)",
        source: "<?php",
      }),
    ).toBeNull();
    expect(
      phpSuppressesSameSourceMethodReturnFallback([], {
        methodName: "findOrFail",
      }),
    ).toBe(false);
  });

  it("uses extension order as deterministic semantic precedence", () => {
    const skipped = vi.fn(() => "App\\Skipped");
    const extensions: readonly PhpSemanticTypeExtension[] = [
      { propertyType: () => "App\\Preferred" },
      { propertyType: skipped },
    ];

    expect(
      phpPropertyTypeFromExtensions(extensions, {
        propertyName: "service",
        receiverType: "App\\Controller",
        source: "<?php",
      }),
    ).toBe("App\\Preferred");
    expect(skipped).not.toHaveBeenCalled();
  });

  it("accepts an arbitrary Symfony-like extension without core changes", () => {
    const symfonyExtension: PhpSemanticTypeExtension = {
      containerExpressionType: ({ expression }) =>
        expression === "$container->get(Mailer::class)" ? "App\\Mailer" : null,
      methodCallReturnType: ({ methodName }) =>
        methodName === "repository" ? "App\\Repository" : null,
      suppressSameSourceMethodReturnFallback: ({ methodName }) =>
        methodName === "repository",
    };

    expect(
      phpContainerExpressionTypeFromExtensions([symfonyExtension], {
        expression: "$container->get(Mailer::class)",
        source: "<?php",
      }),
    ).toBe("App\\Mailer");
    expect(
      phpMethodCallReturnTypeFromExtensions([symfonyExtension], {
        callExpression: "$manager->repository()",
        methodName: "repository",
        receiverExpression: "$manager",
        receiverType: "Doctrine\\Manager",
        source: "<?php",
      }),
    ).toBe("App\\Repository");
    expect(
      phpSuppressesSameSourceMethodReturnFallback([symfonyExtension], {
        methodName: "repository",
      }),
    ).toBe(true);
  });
});
