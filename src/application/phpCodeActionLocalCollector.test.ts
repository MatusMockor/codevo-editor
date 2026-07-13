import { describe, expect, it } from "vitest";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import {
  collectPhpClassScopedCodeActions,
  collectPhpFileScopedCodeActions,
} from "./phpCodeActionLocalCollector";
import { phpCreateFromUsageCodeAction } from "./phpCreateMemberCodeActions";
import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";

function positionOffset(
  source: string,
  lineNumber: number,
  column: number,
): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let index = 0; index < lineNumber - 1; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }

  return offset + column - 1;
}

function applyAction(source: string, action: PhpCodeActionDescriptor): string {
  const edits = action.edits.map((edit) => ({
    end: positionOffset(
      source,
      edit.range.endLineNumber,
      edit.range.endColumn,
    ),
    start: positionOffset(
      source,
      edit.range.startLineNumber,
      edit.range.startColumn,
    ),
    text: edit.text,
  }));

  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) =>
        `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
      source,
    );
}

describe("phpCodeActionLocalCollector", () => {
  it("collects file-scoped refactors before workspace-specific orchestration", () => {
    const source = `<?php

function answer()
{
    return 42;
}
`;

    const actions = collectPhpFileScopedCodeActions(source, {
      end: source.indexOf("answer") + "answer".length,
      start: source.indexOf("answer"),
    });

    expect(actions.map((action) => action.title)).toContain("Add return type");
  });

  it("collects class-scoped create/generate actions without workspace dependencies", () => {
    const source = `<?php

class Invoice
{
    private string $number;

    public function store(): void
    {
        $this->persist();
    }
}
`;
    const range = {
      end: source.indexOf("persist") + "persist".length,
      start: source.indexOf("persist"),
    };
    const structure = parsePhpClassStructure(source);

    const actions = collectPhpClassScopedCodeActions(source, range, structure);

    expect(actions.map((action) => action.title)).toEqual(
      expect.arrayContaining(["Create method 'persist'", "Generate constructor"]),
    );
  });

  it("offers genuine promotion and applies its complete atomic edit set", () => {
    const source = `<?php

class Account
{
    private string $name;
    protected int $balance = 0;
}
`;
    const actions = collectPhpClassScopedCodeActions(
      source,
      { end: 0, start: 0 },
      parsePhpClassStructure(source),
    );
    const promotion = actions.find(
      (action) => action.title === "Generate constructor with promotion",
    );

    expect(promotion).toBeDefined();
    expect(promotion?.edits).toHaveLength(3);
    expect(applyAction(source, promotion!)).toBe(`<?php

class Account
{

    public function __construct(
        private string $name,
        protected int $balance = 0,
    ) {}
}
`);
  });

  it("creates a same-file parent method with protected visibility", () => {
    const source = `<?php

class Base
{
}

class Child extends Base
{
    public function run(): void
    {
        parent::handle('value');
    }
}
`;
    const start = source.indexOf("handle");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "handle".length,
      start,
    });

    expect(action).not.toBeNull();
    expect(applyAction(source, action!)).toContain(
      "protected function handle(string $arg0)",
    );
  });

  it.each([
    ["$this->persist()", "private function persist()"],
    ["self::persist()", "private static function persist()"],
    ["static::persist()", "private static function persist()"],
  ])("inserts %s into the class containing the cursor", (usage, signature) => {
    const source = `<?php

class Earlier
{
}

class Invoice
{
    public function store(): void
    {
        ${usage};
    }
}
`;
    const start = source.indexOf("persist");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "persist".length,
      start,
    });

    expect(action).not.toBeNull();
    const result = applyAction(source, action!);
    const earlierEnd = result.indexOf("class Invoice");

    expect(result.slice(0, earlierEnd)).not.toContain(signature);
    expect(result.slice(earlierEnd)).toContain(signature);
  });

  it("uses body identity when namespaces contain duplicate class names", () => {
    const source = `<?php

namespace A {
    class Service
    {
        private function persist() {}
    }
}

namespace B {
    class Service
    {
        public function run(): void
        {
            $this->persist();
        }
    }
}
`;
    const start = source.lastIndexOf("persist");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "persist".length,
      start,
    });

    expect(action).not.toBeNull();
    const result = applyAction(source, action!);
    const namespaceB = result.indexOf("namespace B");

    expect(result.slice(namespaceB)).toContain("private function persist()");
  });

  it("suppresses create-from-usage inside an anonymous class", () => {
    const source = `<?php

