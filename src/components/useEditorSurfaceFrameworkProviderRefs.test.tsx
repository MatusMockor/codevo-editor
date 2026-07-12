// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EditorSurfaceFrameworkIntelligenceProviders,
} from "./editorSurfaceFrameworkProviderResolution";
import { useEditorSurfaceFrameworkProviderRefs } from "./useEditorSurfaceFrameworkProviderRefs";

describe("useEditorSurfaceFrameworkProviderRefs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("keeps the template registry ref stable while refreshing its current value", async () => {
    const firstDefinition = vi.fn(async () => true);
    const secondDefinition = vi.fn(async () => false);
    let latest: ReturnType<typeof useEditorSurfaceFrameworkProviderRefs> | null =
      null;

    function Harness({
      providers,
    }: {
      providers: EditorSurfaceFrameworkIntelligenceProviders;
    }) {
      latest = useEditorSurfaceFrameworkProviderRefs({
        frameworkIntelligenceProviders: providers,
      });
      return null;
    }

    await act(async () => {
      root.render(
        <Harness providers={{ provideBladeDefinition: firstDefinition }} />,
      );
    });

    const registryRef = latest!.templateLanguageProvidersRef;
    expect(registryRef.current.blade.provideDefinition).toBe(firstDefinition);

    await act(async () => {
      root.render(
        <Harness providers={{ provideBladeDefinition: secondDefinition }} />,
      );
    });

    expect(latest!.templateLanguageProvidersRef).toBe(registryRef);
    expect(registryRef.current.blade.provideDefinition).toBe(secondDefinition);
  });
});
