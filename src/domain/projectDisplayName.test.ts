import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_DISPLAY_NAME_CHARS,
  clearProjectDisplayNameEntries,
  isProjectDisplayName,
  isProjectDisplayNameToken,
  parseProjectDisplayName,
  projectDisplayNameOf,
  projectDisplayNameOfflineRootKeys,
  projectDisplayNameRejectionMessage,
  projectDisplayNameRootKeys,
  projectDisplayNameToken,
  projectDisplayNameTokenInUse,
  renameProjectDisplayNameEntries,
  resolveProjectDisplayName,
  sameProjectDisplayName,
  type ProjectDisplayNameEntries,
} from "./projectDisplayName";

const LOCAL = "/Users/dev/editor";
const SERVER = "remote:linux:runner:codevo-editor";
const OTHER_SERVER = "remote:backup:runner:codevo-editor";

describe("project display name validation", () => {
  it("trims a valid name and keeps inner spacing and non-ASCII text", () => {
    expect(parseProjectDisplayName("  Codevo Editor  ")).toEqual({
      kind: "name",
      name: "Codevo Editor",
    });
    expect(parseProjectDisplayName("Čučoriedka 🚀")).toEqual({
      kind: "name",
      name: "Čučoriedka 🚀",
    });
  });

  it.each(["", "   ", "\t", "\n \r\n", "\u00a0\u2028"])(
    "treats whitespace-only input %j as a reset to the default name",
    (input) => {
      expect(parseProjectDisplayName(input)).toEqual({ kind: "reset" });
    },
  );

  it("accepts exactly the maximum length and rejects one more without truncating", () => {
    const longest = "a".repeat(MAX_PROJECT_DISPLAY_NAME_CHARS);
    expect(parseProjectDisplayName(longest)).toEqual({ kind: "name", name: longest });
    expect(parseProjectDisplayName(`${longest}b`)).toEqual({ kind: "invalid", reason: "tooLong" });
    expect(parseProjectDisplayName("a".repeat(100_000))).toEqual({
      kind: "invalid",
      reason: "tooLong",
    });
  });

  it("counts characters rather than UTF-16 units", () => {
    const emoji = "🚀".repeat(MAX_PROJECT_DISPLAY_NAME_CHARS);
    expect(parseProjectDisplayName(emoji)).toEqual({ kind: "name", name: emoji });
    expect(parseProjectDisplayName(`${emoji}🚀`)).toEqual({ kind: "invalid", reason: "tooLong" });
  });

  it.each(["one\ntwo", "one\r\ntwo", "tab\there", "nul\u0000", "esc\u001b[31m", "del\u007f x"])(
    "rejects control characters and line breaks in %j",
    (input) => {
      expect(parseProjectDisplayName(input)).toEqual({
        kind: "invalid",
        reason: "controlCharacters",
      });
    },
  );

  it.each([
    "line\u2028separator",
    "paragraph\u2029separator",
    "spoof\u202egnp.exe",
    "isolate\u2066d",
    "mark\u200ename",
    "mark\u200fname",
    "mark\u061cname",
    "\u200e",
  ])("rejects Unicode line separators and directional controls in %j", (input) => {
    expect(parseProjectDisplayName(input)).toEqual({
      kind: "invalid",
      reason: "controlCharacters",
    });
  });

  it.each(["\u200b", "\u00ad", "\u2060", "\u200b\u00ad\u2060", " \u200b \u200d ", "\u200d"])(
    "rejects %j because it would render as a blank name",
    (input) => {
      expect(parseProjectDisplayName(input)).toEqual({
        kind: "invalid",
        reason: "noVisibleCharacters",
      });
      expect(isProjectDisplayName(input)).toBe(false);
    },
  );

  it.each(["a\u200db", "می\u200cخواهم", "soft\u00adhyphen"])(
    "keeps joiners and other format characters inside a visible name %j",
    (input) => {
      expect(parseProjectDisplayName(input)).toEqual({ kind: "name", name: input });
      expect(isProjectDisplayName(input)).toBe(true);
    },
  );

  it("recognises only already-normalised stored names", () => {
    expect(isProjectDisplayName("Editor")).toBe(true);
    expect(isProjectDisplayName(" Editor")).toBe(false);
    expect(isProjectDisplayName("")).toBe(false);
    expect(isProjectDisplayName("a\nb")).toBe(false);
    expect(isProjectDisplayName("a".repeat(MAX_PROJECT_DISPLAY_NAME_CHARS + 1))).toBe(false);
    expect(isProjectDisplayName(42)).toBe(false);
    expect(isProjectDisplayName(null)).toBe(false);
  });

  it("explains each rejection in a short sentence", () => {
    expect(projectDisplayNameRejectionMessage("tooLong")).toBe("Use 64 characters or fewer.");
    expect(projectDisplayNameRejectionMessage("controlCharacters")).toBe(
      "Use a single line without control characters.",
    );
    expect(projectDisplayNameRejectionMessage("noVisibleCharacters")).toBe(
      "Use at least one visible character.",
    );
  });
});

