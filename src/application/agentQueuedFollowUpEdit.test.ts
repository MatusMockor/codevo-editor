import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL,
} from "../domain/agentAttachmentIntake";
import {
  AGENT_QUEUED_EDIT_EMPTY_NOTICE,
  admitQueuedEdit,
  editedFollowUpRequest,
  keptQueuedEditAttachments,
  mergeQueuedEditClaim,
  queuedEditAttachments,
  type AgentQueuedEditAttachment,
  type AgentQueuedEditSession,
} from "./agentQueuedFollowUpEdit";
import type { AgentFollowUpRequest, AgentTurnAttachmentIntent } from "./agentThreadPorts";

const IMAGE: AgentAttachment = {
  kind: "image",
  attachmentId: "0123456789abcdef0123456789abcdef",
  name: "shot.png",
  mime: "image/png",
  bytes: 2_048,
  width: 800,
  height: 600,
  storedPath: "/data/threads/agt-1/0123456789abcdef0123456789abcdef.png",
};

const REFERENCE: AgentAttachment = {
  kind: "reference",
  name: "notes.md",
  path: "/work/notes.md",
  bytes: 12,
};

const FOLDER: AgentAttachment = {
  kind: "reference",
  name: "invoices",
  path: "/Users/x/Documents/codevo s.r.o./invoices",
  bytes: 0,
};

const FOLDER_LINE = '[Attached folder "invoices" is at: /Users/x/Documents/codevo s.r.o./invoices]';

const KEPT_IMAGE: AgentQueuedEditAttachment = {
  key: "attachment-0",
  attachment: IMAGE,
  entry: "file",
};

const OWNER = {
  projectRootKey: "/work",
  ownerId: "owner-1",
  generation: 1,
  workspaceId: "owner-1",
} as const;

const ORIGINAL: AgentFollowUpRequest = {
  threadId: "agt-1",
  prompt: "look at this",
  launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
  attachments: [
    {
      kind: "staged",
      attachmentId: IMAGE.kind === "image" ? IMAGE.attachmentId : "",
      name: "shot.png",
      bytes: 2_048,
      mime: "image/png",
      width: 800,
      height: 600,
    },
    { kind: "reference", name: "notes.md", path: "/work/notes.md", bytes: 12, entry: "file" },
  ],
  attachmentOwner: OWNER,
};

function session(): AgentQueuedEditSession {
  return {
    threadId: "agt-1",
    entryId: "deferred-1",
    lease: 1,
    prompt: "look at this",
    attachments: queuedEditAttachments({
      prompt: "look at this",
      attachments: [IMAGE, REFERENCE],
      references: [],
      notice: null,
    }),
  };
}

