import { describe, expect, it, vi } from "vitest";
import {
  resolveLatteFilterDefinition,
  type LatteFilterDefinitionContext,
} from "./latteFilterDefinitions";

const CONFIG_SOURCE = `services:
  userDateFilter:
    setup:
      - addFilter('UserDate', [@self, format])
`;
const CALLABLE_CONFIG_SOURCE = `services:
  userDateFilter:
    class: App\\Filters\\UserDateFilter
    setup:
      - addFilter('UserDate', [@userDateFilter, format])
`;
const CROSS_FILE_CALLABLE_CONFIG_SOURCE = `services:
  filterLoader:
    setup:
      - addFilter('UserDate', [@userDateFilter, format])
`;
const INLINE_OBJECT_CONFIG_SOURCE = `services:
  filterLoader:
    setup:
      - register('UserDate', [App\\Filters\\UserDateFilter(), format])
`;
const EXTENSION_SOURCE = `<?php
final class AppLatteExtension extends Latte\\Extension
{
    public function getFilters(): array
    {
        return [
            'UserDate' => [$this, 'formatUserDate'],
        ];
    }

    public function formatUserDate(): string
    {
        return '';
    }
}
`;
const EXTERNAL_CALLABLE_EXTENSION_SOURCE = `<?php
final class AppLatteExtension extends Latte\\Extension
{
    public function getFilters(): array
    {
        return [
            'UserDate' => [\\App\\Filters\\UserDateFilter::class, 'format'],
        ];
    }
}
`;

function offsetAfter(source: string, needle: string): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`missing needle: ${needle}`);
  }

  return index + needle.length;
}

function makeContext({
  active = true,
  configSource = CONFIG_SOURCE,
}: {
  active?: boolean | (() => boolean);
  configSource?: string;
} = {}): LatteFilterDefinitionContext {
  const isActive = typeof active === "function" ? active : () => active;

  return {
    deps: {
      openPhpMethodTarget: vi.fn(async () => true),
      openTarget: vi.fn(async () => true),
      readFileContent: vi.fn(async () => configSource),
      resolvePhpReceiverCompletions: vi.fn(async () => [
        {
          declaringClassName: "App\\Filters\\UserDateFilter",
          isStatic: true,
          name: "format",
          parameters: "string $value",
          returnType: "string",
        },
      ]),
      synthesizeTypedReceiverSource: vi.fn((variableName, typeName) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      })),
    },
    isRequestedRootActive: isActive,
    loadFilterRegistrations: vi.fn(async () => [
      {
        name: "UserDate",
        offset: CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/common.neon",
      },
    ]),
  };
}

