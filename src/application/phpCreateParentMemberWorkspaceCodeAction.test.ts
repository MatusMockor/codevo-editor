import { describe, expect, it, vi } from "vitest";
import { buildPhpCreateMemberWorkspaceCodeAction } from "./phpCreateParentMemberWorkspaceCodeAction";

const PARENT_PATH = "/workspace/src/Base.php";
const PARENT_URI = "file:///workspace/src/Base.php";
const TARGET_PATH = "/workspace/src/Registry.php";
const TARGET_URI = "file:///workspace/src/Registry.php";

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

const REGISTRY_SOURCE = `<?php

namespace App;

class Registry
{
}
`;

const EXTERNAL_SOURCE = `<?php

namespace App;

class Service
{
    public function run(): void
    {
        Registry::missing();
    }
}
`;

function rangeAfter(source: string, prefix: string, name: string) {
  const start = source.indexOf(`${prefix}${name}`) + prefix.length;

  return { end: start + name.length, start };
}

function rangeAt(source: string, name: string) {
  return rangeAfter(source, "parent::", name);
}

function buildAction(
  overrides: Partial<
    Parameters<typeof buildPhpCreateMemberWorkspaceCodeAction>[0]
  > = {},
) {
  return buildPhpCreateMemberWorkspaceCodeAction({
    getOpenDocumentSyncVersion: vi.fn(() => null),
    readOpenDocumentContent: vi.fn(() => null),
    readTestFileIfExists: vi.fn(async () => PARENT_SOURCE),
    resolvePhpClassSourcePaths: vi.fn(async () => [PARENT_PATH]),
    workspaceDescriptor: null,
    workspaceRoot: "/workspace",
    ...overrides,
  });
}

describe("buildPhpCreateMemberWorkspaceCodeAction — parent targets", () => {
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
    const readTestFileIfExists = vi.fn(async () => null);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => []),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action).toBeNull();
    expect(readTestFileIfExists).toHaveBeenCalledWith("/workspace/app/Base.php");
  });

  it("falls back to Composer PSR-4 paths before the symbol index sees a new parent file", async () => {
    const readTestFileIfExists = vi.fn(async (path: string) =>
      path === PARENT_PATH ? PARENT_SOURCE : null,
    );
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => []),
      workspaceDescriptor: {
        javaScriptTypeScript: null,
        php: {
          classmapRoots: [],
          hasComposer: true,
          packageName: "app/demo",
          packages: [],
          phpPlatformVersion: null,
          phpVersionConstraint: null,
          psr4Roots: [{ dev: false, namespace: "App\\", paths: ["src/"] }],
        },
        rootPath: "/workspace",
      },
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action?.title).toBe("Create method 'helper' in 'Base'");
    expect(readTestFileIfExists).toHaveBeenCalledWith(PARENT_PATH);
    expect(action?.workspaceEdit?.changes[PARENT_URI]?.[0]?.newText).toContain(
      "protected function helper()",
    );
  });

  it("falls back to nested Composer PSR-4 paths before the symbol index sees a new parent file", async () => {
    const source = CHILD_SOURCE.replace(
      "namespace App;",
      "namespace App\\Support;",
    )
      .replace("class Child", "class QaChild");
    const parentPath = "/workspace/app/Support/Base.php";
    const readTestFileIfExists = vi.fn(async (path: string) =>
      path === parentPath
        ? PARENT_SOURCE.replace("namespace App;", "namespace App\\Support;")
        : null,
    );
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => []),
      workspaceDescriptor: {
        javaScriptTypeScript: null,
        php: {
          classmapRoots: [],
          hasComposer: true,
          packageName: "app/demo",
          packages: [],
          phpPlatformVersion: null,
          phpVersionConstraint: null,
          psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
        },
        rootPath: "/workspace",
      },
    })(source, rangeAt(source, "helper"), () => true);

    expect(action?.title).toBe("Create method 'helper' in 'Base'");
    expect(readTestFileIfExists).toHaveBeenCalledWith(parentPath);
    expect(
      action?.workspaceEdit?.changes[
        "file:///workspace/app/Support/Base.php"
      ]?.[0]?.newText,
    ).toContain("protected function helper()");
  });

  it("uses the Composer PSR-4 path when the symbol index has ambiguous parent candidates", async () => {
    const source = CHILD_SOURCE.replace(
      "namespace App;",
      "namespace App\\Support;",
    )
      .replace("class Child", "class QaChild");
    const parentPath = "/workspace/app/Support/Base.php";
    const readTestFileIfExists = vi.fn(async (path: string) =>
      path === parentPath
        ? PARENT_SOURCE.replace("namespace App;", "namespace App\\Support;")
        : null,
    );
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => [
        "/workspace/vendor/package/Base.php",
        "/workspace/legacy/Base.php",
      ]),
      workspaceDescriptor: {
        javaScriptTypeScript: null,
        php: {
          classmapRoots: [],
          hasComposer: true,
          packageName: "app/demo",
          packages: [],
          phpPlatformVersion: null,
          phpVersionConstraint: null,
          psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
        },
        rootPath: "/workspace",
      },
    })(source, rangeAt(source, "helper"), () => true);

    expect(action?.title).toBe("Create method 'helper' in 'Base'");
    expect(readTestFileIfExists).toHaveBeenCalledWith(parentPath);
  });

  it("falls back to the conventional Laravel app path when the descriptor is not ready", async () => {
    const source = CHILD_SOURCE.replace(
      "namespace App;",
      "namespace App\\Support;",
    )
      .replace("class Child", "class QaChild");
    const parentPath = "/workspace/app/Support/Base.php";
    const readTestFileIfExists = vi.fn(async (path: string) =>
      path === parentPath
        ? PARENT_SOURCE.replace("namespace App;", "namespace App\\Support;")
        : null,
    );
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => []),
      workspaceDescriptor: null,
    })(source, rangeAt(source, "helper"), () => true);

    expect(action?.title).toBe("Create method 'helper' in 'Base'");
    expect(readTestFileIfExists).toHaveBeenCalledWith(parentPath);
  });

  it("finds parent create-method usage when Monaco asks for a broad line range", async () => {
    const source = CHILD_SOURCE.replace(
      "namespace App;",
      "namespace App\\Support;",
    ).replace("class Child", "class QaChild");
    const parentPath = "/workspace/app/Support/Base.php";
    const readTestFileIfExists = vi.fn(async (path: string) =>
      path === parentPath
        ? PARENT_SOURCE.replace("namespace App;", "namespace App\\Support;")
        : null,
    );
    const lineStart = source.indexOf("        parent::helper();");
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => []),
      workspaceDescriptor: null,
    })(
      source,
      { end: source.indexOf(";", lineStart) + 1, start: lineStart },
      () => true,
    );

    expect(action?.title).toBe("Create method 'helper' in 'Base'");
    expect(readTestFileIfExists).toHaveBeenCalledWith(parentPath);
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