describe("agentQueuedFollowUpEdit", () => {
  it("keys claimed attachments by position and keeps only the requested ones", () => {
    const edit = session();

    expect(edit.attachments.map((entry) => entry.key)).toEqual(["attachment-0", "attachment-1"]);
    expect(keptQueuedEditAttachments(edit, ["attachment-1", "unknown"])).toEqual([
      { key: "attachment-1", attachment: REFERENCE, entry: "file" },
    ]);
    expect(queuedEditAttachments(undefined)).toEqual([]);
  });

  it("admits trimmed text or attachments and refuses empty, overfull, and oversized edits", () => {
    expect(admitQueuedEdit("  keep going  ", [], [])).toEqual({
      kind: "accepted",
      prompt: "keep going",
    });
    expect(admitQueuedEdit("   ", [KEPT_IMAGE], [])).toEqual({ kind: "accepted", prompt: "" });
    expect(admitQueuedEdit(" ", [], [])).toEqual({
      kind: "refused",
      reason: AGENT_QUEUED_EDIT_EMPTY_NOTICE,
    });
    const staged = (index: number, bytes: number): AgentTurnAttachmentIntent => ({
      kind: "staged",
      attachmentId: index.toString(16).padStart(32, "0"),
      name: `${index}.png`,
      bytes,
      mime: "image/png",
      width: 1,
      height: 1,
    });
    expect(
      admitQueuedEdit(
        "many",
        [KEPT_IMAGE],
        Array.from({ length: 8 }, (_, index) => staged(index, 1)),
      ),
    ).toEqual({ kind: "refused", reason: AGENT_ATTACHMENT_COUNT_REFUSAL });
    expect(
      admitQueuedEdit(
        "heavy",
        [KEPT_IMAGE],
        Array.from({ length: 2 }, (_, index) => staged(index, 10 * 1_024 * 1_024)),
      ),
    ).toEqual({ kind: "refused", reason: AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL });
  });

  it("rebuilds the claimed turn payload from kept and newly claimed attachments", () => {
    const merged = mergeQueuedEditClaim("closer", [KEPT_IMAGE], {
      prompt: "",
      attachments: [REFERENCE],
      references: [{ kind: "reference", name: "notes.md", path: "/work/notes.md" }],
      notice: null,
    });

    expect(merged.attachments).toEqual([IMAGE, REFERENCE]);
    expect(merged.references).toEqual([
      { kind: "staged", attachmentId: "0123456789abcdef0123456789abcdef" },
      { kind: "reference", name: "notes.md", path: "/work/notes.md" },
    ]);
    expect(merged.prompt.startsWith("closer\n\n")).toBe(true);
    expect(merged.notice).toBeNull();
  });

  it("rewrites the queued request with kept intents and drops the owner without attachments", () => {
    expect(
      editedFollowUpRequest(ORIGINAL, "closer", [KEPT_IMAGE], {
        prompt: "closer",
        keptAttachmentKeys: ["attachment-0"],
      }),
    ).toEqual({ ...ORIGINAL, prompt: "closer", attachments: [ORIGINAL.attachments![0]] });
    const textOnly = editedFollowUpRequest(ORIGINAL, "text", [], {
      prompt: "text",
      keptAttachmentKeys: [],
    });
    expect(textOnly).toEqual({ threadId: "agt-1", prompt: "text", launch: ORIGINAL.launch });
  });

  it("restores a queued folder from its prompt line and keeps the folder wording on commit", () => {
    const edit: AgentQueuedEditSession = {
      threadId: "agt-1",
      entryId: "deferred-1",
      lease: 1,
      prompt: "summarise",
      attachments: queuedEditAttachments({
        prompt: `summarise\n\n${FOLDER_LINE}\n[Attached file "notes.md" is at: /work/notes.md]`,
        attachments: [FOLDER, REFERENCE],
        references: [],
        notice: null,
      }),
    };

    expect(edit.attachments.map((entry) => entry.entry)).toEqual(["directory", "file"]);

    const kept = keptQueuedEditAttachments(edit, ["attachment-0", "attachment-1"]);
    const merged = mergeQueuedEditClaim("again", kept, {
      prompt: "",
      attachments: [],
      references: [],
      notice: null,
    });

    expect(merged.prompt).toBe(
      `again\n\n${FOLDER_LINE}\n[Attached file "notes.md" is at: /work/notes.md]`,
    );
    expect(
      editedFollowUpRequest(ORIGINAL, "again", kept, {
        prompt: "again",
        keptAttachmentKeys: ["attachment-0", "attachment-1"],
      }).attachments,
    ).toEqual([
      {
        kind: "reference",
        name: "invoices",
        path: FOLDER.kind === "reference" ? FOLDER.path : "",
        bytes: 0,
        entry: "directory",
      },
      { kind: "reference", name: "notes.md", path: "/work/notes.md", bytes: 12, entry: "file" },
    ]);
  });

  it("keeps the folder wording of a folder added while editing a queued message", () => {
    const merged = mergeQueuedEditClaim("closer", [KEPT_IMAGE], {
      prompt: FOLDER_LINE,
      attachments: [FOLDER],
      references: [
        { kind: "reference", name: "invoices", path: "/Users/x/Documents/codevo s.r.o./invoices" },
      ],
      notice: null,
    });

    expect(merged.prompt).toBe(
      `closer\n\n[Attached image "shot.png" is saved at: ${IMAGE.kind === "image" ? IMAGE.storedPath : ""}]\n${FOLDER_LINE}`,
    );
  });

  it("reads a queued reference without a folder line as a file", () => {
    const attachments = queuedEditAttachments({
      prompt: 'look\n\n[Attached file "invoices" is at: /Users/x/Documents/codevo s.r.o./invoices]',
      attachments: [FOLDER],
      references: [],
      notice: null,
    });

    expect(attachments.map((entry) => entry.entry)).toEqual(["file"]);
  });

  it("keeps the file wording of a queued file whose folder line was typed into the prompt", () => {
    const typedFolderLine = '[Attached folder "notes.md" is at: /work/notes.md]';
    const fileLine = '[Attached file "notes.md" is at: /work/notes.md]';
    const attachments = queuedEditAttachments({
      prompt: `${typedFolderLine}\n\n${fileLine}`,
      attachments: [REFERENCE],
      references: [],
      notice: null,
    });

    expect(attachments.map((entry) => entry.entry)).toEqual(["file"]);

    const merged = mergeQueuedEditClaim(typedFolderLine, attachments, {
      prompt: "",
      attachments: [],
      references: [],
      notice: null,
    });

    expect(merged.prompt).toBe(`${typedFolderLine}\n\n${fileLine}`);
  });
});
