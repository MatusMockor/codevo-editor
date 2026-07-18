import { describe, expect, it } from "vitest";
import {
  inspectPhpChangeSignatureCompletenessTarget,
  inspectPhpChangeSignatureReferenceShape,
  planPhpChangeSignature,
  type PhpChangeSignatureDocument,
  type PhpChangeSignatureParameter,
  type PhpChangeSignatureReference,
} from "./phpChangeSignature";

const ROOT = "/project";

describe("planPhpChangeSignature", () => {
  it("renames and reorders parameters across declarations and positional calls", () => {
    const parent = php(
      "Parent.php",
      "<?php interface ParentApi { public function send(string $to, int $count = 1): void; }",
    );
    const child = php(
      "Child.php",
      "<?php class Child implements ParentApi { public function send(string $to, int $count = 1): void {} }",
    );
    const consumer = php("Use.php", "<?php $client->send('a@b.test', 2);");

    const result = plan(
      [parent, child, consumer],
      ref(parent, "send", "declaration"),
      [
        parameter("count", "int $attempts"),
        parameter("to", "string $recipient"),
      ],
      [ref(child, "send", "declaration"), ref(consumer, "send", "call")],
    );

    expect(result).toMatchObject({
      kind: "planned",
      preview: { filesChanged: 3, referencesChanged: 1 },
    });
    if (result.kind !== "planned") return;
    expect(
      apply(
        child.content,
        result.preview.edits.filter((edit) => edit.path === child.path),
      ),
    ).toContain("send(int $attempts, string $recipient)");
    expect(
      apply(
        consumer.content,
        result.preview.edits.filter((edit) => edit.path === consumer.path),
      ),
    ).toContain("send(2, 'a@b.test')");
  });

  it("renames named arguments", () => {
    const declaration = php(
      "Service.php",
      "<?php function send(string $to, int $count = 1): void {}",
    );
    const call = php("Use.php", "<?php send(count: 2, to: 'a@b.test');");
    const result = plan(
      [declaration, call],
      ref(declaration, "send", "declaration"),
      [
        parameter("to", "string $recipient"),
        parameter("count", "int $attempts = 1"),
      ],
      [ref(call, "send", "call")],
    );
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(
      apply(
        call.content,
        result.preview.edits.filter((edit) => edit.path === call.path),
      ),
    ).toContain("send(recipient: 'a@b.test', attempts: 2)");
  });

  it("removes parameters and their arguments", () => {
    const declaration = php(
      "Service.php",
      "<?php function send(string $to, bool $trace): void {}",
    );
    const call = php("Use.php", "<?php send('a@b.test', true);");
    const result = plan(
      [declaration, call],
      ref(declaration, "send", "declaration"),
      [parameter("to", "string $to")],
      [ref(call, "send", "call")],
    );
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(
      apply(
        call.content,
        result.preview.edits.filter((edit) => edit.path === call.path),
      ),
    ).toContain("send('a@b.test')");
  });

  it("adds a required parameter using an explicit call-site expression", () => {
    const declaration = php(
      "Service.php",
      "<?php function send(string $to): void {}",
    );
    const call = php("Use.php", "<?php send('a@b.test');");
    const result = plan(
      [declaration, call],
      ref(declaration, "send", "declaration"),
      [
        parameter("to", "string $to"),
        {
          callArgument: "requestId()",
          declaration: "string $requestId",
          sourceName: null,
        },
      ],
      [ref(call, "send", "call")],
    );
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(
      apply(
        call.content,
        result.preview.edits.filter((edit) => edit.path === call.path),
      ),
    ).toContain("send('a@b.test', requestId())");
  });

  it("supports constructor calls", () => {
    const declaration = php(
      "Mail.php",
      "<?php class Mail { public function __construct(string $to) {} }",
    );
    const call = php("Use.php", "<?php $mail = new Mail('a@b.test');");
    const result = plan(
      [declaration, call],
      ref(declaration, "__construct", "declaration"),
      [parameter("to", "string $recipient")],
      [ref(call, "Mail", "call")],
    );
    expect(result.kind).toBe("planned");
  });

  it("uses named arguments when an omitted optional parameter creates a hole", () => {
    const declaration = php(
      "Service.php",
      "<?php function send(string $to, ?string $cc = null, bool $trace = false): void {}",
    );
    const call = php("Use.php", "<?php send('a@b.test', trace: true);");
    const result = plan(
      [declaration, call],
      ref(declaration, "send", "declaration"),
      [
        parameter("to", "string $to"),
        parameter("cc", "?string $cc = null"),
        parameter("trace", "bool $trace = false"),
      ],
      [ref(call, "send", "call")],
    );
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(
      apply(
        call.content,
        result.preview.edits.filter((edit) => edit.path === call.path),
      ),
    ).toContain("send(to: 'a@b.test', trace: true)");
  });

  it.each([
    ["unpacking", "<?php send(...$args);"],
    ["first class callable", "<?php $callable = send(...);"],
    ["dynamic callable", "<?php $send('a@b.test');"],
    ["unknown named argument", "<?php send(other: 1);"],
    ["positional after named", "<?php send(to: 'a', 2);"],
  ])("rejects ambiguous %s calls", (_label, source) => {
    const declaration = php(
      "Service.php",
      "<?php function send(string $to, int $count = 1): void {}",
    );
    const call = php("Use.php", source);
    expect(
      plan(
        [declaration, call],
        ref(declaration, "send", "declaration"),
        [parameter("to", "string $to"), parameter("count", "int $count = 1")],
        [ref(call, "send", "call")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });
  });

  it("supports statically resolved static and typed-receiver calls", () => {
    const declaration = php(
      "Service.php",
      "<?php class Service { public static function send(string $to): void {} }",
    );
    const calls = php(
      "Use.php",
      "<?php Service::send('a'); $service->send('b');",
    );
    const first = calls.content.indexOf("send");
    const second = calls.content.indexOf("send", first + 1);
    const result = plan(
      [declaration, calls],
      ref(declaration, "send", "declaration"),
      [parameter("to", "string $recipient")],
      [
        { offset: first, path: calls.path, role: "call" },
        { offset: second, path: calls.path, role: "call" },
      ],
    );
    expect(result).toMatchObject({
      kind: "planned",
      preview: { referencesChanged: 2 },
    });
  });

  it("preserves and removes positional variadic arguments", () => {
    const declaration = php(
      "Service.php",
      "<?php function collect(string $prefix, int ...$values): void {}",
    );
    const call = php("Use.php", "<?php collect('n', 1, 2, 3);");
    const preserved = plan(
      [declaration, call],
      ref(declaration, "collect", "declaration"),
      [
        parameter("prefix", "string $label"),
        parameter("values", "int ...$numbers"),
      ],
      [ref(call, "collect", "call")],
    );
    expect(plannedContent(preserved, call)).toContain("collect('n', 1, 2, 3)");

    const removed = plan(
      [declaration, call],
      ref(declaration, "collect", "declaration"),
      [parameter("prefix", "string $label")],
      [ref(call, "collect", "call")],
    );
    expect(plannedContent(removed, call)).toContain("collect('n')");
  });

  it("preserves by-reference variadic variables and rejects literal values", () => {
    const declaration = php(
      "Service.php",
      "<?php function mutate(string &...$values): void {}",
    );
    const validCall = php("Valid.php", "<?php mutate($one, $two);");
    const valid = plan(
      [declaration, validCall],
      ref(declaration, "mutate", "declaration"),
      [parameter("values", "string &...$items")],
      [ref(validCall, "mutate", "call")],
    );
    expect(plannedContent(valid, validCall)).toContain("mutate($one, $two)");

    const invalidCall = php("Invalid.php", "<?php mutate('literal');");
    expect(
      plan(
        [declaration, invalidCall],
        ref(declaration, "mutate", "declaration"),
        [parameter("values", "string &...$items")],
        [ref(invalidCall, "mutate", "call")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });
  });

  it("rejects collapsing multiple variadic values into one parameter", () => {
    const declaration = php(
      "Service.php",
      "<?php function collect(int ...$values): void {}",
    );
    const call = php("Use.php", "<?php collect(1, 2);");
    expect(
      plan(
        [declaration, call],
        ref(declaration, "collect", "declaration"),
        [parameter("values", "array $values")],
        [ref(call, "collect", "call")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });
  });

  it("supports union, intersection, defaults, by-reference and variadic declarations", () => {
    const declaration = php(
      "Service.php",
      "<?php function hydrate((A&B)|null &$target, string &...$parts): void {}",
    );
    const result = plan(
      [declaration],
      ref(declaration, "hydrate", "declaration"),
      [
        parameter("target", "(A&B)|null &$value"),
        {
          declaration: "array|string|null $options = null",
          sourceName: null,
        },
        parameter("parts", "string &...$segments"),
      ],
      [],
    );
    expect(plannedContent(result, declaration)).toContain(
      "hydrate((A&B)|null &$value, array|string|null $options = null, string &...$segments)",
    );
  });

  it("rejects non-referenceable expressions for by-reference parameters", () => {
    const declaration = php(
      "Service.php",
      "<?php function hydrate(string $target): void {}",
    );
    const literalCall = php("Use.php", "<?php hydrate('literal');");
    expect(
      plan(
        [declaration, literalCall],
        ref(declaration, "hydrate", "declaration"),
        [parameter("target", "string &$target")],
        [ref(literalCall, "hydrate", "call")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });

    const variableCall = php("Variable.php", "<?php hydrate($target);");
    expect(
      plan(
        [declaration, variableCall],
        ref(declaration, "hydrate", "declaration"),
        [
          parameter("target", "string $target"),
          {
            callArgument: "factory()",
            declaration: "Result &$result",
            sourceName: null,
          },
        ],
        [ref(variableCall, "hydrate", "call")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });
  });

  it("rejects hierarchy declarations with incompatible reference semantics", () => {
    const parent = php(
      "Parent.php",
      "<?php interface ParentApi { public function mutate(string &$value): void; }",
    );
    const child = php(
      "Child.php",
      "<?php class Child implements ParentApi { public function mutate(string $value): void {} }",
    );
    expect(
      plan(
        [parent, child],
        ref(parent, "mutate", "declaration"),
        [parameter("value", "string &$value")],
        [ref(child, "mutate", "declaration")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });
  });

  it.each([
    "string $value garbage",
    "string $value =",
    "string $value = 1; injected()",
    "string $one = $two",
    "string $value = ([)]",
    "Foo Bar $value",
    "?Foo|Bar $value",
    "string $value = 'unterminated",
    "string $value = 1 /* unterminated",
  ])("rejects malformed parameter declaration %s", (declarationText) => {
    const declaration = php("Service.php", "<?php function send(): void {}");
    expect(
      plan(
        [declaration],
        ref(declaration, "send", "declaration"),
        [{ declaration: declarationText, sourceName: null }],
        [],
      ),
    ).toMatchObject({ kind: "rejected" });
  });

  it("rejects unsafe call arguments and conflicting reference roles", () => {
    const declaration = php("Service.php", "<?php function send(): void {}");
    const call = php("Use.php", "<?php send();");
    expect(
      plan(
        [declaration, call],
        ref(declaration, "send", "declaration"),
        [
          {
            callArgument: "safe(), injected()",
            declaration: "string $value",
            sourceName: null,
          },
        ],
        [ref(call, "send", "call")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });

    expect(
      plan(
        [declaration],
        ref(declaration, "send", "declaration"),
        [],
        [ref(declaration, "send", "call")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });
  });

  it("supports attributed promoted parameters without treating attributes as comments", () => {
    const declaration = php(
      "Service.php",
      "<?php class Service { public function __construct(#[Inject('main')] public readonly ServiceInterface $service) {} }",
    );
    const result = plan(
      [declaration],
      ref(declaration, "__construct", "declaration"),
      [
        parameter(
          "service",
          "#[Inject('main')] public readonly ServiceInterface $dependency",
        ),
      ],
      [],
    );
    expect(plannedContent(result, declaration)).toContain(
      "__construct(#[Inject('main')] public readonly ServiceInterface $dependency)",
    );
  });

  it("rejects stale reference offsets instead of jumping to a nearby call", () => {
    const declaration = php("Service.php", "<?php function send(): void {}");
    const call = php("Use.php", "<?php $unrelated = 1; send();");
    expect(
      plan(
        [declaration, call],
        ref(declaration, "send", "declaration"),
        [],
        [
          {
            offset: call.content.indexOf("unrelated"),
            path: call.path,
            role: "call",
          },
        ],
      ),
    ).toEqual({ kind: "rejected", reason: "invalidReference" });
  });

  it("rejects a required addition without an expression", () => {
    const declaration = php("Service.php", "<?php function send(): void {}");
    expect(
      plan(
        [declaration],
        ref(declaration, "send", "declaration"),
        [{ declaration: "string $to", sourceName: null }],
        [],
      ),
    ).toEqual({ kind: "rejected", reason: "missingArgument" });
  });

  it("rejects invalid optional-before-required and non-final variadic signatures", () => {
    const declaration = php(
      "Service.php",
      "<?php function send(string $to): void {}",
    );
    expect(
      plan(
        [declaration],
        ref(declaration, "send", "declaration"),
        [
          parameter("to", "string $to = ''"),
          { callArgument: "1", declaration: "int $count", sourceName: null },
        ],
        [],
      ),
    ).toEqual({ kind: "rejected", reason: "unsupportedSignature" });
    expect(
      plan(
        [declaration],
        ref(declaration, "send", "declaration"),
        [
          parameter("to", "string ...$to"),
          { declaration: "int $count = 1", sourceName: null },
        ],
        [],
      ),
    ).toEqual({ kind: "rejected", reason: "unsupportedSignature" });
  });

  it("rejects hierarchy declarations with a different parameter identity", () => {
    const parent = php(
      "Parent.php",
      "<?php interface ParentApi { public function send(string $to): void; }",
    );
    const child = php(
      "Child.php",
      "<?php class Child implements ParentApi { public function send(string $recipient): void {} }",
    );
    expect(
      plan(
        [parent, child],
        ref(parent, "send", "declaration"),
        [parameter("to", "string $to")],
        [ref(child, "send", "declaration")],
      ),
    ).toEqual({ kind: "rejected", reason: "ambiguousReference" });
  });

  it("rejects missing documents and non-call references", () => {
    const declaration = php("Service.php", "<?php function send(): void {}");
    expect(
      plan(
        [declaration],
        ref(declaration, "send", "declaration"),
        [],
        [{ offset: 0, path: `${ROOT}/Missing.php`, role: "call" }],
      ),
    ).toEqual({ kind: "rejected", reason: "invalidReference" });
    const invalid = php("Use.php", "<?php $name = 'send';");
    expect(
      plan(
        [declaration, invalid],
        ref(declaration, "send", "declaration"),
        [],
        [ref(invalid, "send", "call")],
      ),
    ).toEqual({ kind: "rejected", reason: "invalidReference" });
  });
});

describe("Change Signature completeness classification", () => {
  it.each([
    ["global function", "<?php function total(int $n): int { return $n; }"],
    [
      "private method",
      "<?php class Service { private function total(int $n): int { return $n; } }",
    ],
    [
      "final method",
      "<?php class Service { final public function total(int $n): int { return $n; } }",
    ],
    [
      "method on final class",
      "<?php final class Service { public function total(int $n): int { return $n; } }",
    ],
  ])("accepts a statically closed %s", (_label, source) => {
    expect(
      inspectPhpChangeSignatureCompletenessTarget(
        source,
        source.indexOf("total"),
      ),
    ).toMatchObject({ kind: "safe" });
  });

  it.each([
    [
      "overridable method",
      "<?php class Service { public function total(int $n): int { return $n; } }",
    ],
    [
      "interface declaration",
      "<?php interface Service { public function total(int $n): int; }",
    ],
    [
      "trait declaration",
      "<?php trait Service { public function total(int $n): int { return $n; } }",
    ],
    [
      "abstract declaration",
      "<?php abstract class Service { abstract public function total(int $n): int; }",
    ],
  ])("rejects a hierarchy-ambiguous %s", (_label, source) => {
    expect(
      inspectPhpChangeSignatureCompletenessTarget(
        source,
        source.indexOf("total"),
      ),
    ).toEqual({ kind: "rejected", reason: "hierarchyAmbiguity" });
  });

  it("distinguishes direct calls from callable arrays and first-class callables", () => {
    const direct = "<?php Service::total(1);";
    const callableArray = "<?php $callable = [Service::class, 'total'];";
    const firstClass = "<?php $callable = Service::total(...);";
    expect(
      inspectPhpChangeSignatureReferenceShape(
        direct,
        direct.indexOf("total"),
      ),
    ).toBe("directCall");
    expect(
      inspectPhpChangeSignatureReferenceShape(
        callableArray,
        callableArray.indexOf("total"),
      ),
    ).toBe("unsupported");
    expect(
      inspectPhpChangeSignatureReferenceShape(
        firstClass,
        firstClass.indexOf("total"),
      ),
    ).toBe("unsupported");
  });
});

function plan(
  documents: PhpChangeSignatureDocument[],
  declaration: PhpChangeSignatureReference,
  parameters: PhpChangeSignatureParameter[],
  references: PhpChangeSignatureReference[],
) {
  return planPhpChangeSignature({
    declaration,
    documents,
    parameters,
    references,
  });
}

function php(name: string, content: string): PhpChangeSignatureDocument {
  return { content, path: `${ROOT}/${name}`, version: 1 };
}

function ref(
  document: PhpChangeSignatureDocument,
  needle: string,
  role: "call" | "declaration",
): PhpChangeSignatureReference {
  return {
    offset: document.content.indexOf(needle),
    path: document.path,
    role,
  };
}

function parameter(
  sourceName: string,
  declaration: string,
): PhpChangeSignatureParameter {
  return { declaration, sourceName };
}

function apply(
  source: string,
  edits: Array<{ end: number; start: number; text: string }>,
): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (content, edit) =>
        content.slice(0, edit.start) + edit.text + content.slice(edit.end),
      source,
    );
}

function plannedContent(
  result: ReturnType<typeof plan>,
  document: PhpChangeSignatureDocument,
): string {
  expect(result.kind).toBe("planned");
  if (result.kind !== "planned") return document.content;
  return apply(
    document.content,
    result.preview.edits.filter((edit) => edit.path === document.path),
  );
}
