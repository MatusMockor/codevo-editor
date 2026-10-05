import { describe, expect, it } from "vitest";
import { MAX_AGENT_ATTACHMENT_PATH_BYTES } from "./agentAttachment";
import { agentAttachmentPathCandidates } from "./agentAttachmentPath";

describe("agentAttachmentPathCandidates", () => {
  it("keeps the reported escaped path first and adds its single-argument spelling", () => {
    const raw = "/Users/matusmockor/Documents/codevo\\ s.r.o./výdavky/September";
    expect(agentAttachmentPathCandidates(raw)).toEqual([
      raw,
      "/Users/matusmockor/Documents/codevo s.r.o./výdavky/September",
    ]);
  });

  it.each([
    "/Users/dev/codevo s.r.o./September/",
    "/Users/dev/a\\q.txt",
    "/Users/dev/it's.txt",
    "/Users/dev/$HOME.txt",
    "/Users/dev/$(whoami).txt",
    "/Users/dev/`whoami`.txt",
    "/Users/dev/*.txt",
    "/Users/dev/one /Users/dev/two",
    "/Users/dev/literal\\",
  ])("preserves a literal absolute spelling without guessing: %s", (raw) => {
    expect(agentAttachmentPathCandidates(raw)).toEqual([raw]);
  });

  it.each([
    ["'/Users/dev/codevo s.r.o./September/'", "/Users/dev/codevo s.r.o./September/"],
    ['"/Users/dev/codevo s.r.o./výdavky"', "/Users/dev/codevo s.r.o./výdavky"],
    [" '/Users/dev/path' ", "/Users/dev/path"],
    ["'/Users/dev/$HOME/$(whoami)'", "/Users/dev/$HOME/$(whoami)"],
    ['"/Users/dev/a\\\\b"', "/Users/dev/a\\b"],
    ['"/Users/dev/\\$HOME"', "/Users/dev/$HOME"],
    ["'/Users/dev/it'\\''s.txt'", "/Users/dev/it's.txt"],
  ])("decodes one quoted shell argument: %s", (raw, path) => {
    expect(agentAttachmentPathCandidates(raw)).toEqual([path]);
  });

  it("does not replace a literal backslash or whitespace when producing a fallback", () => {
    const raw = "/Users/dev/a\\\\b\\ c";
    expect(agentAttachmentPathCandidates(raw)).toEqual([raw, "/Users/dev/a\\b c"]);
    expect(agentAttachmentPathCandidates("/Users/dev/a ")).toEqual([
      "/Users/dev/a ",
      "/Users/dev/a",
    ]);
  });

  it("keeps Unicode spaces as filename characters instead of shell separators", () => {
    const raw = "/Users/dev/a\u00a0b\\ c\u00a0";
    expect(agentAttachmentPathCandidates(raw)).toEqual([raw, "/Users/dev/a\u00a0b c\u00a0"]);
  });

  it("decodes an escaped final space before ignoring outer shell separators", () => {
    expect(agentAttachmentPathCandidates("/Users/dev/a\\ ")).toEqual([
      "/Users/dev/a\\ ",
      "/Users/dev/a ",
    ]);
    expect(agentAttachmentPathCandidates("/Users/dev/a\\  ")).toEqual([
      "/Users/dev/a\\  ",
      "/Users/dev/a ",
    ]);
  });

  it.each([
    "relative/file.txt",
    "~/file.txt",
    "$HOME/file.txt",
    '"/Users/dev/$HOME"',
    '"/Users/dev/`whoami`"',
    "'/Users/dev/one' '/Users/dev/two'",
    "'/Users/dev/one';echo x",
    "'/Users/dev/one'|cat",
    "'/Users/dev/unclosed",
    '"/Users/dev/a\\q"',
    "",
  ])("rejects nonabsolute or unsupported shell input: %s", (raw) => {
    expect(agentAttachmentPathCandidates(raw)).toEqual([]);
  });

  it.each(["\0", "\n", "\r", "\t", "\u007f", "\u0085", "\ud800", "\udc00"])(
    "rejects control characters and malformed Unicode: %j",
    (unsafe) => {
      expect(agentAttachmentPathCandidates(`/Users/dev/${unsafe}file`)).toEqual([]);
    },
  );

  it("enforces the UTF-8 input cap before decoding without truncating", () => {
    const asciiBoundary = `/${"a".repeat(MAX_AGENT_ATTACHMENT_PATH_BYTES - 1)}`;
    const utf8Boundary = `/a${"é".repeat((MAX_AGENT_ATTACHMENT_PATH_BYTES - 2) / 2)}`;
    expect(agentAttachmentPathCandidates(asciiBoundary)).toEqual([asciiBoundary]);
    expect(agentAttachmentPathCandidates(utf8Boundary)).toEqual([utf8Boundary]);
    expect(agentAttachmentPathCandidates(`${asciiBoundary}a`)).toEqual([]);
    expect(agentAttachmentPathCandidates(`${utf8Boundary}é`)).toEqual([]);
    expect(agentAttachmentPathCandidates(`'${asciiBoundary}'`)).toEqual([]);
  });
});
