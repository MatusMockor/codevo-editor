// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentTurnChangeSummary,
  AgentTurnChangedFile,
} from "../../../domain/agentTurnChanges";
import { AgentTurnChangesRow } from "./AgentTurnChangesRow";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function file(
  relativePath: string,
  addedLines: number | null,
  deletedLines: number | null,
): AgentTurnChangedFile {
  return { relativePath, oldRelativePath: null, status: "modified", addedLines, deletedLines };
}

function summary(patch: Partial<AgentTurnChangeSummary> = {}): AgentTurnChangeSummary {
  return {
    turnId: "turn-1",
    state: "ready",
    files: [
      file("src/routes/orders.ts", 4, 1),
      file("src/middleware/idempotency.ts", 29, 0),
      file("test/orders.test.ts", 9, 6),
    ],
    truncated: false,
    reason: null,
    ...patch,
  };
}

describe("AgentTurnChangesRow", () => {
  it("summarizes the turn in one row and opens the whole turn diff", () => {
    const open = vi.fn();
    act(() =>
      root.render(<AgentTurnChangesRow active={false} onOpenDiff={open} summary={summary()} />),
    );

    const row = host.querySelector<HTMLButtonElement>("button.cv-changes-row");
    expect(row?.textContent).toBe("3 changed files+42−7Open diff");
    expect(row?.getAttribute("aria-label")).toBe(
      "3 changed files, 42 lines added, 7 removed. Open diff",
    );
    expect(row?.dataset.active).toBe("false");
    act(() => row?.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith();
  });

  it("opens a specific file from the expanded file list", () => {
    const open = vi.fn();
    act(() =>
      root.render(<AgentTurnChangesRow active={false} onOpenDiff={open} summary={summary()} />),
    );

    const toggle = host.querySelector<HTMLButtonElement>("button.cv-changes__toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".cv-changes__files")).toBeNull();
    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");

    const files = [...host.querySelectorAll<HTMLButtonElement>("button.cv-changes__file")];
    expect(files.map((button) => button.title)).toEqual([
      "src/routes/orders.ts",
      "src/middleware/idempotency.ts",
      "test/orders.test.ts",
    ]);
    act(() => files[1]?.click());
    expect(open).toHaveBeenCalledWith("src/middleware/idempotency.ts");
  });

  it("uses the singular, marks the active turn and hides unknown counts", () => {
    act(() =>
      root.render(
        <AgentTurnChangesRow
          active
          onOpenDiff={() => undefined}
          summary={summary({ files: [file("assets/logo.png", null, null)] })}
        />,
      ),
    );

    const row = host.querySelector<HTMLButtonElement>("button.cv-changes-row");
    expect(row?.textContent).toBe("1 changed fileOpen diff");
    expect(row?.dataset.active).toBe("true");
  });

  it("says when only part of the turn was recorded", () => {
    act(() =>
      root.render(
        <AgentTurnChangesRow
          active={false}
          onOpenDiff={() => undefined}
          summary={summary({ truncated: true })}
        />,
      ),
    );

    expect(host.querySelector(".cv-changes-row__count")?.textContent).toBe(
      "At least 3 changed files",
    );
  });

  it("renders the unavailable reason as a quiet note and nothing for an empty turn", () => {
    act(() =>
      root.render(
        <AgentTurnChangesRow
          active={false}
          onOpenDiff={() => undefined}
          summary={summary({
            state: "unavailable",
            files: [],
            reason: "Recorded changes cannot be read in this session.",
          })}
        />,
      ),
    );
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector(".cv-changes-row--unavailable")?.textContent).toBe(
      "Recorded changes cannot be read in this session.",
    );

    act(() =>
      root.render(
        <AgentTurnChangesRow
          active={false}
          onOpenDiff={() => undefined}
          summary={summary({ files: [] })}
        />,
      ),
    );
    expect(host.innerHTML).toBe("");
  });
});
