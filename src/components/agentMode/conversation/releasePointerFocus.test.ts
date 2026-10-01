// @vitest-environment jsdom
import type { MouseEvent } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { releaseFocusAfterPointerPress } from "./releasePointerFocus";

function press(target: HTMLElement): void {
  releaseFocusAfterPointerPress({ currentTarget: target } as unknown as MouseEvent<HTMLElement>);
  target.focus();
  document.dispatchEvent(new Event("mouseup"));
}

function transcriptWithBubble(focusable: boolean): HTMLElement {
  const transcript = document.createElement("div");
  transcript.className = "agent-session__scroll";
  if (focusable) transcript.tabIndex = -1;
  const bubble = document.createElement("div");
  bubble.className = "agent-prompt__bubble";
  bubble.tabIndex = -1;
  transcript.append(bubble);
  document.body.append(transcript);
  return bubble;
}

describe("releaseFocusAfterPointerPress", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("hands focus to the transcript after a pointer press on a bubble", () => {
    const bubble = transcriptWithBubble(true);
    press(bubble);
    expect(document.activeElement).toBe(bubble.parentElement);
  });

  it("drops focus from the bubble when the transcript cannot take focus", () => {
    const bubble = transcriptWithBubble(false);
    press(bubble);
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus alone when the press moved it to a link inside the bubble", () => {
    const bubble = transcriptWithBubble(true);
    const link = document.createElement("a");
    link.href = "https://example.com";
    bubble.append(link);
    releaseFocusAfterPointerPress({ currentTarget: bubble } as unknown as MouseEvent<HTMLElement>);
    link.focus();
    document.dispatchEvent(new Event("mouseup"));
    expect(document.activeElement).toBe(link);
  });
});
