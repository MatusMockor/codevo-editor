// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickOpenPrefixDispatch } from "./useQuickOpenPrefixDispatch";

describe("useQuickOpenPrefixDispatch", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  let dispatch: ReturnType<typeof useQuickOpenPrefixDispatch>;

  function Harness() {
    dispatch = useQuickOpenPrefixDispatch();
    return null;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("keeps stable delegates while forwarding seeds to the current destination", () => {
    act(() => root.render(<Harness />));
    const firstOpenWorkspaceSymbols = dispatch.openWorkspaceSymbols;
    const openWorkspaceSymbols = vi.fn();
    dispatch.quickOpenDispatchRef.current.openWorkspaceSymbols = openWorkspaceSymbols;

    act(() => dispatch.openWorkspaceSymbols("handler"));

    expect(openWorkspaceSymbols).toHaveBeenCalledWith("handler");

    act(() => root.render(<Harness />));

    expect(dispatch.openWorkspaceSymbols).toBe(firstOpenWorkspaceSymbols);
  });
});
