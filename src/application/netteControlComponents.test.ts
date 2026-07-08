import { describe, expect, it, vi } from "vitest";
import {
  latteControlCompletions,
  latteControlCompletionAt,
  netteControlReferenceAt,
  resolveNetteControlDefinition,
} from "./netteControlComponents";
import type { NetteControlCache } from "./netteControlContracts";

const ROOT = "/ws";
const PRESENTER = `<?php
class HomePresenter
{
    protected function createComponentProductList(): ProductListControl
    {
        return new ProductListControl();
    }
}
`;

const deps = {
  joinPath: (root: string, relativePath: string) => `${root}/${relativePath}`,
  openPhpMethodTarget: vi.fn(async () => true),
  openTarget: vi.fn(async () => true),
  readFileContent: vi.fn(async () => PRESENTER),
  resolveDeclaredType: (_source: string, typeHint: string | null) => typeHint,
};

describe("netteControlReferenceAt", () => {
  it("detects control names and render parts", () => {
    const source = "{control productList:pagination}";

    expect(netteControlReferenceAt(source, source.indexOf("pagination")))
      .toEqual({ name: "productList", part: "pagination" });
  });
});

describe("latteControlCompletions", () => {
  it("offers createComponent names from the template owner", async () => {
    const cache: NetteControlCache = {};

    await expect(
      latteControlCompletions(
        {
          componentCache: cache,
          deps,
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
        { prefix: "pro", replaceEnd: 13, replaceStart: 10 },
      ),
    ).resolves.toMatchObject([
      {
        insertText: "productList",
        kind: "component",
        label: "productList",
      },
    ]);
  });

  it("detects the completion span inside a control macro", () => {
    const source = "{control pro}";

    expect(latteControlCompletionAt(source, source.indexOf("}")))
      .toEqual({ prefix: "pro", replaceEnd: 12, replaceStart: 9 });
  });
});

describe("resolveNetteControlDefinition", () => {
  it("opens render part methods before falling back to the factory", async () => {
    const openPhpMethodTarget = vi.fn(async () => true);
    const openTarget = vi.fn(async () => true);

    await expect(
      resolveNetteControlDefinition(
        { ...deps, openPhpMethodTarget, openTarget },
        ROOT,
        () => true,
        { name: "productList", part: "pagination" },
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openPhpMethodTarget).toHaveBeenCalledWith(
      "ProductListControl",
      "renderPagination",
    );
    expect(openTarget).not.toHaveBeenCalled();
  });
});
