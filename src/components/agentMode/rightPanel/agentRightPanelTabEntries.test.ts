import { describe, expect, it } from "vitest";
import {
  agentRightPanelTabEntries,
  selectedAgentRightPanelTabId,
  type AgentRightPanelEditorDocuments,
} from "./agentRightPanelTabEntries";

const noEditor = null;

describe("agentRightPanelTabEntries", () => {
  it("lists open surfaces in order with the active one selected", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["diff", "files", "git"],
      activeSurface: "files",
      terminal: null,
      editorDocuments: noEditor,
    });

    expect(entries.map((entry) => entry.label)).toEqual(["Diff", "Files", "Git"]);
    expect(selectedAgentRightPanelTabId(entries)).toBe("surface:files");
  });

  it("expands the terminal surface into one tab per session in its position", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["diff", "terminal", "git"],
      activeSurface: "terminal",
      terminal: {
        sessions: [
          { id: "terminal-0", title: "dev", live: true, closable: true },
          { id: "terminal-1", title: "zsh", live: false, closable: true },
        ],
        activeSessionId: "terminal-1",
      },
      editorDocuments: noEditor,
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      "surface:diff",
      "terminal:terminal-0",
      "terminal:terminal-1",
      "surface:git",
    ]);
    expect(selectedAgentRightPanelTabId(entries)).toBe("terminal:terminal-1");
    expect(entries[1]).toMatchObject({ kind: "terminalSession", live: true });
  });

  it("falls back to one Terminal tab before the sessions are known", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["terminal"],
      activeSurface: "terminal",
      terminal: { sessions: [], activeSessionId: null },
      editorDocuments: noEditor,
    });

    expect(entries).toEqual([
      expect.objectContaining({ id: "surface:terminal", label: "Terminal", active: true }),
    ]);
  });

  it("places editor documents first and marks only the active one", () => {
    const editorDocuments: AgentRightPanelEditorDocuments = {
      documents: [
        {
          documentId: "a",
          title: "orders.ts",
          path: "/r/src/orders.ts",
          dirty: false,
          preview: false,
        },
        { documentId: "b", title: "app.ts", path: "/r/src/app.ts", dirty: true, preview: true },
      ],
      activeDocumentId: "b",
      surfaceActive: true,
      onActivate: () => undefined,
      onClose: () => undefined,
      onOpenFile: () => undefined,
    };

    const entries = agentRightPanelTabEntries({
      openSurfaces: ["diff"],
      activeSurface: null,
      terminal: null,
      editorDocuments,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["editor:a", "editor:b", "surface:diff"]);
    expect(selectedAgentRightPanelTabId(entries)).toBe("editor:b");
    expect(entries[1]).toMatchObject({ dirty: true, preview: true });
  });

  it("uses the tab label for the pull request surface", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["pullRequest"],
      activeSurface: "pullRequest",
      terminal: null,
      editorDocuments: noEditor,
    });
    expect(entries[0]?.label).toBe("New pull request");
  });
});
