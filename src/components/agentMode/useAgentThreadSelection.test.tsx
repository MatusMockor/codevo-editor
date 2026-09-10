// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAgentThreadSelection, type AgentThreadSelection } from "./useAgentThreadSelection";

const ROOT = "/workspace/app";
const OTHER = "/workspace/api";

describe("useAgentThreadSelection", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: AgentThreadSelection | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("refuses to commit a selection captured before the owner changed", () => {
    render(ROOT, ["agt-1", "agt-2"]);
    act(() => current().apply("agt-1", "toggle"));
    act(() => current().apply("agt-2", "toggle"));
    const capturedOwner = current().owner;
    expect(capturedOwner).toEqual({ key: ROOT, generation: 0 });
    expect([...current().selectedIds]).toEqual(["agt-1", "agt-2"]);

    render(OTHER, ["agt-x"]);
    expect(current().owner).toEqual({ key: OTHER, generation: 1 });
    expect(current().commit(capturedOwner)).toEqual({ kind: "ownerChanged" });
    expect(current().count).toBe(0);
  });

  it("treats a return to the previous project as a new generation", () => {
    render(ROOT, ["agt-1", "agt-2"]);
    act(() => current().apply("agt-1", "toggle"));
    const capturedOwner = current().owner;
    expect(capturedOwner).toEqual({ key: ROOT, generation: 0 });

    render(OTHER, ["agt-x"]);
    render(ROOT, ["agt-1", "agt-2"]);

    expect(current().owner).toEqual({ key: ROOT, generation: 2 });
    expect(current().commit(capturedOwner)).toEqual({ kind: "ownerChanged" });
    expect(current().count).toBe(0);
  });

  it("commits the live selection in visual order and names ids that left the list", () => {
    render(ROOT, ["agt-1", "agt-2", "agt-3"]);
    act(() => current().apply("agt-3", "toggle"));
    act(() => current().apply("agt-1", "toggle"));

    render(ROOT, ["agt-1", "agt-2"]);
    expect(commitNow()).toEqual({
      kind: "ready",
      owner: current().owner,
      ids: ["agt-1"],
      missingIds: ["agt-3"],
    });
  });

  it("ignores a gesture aimed at a row the list does not render", () => {
    render(ROOT, ["agt-1"]);
    act(() => current().apply("agt-hidden", "toggle"));

    expect(current().count).toBe(0);
  });

  it("clears the selection and the anchor", () => {
    render(ROOT, ["agt-1", "agt-2"]);
    act(() => current().apply("agt-1", "toggle"));
    act(() => current().apply("agt-2", "extend"));
    expect(current().count).toBe(2);

    act(() => current().clear());
    expect(current().count).toBe(0);

    act(() => current().apply("agt-2", "extend"));
    expect([...current().selectedIds]).toEqual(["agt-2"]);
  });

  function commitNow(): ReturnType<AgentThreadSelection["commit"]> {
    return current().commit(current().owner);
  }

  function current(): AgentThreadSelection {
    expect(captured).not.toBeNull();
    return captured as AgentThreadSelection;
  }

  function render(ownerKey: string | null, visibleIds: ReadonlyArray<string>): void {
    act(() => {
      root.render(<Harness ownerKey={ownerKey} visibleIds={visibleIds} />);
    });
  }

  function Harness({
    ownerKey,
    visibleIds,
  }: {
    readonly ownerKey: string | null;
    readonly visibleIds: ReadonlyArray<string>;
  }) {
    captured = useAgentThreadSelection(ownerKey, visibleIds);
    return null;
  }
});
