// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { installReferencesPeekRename } from "./referencesPeekRename";

const REFERENCES_PEEK =
  '<div class="peekview-widget reference-zone-widget"><div class="head"><div class="peekview-actions"><ul class="actions-container"></ul></div></div></div>';
const OTHER_PEEK =
  '<div class="peekview-widget"><div class="head"><div class="peekview-actions"></div></div></div>';

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe("installReferencesPeekRename", () => {
  it("adds one Rename button to an open references peek and runs rename", () => {
    const root = mount(REFERENCES_PEEK);
    const onRename = vi.fn();
    const dispose = installReferencesPeekRename(root, onRename);
    const button = root.querySelector<HTMLButtonElement>(".peekview-actions .cv-peek-rename");

    expect(button?.textContent).toBe("RenameF2");
    expect(button?.type).toBe("button");
    expect(button?.getAttribute("aria-keyshortcuts")).toBe("F2");
    expect(button?.getAttribute("title")).toBe("Rename symbol (F2)");
    button?.click();
    expect(onRename).toHaveBeenCalledTimes(1);
    dispose();
    expect(root.querySelector(".cv-peek-rename")).toBeNull();
    root.remove();
  });

  it("decorates a peek that opens later exactly once and ignores other peek kinds", () => {
    const root = mount("");
    let trigger: MutationCallback = () => undefined;
    const disconnect = vi.fn();
    const dispose = installReferencesPeekRename(root, vi.fn(), (_target, callback) => {
      trigger = callback;
      return { disconnect };
    });
    root.innerHTML = REFERENCES_PEEK + OTHER_PEEK;
    trigger([], {} as MutationObserver);
    trigger([], {} as MutationObserver);

    expect(root.querySelectorAll(".cv-peek-rename")).toHaveLength(1);
    expect(
      root.querySelector(".peekview-widget:not(.reference-zone-widget) .cv-peek-rename"),
    ).toBeNull();
    dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("stops decorating after dispose", () => {
    const root = mount("");
    let trigger: MutationCallback = () => undefined;
    const dispose = installReferencesPeekRename(root, vi.fn(), (_target, callback) => {
      trigger = callback;
      return { disconnect: () => undefined };
    });
    dispose();
    root.innerHTML = REFERENCES_PEEK;
    trigger([], {} as MutationObserver);

    expect(root.querySelector(".cv-peek-rename")).toBeNull();
    root.remove();
  });

  it("decorates through the default MutationObserver when a peek is inserted", async () => {
    const root = mount("");
    const dispose = installReferencesPeekRename(root, vi.fn());
    root.innerHTML = REFERENCES_PEEK;
    await Promise.resolve();

    expect(root.querySelectorAll(".cv-peek-rename")).toHaveLength(1);
    dispose();
    root.remove();
  });

  it("does nothing when Monaco's peek DOM has no actions container", () => {
    const root = mount(
      '<div class="peekview-widget reference-zone-widget"><div class="head"></div></div>',
    );
    const dispose = installReferencesPeekRename(root, vi.fn());

    expect(root.querySelector(".cv-peek-rename")).toBeNull();
    dispose();
    root.remove();
  });
});
