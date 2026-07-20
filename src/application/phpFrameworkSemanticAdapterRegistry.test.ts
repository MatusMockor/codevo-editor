import { describe, expect, it, vi } from "vitest";
import { activePhpFrameworkSemanticAdapter } from "./phpFrameworkSemanticAdapterRegistry";

describe("phpFrameworkSemanticAdapterRegistry", () => {
  it("returns the fallback when no provider contribution is active", () => {
    const fallback = { name: "generic" };
    const inactiveAdapter = { name: "inactive" };
    const createAdapter = vi.fn(() => inactiveAdapter);
    const frameworkRuntime = {
      hasProvider: vi.fn(() => false),
      supports: vi.fn(() => false),
    };

    const adapter = activePhpFrameworkSemanticAdapter(
      frameworkRuntime,
      [{ capability: "eloquentModelSemantics", createAdapter, id: "inactive" }],
      fallback,
    );

    expect(adapter).toBe(fallback);
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("returns the first active capability contribution", () => {
    const fallback = { name: "generic" };
    const laravelAdapter = { name: "laravel" };
    const netteAdapter = { name: "nette" };
    const createLaravelAdapter = vi.fn(() => laravelAdapter);
    const createNetteAdapter = vi.fn(() => netteAdapter);
    const queriedCapabilities: string[] = [];

    const adapter = activePhpFrameworkSemanticAdapter(
      {
        hasProvider: () => false,
        supports: (capability) => {
          queriedCapabilities.push(capability);
          return (
            capability === "eloquentModelSemantics" ||
            capability === "latteTemplateIntelligence"
          );
        },
      },
      [
        {
          capability: "eloquentModelSemantics",
          createAdapter: createLaravelAdapter,
          id: "laravel",
        },
        {
          capability: "latteTemplateIntelligence",
          createAdapter: createNetteAdapter,
          id: "nette",
        },
      ],
      fallback,
    );

    expect(adapter).toBe(laravelAdapter);
    expect(queriedCapabilities).toEqual(["eloquentModelSemantics"]);
    expect(createLaravelAdapter).toHaveBeenCalledOnce();
    expect(createNetteAdapter).not.toHaveBeenCalled();
  });

  it("keeps provider-id contributions available for existing registries", () => {
    const fallback = { name: "generic" };
    const adapter = { name: "provider" };
    const createAdapter = vi.fn(() => adapter);

    expect(
      activePhpFrameworkSemanticAdapter(
        {
          hasProvider: (providerId) => providerId === "custom",
        },
        [{ providerId: "custom", createAdapter, id: "custom" }],
        fallback,
      ),
    ).toBe(adapter);
    expect(createAdapter).toHaveBeenCalledOnce();
  });

  it("selects the highest-priority active contribution deterministically", () => {
    const fallback = { name: "generic" };
    const lower = { name: "lower" };
    const higher = { name: "higher" };

    expect(
      activePhpFrameworkSemanticAdapter(
        { hasProvider: () => true },
        [
          {
            createAdapter: () => lower,
            id: "lower",
            priority: 10,
            providerId: "custom",
          },
          {
            createAdapter: () => higher,
            id: "higher",
            priority: 100,
            providerId: "custom",
          },
        ],
        fallback,
      ),
    ).toBe(higher);
  });

  it("keeps registration order when active priorities are equal", () => {
    const fallback = { name: "generic" };
    const first = { name: "first" };

    expect(
      activePhpFrameworkSemanticAdapter(
        { hasProvider: () => true },
        [
          {
            createAdapter: () => first,
            id: "first",
            priority: 50,
            providerId: "custom",
          },
          {
            createAdapter: () => ({ name: "second" }),
            id: "second",
            priority: 50,
            providerId: "custom",
          },
        ],
        fallback,
      ),
    ).toBe(first);
  });

  it("rejects duplicate semantic contribution ids", () => {
    expect(() =>
      activePhpFrameworkSemanticAdapter(
        { hasProvider: () => true },
        [
          {
            createAdapter: () => ({ name: "first" }),
            id: "duplicate",
            providerId: "custom",
          },
          {
            createAdapter: () => ({ name: "second" }),
            id: "duplicate",
            providerId: "custom",
          },
        ],
        { name: "generic" },
      ),
    ).toThrowError(
      'Duplicate PHP framework semantic contribution id "duplicate".',
    );
  });
});
