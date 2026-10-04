// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROJECT_DISPLAY_NAME_ENTRIES,
  MAX_PROJECT_DISPLAY_NAME_TOKEN_ATTEMPTS,
  PROJECT_DISPLAY_NAMES_STORAGE_KEY,
  clearProjectDisplayName,
  projectDisplayNameWriteMessage,
  randomProjectDisplayNameToken,
  readProjectDisplayNameEntries,
  readProjectDisplayNames,
  saveProjectDisplayName,
  subscribeProjectDisplayNames,
} from "./projectDisplayNames";

const LOCAL = "/Users/dev/editor";
const SERVER = "remote:linux:runner:codevo-editor";
const BACKUP = "remote:backup:runner:codevo-editor";
const API = "/Users/dev/api";
const TOKEN_A = "aaaaaaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbbbbbbbbbb";
const TOKEN_C = "cccccccccccccccc";
const STORAGE_QUOTA_CHARS = 5_000_000;

function seed(raw: string): void {
  localStorage.setItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY, raw);
  window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_DISPLAY_NAMES_STORAGE_KEY }));
}

function tokens(...sequence: ReadonlyArray<string>): () => string {
  let index = 0;
  return () => {
    const token = sequence[Math.min(index, sequence.length - 1)] ?? "";
    index += 1;
    return token;
  };
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY) ?? "null");
}

beforeEach(() => {
  localStorage.clear();
});

