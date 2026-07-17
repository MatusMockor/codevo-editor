import { describe, expect, it, vi } from "vitest";
import {
  collectLatteTemplateGraphDocuments,
  joinLatteWorkspacePath,
  latteCrossFileBlockDefinition,
  latteCrossFileBlockOccurrences,
  latteWorkspaceRelativePath,
  LATTE_BLOCK_GRAPH_MAX_DEPTH,
  LATTE_BLOCK_GRAPH_MAX_DOCUMENTS,
  type LatteCrossFileBlockDependencies,
} from "./latteCrossFileBlocks";

describe("collectLatteTemplateGraphDocuments", () => {
  it("collects the explicit extends parent and its imports nearest-first", async () => {
    const deps = fileSystemDependencies({
      "app/UI/@layout.latte":
        "{import 'blocks.latte'}\n{block content}Layout{/block}",
      "app/UI/blocks.latte": "{define tableRow, $row}<tr />{/define}",
    });
    const startSource = "{extends '../@layout.latte'}\n{block content}Child{/block}";

    const documents = await collectLatteTemplateGraphDocuments(
      deps,
      "app/UI/Home/default.latte",
      startSource,
    );

    expect(documents?.map((document) => document.relativePath)).toEqual([
      "app/UI/Home/default.latte",
      "app/UI/@layout.latte",
      "app/UI/blocks.latte",
    ]);
    expect(documents?.[0]?.source).toBe(startSource);
  });

  it("resolves the conventional @layout when no parent tag exists", async () => {
    const deps = fileSystemDependencies({
      "app/UI/@layout.latte": "{block content}{/block}",
    });

    const documents = await collectLatteTemplateGraphDocuments(
      deps,
      "app/UI/Home/default.latte",
      "{block content}Child{/block}",
    );

    expect(documents?.map((document) => document.relativePath)).toEqual([
      "app/UI/Home/default.latte",
      "app/UI/@layout.latte",
    ]);
  });

  it("skips the conventional @layout lookup when the template opts out", async () => {
    const readTemplateFile = vi.fn(async () => null);

    const documents = await collectLatteTemplateGraphDocuments(
      { isRequestedRootActive: () => true, readTemplateFile },
      "app/UI/Home/default.latte",
      "{layout none}\n{block content}Child{/block}",
    );

    expect(documents?.map((document) => document.relativePath)).toEqual([
      "app/UI/Home/default.latte",
    ]);
    expect(readTemplateFile).not.toHaveBeenCalled();
  });

  it("terminates on cyclic imports without duplicating documents", async () => {
    const deps = fileSystemDependencies({
      "app/a.latte": "{import 'b.latte'}\n{block first}{/block}",
      "app/b.latte": "{import 'a.latte'}\n{block second}{/block}",
    });

    const documents = await collectLatteTemplateGraphDocuments(
      deps,
      "app/a.latte",
      "{import 'b.latte'}\n{block first}{/block}",
    );

    expect(documents?.map((document) => document.relativePath)).toEqual([
      "app/a.latte",
      "app/b.latte",
    ]);
  });

  it("bounds traversal by depth", async () => {
    const files: Record<string, string> = {};

    for (let index = 1; index <= LATTE_BLOCK_GRAPH_MAX_DEPTH + 3; index += 1) {
      files[`app/level${index}.latte`] =
        `{extends 'level${index + 1}.latte'}\n{block content}{/block}`;
    }

    const documents = await collectLatteTemplateGraphDocuments(
      fileSystemDependencies(files),
      "app/level0.latte",
      "{extends 'level1.latte'}",
    );

    expect(documents).toHaveLength(LATTE_BLOCK_GRAPH_MAX_DEPTH + 1);
  });

  it("bounds traversal by document count", async () => {
    const files: Record<string, string> = {};
    const imports = Array.from(
      { length: LATTE_BLOCK_GRAPH_MAX_DOCUMENTS + 8 },
      (_value, index) => `{import 'part${index}.latte'}`,
    );

    for (let index = 0; index < imports.length; index += 1) {
      files[`app/part${index}.latte`] = `{define part${index}}{/define}`;
    }

    const documents = await collectLatteTemplateGraphDocuments(
      fileSystemDependencies(files),
      "app/root.latte",
      imports.join("\n"),
    );

    expect(documents).toHaveLength(LATTE_BLOCK_GRAPH_MAX_DOCUMENTS);
  });

  it("skips missing relation targets", async () => {
    const documents = await collectLatteTemplateGraphDocuments(
      fileSystemDependencies({}),
      "app/UI/Home/default.latte",
      "{extends 'gone.latte'}\n{import 'missing.latte'}",
    );

    expect(documents?.map((document) => document.relativePath)).toEqual([
      "app/UI/Home/default.latte",
    ]);
  });

  it("aborts with null when the requested root goes stale mid-traversal", async () => {
    let active = true;

    const documents = await collectLatteTemplateGraphDocuments(
      {
        isRequestedRootActive: () => active,
        readTemplateFile: async () => {
          active = false;
          return "{block content}{/block}";
        },
      },
      "app/UI/Home/default.latte",
      "{extends '@layout.latte'}",
    );

    expect(documents).toBeNull();
  });
});

