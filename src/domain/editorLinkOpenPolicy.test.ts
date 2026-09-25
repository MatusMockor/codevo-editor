import { describe, expect, it } from "vitest";
import { decideEditorLinkOpen } from "./editorLinkOpenPolicy";

describe("decideEditorLinkOpen", () => {
  it.each([
    ["https://example.com/docs?q=a&b=2#top", "https://example.com/docs?q=a&b=2#top"],
    ["http://localhost:3000/", "http://localhost:3000/"],
    ["HTTPS://Example.com", "https://example.com/"],
    ["https://example.com/a b", "https://example.com/a%20b"],
  ])("opens %s externally as %s", (uri, url) => {
    expect(decideEditorLinkOpen(uri)).toEqual({ kind: "open-external", url });
  });

  it("delegates command links to Monaco's allowlisted command opener", () => {
    expect(decideEditorLinkOpen("command:debug.hover.copyEvaluatePath")).toEqual({
      kind: "delegate-command",
    });
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:someone@example.com",
    "vscode://settings",
    "ms-settings:privacy",
    "tauri://localhost",
    "ftp://example.com",
    "inmemory://model/1",
    "not a url",
    "",
    "https://",
  ])("refuses %s", (uri) => {
    expect(decideEditorLinkOpen(uri)).toEqual({ kind: "refuse" });
  });

  it("refuses oversized links before parsing them", () => {
    expect(decideEditorLinkOpen(`https://example.com/${"a".repeat(9000)}`)).toEqual({
      kind: "refuse",
    });
  });
});
