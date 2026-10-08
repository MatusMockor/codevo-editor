import { describe, expect, it } from "vitest";
import {
  AGENT_IMAGE_MAX_MODEL_BYTES,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_TURN_ATTACHMENTS,
  MAX_AGENT_TURN_IMAGE_BYTES,
  MAX_AGENT_TURN_SEND_IMAGE_BYTES,
  type AgentAttachment,
} from "./agentAttachment";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_FILE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
  AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL,
  FALLBACK_AGENT_ATTACHMENT_NAME,
  MAX_AGENT_ATTACHMENT_INTAKE_FAILURE_MESSAGES,
  MAX_AGENT_IMAGE_SOURCE_BYTES,
  admitAgentAttachmentToTurn,
  agentAttachmentIntakeFailureSummary,
  agentAttachmentPromptLine,
  agentEffectivePrompt,
  agentEffectivePromptByteLength,
  agentEffectivePromptWithinCap,
  agentPasteClaim,
  classifyAgentAttachmentCandidate,
  isAttachableAgentReferencePath,
  planAgentAttachmentIntake,
  sanitizeAgentAttachmentName,
  type AgentAttachmentCandidate,
} from "./agentAttachmentIntake";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "./agentTask";

function candidate(overrides: Partial<AgentAttachmentCandidate> = {}): AgentAttachmentCandidate {
  return { name: "shot.png", mime: "image/png", hasPath: false, bytes: 1_024, ...overrides };
}
import { agentDirectoryReferenceEntries, agentReferencesAreFiles } from "./agentReferenceEntry";

const IMAGE: AgentAttachment = {
  kind: "image",
  attachmentId: "0123456789abcdef0123456789abcdef",
  name: "shot.png",
  mime: "image/png",
  bytes: 2_048,
  width: 800,
  height: 600,
  storedPath: "/data/agent-attachments/threads/agt-1-0a1b/0123456789abcdef0123456789abcdef.png",
};

const FILE: AgentAttachment = {
  kind: "file",
  attachmentId: "fedcba9876543210fedcba9876543210",
  name: "notes.txt",
  bytes: 32,
  storedPath: "/data/agent-attachments/threads/agt-1-0a1b/fedcba9876543210fedcba9876543210.txt",
};

const REFERENCE: AgentAttachment = {
  kind: "reference",
  name: "clip.mp4",
  path: "/Users/dev/clip.mp4",
  bytes: 4_096,
};

describe("classifyAgentAttachmentCandidate", () => {
  it.each([
    ["declared heic", { name: "a.bin", mime: "image/heic" }, "image/heic"],
    ["declared heif", { name: "a.bin", mime: "image/heif" }, "image/heif"],
    ["empty mime with .heic", { name: "photo.HEIC", mime: "" }, "image/heic"],
    [
      "octet-stream with .heif",
      { name: "photo.heif", mime: "application/octet-stream" },
      "image/heif",
    ],
    ["empty mime with .png", { name: "shot.PNG", mime: "" }, "image/png"],
    ["empty mime with .jpg", { name: "shot.jpg", mime: "" }, "image/jpeg"],
    ["empty mime with .jpeg", { name: "shot.jpeg", mime: "" }, "image/jpeg"],
    ["empty mime with .gif", { name: "shot.gif", mime: "" }, "image/gif"],
    [
      "octet-stream with .webp",
      { name: "shot.webp", mime: "application/octet-stream" },
      "image/webp",
    ],
    ["supported declared mime", { name: "shot.bin", mime: "image/webp" }, "image/webp"],
    ["mime with parameters", { name: "shot.bin", mime: "image/PNG; charset=binary" }, "image/png"],
  ] as const)("classifies %s as an image", (_label, overrides, mime) => {
    expect(classifyAgentAttachmentCandidate(candidate(overrides))).toEqual({ kind: "image", mime });
  });

  it.each([
    ["svg", { name: "logo.svg", mime: "image/svg+xml" }],
    ["bmp", { name: "logo.bmp", mime: "image/bmp" }],
    ["tiff", { name: "scan.tiff", mime: "image/tiff" }],
    ["video", { name: "clip.mp4", mime: "video/mp4" }],
    ["archive", { name: "bundle.zip", mime: "application/zip" }],
    ["text", { name: "notes.txt", mime: "text/plain" }],
    ["extensionless unknown mime", { name: "Makefile", mime: "" }],
    ["png extension with a declared text mime", { name: "shot.png", mime: "text/plain" }],
  ] as const)("classifies %s as a path", (_label, overrides) => {
    expect(classifyAgentAttachmentCandidate(candidate(overrides))).toEqual({ kind: "path" });
  });
});