describe("collectLatteTemplateGraphDocuments size guard", () => {
  it("excludes oversized related documents from the graph entirely", async () => {
    const oversized = `{block content}${"x".repeat(1_000_001)}{/block}`;
    const deps = fileSystemDependencies({
      "app/UI/blocks.latte": oversized,
      "app/UI/@layout.latte": "{block content}{/block}",
    });

    const documents = await collectLatteTemplateGraphDocuments(
      deps,
      "app/UI/Home/default.latte",
      "{extends '../@layout.latte'}\n{import '../blocks.latte'}",
    );

    expect(documents?.map((document) => document.relativePath)).toEqual([
      "app/UI/Home/default.latte",
      "app/UI/@layout.latte",
    ]);
  });
});

describe("latteCrossFileBlockDefinition", () => {
  it("prefers the extends/layout ancestor declaration over imported partials", async () => {
    const layout = "{block content}Layout{/block}";
    const partial = "{define content}Partial{/define}";
    const deps = fileSystemDependencies({
      "app/UI/@layout.latte": layout,
      "app/UI/blocks.latte": partial,
    });
    const documents = await collectLatteTemplateGraphDocuments(
      deps,
      "app/UI/Home/default.latte",
      "{import '../blocks.latte'}\n{extends '../@layout.latte'}\n{block content}Child{/block}",
    );

    const definition = latteCrossFileBlockDefinition(
      (documents ?? []).slice(1),
      "content",
    );

    expect(definition?.document.relativePath).toBe("app/UI/@layout.latte");
  });

  it("falls back to imported declarations when no ancestor declares the block", async () => {
    const deps = fileSystemDependencies({
      "app/UI/blocks.latte": "{define tableRow}<tr />{/define}",
      "app/UI/@layout.latte": "{block content}{/block}",
    });
    const documents = await collectLatteTemplateGraphDocuments(
      deps,
      "app/UI/Home/default.latte",
      "{import '../blocks.latte'}\n{extends '../@layout.latte'}\n{include #tableRow}",
    );

    const definition = latteCrossFileBlockDefinition(
      (documents ?? []).slice(1),
      "tableRow",
    );

    expect(definition?.document.relativePath).toBe("app/UI/blocks.latte");
  });

  it("skips oversized documents when searching declarations", () => {
    const oversized = `{block content}${"x".repeat(1_000_001)}{/block}`;
    const documents = [
      { relativePath: "app/huge.latte", source: oversized },
      { relativePath: "app/@layout.latte", source: "{block content}{/block}" },
    ];

    expect(
      latteCrossFileBlockDefinition(documents, "content")?.document
        .relativePath,
    ).toBe("app/@layout.latte");
  });

  it("returns the nearest declaration in graph order", () => {
    const layout = "{block content}Layout{/block}";
    const grandLayout = "{block content}Grand{/block}";
    const documents = [
      { relativePath: "app/@layout.latte", source: layout },
      { relativePath: "app/@grand.latte", source: grandLayout },
    ];

    const definition = latteCrossFileBlockDefinition(documents, "content");

    expect(definition?.document.relativePath).toBe("app/@layout.latte");
    expect(definition?.span).toEqual({
      end: layout.indexOf("content") + "content".length,
      start: layout.indexOf("content"),
    });
  });

  it("finds define declarations and ignores dynamic block names", () => {
    const source = "{block $dynamic}{/block}\n{define tableRow}<tr />{/define}";
    const documents = [{ relativePath: "app/blocks.latte", source }];

    expect(latteCrossFileBlockDefinition(documents, "tableRow")?.span).toEqual({
      end: source.indexOf("tableRow") + "tableRow".length,
      start: source.indexOf("tableRow"),
    });
    expect(latteCrossFileBlockDefinition(documents, "$dynamic")).toBeNull();
    expect(latteCrossFileBlockDefinition(documents, "dynamic")).toBeNull();
  });
});

