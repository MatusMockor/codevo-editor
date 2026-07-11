import { describe, expect, it } from "vitest";
import {
  laravelBuiltInValidationRuleNames,
  phpLaravelValidationRuleCompletions,
  phpLaravelValidationRuleTableReferenceAt,
  phpLaravelValidationRuleStringContextAt,
} from "./phpLaravelValidation";

describe("phpLaravelValidation", () => {
  it("detects the rule string context inside $request->validate", () => {
    const source = `<?php

$request->validate([
    'email' => '',
]);
`;

    const context = phpLaravelValidationRuleStringContextAt(
      source,
      positionInside(source, "'email' => '", ""),
    );

    expect(context).not.toBeNull();
    expect(context?.prefix).toBe("");

    const completions = phpLaravelValidationRuleCompletions(context?.prefix ?? "");
    const names = completions.map((completion) => completion.name);

    expect(names).toContain("required");
    expect(names).toContain("email");
    expect(names).toContain("nullable");
    expect(names).toContain("string");
  });

  it("offers further rules after a pipe separator", () => {
    const source = `<?php

$request->validate([
    'email' => 'required|',
]);
`;

    const context = phpLaravelValidationRuleStringContextAt(
      source,
      positionAfter(source, "required|"),
    );

    expect(context).not.toBeNull();
    expect(context?.prefix).toBe("");

    const names = phpLaravelValidationRuleCompletions(context?.prefix ?? "").map(
      (completion) => completion.name,
    );

    expect(names).toContain("email");
    expect(names).toContain("nullable");
  });

  it("filters rules by the prefix typed after the pipe", () => {
    const source = `<?php

$request->validate([
    'email' => 'required|em',
]);
`;

    const context = phpLaravelValidationRuleStringContextAt(
      source,
      positionAfter(source, "required|em"),
    );

    expect(context?.prefix).toBe("em");

    const names = phpLaravelValidationRuleCompletions(context?.prefix ?? "").map(
      (completion) => completion.name,
    );

    expect(names).toContain("email");
    expect(names).not.toContain("required");
  });

  it("detects the rule string context inside Validator::make", () => {
    const source = `<?php

Validator::make($data, [
    'name' => 'req',
]);
`;

    const context = phpLaravelValidationRuleStringContextAt(
      source,
      positionAfter(source, "'name' => 'req"),
    );

    expect(context?.prefix).toBe("req");

    const names = phpLaravelValidationRuleCompletions(context?.prefix ?? "").map(
      (completion) => completion.name,
    );

    expect(names).toContain("required");
  });

  it("detects the rule string context inside $this->validate", () => {
    const source = `<?php

$this->validate($request, [
    'title' => 'str',
]);
`;

    const context = phpLaravelValidationRuleStringContextAt(
      source,
      positionAfter(source, "'title' => 'str"),
    );

    expect(context?.prefix).toBe("str");

    const names = phpLaravelValidationRuleCompletions(context?.prefix ?? "").map(
      (completion) => completion.name,
    );

    expect(names).toContain("string");
  });

  it("does not offer validation rules outside a rule string context", () => {
    const plainString = `<?php

$label = 'required';
`;
    const arrayKey = `<?php

$request->validate([
    'required' => 'string',
]);
`;
    const firstArgument = `<?php

Validator::make('required', []);
`;

    expect(
      phpLaravelValidationRuleStringContextAt(
        plainString,
        positionAfter(plainString, "'required"),
      ),
    ).toBeNull();
    expect(
      phpLaravelValidationRuleStringContextAt(
        arrayKey,
        positionAfter(arrayKey, "    'required"),
      ),
    ).toBeNull();
    expect(
      phpLaravelValidationRuleStringContextAt(
        firstArgument,
        positionAfter(firstArgument, "make('required"),
      ),
    ).toBeNull();
  });

  it("exposes the built-in rule names and filters completions by prefix", () => {
    expect(laravelBuiltInValidationRuleNames).toContain("between");
    expect(laravelBuiltInValidationRuleNames).toContain("unique");
    expect(laravelBuiltInValidationRuleNames).toContain("exists");

    const names = phpLaravelValidationRuleCompletions("req").map(
      (completion) => completion.name,
    );

    expect(names).toContain("required");
    expect(names.every((name) => name.startsWith("req"))).toBe(true);
    expect(names).not.toContain("email");
  });

  describe("validation rule table references", () => {
    it.each([
      ["exists", "exists:users,id"],
      ["unique", "unique:users,email"],
    ])("detects the %s rule table and exact range", (_, rule) => {
      const source = `<?php

$request->validate([
    'email' => '${rule}',
]);
`;
      const startOffset = source.indexOf("users");

      expect(
        phpLaravelValidationRuleTableReferenceAt(
          source,
          positionAtOffset(source, startOffset + 2),
        ),
      ).toEqual({
        endOffset: startOffset + "users".length,
        startOffset,
        tableName: "users",
      });
    });

    it("detects a table in a pipe-separated rule string", () => {
      const source = `<?php

$request->validate([
    'user_id' => 'required|exists:users,id',
]);
`;
      const startOffset = source.indexOf("users");

      expect(
        phpLaravelValidationRuleTableReferenceAt(
          source,
          positionAtOffset(source, startOffset + 1),
        ),
      ).toEqual({
        endOffset: startOffset + "users".length,
        startOffset,
        tableName: "users",
      });
    });

    it("detects a table in an array-form rule list", () => {
      const source = `<?php

$request->validate([
    'user_id' => ['required', 'exists:users,id'],
]);
`;
      const startOffset = source.indexOf("users");

      expect(
        phpLaravelValidationRuleTableReferenceAt(
          source,
          positionAtOffset(source, startOffset + 1),
        ),
      ).toEqual({
        endOffset: startOffset + "users".length,
        startOffset,
        tableName: "users",
      });
    });

    it("detects a table in a FormRequest rules method", () => {
      const source = `<?php

class StoreUserRequest extends FormRequest
{
    public function rules(): array
    {
        return ['user_id' => 'exists:users,id'];
    }
}
`;
      const startOffset = source.indexOf("users");

      expect(
        phpLaravelValidationRuleTableReferenceAt(
          source,
          positionAtOffset(source, startOffset + 1),
        ),
      ).toEqual({
        endOffset: startOffset + "users".length,
        startOffset,
        tableName: "users",
      });
    });

    it("excludes a dotted connection prefix from the table range", () => {
      const source = `<?php

$request->validate([
    'user_id' => 'exists:mysql.users,id',
]);
`;
      const startOffset = source.indexOf("users");

      expect(
        phpLaravelValidationRuleTableReferenceAt(
          source,
          positionAtOffset(source, startOffset + 1),
        ),
      ).toEqual({
        endOffset: startOffset + "users".length,
        startOffset,
        tableName: "users",
      });
    });

    it("does not detect the reference when the cursor is on the rule name", () => {
      const source = `<?php

$request->validate(['user_id' => 'exists:users,id']);
`;

      expect(
        phpLaravelValidationRuleTableReferenceAt(
          source,
          positionAtOffset(source, source.indexOf("exists") + 2),
        ),
      ).toBeNull();
    });

    it("does not detect a rule outside a validation context", () => {
      const source = "<?php $rule = 'exists:users,id';";

      expect(
        phpLaravelValidationRuleTableReferenceAt(
          source,
          positionAtOffset(source, source.indexOf("users") + 1),
        ),
      ).toBeNull();
    });
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  return positionAtOffset(source, offset + token.length);
}

function positionInside(source: string, before: string, prefix: string) {
  const offset = source.indexOf(before);

  if (offset < 0) {
    throw new Error(`Token not found: ${before}`);
  }

  return positionAtOffset(source, offset + before.length + prefix.length);
}

function positionAtOffset(source: string, offset: number) {
  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
