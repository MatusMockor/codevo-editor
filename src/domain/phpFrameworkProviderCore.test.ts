import { describe, expect, expectTypeOf, it } from "vitest";
import {
  hasPhpFrameworkProvider,
  phpFrameworkProviderCoreSignature,
  type PhpFrameworkProviderCore,
} from "./phpFrameworkProviderCore";

describe("phpFrameworkProviderCore", () => {
  it("keeps provider identity independent from feature capabilities", () => {
    const provider: PhpFrameworkProviderCore = {
      id: "symfony",
      presentation: { activityLabel: "Symfony" },
    };

    expect(provider).toEqual({
      id: "symfony",
      presentation: { activityLabel: "Symfony" },
    });
    expectTypeOf(provider).not.toHaveProperty("completions");
  });

  it("builds deterministic signatures and detects provider identity", () => {
    const providers: readonly PhpFrameworkProviderCore[] = [
      { id: "laravel" },
      { id: "nette" },
    ];

    expect(phpFrameworkProviderCoreSignature(providers)).toBe("laravel,nette");
    expect(hasPhpFrameworkProvider(providers, "nette")).toBe(true);
    expect(hasPhpFrameworkProvider(providers, "symfony")).toBe(false);
  });
});
