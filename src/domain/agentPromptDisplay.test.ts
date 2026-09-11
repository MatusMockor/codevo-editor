import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "./agentAttachment";
import { agentAttachmentPromptLine, agentEffectivePrompt } from "./agentAttachmentIntake";
import { agentPromptDisplayText, isAttachedImagePromptLine } from "./agentPromptDisplay";

const STORE = "/Users/me/Library/Application Support/dev.mockor.editor/agent-attachments/threads";
const IMAGE: AgentAttachment = {
  kind: "image",
  attachmentId: "d88cab3ac346ee5db5e41f35f35a1d8a",
  name: "image.png",
  mime: "image/png",
  bytes: 10,
  width: 4,
  height: 4,
  storedPath: `${STORE}/agt-mtx1sron-d07e/d88cab3ac346ee5db5e41f35f35a1d8a.png`,
};
const FILE: AgentAttachment = {
  kind: "file",
  attachmentId: "b".repeat(32),
  name: "notes.txt",
  bytes: 10,
  storedPath: `${STORE}/agt-mtx1sron-d07e/${"b".repeat(32)}.txt`,
};
const REFERENCE: AgentAttachment = {
  kind: "reference",
  name: "clip.mp4",
  path: "/Users/me/clip.mp4",
  bytes: 10,
};

describe("isAttachedImagePromptLine", () => {
  it("recognises exactly the store's image line", () => {
    expect(isAttachedImagePromptLine(agentAttachmentPromptLine(IMAGE))).toBe(true);
    expect(isAttachedImagePromptLine(agentAttachmentPromptLine(FILE))).toBe(false);
    expect(isAttachedImagePromptLine(agentAttachmentPromptLine(REFERENCE))).toBe(false);
  });

  it("rejects prose that only resembles the line", () => {
    expect(isAttachedImagePromptLine('[Attached image "" is saved at: /x.png]')).toBe(false);
    expect(isAttachedImagePromptLine('[Attached image "a" is saved at: x.png]')).toBe(false);
    expect(isAttachedImagePromptLine('[Attached image "a" is saved at: /x.png')).toBe(false);
    expect(isAttachedImagePromptLine('[Attached image "a"b" is saved at: /x.png]')).toBe(false);
    expect(isAttachedImagePromptLine(' [Attached image "a" is saved at: /x.png]')).toBe(false);
    expect(isAttachedImagePromptLine('[Attached image "a" is at: /x.png]')).toBe(false);
  });
});

describe("agentPromptDisplayText", () => {
  it("hides the image store line and keeps file and reference lines", () => {
    const prompt = agentEffectivePrompt("napis ahoj", [IMAGE, FILE, REFERENCE]);

    expect(agentPromptDisplayText(prompt)).toBe(
      [
        "napis ahoj",
        "",
        agentAttachmentPromptLine(FILE),
        agentAttachmentPromptLine(REFERENCE),
      ].join("\n"),
    );
  });

  it("drops the blank separator when only image lines followed the text", () => {
    expect(agentPromptDisplayText(agentEffectivePrompt("napis ahoj", [IMAGE, IMAGE]))).toBe(
      "napis ahoj",
    );
  });

  it("yields an empty display for a prompt that was only an image", () => {
    expect(agentPromptDisplayText(agentEffectivePrompt("", [IMAGE]))).toBe("");
  });

  it("returns the same string when nothing is hidden", () => {
    const prompt = agentEffectivePrompt("read this", [FILE, REFERENCE]);

    expect(agentPromptDisplayText(prompt)).toBe(prompt);
    expect(agentPromptDisplayText("plain\n\n")).toBe("plain\n\n");
  });

  it("hides an image line wherever it sits without touching neighbouring lines", () => {
    const prompt = ["first", agentAttachmentPromptLine(IMAGE), "last"].join("\n");

    expect(agentPromptDisplayText(prompt)).toBe("first\nlast");
  });
});
