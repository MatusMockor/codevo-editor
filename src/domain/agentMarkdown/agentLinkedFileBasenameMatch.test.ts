import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES,
  agentLinkedFileBasenameMatch,
} from "./agentLinkedFileBasenameMatch";

const ROOT = "/workspace/app";

function files(...relativePaths: ReadonlyArray<string>) {
  return {
    results: relativePaths.map((relativePath) => ({ path: `${ROOT}/${relativePath}` })),
    truncated: false,
  };
}

describe("agentLinkedFileBasenameMatch", () => {
  it("takes the one file whose name matches exactly", () => {
    const candidates = files("src/chatview.tsx", "src/ChatView.tsx", "src/ChatViewer.tsx");

    expect(agentLinkedFileBasenameMatch("ChatView.tsx", ROOT, candidates)).toBe(
      `${ROOT}/src/ChatView.tsx`,
    );
  });

  it("falls back to a single case-insensitive match", () => {
    const candidates = files("src/components/chatview.tsx", "src/ChatViewer.tsx");

    expect(agentLinkedFileBasenameMatch("ChatView.tsx", ROOT, candidates)).toBe(
      `${ROOT}/src/components/chatview.tsx`,
    );
  });

  it("refuses to guess between several equally good matches", () => {
    expect(
      agentLinkedFileBasenameMatch("index.ts", ROOT, files("a/index.ts", "b/index.ts")),
    ).toBeNull();
    expect(
      agentLinkedFileBasenameMatch("ChatView.tsx", ROOT, files("a/chatview.tsx", "b/CHATVIEW.tsx")),
    ).toBeNull();
  });

  it("finds nothing when no file has the name", () => {
    expect(agentLinkedFileBasenameMatch("auth.json", ROOT, files("src/auth.ts"))).toBeNull();
    expect(agentLinkedFileBasenameMatch("auth.json", ROOT, files())).toBeNull();
  });

  it("ignores results outside the root or with dot segments", () => {
    const candidates = {
      results: [
        { path: "/workspace/other/auth.json" },
        { path: "/workspace/app-docs/auth.json" },
        { path: `${ROOT}/a/../auth.json` },
      ],
      truncated: false,
    };

    expect(agentLinkedFileBasenameMatch("auth.json", ROOT, candidates)).toBeNull();
  });

  it("never picks from an incomplete search, even with one apparent exact match", () => {
    const truncated = { ...files("src/ChatView.tsx", "src/ChatViewer.tsx"), truncated: true };

    expect(agentLinkedFileBasenameMatch("ChatView.tsx", ROOT, truncated)).toBeNull();
  });

  it("refuses more results than it asked for", () => {
    const many = files(
      ...Array.from(
        { length: MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES },
        (_, index) => `f${index}.ts`,
      ),
      "deep/auth.json",
    );

    expect(agentLinkedFileBasenameMatch("auth.json", ROOT, many)).toBeNull();
  });
});
