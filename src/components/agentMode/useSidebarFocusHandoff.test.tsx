// @vitest-environment jsdom

import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { AgentRailState } from "../../domain/agentWorkbenchLayout";
import { useSidebarFocusHandoff } from "./useSidebarFocusHandoff";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Harness({ rail }: { readonly rail: AgentRailState }) {
  const anchor = useRef<HTMLElement | null>(null);
  useSidebarFocusHandoff(rail, anchor);
  return (
    <section ref={anchor}>
      {rail === "expanded" ? (
        <button aria-label="Collapse sidebar" type="button" />
      ) : (
        <button aria-label="Expand sidebar" type="button" />
      )}
      <textarea aria-label="Message" />
    </section>
  );
}

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function button(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

describe("useSidebarFocusHandoff", () => {
  it("moves lost focus from Collapse to Expand and back", () => {
    mounted = mountUi();
    mounted.render(<Harness rail="expanded" />);
    button("Collapse sidebar")?.focus();

    mounted.render(<Harness rail="collapsed" />);
    expect(document.activeElement).toBe(button("Expand sidebar"));

    mounted.render(<Harness rail="expanded" />);
    expect(document.activeElement).toBe(button("Collapse sidebar"));
  });

  it("never steals focus that is still on a live element", () => {
    mounted = mountUi();
    mounted.render(<Harness rail="expanded" />);
    const message = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
    message?.focus();

    mounted.render(<Harness rail="collapsed" />);

    expect(document.activeElement).toBe(message);
  });

  it("does nothing on the first render", () => {
    mounted = mountUi();
    mounted.render(<Harness rail="collapsed" />);

    expect(document.activeElement).toBe(document.body);
  });
});