describe("planAgentAttachmentIntake", () => {
  it("stages a pasted image and a path-backed image alike", () => {
    expect(planAgentAttachmentIntake(candidate({ hasPath: false }))).toEqual({
      kind: "image",
      sourceMime: "image/png",
      hasPath: false,
    });
    expect(planAgentAttachmentIntake(candidate({ hasPath: true }))).toEqual({
      kind: "image",
      sourceMime: "image/png",
      hasPath: true,
    });
  });

  it("turns a path-backed unattachable type into a reference and a pasted one into a file", () => {
    const unsupported = { name: "clip.mp4", mime: "video/mp4" };
    expect(planAgentAttachmentIntake(candidate({ ...unsupported, hasPath: true }))).toEqual({
      kind: "reference",
      notice: null,
    });
    expect(planAgentAttachmentIntake(candidate({ ...unsupported, hasPath: false }))).toEqual({
      kind: "file",
    });
  });

  it("refuses a pasted file over the generic cap", () => {
    expect(
      planAgentAttachmentIntake(
        candidate({ name: "dump.bin", mime: "", bytes: MAX_AGENT_FILE_BYTES + 1 }),
      ),
    ).toEqual({ kind: "refused", reason: AGENT_ATTACHMENT_FILE_BYTES_REFUSAL });
  });

  it("keeps a path-backed image over the decode guard as a reference with a notice", () => {
    expect(
      planAgentAttachmentIntake(
        candidate({ hasPath: true, bytes: MAX_AGENT_IMAGE_SOURCE_BYTES + 1 }),
      ),
    ).toEqual({ kind: "reference", notice: AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE });
  });

  it("refuses a pasted image over the decode guard", () => {
    expect(
      planAgentAttachmentIntake(
        candidate({ hasPath: false, bytes: MAX_AGENT_IMAGE_SOURCE_BYTES + 1 }),
      ),
    ).toEqual({ kind: "refused", reason: AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL });
  });

  it("accepts a path-backed image exactly at the decode guard", () => {
    expect(
      planAgentAttachmentIntake(candidate({ hasPath: true, bytes: MAX_AGENT_IMAGE_SOURCE_BYTES })),
    ).toEqual({ kind: "image", sourceMime: "image/png", hasPath: true });
  });
});

describe("agentPasteClaim", () => {
  it("claims when any file is an image even with plain text present", () => {
    expect(
      agentPasteClaim([candidate(), candidate({ name: "a.txt", mime: "text/plain" })], 12),
    ).toBe("claim");
  });

  it("passes text through when no file is an image and text is present", () => {
    expect(agentPasteClaim([candidate({ name: "a.txt", mime: "text/plain" })], 12)).toBe(
      "pass-through",
    );
  });

  it("claims non-image files when there is no plain text", () => {
    expect(agentPasteClaim([candidate({ name: "a.txt", mime: "text/plain" })], 0)).toBe("claim");
  });

  it("passes through an empty paste", () => {
    expect(agentPasteClaim([], 0)).toBe("pass-through");
  });
});

