// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DirtyCloseDecisionCoordinator } from "../application/dirtyCloseDecisionCoordinator";
import { DirtyCloseDecisionDialogHost } from "./DirtyCloseDecisionDialogHost";

describe("DirtyCloseDecisionDialogHost", () => {
  let coordinator: DirtyCloseDecisionCoordinator;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    coordinator = new DirtyCloseDecisionCoordinator();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(<DirtyCloseDecisionDialogHost coordinator={coordinator} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders a labelled modal and focuses the safe default action", async () => {
    const invoker = document.createElement("button");
    document.body.append(invoker);
    invoker.focus();

    const { decision } = await requestDecision({
      scope: "tab",
      documentNames: ["notes.ts"],
    });

    const dialog = requireDialog();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Save changes to notes.ts?");
    expect(document.activeElement).toBe(button("Save"));

    await act(async () => button("Save").click());

    await expect(decision).resolves.toBe("save");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it("returns discard from its explicit destructive action", async () => {
    const { decision } = await requestDecision({
      scope: "workspace",
      documentNames: ["first.ts", "second.ts"],
    });

    expect(host.textContent).toContain(
      "Save changes before closing this workspace?",
    );
    expect(host.textContent).toContain("2 documents have unsaved changes.");
    expect(
      Array.from(host.querySelectorAll("li"), (item) => item.textContent),
    ).toEqual(["first.ts", "second.ts"]);

    expect(button("Save All")).toBeTruthy();

    await act(async () => button("Discard All").click());

    await expect(decision).resolves.toBe("discard");
  });

  it("disambiguates equal relative paths from different workspaces", async () => {
    const { decision } = await requestDecision({
      scope: "quit",
      documentNames: ["config.php", "config.php"],
      documents: [
        {
          id: "workspace-a:config",
          name: "config.php",
          relativePath: "config/config.php",
          workspaceLabel: "api",
        },
        {
          id: "workspace-b:config",
          name: "config.php",
          relativePath: "config/config.php",
          workspaceLabel: "worker",
        },
      ],
    });

    expect(
      Array.from(host.querySelectorAll("li"), (item) => item.textContent),
    ).toEqual(["api / config/config.php", "worker / config/config.php"]);

    await act(async () => button("Cancel").click());
    await decision;
  });

  it("keeps a single-project prompt compact while showing relative paths", async () => {
    const { decision } = await requestDecision({
      scope: "workspace",
      documentNames: ["User.php", "Invoice.php"],
      documents: [
        {
          id: "api:user",
          name: "User.php",
          relativePath: "app/Models/User.php",
          workspaceLabel: "api",
        },
        {
          id: "api:invoice",
          name: "Invoice.php",
          relativePath: "app/Models/Invoice.php",
          workspaceLabel: "api",
        },
      ],
    });

    expect(
      Array.from(host.querySelectorAll("li"), (item) => item.textContent),
    ).toEqual(["app/Models/User.php", "app/Models/Invoice.php"]);

    await act(async () => button("Cancel").click());
    await decision;
  });

  it("does not let a duplicate stale event consume a queued request", async () => {
    const { decision: firstDecision } = await requestDecision({
      scope: "tab",
      documentNames: ["first.ts"],
    });
    const staleSaveButton = button("Save");
    const { decision: secondDecision } = await requestDecision({
      scope: "tab",
      documentNames: ["second.ts"],
    });

    await act(async () => staleSaveButton.click());
    await expect(firstDecision).resolves.toBe("save");
    expect(host.textContent).toContain("Save changes to second.ts?");

    await act(async () => staleSaveButton.click());
    expect(host.textContent).toContain("Save changes to second.ts?");

    await act(async () => button("Discard").click());
    await expect(secondDecision).resolves.toBe("discard");
  });

  it.each([
    ["tab", "Save changes to draft.ts?"],
    [
      "group",
      "Save changes to draft.ts before closing this editor group?",
    ],
    [
      "workspace",
      "Save changes to draft.ts before closing this workspace?",
    ],
    ["quit", "Save changes to draft.ts before quitting?"],
  ] as const)("names a single document for the %s scope", async (scope, copy) => {
    const { decision } = await requestDecision({
      scope,
      documentNames: ["draft.ts"],
    });

    expect(host.textContent).toContain(copy);
    await act(async () => button("Cancel").click());
    await decision;
  });

  it("allows long unbroken document names to wrap", async () => {
    const longName = `${"unbroken".repeat(30)}.typescript`;
    const { decision: singleDecision } = await requestDecision({
      scope: "quit",
      documentNames: [longName],
    });

    expect(host.querySelector("h2")?.textContent).toContain(longName);
    await act(async () => button("Cancel").click());
    await singleDecision;

    const { decision: multipleDecision } = await requestDecision({
      scope: "workspace",
      documentNames: [longName, `${longName}.second`],
    });
    const listItem = host.querySelector("li");

    expect(listItem?.textContent).toBe(longName);
    expect(listItem?.textContent).not.toContain("...");

    await act(async () => button("Cancel").click());
    await multipleDecision;
  });

  it("treats Escape, native cancel, and the backdrop as cancel", async () => {
    const { decision: escapeDecision } = await requestDecision({
      scope: "quit",
      documentNames: ["notes.ts"],
    });

    await act(async () => {
      requireDialog().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    await expect(escapeDecision).resolves.toBe("cancel");

    const { decision: nativeDecision } = await requestDecision({
      scope: "group",
      documentNames: ["notes.ts"],
    });
    await act(async () => {
      requireDialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    await expect(nativeDecision).resolves.toBe("cancel");

    const { decision: backdropDecision } = await requestDecision({
      scope: "tab",
      documentNames: ["notes.ts"],
    });
    await act(async () => {
      requireDialog().dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });
    await expect(backdropDecision).resolves.toBe("cancel");
  });

  it("traps keyboard focus inside the action row", async () => {
    await requestDecision({
      scope: "quit",
      documentNames: ["notes.ts"],
    });
    const dialog = requireDialog();

    button("Save").focus();
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      );
    });
    expect(document.activeElement).toBe(button("Cancel"));

    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Tab",
          shiftKey: true,
        }),
      );
    });
    expect(document.activeElement).toBe(button("Save"));
  });

  it("cancels an unresolved request when its shell host unmounts", async () => {
    const { decision } = await requestDecision({
      scope: "quit",
      documentNames: [],
    });

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    await expect(decision).resolves.toBe("cancel");
    root = createRoot(host);
  });

  it("keeps requests live through StrictMode effect replay", async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    coordinator = new DirtyCloseDecisionCoordinator();
    root = createRoot(host);
    await act(async () => {
      root.render(
        <StrictMode>
          <DirtyCloseDecisionDialogHost coordinator={coordinator} />
        </StrictMode>,
      );
      await Promise.resolve();
    });
    const { decision } = await requestDecision({
      scope: "tab",
      documentNames: ["strict.ts"],
    });

    await act(async () => Promise.resolve());
    expect(host.textContent).toContain("Save changes to strict.ts?");

    await act(async () => button("Save").click());
    await expect(decision).resolves.toBe("save");
  });

  it("keeps queued requests owned by an immediately remounted host live", async () => {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => {
      root.render(<DirtyCloseDecisionDialogHost coordinator={coordinator} />);
    });

    let firstDecision: Promise<"save" | "discard" | "cancel"> | null = null;
    let secondDecision: Promise<"save" | "discard" | "cancel"> | null = null;
    act(() => {
      firstDecision = coordinator.decideDirtyClose({
        scope: "tab",
        documentNames: ["first-remount.ts"],
      });
      secondDecision = coordinator.decideDirtyClose({
        scope: "tab",
        documentNames: ["second-remount.ts"],
      });
    });
    if (!firstDecision || !secondDecision) {
      throw new Error("Expected remounted dirty-close decision promises");
    }

    await act(async () => Promise.resolve());
    expect(host.textContent).toContain("Save changes to first-remount.ts?");

    await act(async () => button("Save").click());
    await expect(firstDecision).resolves.toBe("save");
    expect(host.textContent).toContain("Save changes to second-remount.ts?");

    await act(async () => button("Discard").click());
    await expect(secondDecision).resolves.toBe("discard");
  });

  async function requestDecision(
    request: Parameters<DirtyCloseDecisionCoordinator["decideDirtyClose"]>[0],
  ) {
    let decision: ReturnType<
      DirtyCloseDecisionCoordinator["decideDirtyClose"]
    > | null = null;
    await act(async () => {
      decision = coordinator.decideDirtyClose(request);
    });

    if (!decision) {
      throw new Error("Expected a dirty-close decision promise");
    }

    return { decision };
  }

  function requireDialog(): HTMLDialogElement {
    const dialog = host.querySelector<HTMLDialogElement>('[role="alertdialog"]');
    if (!dialog) {
      throw new Error("Expected dirty-close decision dialog");
    }

    return dialog;
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!match) {
      throw new Error(`Expected ${label} button`);
    }

    return match;
  }
});