describe("resolveLatteFilterDefinition", () => {
  it("opens an inline object callable PHP method before its NEON registration", async () => {
    const context = makeContext({ configSource: INLINE_OBJECT_CONFIG_SOURCE });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callable: {
          methodName: "format",
          serviceClassName: "App\\Filters\\UserDateFilter",
        },
        methodName: "format",
        name: "UserDate",
        offset: INLINE_OBJECT_CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/filters.neon",
        serviceClassName: "App\\Filters\\UserDateFilter",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.readFileContent).not.toHaveBeenCalled();
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("falls back to an inline object callable's NEON registration", async () => {
    const context = makeContext({ configSource: INLINE_OBJECT_CONFIG_SOURCE });
    context.deps.openPhpMethodTarget = vi.fn(async () => false);
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callable: {
          methodName: "format",
          serviceClassName: "App\\Filters\\UserDateFilter",
        },
        name: "UserDate",
        offset: INLINE_OBJECT_CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/filters.neon",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledTimes(1);
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/config/filters.neon",
      { column: 19, lineNumber: 4 },
      "UserDate",
    );
  });

  it("opens the discovered Latte filter registration", async () => {
    const context = makeContext();
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/config/common.neon",
      { column: 20, lineNumber: 4 },
      "UserDate",
    );
    expect(context.deps.openPhpMethodTarget).not.toHaveBeenCalled();
  });

  it("opens a same-file NEON callable service method before its registration", async () => {
    const context = makeContext({ configSource: CALLABLE_CONFIG_SOURCE });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        methodName: "format",
        name: "UserDate",
        offset: CALLABLE_CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/common.neon",
        serviceName: "userDateFilter",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("opens a cross-file NEON callable using the project service type", async () => {
    const context = makeContext({
      configSource: CROSS_FILE_CALLABLE_CONFIG_SOURCE,
    });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        methodName: "format",
        name: "UserDate",
        offset: CROSS_FILE_CALLABLE_CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/filters.neon",
        serviceName: "userDateFilter",
      },
    ]);
    context.loadProjectConfig = vi.fn(async () => ({
      serviceAliases: new Map(),
      serviceNameTypes: new Map([
        ["userDateFilter", "App\\Filters\\UserDateFilter"],
      ]),
    }));
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.loadProjectConfig).toHaveBeenCalledOnce();
    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("resolves cross-file NEON aliases before opening the callable", async () => {
    const context = makeContext({
      configSource: CROSS_FILE_CALLABLE_CONFIG_SOURCE,
    });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        methodName: "format",
        name: "UserDate",
        offset: CROSS_FILE_CALLABLE_CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/filters.neon",
        serviceName: "userDateFilter",
      },
    ]);
    context.loadProjectConfig = vi.fn(async () => ({
      serviceAliases: new Map([["userDateFilter", "realUserDateFilter"]]),
      serviceNameTypes: new Map([
        ["realUserDateFilter", "App\\Filters\\UserDateFilter"],
      ]),
    }));
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("opens the NEON filter registration when project config has no service type", async () => {
    const context = makeContext({
      configSource: CROSS_FILE_CALLABLE_CONFIG_SOURCE,
    });
    context.deps.openPhpMethodTarget = vi.fn(async () => false);
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        methodName: "format",
        name: "UserDate",
        offset: CROSS_FILE_CALLABLE_CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/filters.neon",
        serviceName: "userDateFilter",
      },
    ]);
    context.loadProjectConfig = vi.fn(async () => ({
      serviceAliases: new Map(),
      serviceNameTypes: new Map(),
    }));
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).not.toHaveBeenCalled();
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/config/filters.neon",
      { column: 20, lineNumber: 4 },
      "UserDate",
    );
  });

  it("opens the resolved project callable while the root stays active", async () => {
    let active = true;
    const context = makeContext({
      active: () => active,
      configSource: CROSS_FILE_CALLABLE_CONFIG_SOURCE,
    });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        methodName: "format",
        name: "UserDate",
        offset: CROSS_FILE_CALLABLE_CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/filters.neon",
        serviceName: "userDateFilter",
      },
    ]);
    context.loadProjectConfig = vi.fn(async () => ({
      serviceAliases: new Map(),
      serviceNameTypes: new Map([
        ["userDateFilter", "App\\Filters\\UserDateFilter"],
      ]),
    }));
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(active).toBe(true);
    expect(context.loadProjectConfig).toHaveBeenCalledOnce();
    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("opens an @self NEON callable before its registration", async () => {
    const context = makeContext();
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callable: {
          methodName: "format",
          serviceClassName: "App\\Filters\\UserDateFilter",
          serviceName: "self",
        },
        name: "UserDate",
        offset: CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/common.neon",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("falls back to the NEON registration when the callable cannot be opened", async () => {
    const context = makeContext();
    context.deps.openPhpMethodTarget = vi.fn(async () => false);
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        methodName: "format",
        name: "UserDate",
        offset: CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/common.neon",
        serviceClassName: "App\\Filters\\UserDateFilter",
        serviceName: "missingFilter",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/config/common.neon",
      { column: 20, lineNumber: 4 },
      "UserDate",
    );
    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
  });

  it("prefers a PHP extension same-file method declaration over the filter key", async () => {
    const context = makeContext({ configSource: EXTENSION_SOURCE });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callableOffset: EXTENSION_SOURCE.indexOf("formatUserDate", EXTENSION_SOURCE.indexOf("function formatUserDate")),
        name: "UserDate",
        offset: EXTENSION_SOURCE.indexOf("UserDate"),
        path: "/ws/app/Latte/AppLatteExtension.php",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/Latte/AppLatteExtension.php",
      { column: 21, lineNumber: 11 },
      "UserDate",
    );
  });

  it("opens an external PHP extension callable method before its registration", async () => {
    const context = makeContext({
      configSource: EXTERNAL_CALLABLE_EXTENSION_SOURCE,
    });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callableOffset: EXTERNAL_CALLABLE_EXTENSION_SOURCE.indexOf("format"),
        methodName: "format",
        name: "UserDate",
        offset: EXTERNAL_CALLABLE_EXTENSION_SOURCE.indexOf("UserDate"),
        path: "/ws/app/Latte/AppLatteExtension.php",
        serviceClassName: "App\\Filters\\UserDateFilter",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("falls back to a class-string registration for a non-static method", async () => {
    const context = makeContext({
      configSource: EXTERNAL_CALLABLE_EXTENSION_SOURCE,
    });
    context.deps.resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Filters\\UserDateFilter",
        name: "format",
        parameters: "string $value",
        returnType: "string",
      },
    ]);
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callableKind: "static" as const,
        callableOffset: EXTERNAL_CALLABLE_EXTENSION_SOURCE.indexOf("format"),
        methodName: "format",
        name: "UserDate",
        offset: EXTERNAL_CALLABLE_EXTENSION_SOURCE.indexOf("UserDate"),
        path: "/ws/app/Latte/AppLatteExtension.php",
        serviceClassName: "App\\Filters\\UserDateFilter",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).not.toHaveBeenCalled();
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/Latte/AppLatteExtension.php",
      { column: 14, lineNumber: 7 },
      "UserDate",
    );
  });

  it("opens the inherited declaring class for a valid static callable", async () => {
    const context = makeContext({
      configSource: EXTERNAL_CALLABLE_EXTENSION_SOURCE,
    });
    context.deps.resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Filters\\BaseDateFilter",
        isStatic: true,
        name: "format",
        parameters: "string $value",
        returnType: "string",
      },
    ]);
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callableKind: "static" as const,
        methodName: "format",
        name: "UserDate",
        offset: EXTERNAL_CALLABLE_EXTENSION_SOURCE.indexOf("UserDate"),
        path: "/ws/app/Latte/AppLatteExtension.php",
        serviceClassName: "App\\Filters\\ChildDateFilter",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\BaseDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("falls back to registration for an unresolved inherited $this callable", async () => {
    const context = makeContext({ configSource: EXTENSION_SOURCE });
    context.deps.openPhpMethodTarget = vi.fn(async () => false);
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callableKind: "instance" as const,
        methodName: "inheritedMethod",
        name: "UserDate",
        offset: EXTENSION_SOURCE.indexOf("UserDate"),
        path: "/ws/app/Latte/AppLatteExtension.php",
        serviceClassName: "App\\Latte\\ProjectExtension",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Latte\\ProjectExtension",
      "inheritedMethod",
    );
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/Latte/AppLatteExtension.php",
      { column: 14, lineNumber: 7 },
      "UserDate",
    );
  });

  it("opens a known core Latte filter method when no project registration matches", async () => {
    const context = makeContext();
    context.loadFilterRegistrations = vi.fn(async () => []);
    const source = "{$title|webalize}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "web"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "Nette\\Utils\\Strings",
      "webalize",
    );
    expect(context.deps.readFileContent).not.toHaveBeenCalled();
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("keeps a project filter registration ahead of a same-name core filter", async () => {
    const context = makeContext({
      configSource: EXTERNAL_CALLABLE_EXTENSION_SOURCE,
    });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        methodName: "format",
        name: "webalize",
        offset: EXTERNAL_CALLABLE_EXTENSION_SOURCE.indexOf("UserDate"),
        path: "/ws/app/Latte/AppLatteExtension.php",
        serviceClassName: "App\\Filters\\UserDateFilter",
      },
    ]);
    const source = "{$title|webalize}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "web"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
    expect(context.deps.openPhpMethodTarget).not.toHaveBeenCalledWith(
      "Nette\\Utils\\Strings",
      "webalize",
    );
  });

  it("opens a PHP extension external callable before the filter key", async () => {
    const context = makeContext({
      configSource: EXTERNAL_CALLABLE_EXTENSION_SOURCE,
    });
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        callableOffset: EXTERNAL_CALLABLE_EXTENSION_SOURCE.indexOf("format"),
        methodName: "format",
        name: "UserDate",
        offset: EXTERNAL_CALLABLE_EXTENSION_SOURCE.indexOf("UserDate"),
        path: "/ws/app/Latte/AppLatteExtension.php",
        serviceClassName: "App\\Filters\\UserDateFilter",
      },
    ]);
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(true);

    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Filters\\UserDateFilter",
      "format",
    );
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

  it("drops stale-root filter registrations after async load", async () => {
    let active = true;
    const context = makeContext({ active: () => active });
    context.loadFilterRegistrations = vi.fn(async () => {
      active = false;
      return [
        {
          name: "UserDate",
          offset: CONFIG_SOURCE.indexOf("UserDate"),
          path: "/ws/app/config/common.neon",
        },
      ];
    });
    const source = "{$createdAt|UserDate}";

    await expect(
      resolveLatteFilterDefinition(
        context,
        source,
        offsetAfter(source, "User"),
      ),
    ).resolves.toBe(false);

    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });
});