describe("buildPhpCreateMemberWorkspaceCodeAction — external targets", () => {
  it("offers a create-method action for an out-of-file receiver class", async () => {
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () => REGISTRY_SOURCE),
      resolvePhpClassSourcePaths,
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => true,
    );

    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith("App\\Registry");
    expect(action?.title).toBe("Create method 'missing' in 'Registry'");
    expect(action?.isPreferred).toBe(true);
    expect(action?.kind).toBe("quickfix");
    expect(Object.keys(action?.workspaceEdit?.changes ?? {})).toEqual([
      TARGET_URI,
    ]);
    expect(action?.workspaceEdit?.changes[TARGET_URI]?.[0]?.newText).toContain(
      "public static function missing()",
    );
  });

  it("offers a create-constant action for an out-of-file receiver class", async () => {
    const source = EXTERNAL_SOURCE.replace(
      "Registry::missing();",
      "$limit = Registry::MISSING;",
    );
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () => REGISTRY_SOURCE),
      resolvePhpClassSourcePaths: vi.fn(async () => [TARGET_PATH]),
    })(source, rangeAfter(source, "Registry::", "MISSING"), () => true);

    expect(action?.title).toBe("Create constant 'MISSING' in 'Registry'");
    expect(action?.workspaceEdit?.changes[TARGET_URI]?.[0]?.newText).toContain(
      "public const MISSING = null;",
    );
  });

  it("resolves an imported receiver through the use statement", async () => {
    const source = EXTERNAL_SOURCE.replace(
      "namespace App;",
      "namespace App;\n\nuse Vendor\\Registry;",
    );
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        REGISTRY_SOURCE.replace("namespace App;", "namespace Vendor;"),
      ),
      resolvePhpClassSourcePaths,
    })(source, rangeAfter(source, "Registry::", "missing"), () => true);

    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith(
      "Vendor\\Registry",
    );
    expect(action?.title).toBe("Create method 'missing' in 'Registry'");
  });

  it("returns null when the receiver class is declared in the same file", async () => {
    const source = `${REGISTRY_SOURCE}
class Service
{
    public function run(): void
    {
        Registry::missing();
    }
}
`;
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({ resolvePhpClassSourcePaths })(
      source,
      rangeAfter(source, "Registry::", "missing"),
      () => true,
    );

    expect(action).toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("returns null when the receiver class resolves to multiple source files", async () => {
    const readTestFileIfExists = vi.fn(async () => REGISTRY_SOURCE);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => [
        TARGET_PATH,
        "/workspace/legacy/Registry.php",
      ]),
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => true,
    );

    expect(action).toBeNull();
    expect(readTestFileIfExists).not.toHaveBeenCalled();
  });

  it("returns null when the target file already declares the member", async () => {
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        REGISTRY_SOURCE.replace(
          "class Registry\n{\n}",
          "class Registry\n{\n    public static function missing(): void\n    {\n    }\n}",
        ),
      ),
      resolvePhpClassSourcePaths: vi.fn(async () => [TARGET_PATH]),
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => true,
    );

    expect(action).toBeNull();
  });

  it("returns null when the root changes while resolving the receiver class", async () => {
    let active = true;
    const readTestFileIfExists = vi.fn(async () => REGISTRY_SOURCE);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => {
        active = false;
        return [TARGET_PATH];
      }),
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => active,
    );

    expect(action).toBeNull();
    expect(readTestFileIfExists).not.toHaveBeenCalled();
  });

  it("returns null when the root changes while reading the target file", async () => {
    let active = true;
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () => {
        active = false;
        return REGISTRY_SOURCE;
      }),
      resolvePhpClassSourcePaths: vi.fn(async () => [TARGET_PATH]),
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => active,
    );

    expect(action).toBeNull();
  });

  it("anchors the workspace edit to the open target document sync version", async () => {
    const action = await buildAction({
      getOpenDocumentSyncVersion: vi.fn(() => 5),
      readOpenDocumentContent: vi.fn((path: string) =>
        path === TARGET_PATH ? REGISTRY_SOURCE : null,
      ),
      resolvePhpClassSourcePaths: vi.fn(async () => [TARGET_PATH]),
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => true,
    );

    expect(action?.workspaceEdit?.documentVersions).toEqual({
      [TARGET_URI]: 5,
    });
  });
});