describe("project display name resolution", () => {
  it("has no name for a project nobody renamed", () => {
    expect(
      resolveProjectDisplayName(new Map(), {
        representativeRootKey: LOCAL,
        memberRootKeys: [LOCAL, SERVER],
      }),
    ).toBeNull();
    expect(
      resolveProjectDisplayName(new Map([["/elsewhere", "Other"]]), {
        representativeRootKey: LOCAL,
        memberRootKeys: [LOCAL],
      }),
    ).toBeNull();
  });

  it("reads the name stored for one physical checkout", () => {
    const names = new Map([[SERVER, "Codevo"]]);

    expect(projectDisplayNameOf(names, SERVER)).toBe("Codevo");
    expect(projectDisplayNameOf(names, LOCAL)).toBeNull();
    expect(projectDisplayNameOf(new Map(), SERVER)).toBeNull();
  });

  it("uses the name of any member when only one checkout was renamed", () => {
    expect(
      resolveProjectDisplayName(new Map([[SERVER, "Codevo"]]), {
        representativeRootKey: LOCAL,
        memberRootKeys: [LOCAL, SERVER],
      }),
    ).toBe("Codevo");
  });

  it("prefers the representative when members disagree", () => {
    const names = new Map([
      [SERVER, "Server name"],
      [LOCAL, "Local name"],
    ]);
    expect(
      resolveProjectDisplayName(names, {
        representativeRootKey: LOCAL,
        memberRootKeys: [SERVER, LOCAL],
      }),
    ).toBe("Local name");
  });

  it("falls back to the first remaining member in a stable order regardless of discovery order", () => {
    const names = new Map([
      [SERVER, "Linux name"],
      [OTHER_SERVER, "Backup name"],
    ]);
    const forward = resolveProjectDisplayName(names, {
      representativeRootKey: LOCAL,
      memberRootKeys: [LOCAL, SERVER, OTHER_SERVER],
    });
    const reversed = resolveProjectDisplayName(names, {
      representativeRootKey: LOCAL,
      memberRootKeys: [OTHER_SERVER, SERVER, LOCAL],
    });
    expect(forward).toBe("Backup name");
    expect(reversed).toBe("Backup name");
  });

  it("lists the representative first and every other member once", () => {
    expect(
      projectDisplayNameRootKeys({
        representativeRootKey: LOCAL,
        memberRootKeys: [SERVER, LOCAL, OTHER_SERVER, SERVER],
      }),
    ).toEqual([LOCAL, OTHER_SERVER, SERVER]);
    expect(
      projectDisplayNameRootKeys({ representativeRootKey: LOCAL, memberRootKeys: [] }),
    ).toEqual([LOCAL]);
  });
});

