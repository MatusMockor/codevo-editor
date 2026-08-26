// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DirtyCloseDecisionPort } from "./dirtyCloseDecisionPort";
import { useWorkbenchDirtyCloseDecisionPort } from "./useWorkbenchDirtyCloseDecisionPort";
import type { WorkbenchPrompter } from "./workbenchPrompter";

function renderDecisionPort(prompter: WorkbenchPrompter) {
  const host = document.createElement("div");
  const root = createRoot(host);
  let port: DirtyCloseDecisionPort | null = null;

  function Harness() {
    port = useWorkbenchDirtyCloseDecisionPort(prompter);
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    port: () => port as DirtyCloseDecisionPort,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useWorkbenchDirtyCloseDecisionPort", () => {
  it("settles a synchronous confirmation without an extra async layer", async () => {
    const harness = renderDecisionPort({
      confirm: vi.fn(() => true),
      prompt: vi.fn(() => null),
    });
    let settled = false;
    const decision = harness.port().decideDirtyClose({ documentNames: ["App.ts"], scope: "tab" });
    void decision.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(settled).toBe(true);
    await expect(decision).resolves.toBe("discard");
    harness.unmount();
  });

  it("fails closed when an asynchronous confirmation rejects", async () => {
    const harness = renderDecisionPort({
      confirm: vi.fn(() => Promise.reject(new Error("dialog unavailable"))),
      prompt: vi.fn(() => null),
    });

    await expect(
      harness.port().decideDirtyClose({ documentNames: ["App.ts"], scope: "tab" }),
    ).resolves.toBe("cancel");
    harness.unmount();
  });
});
