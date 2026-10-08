import { describe, expect, it } from "vitest";
import {
  agentDirectoryReferenceEntries,
  agentReferenceEntriesInPrompt,
  agentReferenceEntryOf,
  agentReferencePromptLine,
  agentReferencesAreFiles,
  anyAgentReferenceDirectory,
  type AgentReferenceEntry,
  type AgentReferenceIdentity,
} from "./agentReferenceEntry";

const INVOICES: AgentReferenceIdentity = {
  name: "invoices",
  path: "/Users/x/Documents/codevo s.r.o./invoices",
};

const NOTES: AgentReferenceIdentity = { name: "notes.md", path: "/work/notes.md" };

const INVOICES_FOLDER_LINE =
  '[Attached folder "invoices" is at: /Users/x/Documents/codevo s.r.o./invoices]';

const INVOICES_FILE_LINE =
  '[Attached file "invoices" is at: /Users/x/Documents/codevo s.r.o./invoices]';

describe("agentReferenceEntryOf", () => {
  it("reads the entry from inspected metadata only", () => {
    expect(agentReferenceEntryOf({ isDirectory: true })).toBe("directory");
    expect(agentReferenceEntryOf({ isDirectory: false })).toBe("file");
  });
});

describe("agentReferencePromptLine", () => {
  it("calls a directory a folder and keeps the shipped wording for a file", () => {
    expect(agentReferencePromptLine(INVOICES, "directory")).toBe(INVOICES_FOLDER_LINE);
    expect(agentReferencePromptLine(INVOICES, "file")).toBe(
      '[Attached file "invoices" is at: /Users/x/Documents/codevo s.r.o./invoices]',
    );
  });

  it("rejects an entry outside the closed set", () => {
    expect(() =>
      agentReferencePromptLine(INVOICES, "symlink" as unknown as AgentReferenceEntry),
    ).toThrow(TypeError);
  });
});

describe("agentReferenceEntriesInPrompt", () => {
  it("resolves a directory from its exact folder line next to the reference", () => {
    const entryOf = agentReferenceEntriesInPrompt(
      `summarise\n\n${INVOICES_FOLDER_LINE}\n[Attached file "notes.md" is at: /work/notes.md]`,
    );

    expect(entryOf(INVOICES)).toBe("directory");
    expect(entryOf(NOTES)).toBe("file");
  });

  it.each([
    ["an empty prompt", ""],
    ["a prompt written by a shipped build", '[Attached file "invoices" is at: /x/invoices]'],
    ["a folder line with another name", INVOICES_FOLDER_LINE.replace('"invoices"', '"other"')],
    ["a folder line with a longer path", INVOICES_FOLDER_LINE.replace("]", "/2024]")],
    ["a folder line with a shorter path", INVOICES_FOLDER_LINE.replace("/invoices]", "]")],
    ["a folder line inside a longer line", `> ${INVOICES_FOLDER_LINE}`],
    ["a folder line with trailing text", `${INVOICES_FOLDER_LINE} `],
    ["a folder line without its closing bracket", INVOICES_FOLDER_LINE.slice(0, -1)],
    ["a folder line in another case", INVOICES_FOLDER_LINE.toUpperCase()],
  ])("fails closed to a file for %s", (_label, prompt) => {
    expect(agentReferenceEntriesInPrompt(prompt)(INVOICES)).toBe("file");
  });

  it.each([
    ["the file line first", [INVOICES_FILE_LINE, INVOICES_FOLDER_LINE]],
    ["the folder line first", [INVOICES_FOLDER_LINE, INVOICES_FILE_LINE]],
    ["the folder line repeated", [INVOICES_FOLDER_LINE, INVOICES_FILE_LINE, INVOICES_FOLDER_LINE]],
  ])("fails closed to a file when both exact lines name it with %s", (_label, lines) => {
    const entryOf = agentReferenceEntriesInPrompt(`summarise\n\n${lines.join("\n")}`);

    expect(entryOf(INVOICES)).toBe("file");
  });

  it("keeps a folder whose file line names another reference", () => {
    const entryOf = agentReferenceEntriesInPrompt(
      [
        INVOICES_FOLDER_LINE,
        INVOICES_FILE_LINE.replace('"invoices"', '"other"'),
        INVOICES_FILE_LINE.replace("/invoices]", "/invoices.zip]"),
        `> ${INVOICES_FILE_LINE}`,
      ].join("\n"),
    );

    expect(entryOf(INVOICES)).toBe("directory");
  });

  it("matches a path with spaces, dots, and non-ASCII characters exactly", () => {
    const reference = {
      name: "faktúry 2024",
      path: "/Users/x/Dokumenty/codevo s.r.o./faktúry 2024",
    };
    const entryOf = agentReferenceEntriesInPrompt(agentReferencePromptLine(reference, "directory"));

    expect(entryOf(reference)).toBe("directory");
    expect(entryOf({ ...reference, path: `${reference.path}.bak` })).toBe("file");
  });
});

describe("agentDirectoryReferenceEntries", () => {
  it("resolves exactly the listed directories", () => {
    const entryOf = agentDirectoryReferenceEntries([INVOICES]);

    expect(entryOf(INVOICES)).toBe("directory");
    expect(entryOf({ ...INVOICES, name: "other" })).toBe("file");
    expect(entryOf(NOTES)).toBe("file");
    expect(agentDirectoryReferenceEntries([])).toBe(agentReferencesAreFiles);
  });
});

describe("anyAgentReferenceDirectory", () => {
  it("is a directory when any source says so and a file otherwise", () => {
    const entryOf = anyAgentReferenceDirectory([
      agentReferencesAreFiles,
      agentDirectoryReferenceEntries([INVOICES]),
    ]);

    expect(entryOf(INVOICES)).toBe("directory");
    expect(entryOf(NOTES)).toBe("file");
    expect(anyAgentReferenceDirectory([])(INVOICES)).toBe("file");
  });
});
