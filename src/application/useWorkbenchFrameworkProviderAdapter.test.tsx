// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkbenchFrameworkIntelligence } from "./workbenchFrameworkIntelligenceContracts";
import { useWorkbenchFrameworkProviderAdapter } from "./useWorkbenchFrameworkProviderAdapter";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useWorkbenchFrameworkProviderAdapter", () => {
  it("forwards canonical presenter-link callbacks without projecting Nette aliases", () => {
    const providePhpPresenterLinkCompletions = vi.fn(async () => null);
    const providePhpPresenterLinkDefinition = vi.fn(async () => true);
    const isPhpPresenterLinkCompletionContext = vi.fn(() => true);
    const intelligence = {
      isPhpFrameworkStringCompletionContext: vi.fn(() => false),
      isPhpPresenterLinkCompletionContext,
      provideBladeCodeActions: vi.fn(async () => []),
      provideBladeCompletions: vi.fn(async () => []),
      provideBladeDefinition: vi.fn(async () => false),
      provideLatteCompletions: vi.fn(async () => []),
      provideLatteDefinition: vi.fn(async () => false),
      provideNeonCompletions: vi.fn(async () => []),
      provideNeonDefinition: vi.fn(async () => false),
      providePhpPresenterLinkCompletions,
      providePhpPresenterLinkDefinition,
    } as unknown as WorkbenchFrameworkIntelligence;
    const container = document.createElement("div");
    const root = createRoot(container);
    let providers: ReturnType<
      typeof useWorkbenchFrameworkProviderAdapter
    > | null = null;

    function Harness() {
      providers = useWorkbenchFrameworkProviderAdapter(intelligence);
      return null;
    }

    act(() => {
      root.render(<Harness />);
    });

    expect(providers).toEqual(
      expect.objectContaining({
        isPhpPresenterLinkCompletionContext,
        providePhpPresenterLinkCompletions,
        providePhpPresenterLinkDefinition,
      }),
    );
    expect(providers).not.toHaveProperty("provideNettePhpLinkCompletions");
    expect(providers).not.toHaveProperty("provideNettePhpLinkDefinition");

    act(() => {
      root.unmount();
    });
  });
});
