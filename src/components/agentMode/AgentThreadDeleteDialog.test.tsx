// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentThreadDeleteDialog } from "./AgentThreadDeleteDialog";

const RAW_PROMPT = [
  "ake features alebo co mame zle alebo inak co sa tyka menezovania threadov alebbo",
  "co zobrazuje a ako zobrazuje v chate atd co uz pre codex alebo claude code.",
  "https://git.efabrica.sk/ebox/backend/crm/-/merge_requests/123",
].join("\n");

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

function render(title: string) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <AgentThreadDeleteDialog onCancel={onCancel} onConfirm={onConfirm} open title={title} />,
    ),
  );
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const button = (text: string) =>
    Array.from(dialog.querySelectorAll("button")).find((item) => item.textContent === text)!;
  return { dialog, button, onCancel, onConfirm };
}

describe("delete thread confirmation", () => {
  it("names the thread on one quiet, truncated line instead of dumping the raw prompt", () => {
    const { dialog } = render(RAW_PROMPT);
    expect(dialog.querySelector("h2")?.textContent).toBe("Delete thread?");
    const name = dialog.querySelector<HTMLElement>(".agent-delete-dialog__name")!;
    expect(Array.from(name.textContent ?? "").length).toBeLessThanOrEqual(60);
    expect(name.textContent?.endsWith("…")).toBe(true);
    expect(name.textContent).not.toContain("\n");
    expect(name.getAttribute("title")).toMatch(
      /^ake features .* git\.efabrica\.sk\/…\/merge_requests\/123$/u,
    );
    expect(dialog.textContent).toContain(
      "Its saved history will be removed from Codevo. This can't be undone.",
    );
    expect(dialog.textContent).not.toContain("and its saved history are removed");
  });

  it("cleans URLs and falls back for an empty title", () => {
    expect(
      render("https://git.efabrica.sk/ebox/backend/crm/-/merge_requests/123").dialog.querySelector(
        ".agent-delete-dialog__name",
      )?.textContent,
    ).toBe("git.efabrica.sk/…/merge_requests/123");
    act(() => root?.unmount());
    root = null;
    expect(render("   ").dialog.querySelector(".agent-delete-dialog__name")?.textContent).toBe(
      "Untitled conversation",
    );
  });

  it("focuses Cancel by default and only deletes from the destructive button", () => {
    const { button, onCancel, onConfirm } = render("Telekom phone");
    expect(document.activeElement).toBe(button("Cancel"));
    act(() => button("Cancel").click());
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => button("Delete thread").click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