class Outer extends WrongBase
{
    public function run(): void
    {
        $value = new class extends RightBase {
            public function execute(): void
            {
                parent::missing();
            }
        };
    }
}
`;
    const start = source.indexOf("missing");

    expect(
      phpCreateFromUsageCodeAction(source, {
        end: start + "missing".length,
        start,
      }),
    ).toBeNull();
  });

  it("finds an anonymous body after constructor closures and excludes the argument closure", () => {
    const source = `<?php

class Outer
{
    public function run(): void
    {
        $value = new #[Marker(/* ] */ options: [']'])] class(function (): void {
            $this->outerMissing();
        }) extends Base {
            public function execute(): void
            {
                parent::innerMissing();
            }
        };
    }
}
`;
    const outerStart = source.indexOf("outerMissing");
    const outerAction = phpCreateFromUsageCodeAction(source, {
      end: outerStart + "outerMissing".length,
      start: outerStart,
    });

    expect(outerAction).not.toBeNull();
    expect(applyAction(source, outerAction!)).toContain(
      "private function outerMissing()",
    );

    const innerStart = source.indexOf("innerMissing");

    expect(
      phpCreateFromUsageCodeAction(source, {
        end: innerStart + "innerMissing".length,
        start: innerStart,
      }),
    ).toBeNull();
  });

  it.each([
    "#[Marker(/* ] */ 1)]",
    "#[Marker(// ]\n            1)]",
    "#[Marker(']', \"\\]\")]",
    "#[Marker([1, [2, 3]])]",
  ])("balances comments, strings, and brackets in %s", (attribute) => {
    const source = `<?php

class Outer extends WrongBase
{
    public function run(): void
    {
        $value = new ${attribute} class extends RightBase {
            public function execute(): void
            {
                parent::missing();
            }
        };
    }
}
`;
    const start = source.indexOf("missing");

    expect(
      phpCreateFromUsageCodeAction(source, {
        end: start + "missing".length,
        start,
      }),
    ).toBeNull();
  });

  it("inserts into Outer after an attributed closure with comment delimiters", () => {
    const source = `<?php

class Outer
{
    public function run(): void
    {
        $callback = #[Marker(/* ] } */ 1)] function (): void {
            $this->missing();
        };
    }
}
`;
    const start = source.indexOf("missing");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "missing".length,
      start,
    });

    expect(action).not.toBeNull();
    const result = applyAction(source, action!);
    const generated = result.indexOf("private function missing()");

    expect(generated).toBeGreaterThan(result.indexOf("        };"));
    expect(generated).toBeLessThan(result.lastIndexOf("}"));
  });

  it("renders legal self members for interfaces and suppresses properties", () => {
    const methodSource = `<?php

interface ServiceContract
{
    public function run(): void
    {
        self::missing();
    }
}
`;
    const methodStart = methodSource.indexOf("missing");
    const methodAction = phpCreateFromUsageCodeAction(methodSource, {
      end: methodStart + "missing".length,
      start: methodStart,
    });

    expect(methodAction).not.toBeNull();
    expect(applyAction(methodSource, methodAction!)).toContain(
      "public static function missing();",
    );

    const constantSource = methodSource.replace("self::missing()", "self::VALUE");
    const constantStart = constantSource.indexOf("VALUE");
    const constantAction = phpCreateFromUsageCodeAction(constantSource, {
      end: constantStart + "VALUE".length,
      start: constantStart,
    });

    expect(constantAction).not.toBeNull();
    expect(applyAction(constantSource, constantAction!)).toContain(
      "public const VALUE = null;",
    );

    const propertySource = methodSource.replace("self::missing()", "$this->value");
    const propertyStart = propertySource.indexOf("value");

    expect(
      phpCreateFromUsageCodeAction(propertySource, {
        end: propertyStart + "value".length,
        start: propertyStart,
      }),
    ).toBeNull();
  });

  it("suppresses enum properties and untyped readonly properties", () => {
    for (const source of [
      `<?php
enum Status
{
    public function value() { return $this->missing; }
}
`,
      `<?php
