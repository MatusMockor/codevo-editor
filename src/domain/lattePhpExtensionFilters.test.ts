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
      {
        callableKind: "instance",
        className: "ProjectLatteExtension",
        methodName: "formatUserDate",
        name: "userDate",
        offset: offsetOf(source, "userDate"),
        serviceClassName: "ProjectLatteExtension",
      },
      {
        callableKind: "static",
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
        callableKind: "static",
        callableOffset: offsetOf(source, "format"),
        className: "\\App\\Filters\\UserDateFilter",
        methodName: "format",
        name: "userDate",
        offset: offsetOf(source, "userDate"),
        serviceClassName: "App\\Filters\\UserDateFilter",
      },
      {
        callableKind: "static",
        callableOffset: offsetOf(source, "formatShort"),
        className: "UserDateFilter",
        methodName: "formatShort",
        name: "shortDate",
        offset: offsetOf(source, "shortDate"),
        serviceClassName: "UserDateFilter",
      },
    ]);
  });

  it("resolves imported and namespace-relative class-string callables", () => {
    const source = [
      "<?php",
      "namespace App\\Latte;",
      "",
      "use Vendor\\Filters\\MoneyFilter as ImportedMoney;",
      "",
      "final class ProjectLatteExtension extends \\Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'imported' => [ImportedMoney::class, 'format'],",
      "            'relative' => [LocalFilter::class, 'render'],",
      "            'fqcn' => [\\GlobalFilters\\RawFilter::class, 'apply'],",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      {
        callableKind: "static",
        callableOffset: offsetOf(source, "format"),
        className: "ImportedMoney",
        methodName: "format",
        name: "imported",
        offset: offsetOf(source, "imported"),
        serviceClassName: "Vendor\\Filters\\MoneyFilter",
      },
      {
        callableKind: "static",
        callableOffset: offsetOf(source, "render"),
        className: "LocalFilter",
        methodName: "render",
        name: "relative",
        offset: offsetOf(source, "relative"),
        serviceClassName: "App\\Latte\\LocalFilter",
      },
      {
        callableKind: "static",
        callableOffset: offsetOf(source, "apply"),
        className: "\\GlobalFilters\\RawFilter",
        methodName: "apply",
        name: "fqcn",
        offset: offsetOf(source, "fqcn"),
        serviceClassName: "GlobalFilters\\RawFilter",
      },
    ]);
  });

  it("resolves $this and self::class to the containing namespaced extension", () => {
    const source = [
      "<?php",
      "namespace App\\Latte;",
      "",
      "final class ProjectLatteExtension extends \\Latte\\Extension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'instance' => [$this, 'formatInstance'],",
      "            'static' => [self::class, 'formatStatic'],",
      "        ];",
      "    }",
      "",
      "    public function formatInstance(): string",
      "    {",
      "        return '';",
      "    }",
      "",
      "    public static function formatStatic(): string",
      "    {",
      "        return '';",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      {
        callableKind: "instance",
        callableOffset: offsetOf(
          source,
          "formatInstance",
          offsetOf(source, "function formatInstance"),
        ),
        className: "App\\Latte\\ProjectLatteExtension",
        methodName: "formatInstance",
        name: "instance",
        offset: offsetOf(source, "instance"),
        serviceClassName: "App\\Latte\\ProjectLatteExtension",
      },
      {
        callableKind: "static",
        callableOffset: offsetOf(
          source,
          "formatStatic",
          offsetOf(source, "self::class"),
        ),
        className: "self",
        methodName: "formatStatic",
        name: "static",
        offset: offsetOf(source, "static'"),
        serviceClassName: "App\\Latte\\ProjectLatteExtension",
      },
    ]);
  });

  it("retains $this metadata for a potentially inherited method", () => {
    const source = [
      "<?php",
      "namespace App\\Latte;",
      "",
      "final class ProjectLatteExtension extends BaseLatteExtension",
      "{",
      "    public function getFilters(): array",
      "    {",
      "        return [",
      "            'inherited' => [$this, 'inheritedMethod'],",
      "        ];",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(lattePhpExtensionFiltersFromSource(source)).toEqual([
      {
        callableKind: "instance",
        className: "App\\Latte\\ProjectLatteExtension",
        methodName: "inheritedMethod",
        name: "inherited",
        offset: offsetOf(source, "inherited'"),
        serviceClassName: "App\\Latte\\ProjectLatteExtension",
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
        callableKind: "instance",
        callableOffset: offsetOf(
          source,
          "formatInside",
          source.indexOf("function formatInside"),
        ),
        className: "ProjectLatteExtension",
        methodName: "formatInside",
        name: "inside",
        offset: offsetOf(source, "inside"),
        serviceClassName: "ProjectLatteExtension",
      },
      {
        callableKind: "instance",
        className: "ProjectLatteExtension",
        methodName: "missingMethod",
        name: "missing",
        offset: offsetOf(source, "missing"),
        serviceClassName: "ProjectLatteExtension",
      },
      {
        callableKind: "static",
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
        callableKind: "instance",
        callableOffset: offsetOf(
          source,
          "formatInside",
          source.indexOf(
            "function formatInside",
            source.indexOf("class ProjectLatteExtension"),
          ),
        ),
        className: "ProjectLatteExtension",
        methodName: "formatInside",
        name: "inside",
        offset: offsetOf(source, "inside"),
        serviceClassName: "ProjectLatteExtension",
      },
    ]);
  });

  it("retains containing-class metadata when only a nested function matches", () => {
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
      {
        callableKind: "instance",
        className: "ProjectLatteExtension",
        methodName: "formatInside",
        name: "inside",
        offset: offsetOf(source, "inside"),
        serviceClassName: "ProjectLatteExtension",
      },
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
        callableKind: "instance",
        callableOffset: offsetOf(
          source,
          "func",
          source.indexOf("function func") + "function ".length,
        ),
        className: "ProjectLatteExtension",
        methodName: "func",
        name: "short",
        offset: offsetOf(source, "short"),
        serviceClassName: "ProjectLatteExtension",
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
      {
        callableKind: "instance",
        className: "Filters",
        methodName: "plainText",
        name: "plainText",
        offset: offsetOf(source, "plainText"),
        serviceClassName: "Filters",
      },
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
      {
        callableKind: "instance",
        className: "Filters",
        methodName: "inside",
        name: "inside",
        offset: offsetOf(source, "inside"),
        serviceClassName: "Filters",
      },
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
      {
        callableKind: "instance",
        className: "Filters",
        methodName: "valid",
        name: "valid",
        offset: offsetOf(source, "valid"),
        serviceClassName: "Filters",
      },
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
