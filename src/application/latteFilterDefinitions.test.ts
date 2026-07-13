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
