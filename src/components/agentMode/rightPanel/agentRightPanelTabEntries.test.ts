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

  it("represents the editor kind by its document entries at the kind's position", () => {
    const entries = agentRightPanelTabEntries({
      openSurfaces: ["files", "editor", "diff"],
      activeSurface: "editor",
      terminal: null,
      editorDocuments: {
        documents: [
          {
            documentId: "/w/a.ts",
            title: "a.ts",
            path: "/w/a.ts",
            dirty: true,
            preview: false,
            gitStatus: "modified",
          },
          {
            documentId: "/w/b.ts",
            title: "b.ts",
            path: "/w/b.ts",
            dirty: false,
            preview: true,
            gitStatus: null,
          },
        ],
        activeDocumentId: "/w/b.ts",
        surfaceActive: true,
        onActivate: () => undefined,
        onClose: () => undefined,
        onOpenFile: () => undefined,
        onPin: () => undefined,
      },
    });

    expect(
      entries.map((entry) =>
        entry.kind === "editorDocument" ? `doc:${entry.label}:${entry.active}` : entry.id,
      ),
    ).toEqual(["surface:files", "doc:a.ts:false", "doc:b.ts:true", "surface:diff"]);
    expect(selectedAgentRightPanelTabId(entries)).toBe("editor:/w/b.ts");
    expect(entries[1]).toMatchObject({
      dirty: true,
      preview: false,
      gitStatus: "modified",
      panelId: "agent-surface-panel-editor",
    });
  });

  it("emits nothing for the editor kind without documents and no documents without the kind", () => {
    const editorDocuments: AgentRightPanelEditorDocuments = {
      documents: [
        {
          documentId: "a",
          title: "orders.ts",
          path: "/r/orders.ts",
          dirty: false,
          preview: false,
          gitStatus: null,
        },
      ],
      activeDocumentId: "a",
      surfaceActive: false,
      onActivate: () => undefined,
      onClose: () => undefined,
      onOpenFile: () => undefined,
      onPin: () => undefined,
    };

    expect(
      agentRightPanelTabEntries({
        openSurfaces: ["editor", "diff"],
        activeSurface: "diff",
        terminal: null,
        editorDocuments: noEditor,
      }).map((entry) => entry.id),
    ).toEqual(["surface:diff"]);
    expect(
      agentRightPanelTabEntries({
        openSurfaces: ["editor"],
        activeSurface: "editor",
        terminal: null,
        editorDocuments: { ...editorDocuments, documents: [] },
      }),
    ).toEqual([]);
    expect(
      agentRightPanelTabEntries({
        openSurfaces: ["diff"],
        activeSurface: "diff",
        terminal: null,
        editorDocuments,
      }).map((entry) => entry.id),
    ).toEqual(["surface:diff"]);
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
