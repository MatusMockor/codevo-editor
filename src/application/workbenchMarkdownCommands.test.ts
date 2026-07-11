import { describe, expect, it, vi } from "vitest";
import { workbenchMarkdownCommands } from "./workbenchMarkdownCommands";

describe("workbenchMarkdownCommands", () => {
  it("exposes the Markdown preview command only for an active Markdown document", () => {
    const openMarkdownPreview = vi.fn();
    const [command] = workbenchMarkdownCommands({
      isActiveDocumentMarkdown: true,
      openMarkdownPreview,
    });

    expect(command).toMatchObject({
      category: "Markdown",
      id: "markdown.openPreview",
      shortcut: "Cmd+Shift+V",
      title: "Markdown: Open Preview",
    });
    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(true);

    command?.run();
    expect(openMarkdownPreview).toHaveBeenCalledOnce();
  });

  it("disables the command for non-Markdown documents", () => {
    const [command] = workbenchMarkdownCommands({
      isActiveDocumentMarkdown: false,
      openMarkdownPreview: vi.fn(),
    });

    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(false);
  });
});
