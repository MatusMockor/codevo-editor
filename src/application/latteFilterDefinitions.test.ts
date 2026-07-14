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

  it("opens a same-file NEON filter callable service method when metadata is available", async () => {
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

  it("opens an @self NEON filter callable using the owning service class", async () => {
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

  it("falls back to the registration target when a NEON callable method cannot be opened", async () => {
    const context = makeContext();
    context.deps.openPhpMethodTarget = vi.fn(async () => false);
    context.loadFilterRegistrations = vi.fn(async () => [
      {
        methodName: "format",
        name: "UserDate",
        offset: CONFIG_SOURCE.indexOf("UserDate"),
        path: "/ws/app/config/common.neon",
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

    expect(context.deps.openPhpMethodTarget).not.toHaveBeenCalled();
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/config/common.neon",
      { column: 20, lineNumber: 4 },
      "UserDate",
    );
  });

  it("prefers a PHP extension filter callable method over the filter key", async () => {
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
