import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
import { describe, expect, it } from "vitest";
import {
  createWorkspaceRoot,
  createWorkspaceRootFromPath,
  parseWorkspacePath,
  type WorkspacePath,
  type CaseInsensitiveWorkspacePathPolicy,
  type WorkspacePathPolicy,
  type WorkspacePathResult,
  type WorkspaceRootDescriptor,
} from "./workspacePath";

const CASE_SENSITIVE: WorkspacePathPolicy = {
  caseSensitive: true,
  unicodeNormalization: "NFC",
};

const TEST_UNICODE_FOLD = (value: string): string => value.toUpperCase();

const CASE_INSENSITIVE: WorkspacePathPolicy = {
  caseSensitive: false,
  foldCase: TEST_UNICODE_FOLD,
  unicodeNormalization: "NFC",
};

function valueOf<Value>(result: WorkspacePathResult<Value>): Value {
  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
}

function root(
  workspaceId = "project-a",
  nativePath = "/work/project",
  policy: WorkspacePathPolicy = CASE_SENSITIVE,
): WorkspaceRootDescriptor {
  return valueOf(createWorkspaceRoot(workspaceId, nativePath, policy));
}

function path(
  descriptor: WorkspaceRootDescriptor,
  pathOrUri: string,
): WorkspacePath {
  return valueOf(parseWorkspacePath(descriptor, pathOrUri));
}

