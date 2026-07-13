import { describe, expect, it } from "vitest";
import { lattePhpExtensionFiltersFromSource } from "./lattePhpExtensionFilters";

function offsetOf(source: string, needle: string): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index;
}

describe("lattePhpExtensionFiltersFromSource", () => {
  it("extracts string keys from a getFilters array return", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'userDate' => [$this, 'formatUserDate'],",
      "            \"money\" => [MoneyFilter::class, 'format'],",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      { name: "userDate", offset: offsetOf(source, "userDate") },
      { name: "money", offset: offsetOf(source, "money") },
    ]);
  });

  it("supports the array() static array form", () => {
    const source = [
      "<?php",
      "",
      "class Filters extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return array(",
      "            'plainText' => [$this, 'plainText'],",
      "        );",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      { name: "plainText", offset: offsetOf(source, "plainText") },
    ]);
  });

  it("ignores strings and comments outside getFilters", () => {
    const source = [
      "<?php",
      "",
      "// 'commentedOut' => [$this, 'format'],",
      "$example = \"outside\";",
      "",
      "class Filters extends Latte\\Extension",
      "{",
      "    public function getTags(): array",
      "    {",
      "        return ['tagOnly' => [$this, 'tag']];",
      "    }",
      "",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            // 'alsoCommented' => [$this, 'format'],",
      "            'inside' => [$this, 'inside'],",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      { name: "inside", offset: offsetOf(source, "inside") },
    ]);
  });

  it("only extracts top-level keys from the returned array", () => {
    const source = [
      "<?php",
      "",
      "class Filters extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'outer' => [",
      "                'nested' => 'value',",
      "            ],",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      { name: "outer", offset: offsetOf(source, "outer") },
    ]);
  });

  it("skips non-key strings, empty names, and dynamic returns", () => {
    const source = [
      "<?php",
      "",
      "class Filters extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'valueOnly',",
      "            '' => [$this, 'empty'],",
      "            $dynamic => [$this, 'dynamic'],",
      "            'valid' => [$this, 'valid'],",
      "        ];",
      "    }",
      "",
      "    public function getFiltersDynamic(): array",
      "    {",
      "        return $this->filters;",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      { name: "valid", offset: offsetOf(source, "valid") },
    ]);
  });

  it("requires getFilters to declare an array return type", () => {
    const source = [
      "<?php",
      "",
      "class Filters extends Latte\\Extension",
      "{",
      "    public function getFilters()",
      "    {",
      "        return ['missingType' => [$this, 'format']];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([]);
  });
});
