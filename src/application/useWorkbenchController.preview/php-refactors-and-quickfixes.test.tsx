// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  applyPhpDescriptorEdits,
  createDeferred,
  defaultAppSettings,
  describe,
  expect,
  expectBalancedPhp,
  fileEntry,
  flushAsyncTurns,
  it,
  phpWorkspaceDescriptor,
  type ProjectSymbolSearchGateway,
  setupWorkbenchControllerTestHarness,
  vi,
  waitForReact,
  type WorkbenchController,
} from "./testSupport";

describe("useWorkbenchController workspace sessions and PHP code actions", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();
  it("offers a generate constructor action for a class with properties and no constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    private int $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const constructorAction = actions.find((action) => action.title === "Generate constructor");
    expect(constructorAction).toBeDefined();
    const constructorText = constructorAction?.edits[0]?.text ?? "";
    expect(constructorText).toContain("public function __construct(string $name, int $balance)");
    expect(constructorText).toContain("$this->name = $name;");
    expect(constructorText).toContain("$this->balance = $balance;");
  });
  it("moves declared properties into a genuinely promoted constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    private int $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const classicAction = actions.find((action) => action.title === "Generate constructor");
    expect(classicAction).toBeDefined();

    const promotedAction = actions.find(
      (action) => action.title === "Generate constructor with promotion",
    );
    expect(promotedAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, promotedAction!)).toBe(`<?php

namespace App\\Models;

class Account
{

    public function __construct(
        private string $name,
        private int $balance,
    ) {}
}
`);
  });
  it("offers no promoted constructor action when the class already has a constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Generate constructor with promotion")).toBe(
      false,
    );
  });
  it("offers no generate constructor action when the class already has a constructor", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

class Account
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Generate constructor")).toBe(false);
  });
  it("offers Generate PHPDoc when the cursor sits on an undocumented method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name, int $count): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();

    const edit = phpDocAction?.edits[0];
    const text = edit?.text ?? "";
    expect(text).toContain("    /**");
    expect(text).toContain("     * @param string $name");
    expect(text).toContain("     * @param int $count");
    expect(text).toContain("     * @return bool");

    // Inserted at the start of the declaration line (zero-length edit) so the
    // docblock sits directly above the method.
    const declarationLineNumber = classSource
      .slice(0, classSource.indexOf("public function greet"))
      .split("\n").length;
    expect(edit?.range.startColumn).toBe(1);
    expect(edit?.range.endColumn).toBe(1);
    expect(edit?.range.startLineNumber).toBe(declarationLineNumber);
    expect(edit?.range.endLineNumber).toBe(declarationLineNumber);
  });
  it("does not offer Generate PHPDoc on a method that already has a docblock", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    /**
     * @param string $name
     * @return bool
     */
    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("does not offer Generate PHPDoc when the cursor is not on any method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("offers Generate PHPDoc when the cursor sits on a method's leading attribute", async () => {
    const classPath = "/workspace/app/Http/Controllers/UserController.php";
    const classSource = `<?php

namespace App\\Http\\Controllers;

class UserController
{
    #[Route('/users/{id}')]
    public function show(int $id): string
    {
        return (string) $id;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "UserController.php"));
    });

    // Cursor parked on the `#[Route(...)]` attribute line above the method.
    const offset = classSource.indexOf("Route('/users");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();
    expect(phpDocAction?.edits[0]?.text).toContain(" * @param int $id");

    // The docblock is still inserted above the `function` line (below the
    // attribute), not above the attribute line.
    const declarationLineNumber = classSource
      .slice(0, classSource.indexOf("public function show"))
      .split("\n").length;
    expect(phpDocAction?.edits[0]?.range.startLineNumber).toBe(declarationLineNumber);
  });
  it("offers Generate PHPDoc when the cursor sits on a method's modifier line", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function first(): int
    {
        return 1;
    }

    public function greet(string $name): bool
    {
        return true;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    // Cursor on the `public` modifier of `greet`, before its `function` keyword.
    const offset = classSource.indexOf("public function greet");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const phpDocAction = actions.find((action) => action.title === "Generate PHPDoc");
    expect(phpDocAction).toBeDefined();
    // Resolves to `greet`, not the preceding `first` method.
    expect(phpDocAction?.edits[0]?.text).toContain(" * @param string $name");
    expect(phpDocAction?.edits[0]?.text).toContain(" * @return bool");
  });
  it("does not offer Generate PHPDoc when the docblock would be empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function boot(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    // A no-parameter `void` method would produce a docblock with neither
    // `@param` nor `@return`; PhpStorm offers nothing here, so neither do we.
    const offset = classSource.indexOf("boot(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Generate PHPDoc")).toBe(false);
  });
  it("offers an Add parameter code action that appends an optional parameter to a method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): string
    {
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("greet(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addParameterAction = actions.find((action) => action.title === "Add parameter");
    expect(addParameterAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addParameterAction!)).toBe(`<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name, $parameter = null): string
    {
        return $name;
    }
}
`);
  });
  it("offers an Add parameter code action on a free function with the cursor in its body", async () => {
    const filePath = "/workspace/app/helpers.php";
    const fileSource = `<?php

function add(int $a, int $b): int
{
    return $a + $b;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "helpers.php"));
    });

    const offset = fileSource.indexOf("return $a");
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    const addParameterAction = actions.find((action) => action.title === "Add parameter");
    expect(addParameterAction).toBeDefined();
    expect(applyPhpDescriptorEdits(fileSource, addParameterAction!)).toBe(`<?php

function add(int $a, int $b, $parameter = null): int
{
    return $a + $b;
}
`);
  });
  it("does not offer Add parameter on an abstract method declaration", async () => {
    const classPath = "/workspace/app/Contracts/Base.php";
    const classSource = `<?php

namespace App\\Contracts;

abstract class Base
{
    abstract public function handle(string $name): void;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Base.php"));
    });

    const offset = classSource.indexOf("handle(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add parameter")).toBe(false);
  });
  it("does not offer Add parameter when the cursor is not on any function", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add parameter")).toBe(false);
  });
  it("offers Add return type using the method's PHPDoc @return", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    /**
     * @return Foo
     */
    public function make()
    {
        return $this->foo;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addReturnTypeAction!)).toContain(
      "public function make(): Foo",
    );
  });
  it("offers Add return type as void on a free function with no return value", async () => {
    const filePath = "/workspace/app/helpers.php";
    const fileSource = `<?php

function log_message($message)
{
    error_log($message);
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "helpers.php"));
    });

    const offset = fileSource.indexOf("error_log");
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(fileSource, addReturnTypeAction!)).toContain(
      "function log_message($message): void",
    );
  });
  it("offers Add return type before the semicolon on an abstract method", async () => {
    const classPath = "/workspace/app/Contracts/Maker.php";
    const classSource = `<?php

namespace App\\Contracts;

abstract class Maker
{
    /**
     * @return Foo
     */
    abstract public function make();
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addReturnTypeAction = actions.find((action) => action.title === "Add return type");
    expect(addReturnTypeAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addReturnTypeAction!)).toContain(
      "abstract public function make(): Foo;",
    );
  });
  it("does not offer Add return type when the method already declares one", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    public function make(): Foo
    {
        return new Foo();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("make(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add return type")).toBe(false);
  });
  it("does not offer Add return type when returns mix types", async () => {
    const classPath = "/workspace/app/Services/Maker.php";
    const classSource = `<?php

namespace App\\Services;

class Maker
{
    public function maybe($flag)
    {
        if ($flag) {
            return 'x';
        }

        return 123;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Maker.php"));
    });

    const offset = classSource.indexOf("maybe(");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add return type")).toBe(false);
  });
  it("offers Add type hint using the parameter's PHPDoc @param", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    /**
     * @param Foo $foo
     */
    public function set($foo)
    {
        $this->foo = $foo;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo)");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addTypeHintAction = actions.find((action) => action.title === "Add type hint");
    expect(addTypeHintAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addTypeHintAction!)).toContain(
      "public function set(Foo $foo)",
    );
  });
  it("offers Add type hint as array from an empty-array default", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set($items = [])
    {
        $this->items = $items;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$items");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const addTypeHintAction = actions.find((action) => action.title === "Add type hint");
    expect(addTypeHintAction).toBeDefined();
    expect(applyPhpDescriptorEdits(classSource, addTypeHintAction!)).toContain(
      "public function set(array $items = [])",
    );
  });
  it("does not offer Add type hint for a `= null` default", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set($foo = null)
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add type hint")).toBe(false);
  });
  it("does not offer Add type hint when the parameter already has a type", async () => {
    const classPath = "/workspace/app/Services/Setter.php";
    const classSource = `<?php

namespace App\\Services;

class Setter
{
    public function set(Foo $foo)
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Setter.php"));
    });

    const offset = classSource.indexOf("$foo");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Add type hint")).toBe(false);
  });
  it("offers an optimize imports action when an import is unused", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;
use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const optimizeAction = actions.find((action) => action.title === "Optimize imports");
    expect(optimizeAction).toBeDefined();
    const optimizeText = optimizeAction?.edits[0]?.text ?? "";
    expect(optimizeText).toContain("use App\\Support\\Money;");
    expect(optimizeText).not.toContain("Unused");
  });
  it("offers no optimize imports action when imports are already clean", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Optimize imports")).toBe(false);
  });
  it("does not offer optimize imports when a comment sits between use statements", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;
// keep this note about Money
use App\\Support\\Money;

class Account
{
    private Money $balance;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    expect(actions.some((action) => action.title === "Optimize imports")).toBe(false);
  });
  it("replaces the use block with an empty string when every import is unused", async () => {
    const classPath = "/workspace/app/Models/Account.php";
    const classSource = `<?php

namespace App\\Models;

use App\\Support\\Unused;

class Account
{
    private string $name;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === classPath) {
          return classSource;
        }

        return `<?php\n// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Account.php"));
    });

    const actions = await getWorkbench().providePhpCodeActions(classSource);

    const optimizeAction = actions.find((action) => action.title === "Optimize imports");
    expect(optimizeAction).toBeDefined();
    const optimizeEdit = optimizeAction?.edits[0];
    expect(optimizeEdit?.text).toBe("");
    expect(optimizeEdit?.range.startLineNumber).toBe(5);
    expect(optimizeEdit?.range.endLineNumber).toBe(5);
  });
  it("offers an Import class action for an unimported class found in the index", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

use App\\Models\\Comment;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(dependencies.workspaceGateways.projectSymbols.searchProjectSymbols).toHaveBeenCalledWith(
      "/workspace",
      "Post",
      25,
    );
    const importAction = actions.find((action) => action.title === "Import App\\Models\\Post");
    expect(importAction).toBeDefined();
    const importEdit = importAction?.edits[0];
    expect(importEdit?.text).toBe("use App\\Models\\Post;\n");
    // Inserted before the alphabetically-later `use App\\Models\\Comment;`? No:
    // Post sorts after Comment, so it lands on the line AFTER Comment (line 6).
    expect(importEdit?.range.startColumn).toBe(1);
    expect(importEdit?.range.endColumn).toBe(1);
    expect(importEdit?.range.startLineNumber).toBe(6);
    expect(importEdit?.range.endLineNumber).toBe(6);
  });
  it("offers one Import action per candidate namespace for an ambiguous class", async () => {
    const classPath = "/workspace/app/Http/UserController.php";
    const classSource = `<?php

namespace App\\Http;

class UserController
{
    public function show(): User
    {
        return new User();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\User",
        kind: "class",
        lineNumber: 5,
        name: "User",
        path: "/workspace/app/Models/User.php",
        relativePath: "app/Models/User.php",
      },
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Support\\User",
        kind: "class",
        lineNumber: 9,
        name: "User",
        path: "/workspace/app/Support/User.php",
        relativePath: "app/Support/User.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "UserController.php"));
    });

    const offset = classSource.indexOf("User", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const importTitles = actions
      .map((action) => action.title)
      .filter((title) => title.startsWith("Import "));
    expect(importTitles).toEqual(["Import App\\Models\\User", "Import App\\Support\\User"]);
  });
  it("does not offer an Import action when the class is already imported", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

use App\\Models\\Post;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("does not offer an Import action when the only candidate is in the current namespace", async () => {
    const classPath = "/workspace/app/Models/PostController.php";
    const classSource = `<?php

namespace App\\Models;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("does not offer an Import action when no candidate exists in the index", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Import "))).toBe(false);
  });
  it("drops stale Import class actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const symbolSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => symbolSearch.promise);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource, {
        end: offset,
        start: offset,
      });
      await Promise.resolve();
    });
    await waitForReact(() => {
      // The Create-class existence probe (limit 50) and/or the Import-class
      // lookup (limit 25) both query the symbol index for the short name; either
      // confirms the in-flight search started before we switch tabs.
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith("/workspace-a", "Post", expect.any(Number));
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    symbolSearch.resolve([
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace-a/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
  it("drops stale generate-constructor code actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Greeter.php";
    const interfacePath = "/workspace-a/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
    private string $name;
}
`;
    const interfaceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === interfacePath) {
        return interfaceRead.promise;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(interfacePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    interfaceRead.resolve(`<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(string $name): string;
}
`);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
  it("offers a create-method code action when the cursor is on a missing $this method", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork(1, 'x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'doWork'");
    expect(createMethod).toBeDefined();
    const stubText = createMethod?.edits[0]?.text ?? "";
    expect(stubText).toContain("private function doWork(int $arg0, string $arg1)");
  });
  it("offers a create-property code action when the cursor is on a missing $this property", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        echo $this->status;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("status");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createProperty = actions.find((action) => action.title === "Create property 'status'");
    expect(createProperty).toBeDefined();
    expect(createProperty?.edits[0]?.text ?? "").toContain("private $status;");
  });
  it("offers no create-method action when the $this method already exists", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork();
    }

    private function doWork(): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("marks Create method as the preferred quickfix on an unresolved member", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $this->doWork(1, 'x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("doWork");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'doWork'");
    // PhpStorm Alt+Enter: the contextual fix for the unresolved member is the
    // single most-likely action - a "quickfix" lightbulb, flagged preferred so
    // Monaco floats it to the top of the list.
    expect(createMethod?.kind).toBe("quickfix");
    expect(createMethod?.isPreferred).toBe(true);
    // And it leads the returned list (ordering = "most likely first").
    expect(actions[0]?.title).toBe("Create method 'doWork'");
  });
  it("offers a static create-method action when the cursor is on a missing self:: call", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): void
    {
        self::make('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("make");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find((action) => action.title === "Create method 'make'");
    expect(createMethod).toBeDefined();
    expect(createMethod?.edits[0]?.text ?? "").toContain(
      "private static function make(string $arg0)",
    );
  });
  it("offers a create-constant action when the cursor is on a missing self::CONST", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): string
    {
        return self::DEFAULT_NAME;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("DEFAULT_NAME");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createConstant = actions.find(
      (action) => action.title === "Create constant 'DEFAULT_NAME'",
    );
    expect(createConstant).toBeDefined();
    expect(createConstant?.edits[0]?.text ?? "").toContain("private const DEFAULT_NAME = null;");
  });
  it("infers the property type from a typed $this assignment", async () => {
    const classPath = "/workspace/app/Services/Factory.php";
    const classSource = `<?php

namespace App\\Services;

class Factory
{
    public function run(): void
    {
        $this->client = new HttpClient();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Factory.php"));
    });

    const offset = classSource.indexOf("client");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createProperty = actions.find((action) => action.title === "Create property 'client'");
    expect(createProperty).toBeDefined();
    expect(createProperty?.edits[0]?.text ?? "").toContain("private HttpClient $client;");
  });
  it("offers a same-file parent:: create-method action targeting the parent class", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
}

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createMethod = actions.find(
      (action) => action.title === "Create method 'handle' in 'Base'",
    );
    expect(createMethod).toBeDefined();
    const insertOffset = classSource.split("\n").slice(0, 6).join("\n").length + 1;
    // The edit lands inside Base's body (before Child), not at the end of file.
    const editLine = createMethod?.edits[0]?.range.startLineNumber ?? 0;
    expect(editLine).toBeLessThan(
      classSource.slice(0, classSource.indexOf("class Child")).split("\n").length,
    );
    expect(insertOffset).toBeGreaterThan(0);
  });
  it("does not offer a parent:: action when the same-file parent already has the method", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
    public function handle(string $value): void
    {
    }
}

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("offers a parent::CONST create-constant action targeting the same-file parent", async () => {
    const classPath = "/workspace/app/Services/Pair.php";
    const classSource = `<?php

namespace App\\Services;

class Base
{
}

class Child extends Base
{
    public function run(): string
    {
        return parent::DEFAULT_LABEL;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Pair.php"));
    });

    const offset = classSource.indexOf("parent::DEFAULT_LABEL") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createConstant = actions.find(
      (action) => action.title === "Create constant 'DEFAULT_LABEL' in 'Base'",
    );
    expect(createConstant).toBeDefined();
    const editText = createConstant?.edits[0]?.text ?? "";
    expect(editText).toContain("protected const DEFAULT_LABEL = null;");
    expect(editText).not.toContain("private const DEFAULT_LABEL = null;");
  });
  it("does not offer a parent:: action when the parent lives in another file", async () => {
    const classPath = "/workspace/app/Services/Child.php";
    const classSource = `<?php

namespace App\\Services;

class Child extends Base
{
    public function run(): void
    {
        parent::handle('x');
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Child.php"));
    });

    const offset = classSource.indexOf("parent::handle") + "parent::".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title.startsWith("Create method"))).toBe(false);
  });
  it("tags an Import class action as a preferred quickfix", async () => {
    const classPath = "/workspace/app/Http/PostController.php";
    const classSource = `<?php

namespace App\\Http;

class PostController
{
    public function show(): Post
    {
        return new Post();
    }
}
`;
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementation(async () => [
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "App\\Models\\Post",
        kind: "class",
        lineNumber: 5,
        name: "Post",
        path: "/workspace/app/Models/Post.php",
        relativePath: "app/Models/Post.php",
      },
    ]);
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "PostController.php"));
    });

    const offset = classSource.indexOf("Post", classSource.indexOf("show()"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const importAction = actions.find((action) => action.title === "Import App\\Models\\Post");
    expect(importAction?.kind).toBe("quickfix");
    expect(importAction?.isPreferred).toBe(true);
  });
  it("classifies Generate constructor as a generate-family refactor (not a quickfix)", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    private string $name;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const constructor = actions.find((action) => action.title === "Generate constructor");
    // Generate-family actions read as "refactor" in the action widget (distinct
    // icon/group from the quickfix lightbulb), matching PhpStorm's Generate menu.
    expect(constructor?.kind).toBe("refactor.rewrite");
    expect(constructor?.isPreferred).not.toBe(true);

    const accessors = actions.find((action) => action.title === "Generate getters and setters");
    expect(accessors?.kind).toBe("refactor.rewrite");
  });
  it("tags Optimize imports with the organize-imports source kind", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Models\\Unused;
use App\\Models\\Apple;

class Greeter
{
    public function run(Apple $apple): void
    {
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("class Greeter");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const optimize = actions.find((action) => action.title === "Optimize imports");
    expect(optimize?.kind).toBe("source.organizeImports");
  });
  it("orders the contextual quickfix ahead of generate-family refactors", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    // The cursor sits on an unresolved `$this->status`, so the contextual fix
    // (Create property) must lead - ahead of the class-level generate actions
    // (constructor / accessors) that are also offered for the same class.
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    private string $name;

    public function run(): void
    {
        echo $this->status;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("status");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const createIndex = actions.findIndex((action) => action.title === "Create property 'status'");
    const constructorIndex = actions.findIndex((action) => action.title === "Generate constructor");
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(constructorIndex).toBeGreaterThanOrEqual(0);
    // Quickfix before generate-family refactor (PhpStorm "most likely first").
    expect(createIndex).toBeLessThan(constructorIndex);
    expect(actions[createIndex]?.isPreferred).toBe(true);
  });
  it("orders free-function refactors by kind family (extract before rewrite)", async () => {
    const classPath = "/workspace/app/helpers.php";
    // A free function (no enclosing class) with a selected expression (so
    // Extract variable - refactor.extract is offered) and no declared return
    // type but a literal return (so Add return type - refactor.rewrite fires).
    const classSource = `<?php

function total()
{
    return 42;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "helpers.php"));
    });

    const exprStart = classSource.indexOf("42");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: exprStart + "42".length,
      start: exprStart,
    });

    const extractIndex = actions.findIndex((action) => action.title === "Extract variable");
    const returnTypeIndex = actions.findIndex((action) => action.title === "Add return type");
    expect(extractIndex).toBeGreaterThanOrEqual(0);
    expect(returnTypeIndex).toBeGreaterThanOrEqual(0);
    // refactor.extract sorts ahead of refactor.rewrite even in a free function.
    expect(extractIndex).toBeLessThan(returnTypeIndex);
  });
  it("offers an extract-variable code action for a selected expression", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): int
    {
        return price() + tax();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const start = classSource.indexOf("price()");
    const end = classSource.indexOf("tax()") + "tax()".length;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract variable");
    expect(extract).toBeDefined();
    expect(extract?.edits).toHaveLength(2);
    const declaration = extract?.edits.find((edit) =>
      edit.text.includes("$extracted = price() + tax();"),
    );
    expect(declaration).toBeDefined();
    const replacement = extract?.edits.find((edit) => edit.text === "$extracted");
    expect(replacement).toBeDefined();
  });
  it("offers no extract-variable action when the selection is empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): int
    {
        return price() + tax();
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("price()");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Extract variable")).toBe(false);
  });
  it("offers an inline-variable code action when the cursor is on a single-assignment local", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): string
    {
        $name = $user->name;
        echo $name;
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$name");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const inline = actions.find((action) => action.title === "Inline variable");
    expect(inline).toBeDefined();
    // Declaration deletion plus one replacement per usage.
    expect(inline?.edits).toHaveLength(3);
    const deletion = inline?.edits.find((edit) => edit.text === "");
    expect(deletion).toBeDefined();
    expect(inline?.edits.every((edit) => edit.text === "" || edit.text === "$user->name")).toBe(
      true,
    );
  });
  it("offers no inline-variable action when the local is reassigned", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): string
    {
        $name = $a;
        $name = $b;
        return $name;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$name");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Inline variable")).toBe(false);
  });
  it("offers an introduce-constant code action when the cursor is on a literal", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const introduce = actions.find((action) => action.title === "Introduce constant");
    expect(introduce).toBeDefined();
    expect(introduce?.edits).toHaveLength(2);
    const declaration = introduce?.edits.find((edit) =>
      edit.text.includes("private const HELLO_WORLD = 'Hello world';"),
    );
    expect(declaration).toBeDefined();
    const replacement = introduce?.edits.find((edit) => edit.text === "self::HELLO_WORLD");
    expect(replacement).toBeDefined();
  });
  it("offers an introduce-field code action when the cursor is on a literal", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    const introduce = actions.find((action) => action.title === "Introduce field");
    expect(introduce).toBeDefined();
    expect(introduce?.edits).toHaveLength(2);
    const declaration = introduce?.edits.find((edit) =>
      edit.text.includes("private string $helloWorld = 'Hello world';"),
    );
    expect(declaration).toBeDefined();
    const replacement = introduce?.edits.find((edit) => edit.text === "$this->helloWorld");
    expect(replacement).toBeDefined();
  });
  it("offers no introduce-constant or introduce-field action outside a class", async () => {
    const filePath = "/workspace/script.php";
    const fileSource = `<?php

$greeting = 'Hello world';
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === filePath ? fileSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(filePath, "script.php"));
    });

    const offset = fileSource.indexOf("'Hello world'") + 2;
    const actions = await getWorkbench().providePhpCodeActions(fileSource, {
      end: offset,
      start: offset,
    });

    expect(
      actions.some(
        (action) => action.title === "Introduce constant" || action.title === "Introduce field",
      ),
    ).toBe(false);
  });
  it("offers an extract-method code action for a whole-statement selection", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(int $seed): void
    {
        $base = $seed * 2;
        $total = $base + 10;
        echo $total;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const start = classSource.lastIndexOf("\n", classSource.indexOf("$total = $base")) + 1;
    const end = classSource.indexOf("\n", classSource.indexOf("echo $total;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract method");
    expect(extract).toBeDefined();
    expect(extract?.kind).toBe("refactor.extract");
    expect(extract?.edits).toHaveLength(2);

    const applied = applyPhpDescriptorEdits(classSource, extract!);
    expect(applied).toContain("$this->extracted($base);");
    expect(applied).toContain("private function extracted($base): void");
    expect(applied).toContain("$total = $base + 10;");
    expectBalancedPhp(applied);
  });
  it("offers no extract-method action when the selection is empty", async () => {
    const classPath = "/workspace/app/Services/Greeter.php";
    const classSource = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $a = 1;
        echo $a;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("$a = 1;");
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end: offset,
      start: offset,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it("offers no extract-method action outside a class (free function)", async () => {
    const classPath = "/workspace/app/helpers.php";
    const classSource = `<?php

function run(): void
{
    $a = 1;
    echo $a;
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "helpers.php"));
    });

    const start = classSource.indexOf("    $a = 1;");
    const end = classSource.indexOf("\n", classSource.indexOf("echo $a;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it("offers no extract-method action when more than one variable must be returned", async () => {
    const classPath = "/workspace/app/Services/Calculator.php";
    const classSource = `<?php

namespace App\\Services;

class Calculator
{
    public function run(): int
    {
        $a = 1;
        $b = 2;
        return $a + $b;
    }
}
`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? classSource : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Calculator.php"));
    });

    const start = classSource.lastIndexOf("\n", classSource.indexOf("$a = 1;")) + 1;
    const end = classSource.indexOf("\n", classSource.indexOf("$b = 2;"));
    const actions = await getWorkbench().providePhpCodeActions(classSource, {
      end,
      start,
    });

    expect(actions.some((action) => action.title === "Extract method")).toBe(false);
  });
  it.each([
    {
      name: "selection cutting an if/else boundary",
      from: "echo 'positive';",
      to: "} else {",
      source: `<?php

class Greeter
{
    public function run(int $x): void
    {
        if ($x > 0) {
            echo 'positive';
        } else {
            echo 'other';
        }
    }
}
`,
    },
    {
      name: "selection containing a break inside a loop",
      from: "$double = $item * 2;",
      to: "break;",
      source: `<?php

class Greeter
{
    public function run(array $items): void
    {
        foreach ($items as $item) {
            $double = $item * 2;
            break;
        }
    }
}
`,
    },
    {
      name: "selection containing a closure with use()",
      from: "$fn = function",
      to: "};",
      source: `<?php

class Greeter
{
    public function run(): void
    {
        $factor = 2;
        $fn = function ($x) use ($factor) {
            return $x * $factor;
        };
        echo $fn(3);
    }
}
`,
    },
  ])("extract-method adversarial sweep never corrupts: $name", async ({ source, from, to }) => {
    const classPath = "/workspace/app/Services/Edge.php";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === classPath ? source : `<?php\n// ${path}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Edge.php"));
    });

    const start = source.lastIndexOf("\n", source.indexOf(from)) + 1;
    const toEnd = source.indexOf(to) + to.length;
    const end = source.indexOf("\n", toEnd);
    const actions = await getWorkbench().providePhpCodeActions(source, {
      end: end < 0 ? source.length : end,
      start,
    });

    const extract = actions.find((action) => action.title === "Extract method");

    // Either the action is withheld (conservative no-op) or, if offered, the
    // applied edits keep the file syntactically balanced - never corruption.
    if (!extract) {
      return;
    }

    const applied = applyPhpDescriptorEdits(source, extract);
    expectBalancedPhp(applied);
  });
  it("drops stale introduce-constant code actions after switching project tabs", async () => {
    const classPath = "/workspace-a/app/Services/Greeter.php";
    const interfacePath = "/workspace-a/app/Contracts/GreeterContract.php";
    const classSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreeterContract;

class Greeter implements GreeterContract
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;
    const interfaceRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === classPath) {
        return classSource;
      }

      if (path === interfacePath) {
        return interfaceRead.promise;
      }

      return `<?php\n// ${path}\n`;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile(fileEntry(classPath, "Greeter.php"));
    });

    const offset = classSource.indexOf("'Hello world'") + 2;
    let actionsPromise: ReturnType<WorkbenchController["providePhpCodeActions"]> | null = null;
    await act(async () => {
      actionsPromise = getWorkbench().providePhpCodeActions(classSource, {
        end: offset,
        start: offset,
      });
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(interfacePath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    interfaceRead.resolve(`<?php

namespace App\\Contracts;

interface GreeterContract
{
    public function greet(): string;
}
`);

    expect(actionsPromise).not.toBeNull();
    await expect(actionsPromise).resolves.toEqual([]);
  });
});