describe("project display name group links", () => {
  const TOKEN_A = "aaaaaaaaaaaaaaaa";
  const TOKEN_B = "bbbbbbbbbbbbbbbb";
  const TOKEN_C = "cccccccccccccccc";
  const API = "/Users/dev/api";
  const NOWHERE: ReadonlySet<string> = new Set();
  const entries: ProjectDisplayNameEntries = new Map([
    [LOCAL, { name: "Billing API", token: TOKEN_A }],
    [SERVER, { name: "Billing API", token: TOKEN_A }],
    [OTHER_SERVER, { name: "Billing API", token: TOKEN_B }],
    [API, { name: "Docs", token: TOKEN_C }],
  ]);

  it.each(["0123456789abcdef", "ffffffffffffffff"])("accepts the bounded hex token %j", (token) => {
    expect(isProjectDisplayNameToken(token)).toBe(true);
  });

  it.each([
    "",
    "0123456789abcde",
    "0123456789abcdef0",
    "0123456789ABCDEF",
    "0123456789abcdeg",
    " 123456789abcdef",
    "0123456789abcde\n",
    7,
    null,
    undefined,
    ["0123456789abcdef"],
  ])("rejects the malformed token %j", (token) => {
    expect(isProjectDisplayNameToken(token)).toBe(false);
  });

  it("takes the token of the first member that has one", () => {
    expect(projectDisplayNameToken(entries, [LOCAL, OTHER_SERVER], NOWHERE)).toBe(TOKEN_A);
    expect(projectDisplayNameToken(entries, [OTHER_SERVER, LOCAL], NOWHERE)).toBe(TOKEN_B);
    expect(projectDisplayNameToken(entries, ["/Users/dev/new", OTHER_SERVER], NOWHERE)).toBe(
      TOKEN_B,
    );
    expect(projectDisplayNameToken(entries, ["/Users/dev/new"], NOWHERE)).toBeNull();
    expect(projectDisplayNameToken(new Map(), [LOCAL], NOWHERE)).toBeNull();
  });

  it("has no reusable token when a member's token is also displayed in another group", () => {
    expect(projectDisplayNameToken(entries, [LOCAL], new Set([SERVER]))).toBeNull();
    expect(projectDisplayNameToken(entries, [SERVER], new Set([LOCAL, API]))).toBeNull();
    expect(projectDisplayNameToken(entries, [API, LOCAL], new Set([SERVER]))).toBeNull();
    expect(projectDisplayNameToken(entries, [LOCAL, SERVER], new Set([OTHER_SERVER, API]))).toBe(
      TOKEN_A,
    );
    expect(projectDisplayNameToken(entries, [LOCAL], new Set([OTHER_SERVER]))).toBe(TOKEN_A);
  });

  it("knows whether a token is already linked to some project", () => {
    expect(projectDisplayNameTokenInUse(entries, TOKEN_B)).toBe(true);
    expect(projectDisplayNameTokenInUse(entries, "dddddddddddddddd")).toBe(false);
  });

  it("lists linked checkouts that are not displayed anywhere, in a stable order", () => {
    const linked: ProjectDisplayNameEntries = new Map([
      ...entries,
      ["/Users/dev/zeta", { name: "Billing API", token: TOKEN_A }],
      ["/Users/dev/alpha", { name: "Billing API", token: TOKEN_A }],
    ]);

    expect(projectDisplayNameOfflineRootKeys(linked, [LOCAL], NOWHERE)).toEqual([
      "/Users/dev/alpha",
      "/Users/dev/zeta",
      SERVER,
    ]);
    expect(projectDisplayNameOfflineRootKeys(linked, [LOCAL], new Set([SERVER]))).toEqual([
      "/Users/dev/alpha",
      "/Users/dev/zeta",
    ]);
    expect(projectDisplayNameOfflineRootKeys(linked, [LOCAL, SERVER], NOWHERE)).toEqual([
      "/Users/dev/alpha",
      "/Users/dev/zeta",
    ]);
    expect(projectDisplayNameOfflineRootKeys(linked, ["/Users/dev/new"], NOWHERE)).toEqual([]);
    expect(projectDisplayNameOfflineRootKeys(new Map(), [LOCAL], NOWHERE)).toEqual([]);
  });

  it("clears every offline entry linked to the members and never an equal name with another token", () => {
    expect([...clearProjectDisplayNameEntries(entries, [LOCAL], NOWHERE)]).toEqual([
      [OTHER_SERVER, { name: "Billing API", token: TOKEN_B }],
      [API, { name: "Docs", token: TOKEN_C }],
    ]);
    expect([...clearProjectDisplayNameEntries(entries, ["/Users/dev/unnamed"], NOWHERE)]).toEqual([
      ...entries,
    ]);
    expect([...clearProjectDisplayNameEntries(entries, [OTHER_SERVER, API], NOWHERE)]).toEqual([
      [LOCAL, { name: "Billing API", token: TOKEN_A }],
      [SERVER, { name: "Billing API", token: TOKEN_A }],
    ]);
  });

  it("never clears a linked entry that is displayed in another group", () => {
    expect([...clearProjectDisplayNameEntries(entries, [LOCAL], new Set([SERVER]))]).toEqual([
      [SERVER, { name: "Billing API", token: TOKEN_A }],
      [OTHER_SERVER, { name: "Billing API", token: TOKEN_B }],
      [API, { name: "Docs", token: TOKEN_C }],
    ]);
  });

  it("renames linked offline entries and keeps unrelated ones", () => {
    expect([
      ...renameProjectDisplayNameEntries(entries, [LOCAL], "Billing", TOKEN_A, NOWHERE),
    ]).toEqual([
      [LOCAL, { name: "Billing", token: TOKEN_A }],
      [SERVER, { name: "Billing", token: TOKEN_A }],
      [OTHER_SERVER, { name: "Billing API", token: TOKEN_B }],
      [API, { name: "Docs", token: TOKEN_C }],
    ]);
  });

  it("never renames a linked entry that is displayed in another group", () => {
    const severed = "dddddddddddddddd";
    const linked: ProjectDisplayNameEntries = new Map([
      ...entries,
      ["/Users/dev/offline", { name: "Billing API", token: TOKEN_A }],
    ]);

    expect([
      ...renameProjectDisplayNameEntries(linked, [LOCAL], "Fork", severed, new Set([SERVER])),
    ]).toEqual([
      [LOCAL, { name: "Fork", token: severed }],
      [SERVER, { name: "Billing API", token: TOKEN_A }],
      [OTHER_SERVER, { name: "Billing API", token: TOKEN_B }],
      [API, { name: "Docs", token: TOKEN_C }],
      ["/Users/dev/offline", { name: "Fork", token: severed }],
    ]);
  });

  it("links new members and converges members that carried different tokens", () => {
    const renamed = renameProjectDisplayNameEntries(
      entries,
      [OTHER_SERVER, API, "/Users/dev/new"],
      "One name",
      TOKEN_B,
      NOWHERE,
    );

    expect([...renamed]).toEqual([
      [LOCAL, { name: "Billing API", token: TOKEN_A }],
      [SERVER, { name: "Billing API", token: TOKEN_A }],
      [OTHER_SERVER, { name: "One name", token: TOKEN_B }],
      [API, { name: "One name", token: TOKEN_B }],
      ["/Users/dev/new", { name: "One name", token: TOKEN_B }],
    ]);
    expect([...entries.values()].map((entry) => entry.name)).toEqual([
      "Billing API",
      "Billing API",
      "Billing API",
      "Docs",
    ]);
  });

  it("pulls offline entries along when their linked member converges into another token", () => {
    const renamed = renameProjectDisplayNameEntries(
      entries,
      [API, LOCAL],
      "One name",
      TOKEN_C,
      NOWHERE,
    );

    expect([...renamed]).toEqual([
      [LOCAL, { name: "One name", token: TOKEN_C }],
      [SERVER, { name: "One name", token: TOKEN_C }],
      [OTHER_SERVER, { name: "Billing API", token: TOKEN_B }],
      [API, { name: "One name", token: TOKEN_C }],
    ]);
  });
});

describe("project display name comparison", () => {
  it("treats names that read the same as equal", () => {
    expect(sameProjectDisplayName("Flagship", "flagship")).toBe(true);
    expect(sameProjectDisplayName(" Flagship ", "FLAGSHIP")).toBe(true);
    expect(sameProjectDisplayName("ﬁle", "file")).toBe(true);
    expect(sameProjectDisplayName("Flagship", "Flagship 2")).toBe(false);
  });
});
