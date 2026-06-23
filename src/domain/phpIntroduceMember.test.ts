import { describe, expect, it } from "vitest";
import {
  planIntroduceConstant,
  planIntroduceField,
} from "./phpIntroduceMember";

/**
 * Applies an introduce-member plan to the source so tests assert on the
 * resulting code rather than only on raw offsets. The two edits (insert the
 * declaration at the top of the class body, replace the literal/usage span) are
 * applied highest offset first, keeping lower offsets valid regardless of the
 * relative ordering of the two regions.
 */
function applyPlan(
  source: string,
  plan: {
    declarationOffset: number;
    declarationText: string;
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
  },
): string {
  const replaceEdit = {
    start: plan.replaceStart,
    end: plan.replaceEnd,
    text: plan.replacementText,
  };
  const declarationEdit = {
    start: plan.declarationOffset,
    end: plan.declarationOffset,
    text: plan.declarationText,
  };

  return [replaceEdit, declarationEdit]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) =>
        current.slice(0, edit.start) + edit.text + current.slice(edit.end),
      source,
    );
}

function offsetOf(source: string, needle: string): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index;
}

const STRING_CLASS = `<?php

class Greeter
{
    public function greet(): string
    {
        return 'Hello world';
    }
}
`;

const NUMBER_CLASS = `<?php

class Calculator
{
    public function compute(): int
    {
        return 42 * 2;
    }
}
`;

describe("planIntroduceConstant", () => {
  it("introduces a private const from a string literal and replaces it with self::NAME", () => {
    const offset = offsetOf(STRING_CLASS, "'Hello world'") + 2;

    const plan = planIntroduceConstant(STRING_CLASS, offset);

    expect(plan).not.toBeNull();
    expect(plan!.name).toBe("HELLO_WORLD");
    expect(plan!.replacementText).toBe("self::HELLO_WORLD");
    expect(applyPlan(STRING_CLASS, plan!)).toBe(`<?php

class Greeter
{
    private const HELLO_WORLD = 'Hello world';

    public function greet(): string
    {
        return self::HELLO_WORLD;
    }
}
`);
  });

  it("derives a generic name from a numeric literal", () => {
    const offset = offsetOf(NUMBER_CLASS, "42");

    const plan = planIntroduceConstant(NUMBER_CLASS, offset);

    expect(plan).not.toBeNull();
    expect(plan!.name).toBe("CONSTANT");
    expect(plan!.replacementText).toBe("self::CONSTANT");
    expect(applyPlan(NUMBER_CLASS, plan!)).toBe(`<?php

class Calculator
{
    private const CONSTANT = 42;

    public function compute(): int
    {
        return self::CONSTANT * 2;
    }
}
`);
  });

  it("honours an explicit constant name", () => {
    const offset = offsetOf(STRING_CLASS, "'Hello world'") + 2;

    const plan = planIntroduceConstant(STRING_CLASS, offset, "greeting");

    expect(plan).not.toBeNull();
    expect(plan!.name).toBe("GREETING");
    expect(plan!.replacementText).toBe("self::GREETING");
  });

  it("returns null when the cursor is not on a literal", () => {
    const offset = offsetOf(STRING_CLASS, "greet");

    expect(planIntroduceConstant(STRING_CLASS, offset)).toBeNull();
  });

  it("returns null when the literal sits outside any class", () => {
    const source = "<?php\n\n$greeting = 'Hello world';\n";
    const offset = offsetOf(source, "'Hello world'") + 2;

    expect(planIntroduceConstant(source, offset)).toBeNull();
  });

  it("returns null on a literal that is an existing const value (declaration position)", () => {
    const source = `<?php

class Greeter
{
    private const GREETING = 'Hello world';
}
`;
    const offset = offsetOf(source, "'Hello world'") + 2;

    expect(planIntroduceConstant(source, offset)).toBeNull();
  });

  it("returns null on a literal that is a property default (declaration position)", () => {
    const source = `<?php

class Greeter
{
    private string $greeting = 'Hello world';
}
`;
    const offset = offsetOf(source, "'Hello world'") + 2;

    expect(planIntroduceConstant(source, offset)).toBeNull();
  });

  it("returns null on a literal that is a default parameter value", () => {
    const source = `<?php

class Greeter
{
    public function greet(string $name = 'Hello world'): string
    {
        return $name;
    }
}
`;
    const offset = offsetOf(source, "'Hello world'") + 2;

    expect(planIntroduceConstant(source, offset)).toBeNull();
  });

  it("returns null on an enum backed-case value", () => {
    const source = `<?php

enum Suit: string
{
    case Hearts = 'H';
}
`;
    const offset = offsetOf(source, "'H'") + 1;

    expect(planIntroduceConstant(source, offset)).toBeNull();
  });

  it("returns null on a literal inside a nested anonymous class", () => {
    const source = `<?php

class Greeter
{
    public function make(): object
    {
        return new class {
            public function inner(): string
            {
                return 'Hello world';
            }
        };
    }
}
`;
    const offset = offsetOf(source, "'Hello world'") + 2;

    expect(planIntroduceConstant(source, offset)).toBeNull();
  });
});

describe("planIntroduceField", () => {
  it("introduces a typed property from a string literal and replaces it with $this->name", () => {
    const offset = offsetOf(STRING_CLASS, "'Hello world'") + 2;

    const plan = planIntroduceField(STRING_CLASS, offset);

    expect(plan).not.toBeNull();
    expect(plan!.name).toBe("helloWorld");
    expect(plan!.replacementText).toBe("$this->helloWorld");
    expect(applyPlan(STRING_CLASS, plan!)).toBe(`<?php

class Greeter
{
    private string $helloWorld = 'Hello world';

    public function greet(): string
    {
        return $this->helloWorld;
    }
}
`);
  });

  it("derives the field name and type from a local variable assignment", () => {
    const source = `<?php

class Service
{
    public function run(): void
    {
        $userName = 'Ada';
    }
}
`;
    const offset = offsetOf(source, "$userName");

    const plan = planIntroduceField(source, offset);

    expect(plan).not.toBeNull();
    expect(plan!.name).toBe("userName");
    expect(plan!.replacementText).toBe("$this->userName");
    expect(applyPlan(source, plan!)).toBe(`<?php

class Service
{
    private string $userName;

    public function run(): void
    {
        $this->userName = 'Ada';
    }
}
`);
  });

  it("returns null when the literal sits outside any class", () => {
    const source = "<?php\n\n$greeting = 'Hello world';\n";
    const offset = offsetOf(source, "'Hello world'") + 2;

    expect(planIntroduceField(source, offset)).toBeNull();
  });

  it("does not promote a variable that is read elsewhere in the method", () => {
    const source = `<?php

class Service
{
    public function run(): void
    {
        $userName = 'Ada';
        echo $userName;
    }
}
`;
    const offset = offsetOf(source, "$userName");

    expect(planIntroduceField(source, offset)).toBeNull();
  });
});
