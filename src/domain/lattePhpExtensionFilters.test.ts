import { describe, expect, it } from "vitest";
import { lattePhpExtensionFiltersFromSource } from "./lattePhpExtensionFilters";

function offsetOf(source: string, needle: string, start = 0): number {
  const index = source.indexOf(needle, start);

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
      {
        callableOffset: offsetOf(
          source,
          "format",
          offsetOf(source, "MoneyFilter"),
        ),
        className: "MoneyFilter",
        methodName: "format",
        name: "money",
        offset: offsetOf(source, "money"),
        serviceClassName: "MoneyFilter",
      },
    ]);
  });

  it("extracts external class callables from getFilters", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'userDate' => [\\App\\Filters\\UserDateFilter::class, 'format'],",
      "            'shortDate' => [UserDateFilter::class, 'formatShort'],",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      {
        callableOffset: offsetOf(source, "format"),
        className: "\\App\\Filters\\UserDateFilter",
        methodName: "format",
        name: "userDate",
        offset: offsetOf(source, "userDate"),
        serviceClassName: "App\\Filters\\UserDateFilter",
      },
      {
        callableOffset: offsetOf(source, "formatShort"),
        className: "UserDateFilter",
        methodName: "formatShort",
        name: "shortDate",
        offset: offsetOf(source, "shortDate"),
        serviceClassName: "UserDateFilter",
      },
    ]);
  });

  it("keeps filter names without callable info for unclear external callables", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'dynamicClass' => [$filterClass, 'format'],",
      "            'dynamicMethod' => [UserDateFilter::class, $method],",
      "            'callableString' => 'UserDateFilter::format',",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      { name: "dynamicClass", offset: offsetOf(source, "dynamicClass") },
      { name: "dynamicMethod", offset: offsetOf(source, "dynamicMethod") },
      { name: "callableString", offset: offsetOf(source, "callableString") },
    ]);
  });

  it("only marks static same-extension callables when the method exists", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'inside' => [$this, 'formatInside'],",
      "            'missing' => [$this, 'missingMethod'],",
      "            'external' => [ExternalFilter::class, 'format'],",
      "        ];",
      "    }",
      "",
      "    public function formatInside(): string",
      "    {",
      "        return '';",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      {
        callableOffset: offsetOf(
          source,
          "formatInside",
          source.indexOf("function formatInside"),
        ),
        name: "inside",
        offset: offsetOf(source, "inside"),
      },
      { name: "missing", offset: offsetOf(source, "missing") },
      {
        callableOffset: offsetOf(
          source,
          "format",
          offsetOf(source, "ExternalFilter"),
        ),
        className: "ExternalFilter",
        methodName: "format",
        name: "external",
        offset: offsetOf(source, "external"),
        serviceClassName: "ExternalFilter",
      },
    ]);
  });

  it("does not resolve a callable to a global function before the extension class", () => {
    const source = [
      "<?php",
      "",
      "function formatInside(): string",
      "{",
      "    return 'wrong';",
      "}",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'inside' => [$this, 'formatInside'],",
      "        ];",
      "    }",
      "",
      "    public function formatInside(): string",
      "    {",
      "        return 'right';",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      {
        callableOffset: offsetOf(
          source,
          "formatInside",
          source.indexOf(
            "function formatInside",
            source.indexOf("class ProjectLatteExtension"),
          ),
        ),
        name: "inside",
        offset: offsetOf(source, "inside"),
      },
    ]);
  });

  it("does not resolve a callable to a nested function inside getFilters", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        function formatInside(): string",
      "        {",
      "            return 'nested';",
      "        }",
      "",
      "        return [",
      "            'inside' => [$this, 'formatInside'],",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      { name: "inside", offset: offsetOf(source, "inside") },
    ]);
  });

  it("opens a callable method whose name appears inside the function keyword", () => {
    const source = [
      "<?php",
      "",
      "final class ProjectLatteExtension extends Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'short' => [$this, 'func'],",
      "        ];",
      "    }",
      "",
      "    public function func(): string",
      "    {",
      "        return '';",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      {
        callableOffset: offsetOf(
          source,
          "func",
          source.indexOf("function func") + "function ".length,
        ),
        name: "short",
        offset: offsetOf(source, "short"),
      },
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
      '$example = "outside";',
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
