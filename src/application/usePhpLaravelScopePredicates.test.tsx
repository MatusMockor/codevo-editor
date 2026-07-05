// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { usePhpLaravelScopePredicates } from "./usePhpLaravelScopePredicates";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type HookOptions = Parameters<typeof usePhpLaravelScopePredicates>[0];
type HookApi = ReturnType<typeof usePhpLaravelScopePredicates>;

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
    collectPhpLaravelDynamicWhereMethodsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    isLaravelFrameworkActive: true,
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
      collectPhpLaravelDynamicWhereMethodsForClass: vi.fn(async () => [
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
      options.collectPhpLaravelDynamicWhereMethodsForClass,
    ).toHaveBeenCalledWith("App\\Models\\User");

    harness.unmount();
  });

  it("returns false for Laravel dynamic where methods when no method matches", async () => {
    const options = makeOptions({
      collectPhpLaravelDynamicWhereMethodsForClass: vi.fn(async () => [
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

  it("short-circuits Laravel local scope checks when Laravel is inactive", async () => {
    const options = makeOptions({
      collectPhpMethodsForClass: vi.fn(async () => [
        methodCompletion("scopePublished"),
      ]),
      isLaravelFrameworkActive: false,
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
