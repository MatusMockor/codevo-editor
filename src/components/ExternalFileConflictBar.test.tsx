// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalFileConflict } from "../domain/externalFileConflict";
import { ExternalFileConflictBar } from "./ExternalFileConflictBar";

describe("ExternalFileConflictBar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders persistent modified-conflict actions and dispatches them", async () => {
    const onAction = vi.fn();
    await renderBar(modifiedConflict(), { onAction });

    expect(host.querySelector('[aria-label="External file conflict"]')).not.toBeNull();
    expect(host.textContent).toContain("File changed on disk");
    expect(buttonLabels()).toEqual(["Compare", "Reload", "Overwrite"]);

    await act(async () => {
      button("Compare").click();
      button("Reload").click();
      button("Overwrite").click();
    });

    expect(onAction.mock.calls).toEqual([
      ["compare"],
      ["reload"],
      ["overwrite"],
    ]);
  });

  it("offers Recreate without Reload for a deleted file", async () => {
    await renderBar(deletedConflict());

    expect(host.textContent).toContain("File deleted on disk");
    expect(buttonLabels()).toEqual(["Compare", "Recreate"]);
  });

  it("offers Follow Rename and identifies the destination", async () => {
    await renderBar(renamedConflict());

    expect(host.textContent).toContain("/project/new-note.txt");
    expect(buttonLabels()).toEqual([
      "Compare",
      "Follow Rename",
      "Overwrite",
    ]);
  });

  it("disables every action and exposes progress while resolving", async () => {
    await renderBar(modifiedConflict(), { busyAction: "reload" });

    expect(buttonLabels()).toEqual(["Compare", "Reload...", "Overwrite"]);
    expect(
      host.querySelector('[aria-busy="true"]')?.textContent,
    ).toContain("Reload...");
    expect(
      Array.from(host.querySelectorAll<HTMLButtonElement>("button")).every(
        ({ disabled }) => disabled,
      ),
    ).toBe(true);
  });

  it("surfaces an action error in place of the normal detail", async () => {
    await renderBar(modifiedConflict(), { error: "Permission denied" });

    expect(host.textContent).toContain("Permission denied");
    expect(host.textContent).not.toContain(
      "The disk version changed while this document was open.",
    );
  });

  async function renderBar(
    conflict: ExternalFileConflict,
    overrides: Partial<{
      busyAction: "reload";
      error: string;
      onAction: (action: string) => void;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <ExternalFileConflictBar
          busyAction={overrides.busyAction ?? null}
          conflict={conflict}
          error={overrides.error ?? null}
          onAction={overrides.onAction ?? vi.fn()}
        />,
      );
    });
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent === label);

    if (!match) {
      throw new Error(`Missing ${label} button`);
    }

    return match;
  }

  function buttonLabels(): string[] {
    return Array.from(host.querySelectorAll("button"), (element) =>
      element.textContent ?? "",
    );
  }
});

function modifiedConflict(): ExternalFileConflict {
  return {
    id: 1,
    revision: 3,
    kind: "modified",
    baseline: { path: "/project/note.txt", content: "editor" },
    disk: { path: "/project/note.txt", content: "disk" },
  };
}

function deletedConflict(): ExternalFileConflict {
  return {
    id: 2,
    revision: 4,
    kind: "deleted",
    baseline: { path: "/project/note.txt", content: "editor" },
    disk: null,
  };
}

function renamedConflict(): ExternalFileConflict {
  return {
    id: 3,
    revision: 5,
    kind: "renamed",
    baseline: { path: "/project/note.txt", content: "editor" },
    disk: { path: "/project/new-note.txt", content: "disk" },
  };
}
