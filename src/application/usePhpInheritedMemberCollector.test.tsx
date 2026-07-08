// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  usePhpInheritedMemberCollector,
  type PhpInheritedMemberCollectors,
  type UsePhpInheritedMemberCollectorOptions,
} from "./usePhpInheritedMemberCollector";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

function classPath(className: string): string {
  return `${ROOT}/${className.split("\\").join("/")}.php`;
}

function makeOptions(
  classes: Record<string, string>,
  overrides: Partial<UsePhpInheritedMemberCollectorOptions> = {},
): UsePhpInheritedMemberCollectorOptions {
  const sourcesByPath = new Map(
    Object.entries(classes).map(([className, source]) => [
      classPath(className),
      source,
    ]),
  );

  return {
    readNavigationFileContent: vi.fn(async (path: string) => {
      const source = sourcesByPath.get(path);

      if (source === undefined) {
        throw new Error(`Missing class source for ${path}`);
      }

      return source;
    }),
    resolvePhpClassSourcePaths: vi.fn(async (className: string) => {
      const normalizedClassName = className.trim().replace(/^\\+/, "");

      return sourcesByPath.has(classPath(normalizedClassName))
        ? [classPath(normalizedClassName)]
        : [];
    }),
    ...overrides,
  };
}

function renderHook(options: UsePhpInheritedMemberCollectorOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpInheritedMemberCollectors | null } = { api: null };

  function Harness({
    hookOptions,
  }: {
    hookOptions: UsePhpInheritedMemberCollectorOptions;
  }) {
    captured.api = usePhpInheritedMemberCollector(hookOptions);
    return null;
  }

  act(() => {
    root.render(<Harness hookOptions={options} />);
  });

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpInheritedMemberCollector", () => {
  it("collects abstract members across extends and implements hierarchies", async () => {
    const childSource = `<?php

namespace App\\Services;

use App\\Contracts\\GreetingContract;

class Greeter extends AbstractGreeter implements GreetingContract
{
}
`;
    const options = makeOptions({
      "App\\Contracts\\GreetingContract": `<?php

namespace App\\Contracts;

interface GreetingContract
{
    public function greet(string $name): string;
}
`,
      "App\\Services\\AbstractGreeter": `<?php

namespace App\\Services;

abstract class AbstractGreeter implements BaseContract
{
    abstract protected function configure(): void;

    public function inheritedSatisfied(): void
    {
    }
}
`,
      "App\\Services\\BaseContract": `<?php

namespace App\\Services;

interface BaseContract
{
    public function inheritedSatisfied(): void;

    public function fromBase(): int;
}
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected).not.toBeNull();
    expect([...(collected?.abstractMembers.keys() ?? [])]).toEqual([
      "configure",
      "inheritedsatisfied",
      "frombase",
      "greet",
    ]);
    expect(collected?.satisfiedNames.has("inheritedsatisfied")).toBe(true);
    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Services\\AbstractGreeter"),
    );
    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Services\\BaseContract"),
    );
    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Contracts\\GreetingContract"),
    );

    harness.unmount();
  });

  it("collects overridable methods from the parent chain with inherited filtering", async () => {
    const childSource = `<?php

namespace App\\Services;

class Child extends ParentService
{
}
`;
    const options = makeOptions({
      "App\\Services\\GrandparentService": `<?php

namespace App\\Services;

class GrandparentService
{
    public function inherited(): string
    {
        return '';
    }

    public function hidden(): void
    {
    }

    public function sealed(): void
    {
    }

    public function mustImplement(): void
    {
    }
}
`,
      "App\\Services\\ParentService": `<?php

namespace App\\Services;

abstract class ParentService extends GrandparentService
{
    public function handle(string $name): string
    {
        return $name;
    }

    final public function sealed(): void
    {
    }

    private function hidden(): void
    {
    }

    abstract public function mustImplement(): void;

    public function __construct()
    {
    }
}
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpOverridableParentMethods(childSource, () => true);

    expect(collected).not.toBeNull();
    expect([...(collected?.keys() ?? [])]).toEqual(["handle", "inherited"]);
    expect(collected?.get("handle")?.member.returnType).toBe("string");
    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Services\\ParentService"),
    );
    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Services\\GrandparentService"),
    );

    harness.unmount();
  });

  it("cancels collection when the requested root changes after reading a file", async () => {
    const childSource = `<?php

namespace App\\Services;

class Child extends ParentService
{
}
`;
    let active = true;
    const options = makeOptions(
      {
        "App\\Services\\ParentService": `<?php

namespace App\\Services;

abstract class ParentService
{
    abstract public function handle(): void;
}
`,
      },
      {
        readNavigationFileContent: vi.fn(async (path: string) => {
          active = false;
          return `<?php\n// ${path}\n`;
        }),
      },
    );
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => active);

    expect(collected).toBeNull();
    expect(options.readNavigationFileContent).toHaveBeenCalledTimes(1);

    harness.unmount();
  });
});
