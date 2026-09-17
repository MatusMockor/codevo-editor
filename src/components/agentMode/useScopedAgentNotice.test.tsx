// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useScopedAgentNotice } from "./useScopedAgentNotice";

it("drops old notices and late callbacks across A → B → A without hiding current failures", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  let state!: ReturnType<typeof useScopedAgentNotice>;
  function Probe({ owner }: { owner: string }) {
    state = useScopedAgentNotice(owner);
    return state[0]?.message ?? null;
  }
  try {
    act(() => root.render(<Probe owner="A" />));
    const lateA = state[1];
    act(() => lateA({ kind: "error", message: "First A", action: null }));
    expect(host.textContent).toBe("First A");
    act(() => root.render(<Probe owner="B" />));
    expect(host.textContent).toBe("");
    act(() => lateA({ kind: "error", message: "Late A", action: null }));
    expect(host.textContent).toBe("");
    act(() => root.render(<Probe owner="A" />));
    act(() => lateA({ kind: "error", message: "Old generation", action: null }));
    expect(host.textContent).toBe("");
    act(() => state[1]({ kind: "error", message: "Current A", action: null }));
    expect(host.textContent).toBe("Current A");
    act(() => state[1](null));
    expect(host.textContent).toBe("");
  } finally {
    act(() => root.unmount());
  }
});
