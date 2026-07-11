import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { buildPhpCreateClassCodeAction } from "./phpCreateClassWorkspaceCodeAction";

const workspaceDescriptor: WorkspaceDescriptor = {
  javaScriptTypeScript: null,
  php: {
    classmapRoots: [],
    hasComposer: true,
    packageName: null,
    packages: [],
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
  },
  rootPath: "/workspace",
};

describe("buildPhpCreateClassCodeAction", () => {
  it("creates a class file with members inferred from the usage context", async () => {
    const source = `<?php

namespace App;

class Checkout
{
    public function run(int $userId, float $orderTotal, string $msg): void
    {
        $foo = new Foo($userId, $orderTotal);
        $foo->send($msg);
    }
}
`;
    const action = await buildPhpCreateClassCodeAction({
      readTestFileIfExists: vi.fn(async () => null),
      resolvePhpClassSourcePaths: vi.fn(async () => []),
      workspaceDescriptor,
      workspaceRoot: "/workspace",
    })(
      source,
      { end: source.indexOf("Foo") + 3, start: source.indexOf("Foo") },
      () => true,
    );

    expect(action?.newFile).toEqual({
      content: `<?php

namespace App;

class Foo
{
    public function __construct(
        private int $userId,
        private float $orderTotal,
    ) {}

    public function send(string $arg0)
    {
    }
}
`,
      path: "/workspace/app/Foo.php",
    });
  });
});
