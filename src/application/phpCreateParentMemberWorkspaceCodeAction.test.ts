import { describe, expect, it, vi } from "vitest";
import { buildPhpCreateParentMemberWorkspaceCodeAction } from "./phpCreateParentMemberWorkspaceCodeAction";

const PARENT_PATH = "/workspace/src/Base.php";
const PARENT_URI = "file:///workspace/src/Base.php";

const PARENT_SOURCE = `<?php

namespace App;

class Base
{
    public function existing(): void
    {
    }
}
`;

const CHILD_SOURCE = `<?php

namespace App;

class Child extends Base
{
    public function run(): void
    {
        parent::helper();
    }
}
`;

function rangeAt(source: string, name: string) {
  const start = source.indexOf(`parent::${name}`) + "parent::".length;

  return { end: start + name.length, start };
}

function buildAction(
  overrides: Partial<
    Parameters<typeof buildPhpCreateParentMemberWorkspaceCodeAction>[0]
  > = {},
) {
  return buildPhpCreateParentMemberWorkspaceCodeAction({
    getOpenDocumentSyncVersion: vi.fn(() => null),
    readOpenDocumentContent: vi.fn(() => null),
    readTestFileIfExists: vi.fn(async () => PARENT_SOURCE),
    resolvePhpClassSourcePaths: vi.fn(async () => [PARENT_PATH]),
    ...overrides,
  });
}