describe("admitAgentAttachmentToTurn", () => {
  it("refuses the ninth attachment", () => {
    const existing = Array.from({ length: MAX_AGENT_TURN_ATTACHMENTS }, () => REFERENCE);
    expect(admitAgentAttachmentToTurn(existing, REFERENCE)).toEqual({
      kind: "refused",
      reason: AGENT_ATTACHMENT_COUNT_REFUSAL,
    });
    expect(admitAgentAttachmentToTurn(existing.slice(1), REFERENCE)).toEqual({ kind: "accepted" });
  });

  it("refuses an image over the model byte cap", () => {
    expect(
      admitAgentAttachmentToTurn([], { kind: "image", bytes: MAX_AGENT_IMAGE_BYTES + 1 }),
    ).toEqual({ kind: "refused", reason: AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL });
    expect(
      admitAgentAttachmentToTurn([], { kind: "image", bytes: AGENT_IMAGE_MAX_MODEL_BYTES + 1 }),
    ).toEqual({ kind: "refused", reason: AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL });
    expect(
      admitAgentAttachmentToTurn([], { kind: "image", bytes: AGENT_IMAGE_MAX_MODEL_BYTES }),
    ).toEqual({ kind: "accepted" });
    expect(AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL).toBe("Image cannot be shrunk to 3.75 MB.");
  });

  it("refuses an image that pushes the turn over the send image budget", () => {
    const existing = Array.from({ length: 5 }, () => ({
      kind: "image" as const,
      bytes: AGENT_IMAGE_MAX_MODEL_BYTES,
    }));
    expect(
      admitAgentAttachmentToTurn(existing, { kind: "image", bytes: AGENT_IMAGE_MAX_MODEL_BYTES }),
    ).toEqual({ kind: "refused", reason: AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL });
    expect(admitAgentAttachmentToTurn(existing, { kind: "image", bytes: 1 })).toEqual({
      kind: "accepted",
    });
    expect(MAX_AGENT_TURN_SEND_IMAGE_BYTES).toBe(20 * 1_024 * 1_024);
    expect(MAX_AGENT_TURN_IMAGE_BYTES).toBe(40 * 1_024 * 1_024);
    expect(AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL).toBe("Images in this message exceed 20 MiB.");
  });

  it("ignores non-image bytes in the aggregate image cap", () => {
    const existing = [
      { kind: "file" as const, bytes: MAX_AGENT_FILE_BYTES },
      { kind: "reference" as const, bytes: MAX_AGENT_FILE_BYTES },
    ];
    expect(
      admitAgentAttachmentToTurn(existing, { kind: "image", bytes: AGENT_IMAGE_MAX_MODEL_BYTES }),
    ).toEqual({ kind: "accepted" });
  });
});

describe("sanitizeAgentAttachmentName", () => {
  it("replaces quotes, strips control characters and keeps the last path segment", () => {
    expect(sanitizeAgentAttachmentName('/Users/dev/a"b\u0007c.png')).toBe("a'bc.png");
    expect(sanitizeAgentAttachmentName("C:\\dev\\shot.png")).toBe("shot.png");
  });

  it("truncates to 255 bytes on a character boundary", () => {
    const name = `${"\u00e9".repeat(200)}.png`;
    const sanitized = sanitizeAgentAttachmentName(name);
    const bytes = new TextEncoder().encode(sanitized).byteLength;

    expect(bytes).toBeLessThanOrEqual(255);
    expect(bytes).toBeGreaterThan(253);
    expect([...sanitized].every((character) => character === "\u00e9")).toBe(true);
  });

  it("falls back to a definite name when nothing survives", () => {
    expect(sanitizeAgentAttachmentName("   \u0000\u0001   ")).toBe(FALLBACK_AGENT_ATTACHMENT_NAME);
  });
});

describe("agentAttachmentPromptLine", () => {
  it("writes the exact line for every kind", () => {
    expect(agentAttachmentPromptLine(IMAGE, agentReferencesAreFiles)).toBe(
      `[Attached image "shot.png" is saved at: ${IMAGE.storedPath}]`,
    );
    expect(agentAttachmentPromptLine(FILE, agentReferencesAreFiles)).toBe(
      `[Attached file "notes.txt" is saved at: ${FILE.storedPath}]`,
    );
    expect(agentAttachmentPromptLine(REFERENCE, agentReferencesAreFiles)).toBe(
      '[Attached file "clip.mp4" is at: /Users/dev/clip.mp4]',
    );
  });

  it("rejects an unsupported kind", () => {
    expect(() =>
      agentAttachmentPromptLine(
        { kind: "video" } as unknown as AgentAttachment,
        agentReferencesAreFiles,
      ),
    ).toThrow(TypeError);
  });
});

describe("agentEffectivePrompt", () => {
  it("joins the text and the lines with a blank line", () => {
    expect(agentEffectivePrompt("look", [IMAGE, REFERENCE], agentReferencesAreFiles)).toBe(
      `look\n\n${agentAttachmentPromptLine(IMAGE, agentReferencesAreFiles)}\n${agentAttachmentPromptLine(REFERENCE, agentReferencesAreFiles)}`,
    );
  });

  it("allows an attachment-only turn", () => {
    expect(agentEffectivePrompt("", [IMAGE], agentReferencesAreFiles)).toBe(
      agentAttachmentPromptLine(IMAGE, agentReferencesAreFiles),
    );
  });

  it("returns the text unchanged with no attachments", () => {
    expect(agentEffectivePrompt("look", [], agentReferencesAreFiles)).toBe("look");
  });

  it("counts the effective prompt against the spawner cap", () => {
    const text = "x".repeat(MAX_AGENT_TASK_PROMPT_BYTES - 1);

    expect(agentEffectivePromptWithinCap(text, [], agentReferencesAreFiles)).toBe(true);
    expect(agentEffectivePromptWithinCap(text, [IMAGE], agentReferencesAreFiles)).toBe(false);
    expect(agentEffectivePromptByteLength("", [IMAGE], agentReferencesAreFiles)).toBe(
      new TextEncoder().encode(agentAttachmentPromptLine(IMAGE, agentReferencesAreFiles))
        .byteLength,
    );
  });
});

