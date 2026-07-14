// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { usePhpLaravelScopePredicates } from "./usePhpLaravelScopePredicates";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type HookOptions = Parameters<typeof usePhpLaravelScopePredicates>[0];
type HookApi = ReturnType<typeof usePhpLaravelScopePredicates>;

const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const STALE_LEGACY_LARAVEL_RUNTIME = {
  ...LARAVEL_RUNTIME,
  providers: [],
  hasProvider: () => false,
  isLaravel: true,
};

function methodCompletion(
  name: string,
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Models\\User",
    name,
    parameters: "",
    returnType: "void",
    visibility: "public",
    ...overrides,
  };
}

function makeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    frameworkRuntime: LARAVEL_RUNTIME,
    ...overrides,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpLaravelScopePredicates(hookOptions);
    return null;
  }

  act(() => {
    root.render(<Harness hookOptions={options} />);
  });

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpLaravelScopePredicates", () => {
  it("matches Laravel dynamic where methods case-insensitively", async () => {
    const options = makeOptions({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => [
        methodCompletion("whereEmailAddress"),
      ]),
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpClassHasLaravelDynamicWhere("App\\Models\\User", "WHEREEMAILADDRESS"),
    ).resolves.toBe(true);

    expect(
      options.collectPhpFrameworkSyntheticMethodsForClass,
    ).toHaveBeenCalledWith("App\\Models\\User");

    harness.unmount();
  });

  it("returns false for Laravel dynamic where methods when no method matches", async () => {
    const options = makeOptions({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => [
        methodCompletion("whereName"),
      ]),
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpClassHasLaravelDynamicWhere("App\\Models\\User", "whereEmail"),
    ).resolves.toBe(false);

    harness.unmount();
  });

  it("matches Laravel local scopes through scopeFoo to foo", async () => {
    const options = makeOptions({
      collectPhpMethodsForClass: vi.fn(async () => [
        methodCompletion("scopePublished"),
      ]),
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpClassHasLaravelLocalScope("App\\Models\\Post", "published"),
    ).resolves.toBe(true);

    expect(options.collectPhpMethodsForClass).toHaveBeenCalledWith(
      "App\\Models\\Post",
    );

    harness.unmount();
  });

  it("short-circuits Laravel local scope checks for a generic runtime", async () => {
    const options = makeOptions({
      collectPhpMethodsForClass: vi.fn(async () => [
        methodCompletion("scopePublished"),
      ]),
      frameworkRuntime: GENERIC_RUNTIME,
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpClassHasLaravelLocalScope("App\\Models\\Post", "published"),
    ).resolves.toBe(false);

    expect(options.collectPhpMethodsForClass).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not expose Laravel dynamic where or local scopes for a generic runtime", async () => {
    const options = makeOptions({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => [
        methodCompletion("whereEmailAddress"),
      ]),
      collectPhpMethodsForClass: vi.fn(async () => [
        methodCompletion("scopePublished"),
      ]),
      frameworkRuntime: GENERIC_RUNTIME,
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpClassHasLaravelDynamicWhere("App\\Models\\User", "whereEmailAddress"),
    ).resolves.toBe(false);
    await expect(
      harness
        .api()
        .phpClassHasLaravelLocalScope("App\\Models\\Post", "published"),
    ).resolves.toBe(false);

    expect(
      options.collectPhpFrameworkSyntheticMethodsForClass,
    ).not.toHaveBeenCalled();
    expect(options.collectPhpMethodsForClass).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not expose Laravel dynamic where or local scopes for a stale legacy Laravel runtime", async () => {
    const options = makeOptions({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => [
        methodCompletion("whereEmailAddress"),
      ]),
      collectPhpMethodsForClass: vi.fn(async () => [
        methodCompletion("scopePublished"),
      ]),
      frameworkRuntime: STALE_LEGACY_LARAVEL_RUNTIME,
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpClassHasLaravelDynamicWhere("App\\Models\\User", "whereEmailAddress"),
    ).resolves.toBe(false);
    await expect(
      harness
        .api()
        .phpClassHasLaravelLocalScope("App\\Models\\Post", "published"),
    ).resolves.toBe(false);

    expect(
      options.collectPhpFrameworkSyntheticMethodsForClass,
    ).not.toHaveBeenCalled();
    expect(options.collectPhpMethodsForClass).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("exposes Laravel dynamic where and local scopes for a Laravel runtime", async () => {
    const options = makeOptions({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => [
        methodCompletion("whereEmailAddress"),
      ]),
      collectPhpMethodsForClass: vi.fn(async () => [
        methodCompletion("scopePublished"),
      ]),
      frameworkRuntime: LARAVEL_RUNTIME,
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpClassHasLaravelDynamicWhere("App\\Models\\User", "whereEmailAddress"),
    ).resolves.toBe(true);
    await expect(
      harness
        .api()
        .phpClassHasLaravelLocalScope("App\\Models\\Post", "published"),
    ).resolves.toBe(true);

    expect(
      options.collectPhpFrameworkSyntheticMethodsForClass,
    ).toHaveBeenCalledWith("App\\Models\\User");
    expect(options.collectPhpMethodsForClass).toHaveBeenCalledWith(
      "App\\Models\\Post",
    );

    harness.unmount();
  });

  it("returns false for Laravel local scopes when no scope matches", async () => {
    const options = makeOptions({
      collectPhpMethodsForClass: vi.fn(async () => [
        methodCompletion("scopeArchived"),
      ]),
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpClassHasLaravelLocalScope("App\\Models\\Post", "published"),
    ).resolves.toBe(false);

    harness.unmount();
  });
});