describe("workspace path identity", () => {
  it("derives the same root identity from canonical path aliases", () => {
    const nativeRoot = valueOf(createWorkspaceRootFromPath("/work/project/"));
    const uriRoot = valueOf(
      createWorkspaceRootFromPath("file://localhost/work/project"),
    );

    expect(nativeRoot).toEqual(uriRoot);
    expect(path(nativeRoot, "/work/project/src/App.ts").key).toBe(
      path(uriRoot, "file:///work/project/src/App.ts").key,
    );
  });

  it("canonicalizes native paths and derives every representation", () => {
    const descriptor = root(
      "project-a",
      "/Users/me//project/./packages/..",
    );
    const parsed = path(
      descriptor,
      "/Users/me/project/src//domain/../User Name.php",
    );

    expect(descriptor.nativePath).toBe("/Users/me/project");
    expect(descriptor.fileUri).toBe("file:///Users/me/project");
    expect(parsed.key).toBe('["project-a","src","User Name.php"]');
    expect(parsed.nativePath).toBe("/Users/me/project/src/User Name.php");
    expect(parsed.fileUri).toBe(
      "file:///Users/me/project/src/User%20Name.php",
    );
    expect(parsed.relativePath).toBe("src/User Name.php");
  });

  it("parses local file URIs and canonicalizes localhost away", () => {
    const descriptor = root(
      "project-a",
      "file://localhost/work/project",
    );
    const parsed = path(
      descriptor,
      "FILE:///work/project/src/Hello%20World.ts",
    );

    expect(descriptor.fileUri).toBe("file:///work/project");
    expect(parsed.nativePath).toBe("/work/project/src/Hello World.ts");
    expect(parsed.fileUri).toBe("file:///work/project/src/Hello%20World.ts");
  });

  it.each([
    "https://example.test/work/project/file.ts",
    "file://server/work/project/file.ts",
    "file://user@localhost/work/project/file.ts",
    "file:///work/project/file.ts?version=1",
    "file:///work/project/file.ts#section",
  ])("returns an error for non-local or decorated URI %s", (uri) => {
    expect(parseWorkspacePath(root(), uri).ok).toBe(false);
  });

  it.each([
    "file:///work/project/bad%2Fname.ts",
    "file:///work/project/bad%2fname.ts",
    "file:///work/project/bad%ZZname.ts",
    "file:///work/project/bad%00name.ts",
  ])("returns an error for unsafe percent decoding in %s", (uri) => {
    expect(parseWorkspacePath(root(), uri).ok).toBe(false);
  });

  it("treats POSIX backslash as filename data", () => {
    const descriptor = root("project", "/work");
    const backslash = path(descriptor, "/work/a\\b");
    const separator = path(descriptor, "/work/a/b");

    expect(backslash.nativePath).toBe("/work/a\\b");
    expect(backslash.fileUri).toBe("file:///work/a%5Cb");
    expect(path(descriptor, backslash.fileUri)).toEqual(backslash);
    expect(backslash.key).not.toBe(separator.key);
    expect(backslash.monacoUri).not.toBe(separator.monacoUri);
  });

  it("decodes URI segments before resolving dot traversal", () => {
    expect(
      parseWorkspacePath(root(), "file:///work/project/%2e%2e/outside.ts"),
    ).toMatchObject({ ok: false, error: { code: "outside-workspace" } });
    expect(createWorkspaceRoot("bad", "/../../outside", CASE_SENSITIVE)).toMatchObject(
      { ok: false, error: { code: "unsafe-path" } },
    );
  });

  it("uses segment containment for neighbors and overlapping roots", () => {
    const project = root("project", "/work/project");
    const packageRoot = root("package", "/work/project/packages/core");

    expect(parseWorkspacePath(project, "/work/projectile/file.ts").ok).toBe(
      false,
    );
    expect(
      path(project, "/work/project/packages/core/a.ts").relativePath,
    ).toBe("packages/core/a.ts");
    expect(
      path(packageRoot, "/work/project/packages/core/a.ts").relativePath,
    ).toBe("a.ts");
  });

  it("uses comparison identity for both keys and Monaco URIs", () => {
    const descriptor = root("project", "/Work/Project", CASE_INSENSITIVE);
    const first = path(descriptor, "/work/project/SRC/Stra\u00dfe/\u03c3.ts");
    const second = path(descriptor, "/WORK/PROJECT/src/STRASSE/\u03c2.ts");

    expect(first.key).toBe(second.key);
    expect(first.monacoUri).toBe(second.monacoUri);
    expect(first.nativePath).not.toBe(second.nativePath);
    expect(first.relativePath).toBe("SRC/Stra\u00dfe/\u03c3.ts");
  });

  it("requires an injected authoritative fold when case-insensitive", () => {
    const policy = {
      caseSensitive: false,
      unicodeNormalization: "NFC",
    } as WorkspacePathPolicy;

    expect(createWorkspaceRoot("project", "/work", policy)).toMatchObject({
      ok: false,
      error: { code: "invalid-policy" },
    });
  });

  it("preserves a prototype-defined case fold and its instance receiver", () => {
    class PrototypePolicy implements CaseInsensitiveWorkspacePathPolicy {
      readonly caseSensitive = false;
      readonly unicodeNormalization = "NFC";
      private readonly prefix = "filesystem:";

      foldCase(value: string): string {
        return `${this.prefix}${value.toUpperCase()}`;
      }
    }

    const descriptor = root("project", "/Work/Project", new PrototypePolicy());
    const first = path(descriptor, "/work/project/Stra\u00dfe.ts");
    const second = path(descriptor, "/WORK/PROJECT/STRASSE.ts");

    expect(
      Object.prototype.hasOwnProperty.call(descriptor.policy, "foldCase"),
    ).toBe(true);
    expect(first.key).toBe(second.key);
    expect(first.monacoUri).toBe(second.monacoUri);
  });

  it("applies Unicode normalization before the injected fold", () => {
    const composed = "caf\u00e9";
    const decomposed = "cafe\u0301";
    const descriptor = root("project", `/work/${composed}`, CASE_INSENSITIVE);
    const parsed = path(descriptor, `/WORK/${decomposed}/File.ts`);

    expect(parsed.nativePath).toBe(`/WORK/${decomposed}/File.ts`);

    const literal = root("project", `/work/${composed}`, {
      caseSensitive: true,
      unicodeNormalization: "none",
    });
    expect(parseWorkspacePath(literal, `/work/${decomposed}/file.ts`).ok).toBe(
      false,
    );
  });

  it("keeps workspace IDs collision-free in Monaco URI path segments", () => {
    const combinedId = path(root("a/b", "/work"), "/work");
    const splitPath = path(root("a", "/work"), "/work/b");

    expect(combinedId.monacoUri).not.toBe(splitPath.monacoUri);
    expect(URI.parse(combinedId.monacoUri).toString()).toBe(
      combinedId.monacoUri,
    );
    expect(URI.parse(splitPath.monacoUri).toString()).toBe(splitPath.monacoUri);
  });

  it("round trips generated identities through Monaco URI parsing", () => {
    const parsed = path(
      root("project / 100% \u65e5\u672c\u8a9e", "/work/project"),
      "/work/project/sp ace/100%/#hash/?query/\u65e5\u672c\u8a9e.ts",
    );

    expect(URI.parse(parsed.monacoUri).toString()).toBe(parsed.monacoUri);
    expect(path(root("project", "/work/project"), parsed.fileUri).fileUri).toBe(
      parsed.fileUri,
    );
  });

  it.each(["\ud800", "\udc00", "valid\ud800bad"])(
    "returns errors for ill-formed Unicode %j",
    (invalid) => {
      expect(createWorkspaceRoot(invalid, "/work", CASE_SENSITIVE)).toMatchObject(
        { ok: false, error: { code: "invalid-workspace-id" } },
      );
      expect(
        createWorkspaceRoot("project", `/work/${invalid}`, CASE_SENSITIVE),
      ).toMatchObject({
        ok: false,
        error: { code: "invalid-unicode" },
      });
      expect(parseWorkspacePath(root(), `/work/project/${invalid}`)).toMatchObject(
        { ok: false, error: { code: "invalid-unicode" } },
      );
    },
  );

  it("represents the workspace root with an empty relative path", () => {
    const descriptor = root("project", "/work/project/");
    const parsed = path(descriptor, "file:///work/project");

    expect(parsed.relativePath).toBe("");
    expect(parsed.nativePath).toBe("/work/project");
  });
});