describe("folder references in the effective prompt", () => {
  const FOLDER: AgentAttachment = {
    kind: "reference",
    name: "invoices",
    path: "/Users/x/Documents/codevo s.r.o./invoices",
    bytes: 0,
  };
  const FOLDER_LINE =
    '[Attached folder "invoices" is at: /Users/x/Documents/codevo s.r.o./invoices]';
  const FILE_LINE = '[Attached file "invoices" is at: /Users/x/Documents/codevo s.r.o./invoices]';
  const asFolder = agentDirectoryReferenceEntries([{ name: "invoices", path: FOLDER.path }]);

  it("calls an inspected directory a folder and any other reference a file", () => {
    expect(agentAttachmentPromptLine(FOLDER, asFolder)).toBe(FOLDER_LINE);
    expect(agentAttachmentPromptLine(FOLDER, agentReferencesAreFiles)).toBe(FILE_LINE);
    expect(agentAttachmentPromptLine(REFERENCE, asFolder)).toBe(
      '[Attached file "clip.mp4" is at: /Users/dev/clip.mp4]',
    );
    expect(agentEffectivePrompt("summarise", [FOLDER, REFERENCE], asFolder)).toBe(
      `summarise\n\n${FOLDER_LINE}\n[Attached file "clip.mp4" is at: /Users/dev/clip.mp4]`,
    );
  });

  it("never lets the entry change the wording of a stored image or file", () => {
    const everythingIsAFolder = () => "directory" as const;

    expect(agentAttachmentPromptLine(IMAGE, everythingIsAFolder)).toBe(
      agentAttachmentPromptLine(IMAGE, agentReferencesAreFiles),
    );
    expect(agentAttachmentPromptLine(FILE, everythingIsAFolder)).toBe(
      agentAttachmentPromptLine(FILE, agentReferencesAreFiles),
    );
  });

  it("accounts the folder wording byte for byte against the cap", () => {
    const encoded = (value: string) => new TextEncoder().encode(value).byteLength;

    expect(agentEffectivePromptByteLength("", [FOLDER], asFolder)).toBe(encoded(FOLDER_LINE));
    expect(agentEffectivePromptByteLength("", [FOLDER], asFolder)).toBe(
      agentEffectivePromptByteLength("", [FOLDER], agentReferencesAreFiles) + 2,
    );

    const text = "x".repeat(MAX_AGENT_TASK_PROMPT_BYTES - encoded(`\n\n${FILE_LINE}`));

    expect(agentEffectivePromptWithinCap(text, [FOLDER], agentReferencesAreFiles)).toBe(true);
    expect(agentEffectivePromptWithinCap(text, [FOLDER], asFolder)).toBe(false);
    expect(agentEffectivePromptWithinCap(text.slice(2), [FOLDER], asFolder)).toBe(true);
  });
});

describe("agentAttachmentIntakeFailureSummary", () => {
  it("has nothing to report without a failure", () => {
    expect(agentAttachmentIntakeFailureSummary([])).toBeNull();
  });

  it("joins distinct failures in the order they happened", () => {
    expect(agentAttachmentIntakeFailureSummary(["Folder.", "Unreadable.", "Folder."])).toBe(
      "Folder. Unreadable.",
    );
  });

  it("keeps only the first distinct failures up to its bound", () => {
    const failures = ["One.", "Two.", "One.", "Three.", "Four.", "Five."];

    expect(MAX_AGENT_ATTACHMENT_INTAKE_FAILURE_MESSAGES).toBe(3);
    expect(agentAttachmentIntakeFailureSummary(failures)).toBe("One. Two. Three.");
  });
});

describe("isAttachableAgentReferencePath", () => {
  it("accepts bounded absolute paths only", () => {
    expect(isAttachableAgentReferencePath("/Users/dev/clip.mp4")).toBe(true);
    expect(isAttachableAgentReferencePath("relative/clip.mp4")).toBe(false);
    expect(isAttachableAgentReferencePath("/Users/dev/\u0000clip.mp4")).toBe(false);
    expect(isAttachableAgentReferencePath(`/${"a".repeat(4_096)}`)).toBe(false);
  });
});