describe("buildPhpCreateParentMemberWorkspaceCodeAction", () => {
  it("offers a create-method action targeting the parent file", async () => {
    const resolvePhpClassSourcePaths = vi.fn(async () => [PARENT_PATH]);
    const action = await buildAction({ resolvePhpClassSourcePaths })(
      CHILD_SOURCE,
      rangeAt(CHILD_SOURCE, "helper"),
      () => true,
    );

    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith("App\\Base");
    expect(action?.title).toBe("Create method 'helper' in 'Base'");
    expect(action?.edits).toEqual([]);
    expect(action?.isPreferred).toBe(true);
    expect(action?.kind).toBe("quickfix");
    expect(Object.keys(action?.workspaceEdit?.changes ?? {})).toEqual([
      PARENT_URI,
    ]);
    expect(action?.workspaceEdit?.changes[PARENT_URI]?.[0]?.newText).toContain(
      "protected function helper()",
    );
  });

  it("offers a create-constant action targeting the parent file", async () => {
    const source = CHILD_SOURCE.replace(
      "parent::helper();",
      "$retries = parent::RETRIES;",
    );
    const action = await buildAction()(
      source,
      rangeAt(source, "RETRIES"),
      () => true,
    );

    expect(action?.title).toBe("Create constant 'RETRIES' in 'Base'");
    expect(action?.workspaceEdit?.changes[PARENT_URI]?.[0]?.newText).toContain(
      "protected const RETRIES = null;",
    );
  });

  it("resolves a qualified extends token against the enclosing namespace", async () => {
    const source = CHILD_SOURCE.replace(
      "extends Base",
      "extends Legacy\\Base",
    );
    const resolvePhpClassSourcePaths = vi.fn(async () => [PARENT_PATH]);
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        PARENT_SOURCE.replace("namespace App;", "namespace App\\Legacy;"),
      ),
      resolvePhpClassSourcePaths,
    })(source, rangeAt(source, "helper"), () => true);

    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith(
      "App\\Legacy\\Base",
    );
    expect(action?.title).toBe("Create method 'helper' in 'Base'");
  });

  it("resolves a leading-backslash extends token as fully qualified", async () => {
    const source = CHILD_SOURCE.replace(
      "extends Base",
      "extends \\Legacy\\Base",
    );
    const resolvePhpClassSourcePaths = vi.fn(async () => [PARENT_PATH]);
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        PARENT_SOURCE.replace("namespace App;", "namespace Legacy;"),
      ),
      resolvePhpClassSourcePaths,
    })(source, rangeAt(source, "helper"), () => true);

    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith("Legacy\\Base");
    expect(action?.title).toBe("Create method 'helper' in 'Base'");
  });

  it("resolves a use-aliased extends token through the import", async () => {
    const source = CHILD_SOURCE.replace(
      "namespace App;",
      "namespace App;\n\nuse Legacy\\Base as LegacyBase;",
    ).replace("extends Base", "extends LegacyBase");
    const resolvePhpClassSourcePaths = vi.fn(async () => [PARENT_PATH]);
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        PARENT_SOURCE.replace("namespace App;", "namespace Legacy;"),
      ),
      resolvePhpClassSourcePaths,
    })(source, rangeAt(source, "helper"), () => true);

    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith("Legacy\\Base");
    expect(action?.title).toBe("Create method 'helper' in 'Base'");
  });

  it("computes the edit from the open document content when the parent file is open", async () => {
    const openParentSource = PARENT_SOURCE.replace(
      "    public function existing(): void\n    {\n    }\n",
      "    public function existing(): void\n    {\n    }\n\n    public function draft(): void\n    {\n    }\n",
    );
    const readTestFileIfExists = vi.fn(async () => PARENT_SOURCE);
    const action = await buildAction({
      readOpenDocumentContent: vi.fn((path: string) =>
        path === PARENT_PATH ? openParentSource : null,
      ),
      readTestFileIfExists,
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(readTestFileIfExists).not.toHaveBeenCalled();
    expect(
      action?.workspaceEdit?.changes[PARENT_URI]?.[0]?.range.start.line,
    ).toBe(13);
  });

  it("falls back to the disk content when the parent file is not open", async () => {
    const readTestFileIfExists = vi.fn(async () => PARENT_SOURCE);
    const action = await buildAction({
      readOpenDocumentContent: vi.fn(() => null),
      readTestFileIfExists,
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(readTestFileIfExists).toHaveBeenCalledWith(PARENT_PATH);
    expect(
      action?.workspaceEdit?.changes[PARENT_URI]?.[0]?.range.start.line,
    ).toBe(9);
    expect(action?.workspaceEdit?.documentVersions).toBeUndefined();
  });

  it("anchors the workspace edit to the open document sync version", async () => {
    const action = await buildAction({
      getOpenDocumentSyncVersion: vi.fn(() => 7),
      readOpenDocumentContent: vi.fn(() => PARENT_SOURCE),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action?.workspaceEdit?.documentVersions).toEqual({
      [PARENT_URI]: 7,
    });
  });

  it("omits version anchoring when the open document has no sync version", async () => {
    const action = await buildAction({
      getOpenDocumentSyncVersion: vi.fn(() => null),
      readOpenDocumentContent: vi.fn(() => PARENT_SOURCE),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action?.workspaceEdit?.documentVersions).toBeUndefined();
  });

  it("does not look up a sync version for a disk-sourced parent", async () => {
    const getOpenDocumentSyncVersion = vi.fn(() => 3);
    const action = await buildAction({ getOpenDocumentSyncVersion })(
      CHILD_SOURCE,
      rangeAt(CHILD_SOURCE, "helper"),
      () => true,
    );

    expect(getOpenDocumentSyncVersion).not.toHaveBeenCalled();
    expect(action?.workspaceEdit?.documentVersions).toBeUndefined();
  });

  it("returns null when the class resolver finds no source file", async () => {
    const readTestFileIfExists = vi.fn(async () => PARENT_SOURCE);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => []),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action).toBeNull();
    expect(readTestFileIfExists).not.toHaveBeenCalled();
  });

  it("returns null when the class resolver finds multiple source files", async () => {
    const readTestFileIfExists = vi.fn(async () => PARENT_SOURCE);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => [
        PARENT_PATH,
        "/workspace/legacy/Base.php",
      ]),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action).toBeNull();
    expect(readTestFileIfExists).not.toHaveBeenCalled();
  });

  it("returns null when the parent file cannot be read", async () => {
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () => null),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action).toBeNull();
  });

  it("returns null when the parent file already declares the member", async () => {
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        PARENT_SOURCE.replace("function existing", "function helper"),
      ),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action).toBeNull();
  });

  it("returns null when the parent file namespace does not match", async () => {
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        PARENT_SOURCE.replace("namespace App;", "namespace Domain;"),
      ),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action).toBeNull();
  });

  it("returns null when the parent class is declared in the same file", async () => {
    const source = `${PARENT_SOURCE}
class Child extends Base
{
    public function run(): void
    {
        parent::helper();
    }
}
`;
    const resolvePhpClassSourcePaths = vi.fn(async () => [PARENT_PATH]);
    const action = await buildAction({ resolvePhpClassSourcePaths })(
      source,
      rangeAt(source, "helper"),
      () => true,
    );

    expect(action).toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("returns null when the usage does not target the parent class", async () => {
    const source = CHILD_SOURCE.replace("parent::helper", "$this->helper");
    const start = source.indexOf("$this->helper") + "$this->".length;
    const resolvePhpClassSourcePaths = vi.fn(async () => [PARENT_PATH]);
    const action = await buildAction({ resolvePhpClassSourcePaths })(
      source,
      { end: start + "helper".length, start },
      () => true,
    );

    expect(action).toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("returns null when the root changes while resolving the parent path", async () => {
    let active = true;
    const readTestFileIfExists = vi.fn(async () => PARENT_SOURCE);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => {
        active = false;
        return [PARENT_PATH];
      }),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => active);

    expect(action).toBeNull();
    expect(readTestFileIfExists).not.toHaveBeenCalled();
  });

  it("returns null when the root changes while reading the parent file", async () => {
    let active = true;
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () => {
        active = false;
        return PARENT_SOURCE;
      }),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => active);

    expect(action).toBeNull();
  });
});