readonly class Service
{
    public function value() { return $this->missing; }
}
`,
    ]) {
      const start = source.indexOf("missing");

      expect(
        phpCreateFromUsageCodeAction(source, {
          end: start + "missing".length,
          start,
        }),
      ).toBeNull();
    }

    const typedSource = `<?php
readonly class Service
{
    public function initialize(): void
    {
        $this->missing = 'value';
    }
}
`;
    const typedStart = typedSource.indexOf("missing");
    const typedAction = phpCreateFromUsageCodeAction(typedSource, {
      end: typedStart + "missing".length,
      start: typedStart,
    });

    expect(typedAction).not.toBeNull();
    expect(applyAction(typedSource, typedAction!)).toContain(
      "private string $missing;",
    );
  });

  it("creates a static protected parent method from static invocation context", () => {
    const source = `<?php

class Base
{
}

class Child extends Base
{
    public static function run(): void
    {
        parent::missing();
    }
}
`;
    const start = source.indexOf("missing");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "missing".length,
      start,
    });

    expect(action).not.toBeNull();
    expect(applyAction(source, action!)).toContain(
      "protected static function missing()",
    );
  });

  it.each([
    [
      "public function run(): void",
      "$callback = static function (): void { parent::missing(); };",
      "protected static function missing()",
    ],
    [
      "public function run(): void",
      "$callback = static fn () => parent::missing();",
      "protected static function missing()",
    ],
    [
      "public static function run(): void",
      "$callback = function (): void { parent::missing(); };",
      "protected static function missing()",
    ],
    [
      "public static function run(): void",
      "$callback = fn () => parent::missing();",
      "protected static function missing()",
    ],
    [
      "public function run(): void",
      "$outer = function (): void { $inner = function (): void { parent::missing(); }; };",
      "protected function missing()",
    ],
  ])(
    "propagates static context through executable scopes for %s / %s",
    (methodDeclaration, statement, expectedSignature) => {
      const source = `<?php

class Base
{
}

class Child extends Base
{
    ${methodDeclaration}
    {
        ${statement}
    }
}
`;
      const start = source.indexOf("missing");
      const action = phpCreateFromUsageCodeAction(source, {
        end: start + "missing".length,
        start,
      });

      expect(action).not.toBeNull();
      expect(applyAction(source, action!)).toContain(expectedSignature);
    },
  );

  it("drops unresolved short types when a same-file parent is in another namespace", () => {
    const source = `<?php

namespace A {
    class Base
    {
    }
}

namespace B {
    class Local
    {
    }

    class Child extends \\A\\Base
    {
        public function run(): void
        {
            parent::missing(new Local());
        }
    }
}
`;
    const start = source.indexOf("missing");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "missing".length,
      start,
    });

    expect(action).not.toBeNull();
    const result = applyAction(source, action!);
    const baseBody = result.slice(result.indexOf("class Base"), result.indexOf("namespace B"));

    expect(baseBody).toContain("protected function missing($arg0)");
    expect(baseBody).not.toContain("Local $arg0");
  });

  it("never resolves an explicit FQN parent through a unique short-name decoy", () => {
    const source = `<?php

namespace Decoy {
    class Base
    {
    }
}

namespace App {
    class Child extends \\Vendor\\Base
    {
        public function run(): void
        {
            parent::missing();
        }
    }
}
`;
    const start = source.indexOf("missing");

    expect(
      phpCreateFromUsageCodeAction(source, {
        end: start + "missing".length,
        start,
      }),
    ).toBeNull();
  });

  it("resolves an unqualified same-file parent through its namespace import", () => {
    const source = `<?php

namespace Vendor {
    class Base
    {
    }
}

namespace App {
    use Vendor\\Base;

    class Child extends Base
    {
        public function run(): void
        {
            parent::missing();
        }
    }
}
`;
    const start = source.indexOf("missing");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "missing".length,
      start,
    });

    expect(action).not.toBeNull();
    const result = applyAction(source, action!);
    const baseBody = result.slice(
      result.indexOf("class Base"),
      result.indexOf("namespace App"),
    );

    expect(baseBody).toContain("protected function missing()");
  });

  it("creates a public static method in a same-file external class", () => {
    const source = `<?php

class OtherClass
{
}

