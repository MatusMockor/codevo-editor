import { describe, expect, it } from "vitest";
import {
  LATTE_RENAME_SWEEP_MAX_FILES,
  sweepLatteBlockRename,
  type LatteBlockRenameSweepPorts,
} from "./latteBlockRenameSweep";

const LAYOUT = "app/UI/@layout.latte";
const HOME = "app/UI/Home/default.latte";
const ABOUT = "app/UI/About/default.latte";

const LAYOUT_SOURCE = "{block content}Layout{/block content}";
const HOME_SOURCE = "{extends '../@layout.latte'}\n{block content}Home{/block}";
const ABOUT_SOURCE = "{extends '../@layout.latte'}\n{block content}About{/block}";

describe("sweepLatteBlockRename", () => {
  it("collects the layout and every extending page for a layout-declared block", async () => {
    const ports = sweepPorts({
      [ABOUT]: ABOUT_SOURCE,
      [HOME]: HOME_SOURCE,
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("swept");
    expect(sweptPaths(result)).toEqual([LAYOUT, ABOUT, HOME]);
    expect(sweptOccurrenceCounts(result)).toEqual({
      [ABOUT]: 1,
      [HOME]: 1,
      [LAYOUT]: 2,
    });
  });

  it("collects the same closure when anchored at an extending page", async () => {
    const ports = sweepPorts({
      [ABOUT]: ABOUT_SOURCE,
      [HOME]: HOME_SOURCE,
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, HOME, "content");

    expect(result.kind).toBe("swept");
    expect(sweptPaths(result).sort()).toEqual([ABOUT, LAYOUT, HOME].sort());
  });

  it("joins pages that define a block the shared layout includes", async () => {
    const ports = sweepPorts({
      [ABOUT]:
        "{extends '../@layout.latte'}\n{define sidebar}About{/define}",
      [HOME]: "{extends '../@layout.latte'}\n{define sidebar}Home{/define}",
      [LAYOUT]: "{include #sidebar}",
    });

    const result = await sweepLatteBlockRename(ports, HOME, "sidebar");

    expect(result.kind).toBe("swept");
    expect(sweptPaths(result).sort()).toEqual([ABOUT, LAYOUT, HOME].sort());
  });

  it("keeps unrelated same-named sibling blocks out of the closure", async () => {
    const ports = sweepPorts({
      [ABOUT]: "{extends '../@layout.latte'}\n{block notes}About{/block}",
      [HOME]: "{extends '../@layout.latte'}\n{block notes}Home{/block}",
      [LAYOUT]: "{block content}Layout{/block}",
    });

    const result = await sweepLatteBlockRename(ports, HOME, "notes");

    expect(result.kind).toBe("swept");
    expect(sweptPaths(result)).toEqual([HOME]);
  });

  it("follows the @layout auto-lookup convention into the closure", async () => {
    const ports = sweepPorts({
      [HOME]: "{block content}Home{/block}",
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, HOME, "content");

    expect(result.kind).toBe("swept");
    expect(sweptPaths(result).sort()).toEqual([LAYOUT, HOME].sort());
  });

  it("shares one namespace between {define} and {block} declarations", async () => {
    const ports = sweepPorts({
      [HOME]: "{extends '../@layout.latte'}\n{block content}Home{/block}",
      [LAYOUT]: "{define content}Layout{/define}\n{include #content}",
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("swept");
    expect(sweptOccurrenceCounts(result)).toEqual({
      [HOME]: 1,
      [LAYOUT]: 2,
    });
  });

  it("ignores masked occurrences and masked relations", async () => {
    const ports = sweepPorts({
      [HOME]:
        "{extends '../@layout.latte'}\n{block content}Home{/block}\n{* {block content}x{/block} *}",
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("swept");
    expect(sweptOccurrenceCounts(result)).toEqual({
      [HOME]: 1,
      [LAYOUT]: 2,
    });
  });

  it("rejects when an occurrence-carrying template has a dynamic relation", async () => {
    const ports = sweepPorts({
      [ABOUT]: "{extends $layout}\n{block content}About{/block}",
      [HOME]: HOME_SOURCE,
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("rejected");
    expect(rejectionReason(result)).toContain("dynamic");
  });

  it("allows dynamic relations on templates without occurrences of the name", async () => {
    const ports = sweepPorts({
      [ABOUT]: "{extends $layout}\n{block other}About{/block}",
      [HOME]: HOME_SOURCE,
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("swept");
    expect(sweptPaths(result).sort()).toEqual([LAYOUT, HOME].sort());
  });

  it("rejects when a chain seeing the closure references blocks dynamically", async () => {
    const ports = sweepPorts({
      [ABOUT]: "{extends '../@layout.latte'}\n{include block $name}",
      [HOME]: HOME_SOURCE,
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("rejected");
    expect(rejectionReason(result)).toContain("dynamic");
  });

  it("rejects when the renamed block is included with a from clause", async () => {
    const ports = sweepPorts({
      [ABOUT]: "{include content from '../@layout.latte'}",
      [HOME]: HOME_SOURCE,
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("rejected");
    expect(rejectionReason(result)).toContain("from");
  });

  it("rejects when the workspace lists more templates than the sweep limit", async () => {
    const files: Record<string, string> = { [LAYOUT]: LAYOUT_SOURCE };

    for (let index = 0; index <= LATTE_RENAME_SWEEP_MAX_FILES; index += 1) {
      files[`app/generated/page${index}.latte`] = "static";
    }

    const result = await sweepLatteBlockRename(
      sweepPorts(files),
      LAYOUT,
      "content",
    );

    expect(result.kind).toBe("rejected");
  });

  it("rejects when a listed template exceeds the per-file size limit", async () => {
    const ports = sweepPorts({
      [HOME]: "x".repeat(1_000_001),
      [LAYOUT]: LAYOUT_SOURCE,
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("rejected");
  });

  it("skips vendor and node_modules templates entirely", async () => {
    const ports = sweepPorts({
      [HOME]: HOME_SOURCE,
      [LAYOUT]: LAYOUT_SOURCE,
      "node_modules/pkg/tpl.latte": "{extends $anything}\n{block content}x{/block}",
      "vendor/pkg/templates/page.latte": "{include block $name}",
    });

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("swept");
    expect(sweptPaths(result).sort()).toEqual([LAYOUT, HOME].sort());
  });

  it("reports unavailable when the listing port yields null", async () => {
    const ports = sweepPorts(
      { [LAYOUT]: LAYOUT_SOURCE },
      { listTemplateFiles: async () => null },
    );

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("unavailable");
  });

  it("rejects when the listing port fails", async () => {
    const ports = sweepPorts(
      { [LAYOUT]: LAYOUT_SOURCE },
      {
        listTemplateFiles: async () => {
          throw new Error("boom");
        },
      },
    );

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("rejected");
  });

  it("rejects when the requested root goes stale mid-scan", async () => {
    let active = true;
    const ports = sweepPorts(
      {
        [HOME]: HOME_SOURCE,
        [LAYOUT]: LAYOUT_SOURCE,
      },
      {
        isRequestedRootActive: () => active,
        readTemplateFile: async (path) => {
          active = false;
          return path === LAYOUT ? LAYOUT_SOURCE : HOME_SOURCE;
        },
      },
    );

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("rejected");
  });

  it("rejects when the anchor template cannot be read", async () => {
    const ports = sweepPorts(
      { [HOME]: HOME_SOURCE },
      { readTemplateFile: async () => null },
    );

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("rejected");
  });

  it("skips deleted non-anchor templates instead of rejecting", async () => {
    const ports = sweepPorts(
      {
        [ABOUT]: ABOUT_SOURCE,
        [HOME]: HOME_SOURCE,
        [LAYOUT]: LAYOUT_SOURCE,
      },
      {
        readTemplateFile: async (path) =>
          path === ABOUT
            ? null
            : { [HOME]: HOME_SOURCE, [LAYOUT]: LAYOUT_SOURCE }[path] ?? null,
      },
    );

    const result = await sweepLatteBlockRename(ports, LAYOUT, "content");

    expect(result.kind).toBe("swept");
    expect(sweptPaths(result).sort()).toEqual([LAYOUT, HOME].sort());
  });
});

function sweepPorts(
  files: Record<string, string>,
  overrides: Partial<LatteBlockRenameSweepPorts> = {},
): LatteBlockRenameSweepPorts {
  return {
    isRequestedRootActive: () => true,
    listTemplateFiles: async () => Object.keys(files),
    readTemplateFile: async (path) => files[path] ?? null,
    ...overrides,
  };
}

function sweptPaths(
  result: Awaited<ReturnType<typeof sweepLatteBlockRename>>,
): string[] {
  if (result.kind !== "swept") {
    return [];
  }

  return result.files.map((file) => file.relativePath);
}

function sweptOccurrenceCounts(
  result: Awaited<ReturnType<typeof sweepLatteBlockRename>>,
): Record<string, number> {
  if (result.kind !== "swept") {
    return {};
  }

  return Object.fromEntries(
    result.files.map((file) => [file.relativePath, file.occurrences.length]),
  );
}

function rejectionReason(
  result: Awaited<ReturnType<typeof sweepLatteBlockRename>>,
): string {
  return result.kind === "rejected" ? result.reason : "";
}
