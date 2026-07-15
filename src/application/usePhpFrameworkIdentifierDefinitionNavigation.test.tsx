// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import {
  usePhpFrameworkIdentifierDefinitionNavigation,
  type PhpFrameworkIdentifierDefinitionNavigation,
  type PhpFrameworkIdentifierDefinitionNavigationDependencies,
} from "./usePhpFrameworkIdentifierDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const context: PhpIdentifierContext = {
  kind: "laravelNamedRouteString",
  routeName: "dashboard",
};

function renderHook(
  deps: PhpFrameworkIdentifierDefinitionNavigationDependencies,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    api: PhpFrameworkIdentifierDefinitionNavigation | null;
  } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpFrameworkIdentifierDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpFrameworkIdentifierDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpFrameworkIdentifierDefinitionNavigation => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpFrameworkIdentifierDefinitionNavigation", () => {
  it("dispatches indexed framework navigation through direct adapters", async () => {
    const directAdapter = { goToDefinition: vi.fn(async () => true) };
    const contextualAdapter = { goToDefinition: vi.fn(async () => true) };
    const harness = renderHook({
      adapters: [directAdapter],
      contextualAdapters: [contextualAdapter],
    });

    const handled = await harness
      .api()
      .goToPhpFrameworkIdentifierDefinition(context);

    expect(handled).toBe(true);
    expect(directAdapter.goToDefinition).toHaveBeenCalledWith(context);
    expect(contextualAdapter.goToDefinition).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("dispatches contextual framework navigation through contextual adapters", async () => {
    const directAdapter = { goToDefinition: vi.fn(async () => true) };
    const contextualAdapter = { goToDefinition: vi.fn(async () => true) };
    const harness = renderHook({
      adapters: [directAdapter],
      contextualAdapters: [contextualAdapter],
    });

    const handled = await harness
      .api()
      .goToContextualPhpFrameworkIdentifierDefinition(context);

    expect(handled).toBe(true);
    expect(contextualAdapter.goToDefinition).toHaveBeenCalledWith(context);
    expect(directAdapter.goToDefinition).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("propagates navigation requests through both handlers", async () => {
    const request = { canNavigate: vi.fn(() => true) };
    const directAdapter = { goToDefinition: vi.fn(async () => true) };
    const contextualAdapter = { goToDefinition: vi.fn(async () => true) };
    const harness = renderHook({
      adapters: [directAdapter],
      contextualAdapters: [contextualAdapter],
    });

    await expect(
      harness.api().goToPhpFrameworkIdentifierDefinition(context, request),
    ).resolves.toBe(true);
    await expect(
      harness
        .api()
        .goToContextualPhpFrameworkIdentifierDefinition(context, request),
    ).resolves.toBe(true);

    expect(directAdapter.goToDefinition).toHaveBeenCalledWith(context, request);
    expect(contextualAdapter.goToDefinition).toHaveBeenCalledWith(
      context,
      request,
    );

    harness.unmount();
  });
});