describe("buildPhpCreateMemberWorkspaceCodeAction — typed parameter instance targets", () => {
  const INSTANCE_SOURCE = `<?php

namespace App;

class Service
{
    public function run(Registry $registry): void
    {
        $registry->missing();
    }
}
`;

  it("offers a non-static create-method action for a typed parameter receiver", async () => {
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () => REGISTRY_SOURCE),
      resolvePhpClassSourcePaths,
    })(
      INSTANCE_SOURCE,
      rangeAfter(INSTANCE_SOURCE, "$registry->", "missing"),
      () => true,
    );

    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith("App\\Registry");
    expect(action?.title).toBe("Create method 'missing' in 'Registry'");
    expect(action?.isPreferred).toBe(true);
    expect(action?.kind).toBe("quickfix");
    const newText = action?.workspaceEdit?.changes[TARGET_URI]?.[0]?.newText;

    expect(newText).toContain("public function missing()");
    expect(newText).not.toContain("static");
  });

  it("resolves an imported parameter typehint through the use statement", async () => {
    const source = INSTANCE_SOURCE.replace(
      "namespace App;",
      "namespace App;\n\nuse Vendor\\Registry;",
    );
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        REGISTRY_SOURCE.replace("namespace App;", "namespace Vendor;"),
      ),
      resolvePhpClassSourcePaths,
    })(source, rangeAfter(source, "$registry->", "missing"), () => true);

    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith(
      "Vendor\\Registry",
    );
    expect(action?.title).toBe("Create method 'missing' in 'Registry'");
  });

  it("returns null when the target class extends another class", async () => {
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        REGISTRY_SOURCE.replace("class Registry", "class Registry extends Base"),
      ),
      resolvePhpClassSourcePaths: vi.fn(async () => [TARGET_PATH]),
    })(
      INSTANCE_SOURCE,
      rangeAfter(INSTANCE_SOURCE, "$registry->", "missing"),
      () => true,
    );

    expect(action).toBeNull();
  });

  it("returns null when the target class declares __call", async () => {
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () =>
        REGISTRY_SOURCE.replace(
          "class Registry\n{\n}",
          "class Registry\n{\n    public function __call($name, $arguments)\n    {\n    }\n}",
        ),
      ),
      resolvePhpClassSourcePaths: vi.fn(async () => [TARGET_PATH]),
    })(
      INSTANCE_SOURCE,
      rangeAfter(INSTANCE_SOURCE, "$registry->", "missing"),
      () => true,
    );

    expect(action).toBeNull();
  });

  it("returns null for a parameter typehint under a vendor PSR-4 namespace", async () => {
    const source = INSTANCE_SOURCE.replace(
      "namespace App;",
      "namespace App;\n\nuse Illuminate\\Support\\Registry;",
    );
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({ resolvePhpClassSourcePaths })(
      source,
      rangeAfter(source, "$registry->", "missing"),
      () => true,
    );

    expect(action).toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("returns null when the target resolves into the vendor directory for an instance receiver", async () => {
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () => REGISTRY_SOURCE),
      resolvePhpClassSourcePaths: vi.fn(async () => [
        "/workspace/vendor/acme/src/Registry.php",
      ]),
    })(
      INSTANCE_SOURCE,
      rangeAfter(INSTANCE_SOURCE, "$registry->", "missing"),
      () => true,
    );

    expect(action).toBeNull();
  });
});

