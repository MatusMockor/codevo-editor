// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentThreadRowMenu, type AgentThreadRowMenuProps } from "./AgentThreadRowMenu";

let root: Root;
let host: HTMLDivElement;
const now = 1_900_000_000_000;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(now);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
function render(overrides: Partial<AgentThreadRowMenuProps> = {}) {
  const onCommand = vi.fn();
  act(() =>
    root.render(
      <AgentThreadRowMenu
        threadId="thread"
        branch={null}
        pinned={false}
        archived={false}
        running={false}
        position={{ x: 0, y: 0 }}
        onCommand={onCommand}
        onRename={() => undefined}
        onClose={() => undefined}
        {...overrides}
      />,
    ),
  );
  return onCommand;
}
function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  );
  expect(button).toBeDefined();
  act(() => button!.click());
}
it("opens snooze options without dispatching until a time is selected", () => {
  const command = render();
  click("Snooze…");
  expect(command).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe("For one hour");
  expect(document.querySelector('input[aria-label="Snooze until"]')).not.toBeNull();
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "Snooze until selected time",
    )?.disabled,
  ).toBe(true);
  click("For one hour");
  expect(command).toHaveBeenCalledWith({ kind: "snooze", until: now + 3_600_000 });
});
it("supports wake, completion and restoring settled threads", () => {
  const wake = render({ snoozed: true });
  click("Wake now");
  expect(wake).toHaveBeenCalledWith({ kind: "unsnooze" });
  const settle = render();
  click("Mark settled");
  expect(settle).toHaveBeenCalledWith({ kind: "settle" });
  const restore = render({ settled: true });
  click("Restore to active");
  expect(restore).toHaveBeenCalledWith({ kind: "restore" });
});
it("provides keyboard-accessible reorder commands with exact target IDs", () => {
  const command = render({ moveUpId: "above", moveDownId: "below" });
  click("Move up");
  click("Move down");
  expect(command.mock.calls).toEqual([
    [{ kind: "moveBefore", targetThreadId: "above" }],
    [{ kind: "moveAfter", targetThreadId: "below" }],
  ]);
});
it("does not allow hiding a running thread", () => {
  const command = render({ running: true });
  click("Snooze…");
  click("Mark settled");
  expect(command).not.toHaveBeenCalled();
});
