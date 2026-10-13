import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "./agentAttachment";
import { agentAttachmentPromptLine } from "./agentAttachmentIntake";
import {
  AGENT_ATTACHMENT_PROMPT_LINE_KINDS,
  parseAgentAttachmentPromptLine,
  type AgentAttachmentPromptLineKind,
} from "./agentAttachmentPromptLine";
import { agentReferencePromptLine, type AgentReferenceEntry } from "./agentReferenceEntry";

const ID = "0123456789abcdef0123456789abcdef";
const STORED = `/data/agent-attachments/threads/t/${ID}.png`;

interface Produced {
  readonly attachment: AgentAttachment;
  readonly entry: AgentReferenceEntry;
  readonly name: string;
  readonly path: string;
}

const PRODUCED: Readonly<Record<AgentAttachmentPromptLineKind, Produced>> = {
  image: {
    attachment: {
      kind: "image",
      attachmentId: ID,
      name: "screen.png",
      mime: "image/png",
      bytes: 10,
      width: 4,
      height: 4,
      storedPath: STORED,
    },
    entry: "file",
    name: "screen.png",
    path: STORED,
  },
  file: {
    attachment: {
      kind: "file",
      attachmentId: ID,
      name: "notes.txt",
      bytes: 10,
      storedPath: "/data/agent-attachments/threads/t/notes.txt",
    },
    entry: "file",
    name: "notes.txt",
    path: "/data/agent-attachments/threads/t/notes.txt",
  },
  reference: {
    attachment: {
      kind: "reference",
      name: "payroll.csv",
      path: "/Users/alice/private/payroll.csv",
      bytes: 10,
    },
    entry: "file",
    name: "payroll.csv",
    path: "/Users/alice/private/payroll.csv",
  },
  folder: {
    attachment: { kind: "reference", name: "src", path: "/Users/alice/project/src", bytes: 0 },
    entry: "directory",
    name: "src",
    path: "/Users/alice/project/src",
  },
};

describe("parseAgentAttachmentPromptLine", () => {
  it("recognizes every line the attachment producer writes", () => {
    for (const kind of AGENT_ATTACHMENT_PROMPT_LINE_KINDS) {
      const produced = PRODUCED[kind];
      const line = agentAttachmentPromptLine(produced.attachment, () => produced.entry);

      expect(parseAgentAttachmentPromptLine(line), line).toEqual({
        kind,
        name: produced.name,
        path: produced.path,
      });
    }
  });

  it("recognizes the reference lines the reference producer writes", () => {
    const reference = { name: "payroll.csv", path: "/Users/alice/private/payroll.csv" };

    expect(parseAgentAttachmentPromptLine(agentReferencePromptLine(reference, "file"))).toEqual({
      kind: "reference",
      ...reference,
    });
    expect(
      parseAgentAttachmentPromptLine(agentReferencePromptLine(reference, "directory")),
    ).toEqual({ kind: "folder", ...reference });
  });

  it("reads the name up to its closing quote even when the path repeats the wording", () => {
    const reference = { name: "a.txt", path: '/tmp/x" is saved at: /y' };
    const line = agentReferencePromptLine(reference, "file");

    expect(parseAgentAttachmentPromptLine(line)).toEqual({ kind: "reference", ...reference });
  });

  it("leaves ordinary text alone", () => {
    for (const line of [
      "",
      "It overlaps.",
      "[Attached file]",
      '[Attached file "" is at: /x]',
      '[Attached file "a.txt" was at: /x]',
      '[Attached file "a.txt" is at: /x',
      'See [Attached file "a.txt" is at: /x]',
    ]) {
      expect(parseAgentAttachmentPromptLine(line), line).toBeNull();
    }
  });
});
