import { describe, expect, it, vi } from "vitest";
import { detectLatteReferenceAt } from "../domain/latteNavigation";
import {
  latteBlockDefinitionOffset,
  resolveLatteBlockDefinition,
} from "./latteBlockDefinitions";

function referenceAt(source: string, needle: string) {
  const offset = source.indexOf(needle) + 1;
  const reference = detectLatteReferenceAt(source, offset);

  if (!reference) {
    throw new Error(`No Latte reference found for ${needle}`);
  }

  return reference;
}

describe("latteBlockDefinitionOffset", () => {
  it("resolves an include block reference to the matching block declaration", () => {
    const source = "{include #content}\n\n{block content}\n{/block}";
    const reference = referenceAt(source, "content}");

    expect(latteBlockDefinitionOffset(source, reference)).toBe(
      source.lastIndexOf("content"),
    );
  });

  it("resolves a block name to its own declaration position", () => {
    const source = "{block content}\n{/block}";
    const reference = referenceAt(source, "content");

    expect(latteBlockDefinitionOffset(source, reference)).toBe(
      source.indexOf("content"),
    );
  });

  it("escapes regexp characters in block names", () => {
    const source = "{include #price.total}\n{block price.total}\n{/block}";
    const reference = {
      kind: "block",
      name: "price.total",
      nameEnd: source.indexOf("}") - 1,
      nameStart: source.indexOf("price.total"),
      tag: "include",
    } as const;

    expect(latteBlockDefinitionOffset(source, reference)).toBe(
      source.lastIndexOf("price.total"),
    );
  });
});

describe("resolveLatteBlockDefinition", () => {
  it("opens the active document at the local block declaration", async () => {
    const openTarget = vi.fn(async () => true);
    const source = "{include #content}\n\n{block content}\n{/block}";
    const reference = referenceAt(source, "content}");

    await expect(
      resolveLatteBlockDefinition(
        {
          getActiveDocument: () => ({ path: "/ws/templates/default.latte" }),
          openTarget,
        },
        source,
        reference,
        "templates/default.latte",
      ),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/templates/default.latte",
      { column: 8, lineNumber: 3 },
      "content",
    );
  });

  it("does not open without an active template path or active document", async () => {
    const openTarget = vi.fn(async () => true);
    const source = "{include #content}\n\n{block content}\n{/block}";
    const reference = referenceAt(source, "content}");

    await expect(
      resolveLatteBlockDefinition(
        { getActiveDocument: () => ({ path: "/ws/default.latte" }), openTarget },
        source,
        reference,
        null,
      ),
    ).resolves.toBe(false);
    await expect(
      resolveLatteBlockDefinition(
        { getActiveDocument: () => null, openTarget },
        source,
        reference,
        "templates/default.latte",
      ),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });
});
