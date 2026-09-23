import { describe, expect, it } from "vitest";
import { agentThreadAutoTitle } from "./agentThreadAutoTitle";
import { MAX_AGENT_THREAD_TITLE_BYTES, UNTITLED_AGENT_THREAD_TITLE } from "./agentThread";

describe("agentThreadAutoTitle", () => {
  it("strips markdown, slash commands and mention paths from the first meaningful line", () => {
    expect(agentThreadAutoTitle("/review  ## Fix the **login** `redirect` bug")).toBe(
      "Fix the login redirect bug",
    );
    expect(
      agentThreadAutoTitle("- [x] Update [docs](https://example.test) for @src/app/router.ts"),
    ).toBe("Update docs for router.ts");
    expect(agentThreadAutoTitle("> _Explain_   the\tcache\n\nsecond line")).toBe(
      "Explain the cache",
    );
  });

  it("skips fenced code and empty lines before the request", () => {
    expect(agentThreadAutoTitle("```ts\nconst a = 1;\n```\n\n  Why does this fail?  ")).toBe(
      "Why does this fail?",
    );
  });

  it("cuts long lines at a word boundary near sixty characters", () => {
    const title = agentThreadAutoTitle(
      "Refactor the workspace indexer so that large monorepos do not block typing in the editor",
    );
    expect(title).toBe("Refactor the workspace indexer so that large monorepos do…");
    expect(Array.from(title).length).toBeLessThanOrEqual(61);
  });

  it("hard cuts a single long word and stays within the byte bound", () => {
    const title = agentThreadAutoTitle("é".repeat(MAX_AGENT_THREAD_TITLE_BYTES));
    expect(title).toBe(`${"é".repeat(60)}…`);
  });

  it("falls back to the raw first line when nothing meaningful remains", () => {
    expect(agentThreadAutoTitle("/compact")).toBe("/compact");
    expect(agentThreadAutoTitle("   \n  ")).toBe(UNTITLED_AGENT_THREAD_TITLE);
  });
});
