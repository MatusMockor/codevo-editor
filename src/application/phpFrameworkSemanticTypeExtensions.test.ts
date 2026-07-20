import { describe, expect, it } from "vitest";
import type { PhpFrameworkSemanticProvider } from "../domain/phpFrameworkSemanticContracts";
import {
  phpContainerExpressionTypeFromExtensions,
  phpMethodCallReturnTypeFromExtensions,
  phpPropertyTypeFromExtensions,
  phpSuppressesSameSourceMethodReturnFallback,
} from "../domain/phpSemanticTypeExtensions";
import { createPhpFrameworkSemanticTypeExtensions } from "./phpFrameworkSemanticTypeExtensions";

describe("framework semantic type extension adapter", () => {
  it("does not register an adapter for an empty provider list", () => {
    expect(createPhpFrameworkSemanticTypeExtensions({ providers: [] })).toEqual(
      [],
    );
  });

  it("translates neutral requests to provider semantics", () => {
    const provider: PhpFrameworkSemanticProvider = {
      id: "symfony-fixture",
      semantics: {
        containerExpressionClassName: ({ expression }) =>
          expression.includes("Mailer::class") ? "App\\Mailer" : null,
        methodCallReturnTypeFromSource: ({ methodName, sourceContext }) =>
          methodName === "repository" && sourceContext?.workspaceSources?.length
            ? "App\\Repository"
            : null,
        propertyTypeFromSource: ({ propertyName, receiverType }) =>
          propertyName === "logger" && receiverType === "App\\Controller"
            ? "Psr\\Log\\LoggerInterface"
            : null,
        suppressesSameSourceMethodReturnFallback: ({ methodName }) =>
          methodName === "repository",
      },
    };
    const extensions = createPhpFrameworkSemanticTypeExtensions({
      providers: [provider],
    });

    expect(
      phpContainerExpressionTypeFromExtensions(extensions, {
        expression: "$container->get(Mailer::class)",
        source: "<?php",
      }),
    ).toBe("App\\Mailer");
    expect(
      phpPropertyTypeFromExtensions(extensions, {
        propertyName: "logger",
        receiverType: "App\\Controller",
        source: "<?php",
      }),
    ).toBe("Psr\\Log\\LoggerInterface");
    expect(
      phpMethodCallReturnTypeFromExtensions(extensions, {
        callExpression: "$manager->repository()",
        methodName: "repository",
        receiverExpression: "$manager",
        receiverType: "Doctrine\\Manager",
        source: "<?php",
        sourceContext: { workspaceSources: ["<?php class Repository {}"] },
      }),
    ).toBe("App\\Repository");
    expect(
      phpSuppressesSameSourceMethodReturnFallback(extensions, {
        methodName: "repository",
      }),
    ).toBe(true);
  });
});