describe("latteCrossFileBlockOccurrences", () => {
  it("treats {define} and {block} declarations as one shared block namespace", () => {
    const partial = "{define content}Partial{/define content}";
    const child = "{include #content}";
    const occurrences = latteCrossFileBlockOccurrences(
      [
        { relativePath: "app/child.latte", source: child },
        { relativePath: "app/blocks.latte", source: partial },
      ],
      "content",
    );

    expect(
      occurrences.map(({ document, occurrence }) => [
        document.relativePath,
        occurrence.kind,
      ]),
    ).toEqual([
      ["app/child.latte", "include"],
      ["app/blocks.latte", "declaration"],
      ["app/blocks.latte", "closing"],
    ]);
  });

  it("skips oversized documents when collecting occurrences", () => {
    const oversized = `{block content}${"x".repeat(1_000_001)}{/block}`;
    const occurrences = latteCrossFileBlockOccurrences(
      [{ relativePath: "app/huge.latte", source: oversized }],
      "content",
    );

    expect(occurrences).toEqual([]);
  });

  it("collects declarations, closers and includes per document", () => {
    const layout = "{block content}{/block content}";
    const child = "{include #content}\n{include parent}";
    const occurrences = latteCrossFileBlockOccurrences(
      [
        { relativePath: "app/child.latte", source: child },
        { relativePath: "app/@layout.latte", source: layout },
      ],
      "content",
    );

    expect(
      occurrences.map(({ document, occurrence }) => [
        document.relativePath,
        occurrence.kind,
      ]),
    ).toEqual([
      ["app/child.latte", "include"],
      ["app/@layout.latte", "declaration"],
      ["app/@layout.latte", "closing"],
    ]);
  });
});

describe("workspace path helpers", () => {
  it("computes workspace-relative paths defensively", () => {
    expect(latteWorkspaceRelativePath("/ws", "/ws/app/a.latte")).toBe(
      "app/a.latte",
    );
    expect(latteWorkspaceRelativePath("/ws/", "/ws/app/a.latte")).toBe(
      "app/a.latte",
    );
    expect(latteWorkspaceRelativePath("/ws", "/other/app/a.latte")).toBeNull();
    expect(latteWorkspaceRelativePath("/ws", "/ws")).toBeNull();
  });

  it("joins workspace paths without duplicate separators", () => {
    expect(joinLatteWorkspacePath("/ws", "app/a.latte")).toBe("/ws/app/a.latte");
    expect(joinLatteWorkspacePath("/ws/", "app/a.latte")).toBe(
      "/ws/app/a.latte",
    );
  });
});

function fileSystemDependencies(
  files: Record<string, string>,
): LatteCrossFileBlockDependencies {
  return {
    isRequestedRootActive: () => true,
    readTemplateFile: async (relativePath) => files[relativePath] ?? null,
  };
}
