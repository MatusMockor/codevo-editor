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

  it("counts trait-provided methods as satisfying inherited abstract members", async () => {
    const childSource = `<?php

namespace App\\Models;

use App\\Contracts\\Authenticatable;
use App\\Traits\\AuthTrait;

class User implements Authenticatable
{
    use AuthTrait;
}
`;
    const options = makeOptions({
      "App\\Contracts\\Authenticatable": `<?php

namespace App\\Contracts;

interface Authenticatable
{
    public function getAuthIdentifier();
}
`,
      "App\\Traits\\AuthTrait": `<?php

namespace App\\Traits;

trait AuthTrait
{
    public function getAuthIdentifier()
    {
        return $this->id;
    }
}
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected).not.toBeNull();
    expect(collected?.satisfiedNames.has("getauthidentifier")).toBe(true);
    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Traits\\AuthTrait"),
    );

    harness.unmount();
  });

  it("keeps abstract methods declared in used traits as members to implement", async () => {
    const childSource = `<?php

namespace App\\Reports;

use App\\Contracts\\Renderable;
use App\\Traits\\BuildsReports;

class ReportGenerator implements Renderable
{
    use BuildsReports;
}
`;
    const options = makeOptions({
      "App\\Contracts\\Renderable": `<?php

namespace App\\Contracts;

interface Renderable
{
    public function render(): string;
}
`,
      "App\\Traits\\BuildsReports": `<?php

namespace App\\Traits;

trait BuildsReports
{
    abstract public function buildRows(): array;

    public function render(): string
    {
        return '';
    }
}
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected).not.toBeNull();
    expect(collected?.abstractMembers.has("buildrows")).toBe(true);
    expect(collected?.satisfiedNames.has("buildrows")).toBe(false);
    expect(collected?.satisfiedNames.has("render")).toBe(true);

    harness.unmount();
  });

  it("collects trait abstract members for a class without super types", async () => {
    const childSource = `<?php

namespace App\\Reports;

use App\\Traits\\BuildsReports;

class ReportGenerator
{
    use BuildsReports;
}
`;
    const options = makeOptions({
      "App\\Traits\\BuildsReports": `<?php

namespace App\\Traits;

trait BuildsReports
{
    abstract public function buildRows(): array;
}
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected?.abstractMembers.has("buildrows")).toBe(true);

    harness.unmount();
  });

  it("inherits parent trait methods except private ones", async () => {
    const childSource = `<?php

namespace App\\Services;

use App\\Contracts\\ReportContract;

class Child extends Base implements ReportContract
{
}
`;
    const options = makeOptions({
      "App\\Contracts\\ReportContract": `<?php

namespace App\\Contracts;

interface ReportContract
{
    public function fromParentTrait(): void;

    public function fromDeepTrait(): void;

    public function hiddenHelper(): void;
}
`,
      "App\\Services\\Base": `<?php

namespace App\\Services;

use App\\Traits\\ParentTrait;

abstract class Base
{
    use ParentTrait;
}
`,
      "App\\Traits\\DeepTrait": `<?php

namespace App\\Traits;

trait DeepTrait
{
    public function fromDeepTrait(): void
    {
    }
}
`,
      "App\\Traits\\ParentTrait": `<?php

namespace App\\Traits;

trait ParentTrait
{
    use DeepTrait;

    public function fromParentTrait(): void
    {
    }

    private function hiddenHelper(): void
    {
    }
}
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected).not.toBeNull();
    expect(collected?.satisfiedNames.has("fromparenttrait")).toBe(true);
    expect(collected?.satisfiedNames.has("fromdeeptrait")).toBe(true);
    expect(collected?.satisfiedNames.has("hiddenhelper")).toBe(false);

    harness.unmount();
  });

  it("counts private methods of directly used traits as satisfied", async () => {
    const childSource = `<?php

namespace App\\Services;

use App\\Traits\\OwnTrait;

class Owner extends Base
{
    use OwnTrait;
}
`;
    const options = makeOptions({
      "App\\Services\\Base": `<?php

namespace App\\Services;

abstract class Base
{
    abstract protected function required(): void;
}
`,
      "App\\Traits\\OwnTrait": `<?php

namespace App\\Traits;

trait OwnTrait
{
    private function helper(): void
    {
    }
}
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected?.satisfiedNames.has("helper")).toBe(true);
    expect(collected?.abstractMembers.has("required")).toBe(true);

    harness.unmount();
  });

  it("cancels collection when the requested root changes during a trait read", async () => {
    const childSource = `<?php

namespace App\\Models;

use App\\Traits\\AuthTrait;

class User
{
    use AuthTrait;
}
`;
    let active = true;
    const options = makeOptions(
      {},
      {
        readNavigationFileContent: vi.fn(async (path: string) => {
          active = false;
          return `<?php\n// ${path}\n`;
        }),
        resolvePhpClassSourcePaths: vi.fn(async (className: string) => [
          `/workspace/${className.split("\\").join("/")}.php`,
        ]),
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

  it("preserves conflicts between inherited declarations with the same method name", async () => {
    const childSource = `<?php
namespace App;

class Handler implements StringHandler, IntHandler
{
}
`;
    const options = makeOptions({
      "App\\IntHandler": `<?php
namespace App;
interface IntHandler { public function handle(int $value): void; }
`,
      "App\\StringHandler": `<?php
namespace App;
interface StringHandler { public function handle(string $value): void; }
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected?.abstractMembers.get("handle")?.declaringTypeName).toBe(
      "StringHandler",
    );
    expect(collected?.conflictingNames).toEqual(new Set(["handle"]));

    harness.unmount();
  });

  it("does not mark alias-aware agreeing declarations as conflicting", async () => {
    const childSource = `<?php
namespace App;

class Handler implements FirstHandler, SecondHandler
{
}
`;
    const options = makeOptions({
      "App\\FirstHandler": `<?php
namespace App;
use Vendor\\Model as Payload;
interface FirstHandler { public function handle(Payload $value): Payload; }
`,
      "App\\SecondHandler": `<?php
namespace App;
use Vendor\\Model;
interface SecondHandler { public function handle(Model $value): Model; }
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected?.conflictingNames).toEqual(new Set());

    harness.unmount();
  });

  it("does not conflict on nullable or reordered inherited unions", async () => {
    const childSource = `<?php
namespace App;
class Handler implements FirstHandler, SecondHandler {}
`;
    const options = makeOptions({
      "App\\FirstHandler": `<?php
namespace App;
interface FirstHandler { public function handle(?Payload $value): Payload|Failure|null; }
`,
      "App\\SecondHandler": `<?php
namespace App;
interface SecondHandler { public function handle(Payload|null $value): null|Failure|Payload; }
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected?.conflictingNames).toEqual(new Set());

    harness.unmount();
  });

  it("keeps an agreeing abstract-class and interface chain unambiguous", async () => {
    const childSource = `<?php
namespace App;

class Handler extends AbstractHandler
{
    public function handle(int $value): bool { return false; }
}
`;
    const options = makeOptions({
      "App\\AbstractHandler": `<?php
namespace App;
abstract class AbstractHandler implements HandlerContract
{
    abstract public function handle(string $value = ''): void;
}
`,
      "App\\HandlerContract": `<?php
namespace App;
interface HandlerContract
{
    public function handle(string $value = ''): void;
}
`,
    });
    const harness = renderHook(options);

    const collected = await harness
      .api()
      .collectPhpAbstractMembersToImplement(childSource, () => true);

    expect(collected?.abstractMembers.get("handle")?.declaringTypeName).toBe(
      "AbstractHandler",
    );
    expect(collected?.conflictingNames).toEqual(new Set());

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