describe("project display name storage", () => {
  it("uses a versioned storage key", () => {
    expect(PROJECT_DISPLAY_NAMES_STORAGE_KEY).toBe("codevo.project-display-names.v1");
  });

  it("round-trips one name and one group token across every checkout and notifies subscribers", () => {
    const notify = vi.fn();
    const unsubscribe = subscribeProjectDisplayNames(notify);

    expect(saveProjectDisplayName([LOCAL, SERVER], "  Codevo  ", tokens(TOKEN_A))).toEqual({
      kind: "saved",
    });

    expect([...readProjectDisplayNames()]).toEqual([
      [LOCAL, "Codevo"],
      [SERVER, "Codevo"],
    ]);
    expect([...readProjectDisplayNameEntries()]).toEqual([
      [LOCAL, { name: "Codevo", token: TOKEN_A }],
      [SERVER, { name: "Codevo", token: TOKEN_A }],
    ]);
    expect(stored()).toEqual([
      [LOCAL, "Codevo", TOKEN_A],
      [SERVER, "Codevo", TOKEN_A],
    ]);
    expect(readProjectDisplayNames()).toBe(readProjectDisplayNames());
    expect(readProjectDisplayNameEntries()).toBe(readProjectDisplayNameEntries());
    expect(notify).toHaveBeenCalledTimes(1);

    unsubscribe();
    saveProjectDisplayName([LOCAL], "Again", tokens(TOKEN_B));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([
      [LOCAL, "Again", TOKEN_A],
      [SERVER, "Again", TOKEN_A],
    ]);
  });

  it("generates a bounded random hex token by default", () => {
    const first = randomProjectDisplayNameToken();
    const second = randomProjectDisplayNameToken();

    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(second).toMatch(/^[0-9a-f]{16}$/);
    expect(first).not.toBe(second);

    expect(saveProjectDisplayName([LOCAL, SERVER], "Codevo")).toEqual({ kind: "saved" });
    const entries = readProjectDisplayNameEntries();
    expect(entries.get(LOCAL)?.token).toMatch(/^[0-9a-f]{16}$/);
    expect(entries.get(SERVER)?.token).toBe(entries.get(LOCAL)?.token);
  });

  it("removes the name of every given checkout and leaves the others", () => {
    saveProjectDisplayName([LOCAL, SERVER], "Codevo", tokens(TOKEN_A));
    saveProjectDisplayName([API], "API", tokens(TOKEN_B));

    expect(clearProjectDisplayName([LOCAL, SERVER])).toEqual({ kind: "saved" });
    expect(stored()).toEqual([[API, "API", TOKEN_B]]);

    expect(clearProjectDisplayName([API])).toEqual({ kind: "saved" });
    expect(readProjectDisplayNames().size).toBe(0);
    expect(localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY)).toBeNull();
  });

  it("keeps an unrelated project with the same name when the displayed one is reset", () => {
    saveProjectDisplayName([API], "Billing API", tokens(TOKEN_A));
    saveProjectDisplayName([SERVER], "Billing API", tokens(TOKEN_B));

    expect(clearProjectDisplayName([API])).toEqual({ kind: "saved" });

    expect(stored()).toEqual([[SERVER, "Billing API", TOKEN_B]]);
  });

  it("keeps a reset durable for a checkout that was offline during the reset", () => {
    saveProjectDisplayName([LOCAL, SERVER], "Flagship", tokens(TOKEN_A));
    saveProjectDisplayName([API], "Flagship", tokens(TOKEN_B));

    expect(clearProjectDisplayName([LOCAL])).toEqual({ kind: "saved" });

    expect(stored()).toEqual([[API, "Flagship", TOKEN_B]]);
  });

  it("renames a checkout that is offline at rename time through its group token", () => {
    saveProjectDisplayName([LOCAL, SERVER], "Flagship", tokens(TOKEN_A));
    saveProjectDisplayName([API], "Flagship", tokens(TOKEN_B));

    expect(saveProjectDisplayName([LOCAL], "Editor", tokens(TOKEN_C))).toEqual({ kind: "saved" });

    expect(stored()).toEqual([
      [LOCAL, "Editor", TOKEN_A],
      [SERVER, "Editor", TOKEN_A],
      [API, "Flagship", TOKEN_B],
    ]);
  });

  it("converges members that carried different tokens on the first member's token", () => {
    saveProjectDisplayName([LOCAL], "Local name", tokens(TOKEN_A));
    saveProjectDisplayName([SERVER, BACKUP], "Server name", tokens(TOKEN_B));
    saveProjectDisplayName([API], "API", tokens(TOKEN_C));

    expect(saveProjectDisplayName([LOCAL, SERVER], "One name", tokens(TOKEN_C))).toEqual({
      kind: "saved",
    });

    expect(stored()).toEqual([
      [LOCAL, "One name", TOKEN_A],
      [SERVER, "One name", TOKEN_A],
      [BACKUP, "One name", TOKEN_A],
      [API, "API", TOKEN_C],
    ]);

    expect(saveProjectDisplayName([SERVER, LOCAL], "Other order", tokens(TOKEN_C))).toEqual({
      kind: "saved",
    });
    expect(clearProjectDisplayName([BACKUP])).toEqual({ kind: "saved" });
    expect(stored()).toEqual([[API, "API", TOKEN_C]]);
  });

  it("never reuses a token that already links another project", () => {
    saveProjectDisplayName([LOCAL], "Editor", tokens(TOKEN_A));

    expect(saveProjectDisplayName([API], "API", tokens(TOKEN_A, TOKEN_A, TOKEN_B))).toEqual({
      kind: "saved",
    });
    expect(stored()).toEqual([
      [LOCAL, "Editor", TOKEN_A],
      [API, "API", TOKEN_B],
    ]);

    const colliding = vi.fn(() => TOKEN_A);
    expect(saveProjectDisplayName([SERVER], "Server", colliding)).toEqual({
      kind: "rejected",
      reason: "tokenUnavailable",
    });
    expect(colliding).toHaveBeenCalledTimes(MAX_PROJECT_DISPLAY_NAME_TOKEN_ATTEMPTS);
    expect(MAX_PROJECT_DISPLAY_NAME_TOKEN_ATTEMPTS).toBe(8);
    expect(readProjectDisplayNames().has(SERVER)).toBe(false);
  });

  it.each(["", "not-a-token", "AAAAAAAAAAAAAAAA", "aaaaaaaaaaaaaaaaa"])(
    "refuses to store the malformed generated token %j",
    (token) => {
      const malformed = vi.fn(() => token);

      expect(saveProjectDisplayName([LOCAL], "Editor", malformed)).toEqual({
        kind: "rejected",
        reason: "tokenUnavailable",
      });
      expect(malformed).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY)).toBeNull();
    },
  );

  it("reports a failing random source as a failed link, not as a storage failure", () => {
    const calls: number[] = [];
    const failing = (): string => {
      calls.push(calls.length);
      return globalThis.crypto.getRandomValues(new Uint8Array(65_537)).join("");
    };

    expect(saveProjectDisplayName([LOCAL], "Editor", failing)).toEqual({
      kind: "rejected",
      reason: "tokenUnavailable",
    });
    expect(calls).toEqual([0]);
    expect(localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY)).toBeNull();
  });

  it("leaves the other half alone when one half of a split group is renamed", () => {
    saveProjectDisplayName([LOCAL, SERVER], "Flagship", tokens(TOKEN_A));

    expect(saveProjectDisplayName([SERVER], "Fork", tokens(TOKEN_B), [LOCAL, API])).toEqual({
      kind: "saved",
    });

    expect(stored()).toEqual([
      [LOCAL, "Flagship", TOKEN_A],
      [SERVER, "Fork", TOKEN_B],
    ]);

    expect(saveProjectDisplayName([LOCAL], "Main", tokens(TOKEN_C), [SERVER, API])).toEqual({
      kind: "saved",
    });
    expect(stored()).toEqual([
      [LOCAL, "Main", TOKEN_A],
      [SERVER, "Fork", TOKEN_B],
    ]);
  });

  it("leaves the other half alone when one half of a split group is reset", () => {
    saveProjectDisplayName([LOCAL, SERVER], "Flagship", tokens(TOKEN_A));

    expect(clearProjectDisplayName([LOCAL], [SERVER, API])).toEqual({ kind: "saved" });

    expect(stored()).toEqual([[SERVER, "Flagship", TOKEN_A]]);
  });

  it("frees a project that a transient merge linked to another group", () => {
    saveProjectDisplayName([LOCAL, SERVER], "Flagship", tokens(TOKEN_A));
    saveProjectDisplayName([LOCAL, SERVER, API], "Merged", tokens(TOKEN_B));
    expect(stored()).toEqual([
      [LOCAL, "Merged", TOKEN_A],
      [SERVER, "Merged", TOKEN_A],
      [API, "Merged", TOKEN_A],
    ]);

    expect(saveProjectDisplayName([API], "API", tokens(TOKEN_B), [LOCAL, SERVER])).toEqual({
      kind: "saved",
    });
    expect(saveProjectDisplayName([LOCAL, SERVER], "Flagship", tokens(TOKEN_C), [API])).toEqual({
      kind: "saved",
    });
    expect(stored()).toEqual([
      [LOCAL, "Flagship", TOKEN_A],
      [SERVER, "Flagship", TOKEN_A],
      [API, "API", TOKEN_B],
    ]);

    expect(clearProjectDisplayName([LOCAL, SERVER], [API])).toEqual({ kind: "saved" });
    expect(stored()).toEqual([[API, "API", TOKEN_B]]);
  });

  it("mints one new token for every acted member and takes offline checkouts along when severing", () => {
    saveProjectDisplayName([LOCAL, SERVER, BACKUP, API], "Flagship", tokens(TOKEN_A));
    const minted = vi.fn(tokens(TOKEN_B, TOKEN_C));

    expect(saveProjectDisplayName([LOCAL, SERVER], "Fork", minted, [API])).toEqual({
      kind: "saved",
    });

    expect(minted).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([
      [LOCAL, "Fork", TOKEN_B],
      [SERVER, "Fork", TOKEN_B],
      [BACKUP, "Fork", TOKEN_B],
      [API, "Flagship", TOKEN_A],
    ]);
  });

  it("still renames and resets an offline checkout with its group when nothing is displayed elsewhere", () => {
    saveProjectDisplayName([LOCAL, SERVER], "Flagship", tokens(TOKEN_A));
    saveProjectDisplayName([API], "API", tokens(TOKEN_B));

    expect(saveProjectDisplayName([LOCAL], "Editor", tokens(TOKEN_C), [API])).toEqual({
      kind: "saved",
    });
    expect(stored()).toEqual([
      [LOCAL, "Editor", TOKEN_A],
      [SERVER, "Editor", TOKEN_A],
      [API, "API", TOKEN_B],
    ]);

    expect(clearProjectDisplayName([LOCAL], [API])).toEqual({ kind: "saved" });
    expect(stored()).toEqual([[API, "API", TOKEN_B]]);
  });

  it("bounds the displayed project list it accepts", () => {
    const tooMany = Array.from({ length: 4097 }, (_, index) => `/shown/${index}`);

    expect(saveProjectDisplayName([LOCAL], "Editor", tokens(TOKEN_A), tooMany)).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
    expect(clearProjectDisplayName([LOCAL], tooMany)).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
  });

  it("picks up a change written by another window", () => {
    saveProjectDisplayName([LOCAL], "Mine", tokens(TOKEN_A));
    const notify = vi.fn();
    const unsubscribe = subscribeProjectDisplayNames(notify);

    seed(JSON.stringify([[LOCAL, "Theirs", TOKEN_B]]));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(readProjectDisplayNames().get(LOCAL)).toBe("Theirs");
    expect(readProjectDisplayNameEntries().get(LOCAL)?.token).toBe(TOKEN_B);
    unsubscribe();
  });

  it.each([
    "{bad",
    "null",
    "42",
    JSON.stringify({ [LOCAL]: "Codevo" }),
    JSON.stringify("Codevo"),
    JSON.stringify(
      Array.from({ length: MAX_PROJECT_DISPLAY_NAME_ENTRIES + 1 }, (_, index) => [
        `/p/${index}`,
        "Name",
        TOKEN_A,
      ]),
    ),
    `[${" ".repeat(2_000_001)}]`,
  ])("fails closed for corrupt or oversized storage", (raw) => {
    seed(raw);
    expect(readProjectDisplayNames().size).toBe(0);
    expect(readProjectDisplayNameEntries().size).toBe(0);
  });

  it("drops unknown and invalid entries and keeps the valid ones", () => {
    seed(
      JSON.stringify([
        [LOCAL, "Codevo", TOKEN_A],
        [LOCAL, "Duplicate", TOKEN_A],
        ["", "Empty key", TOKEN_A],
        ["/with\nbreak", "Bad key", TOKEN_A],
        ["/too-long-name", "a".repeat(65), TOKEN_A],
        ["/untrimmed", " padded ", TOKEN_A],
        ["/control", "a\u0007b", TOKEN_A],
        ["/blank", "", TOKEN_A],
        ["/not-a-string", 7, TOKEN_A],
        ["/extra", "Name", TOKEN_A, "field"],
        ["/short"],
        { rootKey: "/object", name: "Name", token: TOKEN_A },
        null,
        [SERVER, "Server", TOKEN_B],
      ]),
    );

    expect([...readProjectDisplayNameEntries()]).toEqual([
      [LOCAL, { name: "Codevo", token: TOKEN_A }],
      [SERVER, { name: "Server", token: TOKEN_B }],
    ]);
  });

  it("drops entries without a well-formed token", () => {
    seed(
      JSON.stringify([
        ["/legacy", "No token"],
        ["/empty", "Name", ""],
        ["/short", "Name", "aaaaaaaaaaaaaaa"],
        ["/long", "Name", "aaaaaaaaaaaaaaaaa"],
        ["/upper", "Name", "AAAAAAAAAAAAAAAA"],
        ["/non-hex", "Name", "gggggggggggggggg"],
        ["/padded", "Name", " aaaaaaaaaaaaaaa"],
        ["/number", "Name", 1234567890123456],
        ["/null", "Name", null],
        ["/array", "Name", [TOKEN_A]],
        [LOCAL, "Codevo", "0123456789abcdef"],
      ]),
    );

    expect([...readProjectDisplayNameEntries()]).toEqual([
      [LOCAL, { name: "Codevo", token: "0123456789abcdef" }],
    ]);
    expect([...readProjectDisplayNames()]).toEqual([[LOCAL, "Codevo"]]);
  });

  it("rejects invalid names and projects without changing storage", () => {
    saveProjectDisplayName([LOCAL], "Codevo", tokens(TOKEN_A));
    const before = localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY);

    expect(saveProjectDisplayName([LOCAL], "a".repeat(65))).toEqual({
      kind: "rejected",
      reason: "invalidName",
    });
    expect(saveProjectDisplayName([LOCAL], "two\nlines")).toEqual({
      kind: "rejected",
      reason: "invalidName",
    });
    expect(saveProjectDisplayName([LOCAL], "   ")).toEqual({
      kind: "rejected",
      reason: "invalidName",
    });
    expect(saveProjectDisplayName([], "Name")).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
    expect(saveProjectDisplayName([LOCAL, ""], "Name")).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
    expect(saveProjectDisplayName([`/${"a".repeat(5000)}`], "Name")).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });
    expect(
      saveProjectDisplayName(
        Array.from({ length: MAX_PROJECT_DISPLAY_NAME_ENTRIES + 1 }, (_, index) => `/q/${index}`),
        "Name",
      ),
    ).toEqual({ kind: "rejected", reason: "invalidProject" });
    expect(clearProjectDisplayName(["/bad\u0000key"])).toEqual({
      kind: "rejected",
      reason: "invalidProject",
    });

    expect(localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY)).toBe(before);
  });

  it("rejects a rename that would exceed the entry limit instead of dropping another name", () => {
    for (let index = 0; index < MAX_PROJECT_DISPLAY_NAME_ENTRIES - 1; index += 1) {
      saveProjectDisplayName([`/p/${index}`], `Name ${index}`);
    }
    const before = localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY);

    expect(saveProjectDisplayName([LOCAL, SERVER], "Codevo")).toEqual({
      kind: "rejected",
      reason: "storageFull",
    });
    expect(localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY)).toBe(before);
    expect(readProjectDisplayNames().size).toBe(MAX_PROJECT_DISPLAY_NAME_ENTRIES - 1);
    expect(readProjectDisplayNames().get("/p/0")).toBe("Name 0");

    expect(saveProjectDisplayName(["/p/0"], "Renamed again")).toEqual({ kind: "saved" });
    expect(saveProjectDisplayName([LOCAL], "Codevo")).toEqual({ kind: "saved" });
    expect(readProjectDisplayNames().size).toBe(MAX_PROJECT_DISPLAY_NAME_ENTRIES);
    expect(saveProjectDisplayName([SERVER], "Codevo")).toEqual({
      kind: "rejected",
      reason: "storageFull",
    });

    expect(clearProjectDisplayName(["/p/1"])).toEqual({ kind: "saved" });
    expect(saveProjectDisplayName([SERVER], "Codevo")).toEqual({ kind: "saved" });
    expect(readProjectDisplayNames().get("/p/0")).toBe("Renamed again");
    expect(readProjectDisplayNames().get(SERVER)).toBe("Codevo");
  });

  it.each([
    "{bad",
    "null",
    JSON.stringify({ version: 2, names: { [LOCAL]: "Newer" } }),
    JSON.stringify(
      Array.from({ length: MAX_PROJECT_DISPLAY_NAME_ENTRIES + 1 }, (_, index) => [
        `/p/${index}`,
        "Name",
        TOKEN_A,
      ]),
    ),
    `[${" ".repeat(2_000_001)}]`,
  ])("never overwrites stored names it cannot read", (raw) => {
    seed(raw);
    const notify = vi.fn();
    const unsubscribe = subscribeProjectDisplayNames(notify);

    expect(saveProjectDisplayName([LOCAL], "Codevo")).toEqual({
      kind: "rejected",
      reason: "storageUnreadable",
    });
    expect(clearProjectDisplayName([LOCAL])).toEqual({
      kind: "rejected",
      reason: "storageUnreadable",
    });

    unsubscribe();
    expect(localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY)).toBe(raw);
    expect(readProjectDisplayNames().size).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports a write the browser refuses without publishing a name", () => {
    localStorage.setItem("filler", "x".repeat(STORAGE_QUOTA_CHARS - "filler".length));
    const notify = vi.fn();
    const unsubscribe = subscribeProjectDisplayNames(notify);

    expect(saveProjectDisplayName([LOCAL], "Codevo")).toEqual({
      kind: "rejected",
      reason: "storageUnavailable",
    });

    unsubscribe();
    expect(notify).not.toHaveBeenCalled();
    expect(readProjectDisplayNames().size).toBe(0);
  });

  it("rejects a rename that would exceed the storage size bound", () => {
    saveProjectDisplayName([LOCAL], "Codevo", tokens(TOKEN_A));
    const escaped = Array.from(
      { length: MAX_PROJECT_DISPLAY_NAME_ENTRIES - 1 },
      (_, index) => `/${index}/${"\\".repeat(4900)}`,
    );

    expect(saveProjectDisplayName(escaped, "Name")).toEqual({
      kind: "rejected",
      reason: "storageFull",
    });
    expect([...readProjectDisplayNames()]).toEqual([[LOCAL, "Codevo"]]);
  });

  it("explains every write rejection", () => {
    expect(projectDisplayNameWriteMessage("invalidProject")).toBe(
      "This project can no longer be renamed.",
    );
    expect(projectDisplayNameWriteMessage("invalidName")).toBe("Enter a valid project name.");
    expect(projectDisplayNameWriteMessage("tokenUnavailable")).toBe(
      "The project name could not be linked to this project. Try again.",
    );
    expect(projectDisplayNameWriteMessage("storageFull")).toBe(
      "Too many project names are stored. Reset another project name first.",
    );
    expect(projectDisplayNameWriteMessage("storageUnreadable")).toBe(
      "Saved project names could not be read, so nothing was changed.",
    );
    expect(projectDisplayNameWriteMessage("storageUnavailable")).toBe(
      "The project name could not be saved.",
    );
  });
});
