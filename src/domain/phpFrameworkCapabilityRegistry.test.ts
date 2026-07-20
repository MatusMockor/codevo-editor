import { describe, expect, it } from "vitest";
import {
  createPhpFrameworkCapabilityRegistry,
  definePhpFrameworkCapability,
} from "./phpFrameworkCapabilityRegistry";
import type { PhpFrameworkProviderCore } from "./phpFrameworkProviderCore";

interface TestProvider extends PhpFrameworkProviderCore {
  readonly features?: {
    readonly routes?: true;
  };
}

describe("phpFrameworkCapabilityRegistry", () => {
  const routes = definePhpFrameworkCapability<TestProvider, "routes">(
    "routes",
    (provider) => provider.features?.routes === true,
  );

  it("supports adapter-owned tokens without a central switch", () => {
    const symfonyMessenger = definePhpFrameworkCapability<
      TestProvider,
      "symfonyMessenger"
    >("symfonyMessenger", (provider) => provider.id === "symfony");
    const registry = createPhpFrameworkCapabilityRegistry({
      definitions: [routes, symfonyMessenger],
      providers: [{ id: "symfony" }],
    });

    expect(registry.hasProvider("symfony")).toBe(true);
    expect(registry.supports("symfonyMessenger")).toBe(true);
    expect(registry.supports("routes")).toBe(false);
  });

  it("returns false for an unregistered open token", () => {
    const registry = createPhpFrameworkCapabilityRegistry<TestProvider>({
      definitions: [routes],
      providers: [{ features: { routes: true }, id: "custom" }],
    });

    expect(registry.supports("futureCapability")).toBe(false);
  });

  it("keeps signature and capability lookups on the creation-time provider snapshot", () => {
    const provider: TestProvider = {
      features: { routes: true },
      id: "initial",
    };
    const providers: TestProvider[] = [provider];
    const registry = createPhpFrameworkCapabilityRegistry({
      definitions: [routes],
      providers,
    });

    providers.splice(0, providers.length, { id: "replacement" });
    Object.assign(provider, {
      features: { routes: false },
      id: "mutated",
    });

    expect(registry.providerSignature).toBe("initial");
    expect(registry.hasProvider("initial")).toBe(true);
    expect(registry.hasProvider("mutated")).toBe(false);
    expect(registry.hasProvider("replacement")).toBe(false);
    expect(registry.supports("routes")).toBe(true);
  });

  it("does not gain capabilities from provider object mutation", () => {
    const provider: TestProvider = { id: "initial" };
    const registry = createPhpFrameworkCapabilityRegistry({
      definitions: [routes],
      providers: [provider],
    });

    Object.assign(provider, { features: { routes: true } });

    expect(registry.providerSignature).toBe("initial");
    expect(registry.hasProvider("initial")).toBe(true);
    expect(registry.supports("routes")).toBe(false);
  });

  it("rejects duplicate token ownership", () => {
    expect(() =>
      createPhpFrameworkCapabilityRegistry({
        definitions: [routes, routes],
        providers: [] as TestProvider[],
      }),
    ).toThrow("Duplicate PHP framework capability token: routes");
  });
});
