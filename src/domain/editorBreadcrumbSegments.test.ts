import { describe, expect, it } from "vitest";
import { editorBreadcrumbSegments } from "./editorBreadcrumbSegments";

describe("editorBreadcrumbSegments", () => {
  it("splits a workspace-relative path into folder crumbs and the file", () => {
    expect(editorBreadcrumbSegments("/w/orders-api", "/w/orders-api/src/routes/orders.ts")).toEqual(
      [
        { kind: "folder", label: "src", path: "/w/orders-api/src" },
        { kind: "folder", label: "routes", path: "/w/orders-api/src/routes" },
        { kind: "file", label: "orders.ts", path: "/w/orders-api/src/routes/orders.ts" },
      ],
    );
  });

  it("collapses leading folders beyond the bound into one overflow crumb", () => {
    const segments = editorBreadcrumbSegments("/w", "/w/a/b/c/d/e/f/g.ts");

    expect(segments.map((segment) => segment.label)).toEqual(["…", "c", "d", "e", "f", "g.ts"]);
    expect(segments[0]).toEqual({ kind: "overflow", label: "…", path: "/w/a/b" });
  });

  it("keeps exactly the bound of folders without an overflow crumb", () => {
    const segments = editorBreadcrumbSegments("/w", "/w/a/b/c/d/g.ts");

    expect(segments.map((segment) => segment.kind)).toEqual([
      "folder",
      "folder",
      "folder",
      "folder",
      "file",
    ]);
  });

  it("shows only the file for paths outside the workspace or without a workspace", () => {
    expect(editorBreadcrumbSegments("/w", "/tmp/scratch.ts")).toEqual([
      { kind: "file", label: "scratch.ts", path: "/tmp/scratch.ts" },
    ]);
    expect(editorBreadcrumbSegments(null, "/w/src/a.ts")).toEqual([
      { kind: "file", label: "a.ts", path: "/w/src/a.ts" },
    ]);
  });

  it("rejects sibling prefixes and parent traversal as outside the workspace", () => {
    expect(editorBreadcrumbSegments("/w", "/wx/src/a.ts")).toEqual([
      { kind: "file", label: "a.ts", path: "/wx/src/a.ts" },
    ]);
    expect(editorBreadcrumbSegments("/w", "/w/../etc/a.ts")).toEqual([
      { kind: "file", label: "a.ts", path: "/w/../etc/a.ts" },
    ]);
  });

  it("handles a trailing slash on the root and the filesystem root", () => {
    expect(editorBreadcrumbSegments("/w/", "/w/src/a.ts")).toEqual([
      { kind: "folder", label: "src", path: "/w/src" },
      { kind: "file", label: "a.ts", path: "/w/src/a.ts" },
    ]);
    expect(editorBreadcrumbSegments("/", "/src/a.ts")).toEqual([
      { kind: "folder", label: "src", path: "/src" },
      { kind: "file", label: "a.ts", path: "/src/a.ts" },
    ]);
  });
});
