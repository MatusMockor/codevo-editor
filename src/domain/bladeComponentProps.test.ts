import { describe, expect, it } from "vitest";
import {
  bladeClassComponentConstructorAttributes,
  bladeComponentPropsAttributes,
} from "./bladeComponentProps";

describe("bladeComponentPropsAttributes", () => {
  it("parses plain and defaulted props", () => {
    const source = [
      "@props(['type' => 'info', 'message'])",
      "<div class=\"alert alert-{{ $type }}\">{{ $message }}</div>",
    ].join("\n");

    expect(bladeComponentPropsAttributes(source)).toEqual(["type", "message"]);
  });

  it("parses double-quoted entries", () => {
    expect(
      bladeComponentPropsAttributes('@props(["title", "size" => "md"])'),
    ).toEqual(["title", "size"]);
  });

  it("keeps the key and skips nested array defaults", () => {
    const source =
      "@props(['options' => ['a' => 1, 'b' => [2, 3]], 'label' => null, 'icon'])";

    expect(bladeComponentPropsAttributes(source)).toEqual([
      "options",
      "label",
      "icon",
    ]);
  });

  it("kebab-cases camelCase prop names", () => {
    expect(bladeComponentPropsAttributes("@props(['iconName'])")).toEqual([
      "icon-name",
    ]);
  });

  it("handles multiline props declarations", () => {
    const source = [
      "@props([",
      "    'type' => 'info',",
      "    'message',",
      "])",
    ].join("\n");

    expect(bladeComponentPropsAttributes(source)).toEqual(["type", "message"]);
  });

  it("ignores malformed array", () => {
    expect(bladeComponentPropsAttributes("@props(['type' =>")).toEqual([]);
    expect(bladeComponentPropsAttributes("@props('type')")).toEqual([]);
    expect(bladeComponentPropsAttributes("@props([$type])")).toEqual([]);
    expect(bladeComponentPropsAttributes("@props")).toEqual([]);
  });

  it("ignores @props inside a Blade comment", () => {
    expect(
      bladeComponentPropsAttributes("{{-- @props(['type']) --}}<div></div>"),
    ).toEqual([]);
  });

  it("returns no attributes without a @props directive", () => {
    expect(bladeComponentPropsAttributes("<div>plain</div>")).toEqual([]);
  });
});

describe("bladeClassComponentConstructorAttributes", () => {
  it("maps constructor parameters to kebab-case attributes", () => {
    const source = [
      "<?php",
      "namespace App\\View\\Components;",
      "class Alert extends Component",
      "{",
      "    public function __construct(",
      "        public string $type = 'info',",
      "        public ?string $iconName = null,",
      "    ) {}",
      "}",
    ].join("\n");

    expect(bladeClassComponentConstructorAttributes(source)).toEqual([
      "type",
      "icon-name",
    ]);
  });

  it("skips DI service and variadic parameters", () => {
    const source = [
      "<?php",
      "namespace App\\View\\Components;",
      "class Alert extends Component",
      "{",
      "    public function __construct(",
      "        protected UrlGenerator $url,",
      "        LoggerInterface $logger,",
      "        public string $type = 'info',",
      "        string $message,",
      "        HtmlString ...$sections,",
      "    ) {}",
      "}",
    ].join("\n");

    expect(bladeClassComponentConstructorAttributes(source)).toEqual([
      "type",
      "message",
    ]);
  });

  it("keeps nullable and defaulted class-typed parameters", () => {
    const source = [
      "<?php",
      "class Alert extends Component",
      "{",
      "    public function __construct(",
      "        public ?HtmlString $slotHeader,",
      "        public HtmlString|null $slotFooter,",
      "        public Severity $severity = Severity::Info,",
      "        public HtmlString $body,",
      "    ) {}",
      "}",
    ].join("\n");

    expect(bladeClassComponentConstructorAttributes(source)).toEqual([
      "slot-header",
      "slot-footer",
      "severity",
    ]);
  });

  it("returns no attributes without a constructor", () => {
    const source = [
      "<?php",
      "class Alert extends Component",
      "{",
      "    public function render() {}",
      "}",
    ].join("\n");

    expect(bladeClassComponentConstructorAttributes(source)).toEqual([]);
  });
});
