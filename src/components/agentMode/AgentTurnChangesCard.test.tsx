// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentTurnChangesCard } from "./AgentTurnChangesCard";
import type { AgentTurnChangeSummary, AgentTurnChangedFile } from "../../domain/agentTurnChanges";
const file = (
  relativePath: string,
  addedLines: number | null = 4,
  deletedLines: number | null = 2,
): AgentTurnChangedFile => ({
  relativePath,
  oldRelativePath: null,
  status: "modified",
  addedLines,
  deletedLines,
});
let host: HTMLDivElement;
let root: Root;
let summary: AgentTurnChangeSummary;
const open = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  open.mockClear();
  summary = {
    turnId: "turn-1",
    state: "ready",
    files: [file("src/a.ts"), file("src/b.ts"), file("README.md", 1, 0)],
    truncated: false,
    reason: null,
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () =>
  act(() => root.render(<AgentTurnChangesCard summary={summary} onOpenDiff={open} />));
function button(label: string) {
  return [...host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  )!;
}
it("starts collapsed with accurate totals, opens exact files and the full turn diff", () => {
  render();
  expect(host.textContent).toContain("3 changed files");
  expect(host.textContent).toContain("+9");
  expect(host.textContent).toContain("−4");
  expect(button("Open diff for src/a.ts")).toBeUndefined();
  const folder = host.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!;
  act(() => folder.click());
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  act(() => button("Open diff for src/a.ts").click());
  expect(open).toHaveBeenLastCalledWith("src/a.ts");
  act(() => button("Open diff").click());
  expect(open).toHaveBeenLastCalledWith();
});
it("expands and collapses all folders and resets expansion when the turn changes", () => {
  render();
  act(() => button("Expand all folders").click());
  expect(button("Open diff for src/a.ts")).toBeDefined();
  act(() => button("Collapse all folders").click());
  expect(button("Open diff for src/a.ts")).toBeUndefined();
  act(() => button("Expand all folders").click());
  summary = { ...summary, turnId: "turn-2" };
  render();
  expect(button("Open diff for src/a.ts")).toBeUndefined();
});
it("labels partial lists and unknown line totals without pretending binary files changed zero lines", () => {
  summary = { ...summary, files: [file("image.png", null, null)], truncated: true };
  render();
  expect(host.textContent).toContain("Showing 1 changed file");
  expect(host.textContent).toContain("Line counts unavailable");
  expect(host.textContent).toContain("known counts only");
  expect(
    host.querySelectorAll(".agent-turn-changes__added,.agent-turn-changes__deleted"),
  ).toHaveLength(0);
});
it("shows an unavailable reason without opening a current working-tree diff", () => {
  summary = { ...summary, state: "unavailable", reason: "The starting snapshot is unavailable." };
  render();
  expect(host.textContent).toContain(summary.reason);
  expect(host.querySelector("button")).toBeNull();
});
it("renders nothing for a workspace where turn changes are unsupported", () => {
  summary = { ...summary, state: "unsupported", files: [], reason: "notGitRepository" };
  render();
  expect(host.innerHTML).toBe("");
});
it("hides a verified empty turn but keeps an incomplete empty summary visible", () => {
  summary = { ...summary, files: [] };
  render();
  expect(host.textContent).toBe("");
  summary = { ...summary, truncated: true };
  render();
  expect(host.textContent).toContain("Only part");
});
it("exposes rename provenance and renders unusual file names as text", () => {
  summary = {
    ...summary,
    files: [{ ...file("<img>.ts"), oldRelativePath: "old.ts", status: "renamed" }],
  };
  render();
  expect(host.querySelector("img")).toBeNull();
  expect(button("Open diff for <img>.ts").title).toBe("old.ts → <img>.ts");
  expect(host.textContent).toContain("renamed");
});

it("exposes change status and line counts as an accessible file description", () => {
  summary = { ...summary, files: [file("binary.png", null, null), file("text.ts", 3, 1)] };
  render();
  const binary = button("Open diff for binary.png");
  const text = button("Open diff for text.ts");
  expect(document.getElementById(binary.getAttribute("aria-describedby")!)?.textContent).toContain(
    "Added line count unavailable.",
  );
  expect(document.getElementById(text.getAttribute("aria-describedby")!)?.textContent).toContain(
    "modified. 3 added lines. 1 deleted lines.",
  );
});
