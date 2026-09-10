// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import {
  AgentThreadMinimap,
  MIN_AGENT_MINIMAP_ENTRIES,
  type AgentThreadMinimapProps,
} from "./AgentThreadMinimap";
import { agentThreadMinimapModel } from "./agentThreadMinimapPresentation";

const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RUNNING: AgentTurnStatus = { kind: "running" };

describe("AgentThreadMinimap", () => {
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

  it("renders a navigation list with one dash per user turn", () => {
    render({ model: model(["First question", "Second question", "Third question"]) });

    const nav = host.querySelector('nav[aria-label="Your turns"]');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector("ol")).not.toBeNull();
    const buttons = [...host.querySelectorAll("ol > li > button")];
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Turn 1 of 3: First question",
      "Turn 2 of 3: Second question",
      "Turn 3 of 3: Third question",
    ]);
  });

  it("stays away when a thread has fewer turns than the map needs", () => {
    render({ model: model(["Only question"]) });

    expect(MIN_AGENT_MINIMAP_ENTRIES).toBe(2);
    expect(host.querySelector("nav")).toBeNull();
  });

  it("marks the in-view turn and a streaming one without inventing state", () => {
    render({
      currentIndex: 1,
      model: modelOf([
        turn("t1", "First question", SETTLED),
        turn("t2", "Second question", SETTLED),
        turn("t3", "Third question", RUNNING),
      ]),
    });

    const buttons = buttonList();
    expect(buttons.map((button) => button.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
    expect(buttons.map((button) => button.getAttribute("aria-busy"))).toEqual([null, null, "true"]);
    expect(buttons[2]?.getAttribute("aria-label")).toBe(
      "Turn 3 of 3: Third question, answer in progress",
    );
    expect(buttons[2]?.className).toContain("agent-minimap__dash--live");
  });

  it("encodes proximity to the current turn on every dash", () => {
    render({ currentIndex: 0, model: model(["a", "b", "c", "d", "e", "f", "g"]) });

    expect(
      buttonList().map((button) => button.style.getPropertyValue("--minimap-distance")),
    ).toEqual(["0", "1", "2", "3", "4", "4", "4"]);
  });

  it("compresses the rail once the thread is long", () => {
    render({ model: model(Array.from({ length: 44 }, (_unused, index) => `q${index}`)) });

    expect(host.querySelector(".agent-minimap--dense")).not.toBeNull();
    expect(buttonList()).toHaveLength(44);
  });

  it("folds a very long thread into grouped dashes that still name their range", () => {
    render({ model: model(Array.from({ length: 200 }, (_unused, index) => `q${index}`)) });

    const buttons = buttonList();
    expect(buttons.length).toBeLessThanOrEqual(55);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Turns 1 to 4 of 200, 4 prompts");
    expect(buttons[0]?.className).toContain("agent-minimap__dash--group");
  });

  it("moves a roving tabindex with the arrows, Home and End", () => {
    render({ currentIndex: 1, model: model(["a", "b", "c", "d"]) });

    expect(buttonList().map((button) => button.tabIndex)).toEqual([-1, 0, -1, -1]);

    press("ArrowDown");
    expect(buttonList().map((button) => button.tabIndex)).toEqual([-1, -1, 0, -1]);
    expect(document.activeElement).toBe(buttonList()[2]);

    press("ArrowUp");
    expect(document.activeElement).toBe(buttonList()[1]);

    press("End");
    expect(document.activeElement).toBe(buttonList()[3]);

    press("Home");
    expect(document.activeElement).toBe(buttonList()[0]);

    press("ArrowUp");
    expect(document.activeElement).toBe(buttonList()[0]);
  });

  it("jumps to a turn on click", () => {
    const onJump = vi.fn();
    render({ currentIndex: 0, model: model(["a", "b", "c"]), onJump });

    act(() => buttonList()[2]?.click());

    expect(onJump).toHaveBeenLastCalledWith("t3");
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("claims the arrows but leaves Enter to the button it moved focus to", () => {
    const onJump = vi.fn();
    render({ currentIndex: 0, model: model(["a", "b", "c"]), onJump });

    expect(dispatch("End").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttonList()[2]);
    expect(dispatch("Enter").defaultPrevented).toBe(false);

    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onJump).toHaveBeenLastCalledWith("t3");
  });

  it("takes the Go to Turn signal to the dash of the turn in view", () => {
    render({ currentIndex: 2, model: model(["a", "b", "c", "d"]), openSignal: 1 });
    render({ currentIndex: 2, model: model(["a", "b", "c", "d"]), openSignal: 2 });

    expect(document.activeElement).toBe(buttonList()[2]);
  });

  it("falls back to the same list in a popover at narrow widths", () => {
    const onJump = vi.fn();
    render({
      currentIndex: 1,
      model: model(["First", "Second", "Third"]),
      onJump,
      surface: "list",
    });

    expect(host.querySelector(".agent-minimap--rail")).toBeNull();
    const toggle = host.querySelector<HTMLButtonElement>(".agent-minimap__toggle");
    expect(toggle?.textContent).toBe("Turns · 3");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    act(() => toggle?.click());

    expect(
      host
        .querySelector<HTMLButtonElement>(".agent-minimap__toggle")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    const buttons = [...host.querySelectorAll('nav[aria-label="Your turns"] ol > li > button')];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Turn 1 of 3: First",
      "Turn 2 of 3: Second",
      "Turn 3 of 3: Third",
    ]);
    expect(buttons[1]?.getAttribute("aria-current")).toBe("true");
    expect(buttons[1]?.textContent).toContain("Second");

    act(() => (buttons[2] as HTMLButtonElement).click());
    expect(onJump).toHaveBeenLastCalledWith("t3");
  });

  it("closes the turn list when focus leaves it", () => {
    render({ currentIndex: 0, model: model(["First", "Second"]), surface: "list" });
    act(() => host.querySelector<HTMLButtonElement>(".agent-minimap__toggle")?.click());
    expect(host.querySelector(".agent-minimap__popover")).not.toBeNull();

    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => {
      host
        .querySelector(".agent-minimap--compact")
        ?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    });

    expect(host.querySelector(".agent-minimap__popover")).toBeNull();
    expect(host.querySelector(".agent-minimap__toggle")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    outside.remove();
  });

  function buttonList(): ReadonlyArray<HTMLButtonElement> {
    return [...host.querySelectorAll<HTMLButtonElement>("ol > li > button")];
  }

  function press(key: string): void {
    dispatch(key);
  }

  function dispatch(key: string): KeyboardEvent {
    const list = host.querySelector("ol");
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
    act(() => {
      list?.dispatchEvent(event);
    });
    return event;
  }

  function render(overrides: Partial<AgentThreadMinimapProps> = {}): void {
    act(() =>
      root.render(
        <AgentThreadMinimap
          currentIndex={-1}
          model={model(["a", "b"])}
          onJump={() => undefined}
          surface="rail"
          {...overrides}
        />,
      ),
    );
  }
});

function model(promptTexts: ReadonlyArray<string>) {
  return modelOf(promptTexts.map((prompt, index) => turn(`t${index + 1}`, prompt, SETTLED)));
}

function modelOf(turns: ReadonlyArray<AgentTurn>) {
  return agentThreadMinimapModel(turns);
}

function turn(turnId: string, prompt: string, status: AgentTurnStatus): AgentTurn {
  return {
    turnId,
    prompt,
    status,
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}