class Service
{
    public function run(): void
    {
        OtherClass::missing('value');
    }
}
`;
    const start = source.indexOf("missing");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "missing".length,
      start,
    });

    expect(action).not.toBeNull();
    expect(action?.title).toBe("Create method 'missing' in 'OtherClass'");
    const result = applyAction(source, action!);
    const otherBody = result.slice(
      result.indexOf("class OtherClass"),
      result.indexOf("class Service"),
    );

    expect(otherBody).toContain(
      "public static function missing(string $arg0)",
    );
  });

  it("creates a public constant in a same-file external class", () => {
    const source = `<?php

class OtherClass
{
}

class Service
{
    public function run(): string
    {
        return OtherClass::MISSING;
    }
}
`;
    const start = source.indexOf("MISSING");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "MISSING".length,
      start,
    });

    expect(action).not.toBeNull();
    expect(action?.title).toBe("Create constant 'MISSING' in 'OtherClass'");
    const result = applyAction(source, action!);
    const otherBody = result.slice(
      result.indexOf("class OtherClass"),
      result.indexOf("class Service"),
    );

    expect(otherBody).toContain("public const MISSING = null;");
  });

  it("keeps short types for a same-namespace external sibling", () => {
    const source = `<?php

class Payload
{
}

class OtherClass
{
}

class Service
{
    public function run(): void
    {
        OtherClass::missing(new Payload());
    }
}
`;
    const start = source.indexOf("missing");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "missing".length,
      start,
    });

    expect(action).not.toBeNull();
    const result = applyAction(source, action!);
    const otherBody = result.slice(
      result.indexOf("class OtherClass"),
      result.indexOf("class Service"),
    );

    expect(otherBody).toContain(
      "public static function missing(Payload $arg0)",
    );
  });

  it("drops unresolved short types when the external sibling is in another namespace", () => {
    const source = `<?php

namespace A {
    class OtherClass
    {
    }
}

namespace B {
    use A\\OtherClass;

    class Local
    {
    }

    class Service
    {
        public function run(): void
        {
            OtherClass::missing(new Local());
        }
    }
}
`;
    const start = source.indexOf("missing");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "missing".length,
      start,
    });

    expect(action).not.toBeNull();
    const result = applyAction(source, action!);
    const otherBody = result.slice(
      result.indexOf("class OtherClass"),
      result.indexOf("namespace B"),
    );

    expect(otherBody).toContain("public static function missing($arg0)");
    expect(otherBody).not.toContain("Local $arg0");
  });

  it("creates a private static method when a class calls itself by name", () => {
    const source = `<?php

class Service
{
    public function run(): void
    {
        Service::missing();
    }
}
`;
    const start = source.indexOf("missing");
    const action = phpCreateFromUsageCodeAction(source, {
      end: start + "missing".length,
      start,
    });

    expect(action).not.toBeNull();
    expect(action?.title).toBe("Create method 'missing'");
    expect(applyAction(source, action!)).toContain(
      "private static function missing()",
    );
  });

  it("suppresses creation in a readonly same-file external class", () => {
    const source = `<?php

readonly class OtherClass
{
}

class Service
{
    public function run(): void
    {
        OtherClass::missing();
    }
}
`;
    const start = source.indexOf("missing");

    expect(
      phpCreateFromUsageCodeAction(source, {
        end: start + "missing".length,
        start,
      }),
    ).toBeNull();
  });

  it.each([
    "use Vendor\\Package as V;",
    "use Vendor\\{Package as V};",
    "use Vendor\\Package as V, Other\\Type;",
  ])(
    "expands an imported namespace alias prefix from %s",
    (useClause) => {
      const source = `<?php

namespace Vendor\\Package {
    class Base
    {
    }
}

namespace App\\V {
    class Base
    {
    }
}

namespace App {
    ${useClause}

    class Child extends V\\Base
    {
        public function run(): void
        {
            parent::missing();
        }
    }
}
`;
      const start = source.indexOf("missing");
      const action = phpCreateFromUsageCodeAction(source, {
        end: start + "missing".length,
        start,
      });

      expect(action).not.toBeNull();
      const result = applyAction(source, action!);
      const vendorBody = result.slice(
        result.indexOf("namespace Vendor\\Package"),
        result.indexOf("namespace App\\V"),
      );
      const decoyBody = result.slice(
        result.indexOf("namespace App\\V"),
        result.indexOf("namespace App {"),
      );

      expect(vendorBody).toContain("protected function missing()");
      expect(decoyBody).not.toContain("protected function missing()");
    },
  );
});