describe("buildPhpCreateMemberWorkspaceCodeAction — workspace containment", () => {
  it("returns null when the target resolves into the vendor directory", async () => {
    const readTestFileIfExists = vi.fn(async () => REGISTRY_SOURCE);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => [
        "/workspace/vendor/acme/registry/src/Registry.php",
      ]),
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => true,
    );

    expect(action).toBeNull();
    expect(readTestFileIfExists).not.toHaveBeenCalled();
  });

  it("returns null when the target resolves outside the workspace root", async () => {
    const readTestFileIfExists = vi.fn(async () => REGISTRY_SOURCE);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => [
        "/elsewhere/src/Registry.php",
      ]),
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => true,
    );

    expect(action).toBeNull();
    expect(readTestFileIfExists).not.toHaveBeenCalled();
  });

  it("returns null for a receiver resolving into a vendor PSR-4 namespace", async () => {
    const source = EXTERNAL_SOURCE.replace(
      "namespace App;",
      "namespace App;\n\nuse Illuminate\\Support\\Facades\\Auth;",
    ).replace("Registry::missing();", "Auth::missin();");
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({ resolvePhpClassSourcePaths })(
      source,
      rangeAfter(source, "Auth::", "missin"),
      () => true,
    );

    expect(action).toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("returns null when the parent class resolves into the vendor directory", async () => {
    const readTestFileIfExists = vi.fn(async () => PARENT_SOURCE);
    const action = await buildAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths: vi.fn(async () => [
        "/workspace/vendor/acme/base/src/Base.php",
      ]),
    })(CHILD_SOURCE, rangeAt(CHILD_SOURCE, "helper"), () => true);

    expect(action).toBeNull();
    expect(readTestFileIfExists).not.toHaveBeenCalled();
  });

  it("returns null for a parent extending a vendor PSR-4 namespace", async () => {
    const source = CHILD_SOURCE.replace(
      "extends Base",
      "extends \\Illuminate\\Database\\Eloquent\\Model",
    );
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({ resolvePhpClassSourcePaths })(
      source,
      rangeAt(source, "helper"),
      () => true,
    );

    expect(action).toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("returns null when no workspace root is available", async () => {
    const resolvePhpClassSourcePaths = vi.fn(async () => [TARGET_PATH]);
    const action = await buildAction({
      resolvePhpClassSourcePaths,
      workspaceRoot: null,
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => true,
    );

    expect(action).toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("still offers for an in-root target under a trailing-slash workspace root", async () => {
    const action = await buildAction({
      readTestFileIfExists: vi.fn(async () => REGISTRY_SOURCE),
      resolvePhpClassSourcePaths: vi.fn(async () => [TARGET_PATH]),
      workspaceRoot: "/workspace/",
    })(
      EXTERNAL_SOURCE,
      rangeAfter(EXTERNAL_SOURCE, "Registry::", "missing"),
      () => true,
    );

    expect(action?.title).toBe("Create method 'missing' in 'Registry'");
  });
});
