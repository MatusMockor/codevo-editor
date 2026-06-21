import { describe, expect, it } from "vitest";
import {
  isUsableLaravelTranslationKey,
  phpLaravelJsonTranslationCompletionInsertText,
  phpLaravelJsonTranslationKeysFromSource,
  phpLaravelJsonTranslationLocaleFromRelativePath,
  phpLaravelJsonTranslationTargetFromSource,
  phpLaravelTranslationCompletionInsertText,
  phpLaravelTranslationFileNameFromKey,
  phpLaravelTranslationFileNameFromRelativePath,
  phpLaravelTranslationKeysFromSource,
  phpLaravelTranslationReferenceContextAt,
  phpLaravelTranslationTargetFromSource,
} from "./phpLaravelTranslations";

describe("phpLaravelTranslations", () => {
  it("detects Laravel translation helper strings", () => {
    const source = `<?php

return __('messages.welcome');
`;

    expect(
      phpLaravelTranslationReferenceContextAt(
        source,
        positionAfter(source, "messages.we"),
      ),
    ).toEqual({
      call: "__",
      key: "messages.welcome",
      position: { column: 12, lineNumber: 3 },
      prefix: "messages.we",
    });
  });

  it("detects supported Laravel translation calls", () => {
    const samples = [
      ["trans('messages.welcome')", "trans"],
      ["trans_choice('messages.apples', 3)", "trans_choice"],
      ["Lang::get('messages.welcome')", "Lang::get"],
      ["Lang::has('messages.welcome')", "Lang::has"],
      ["Lang::choice('messages.apples', 3)", "Lang::choice"],
      ["__(key: 'messages.welcome')", "__"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelTranslationReferenceContextAt(
          source,
          positionAfter(
            source,
            expression.includes("apples") ? "messages.ap" : "messages.we",
          ),
        ),
      ).toMatchObject({
        call,
        key: expression.includes("apples")
          ? "messages.apples"
          : "messages.welcome",
      });
    }
  });

  it("detects Laravel JSON sentence translation keys", () => {
    const source = `<?php

return __('I love programming.');
`;

    expect(
      phpLaravelTranslationReferenceContextAt(
        source,
        positionAfter(source, "I love"),
      ),
    ).toMatchObject({
      call: "__",
      key: "I love programming.",
      prefix: "I love",
    });
  });

  it("ignores interpolation, invalid keys, and non-translation calls", () => {
    const interpolated = `<?php\n\nreturn __("messages.$key");\n`;
    const invalid = `<?php\n\nreturn __('vendor::messages.welcome');\n`;
    const wrongCall = `<?php\n\nreturn config('messages.welcome');\n`;

    expect(
      phpLaravelTranslationReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "messages."),
      ),
    ).toBeNull();
    expect(
      phpLaravelTranslationReferenceContextAt(
        invalid,
        positionAfter(invalid, "messages.welcome"),
      ),
    ).toBeNull();
    expect(
      phpLaravelTranslationReferenceContextAt(
        wrongCall,
        positionAfter(wrongCall, "messages.we"),
      ),
    ).toBeNull();
  });

  it("maps translation keys and file paths", () => {
    expect(phpLaravelTranslationFileNameFromKey("messages.welcome")).toBe(
      "messages",
    );
    expect(
      phpLaravelTranslationFileNameFromRelativePath("lang/en/messages.php"),
    ).toBe("messages");
    expect(
      phpLaravelTranslationFileNameFromRelativePath(
        "resources/lang/en/messages.php",
      ),
    ).toBe("messages");
    expect(
      phpLaravelTranslationFileNameFromRelativePath("lang/sk/messages.php"),
    ).toBe("messages");
    expect(
      phpLaravelTranslationFileNameFromRelativePath("lang/en/admin/messages.php"),
    ).toBeNull();
    expect(isUsableLaravelTranslationKey("messages.welcome")).toBe(true);
    expect(isUsableLaravelTranslationKey("messages.")).toBe(false);
  });

  it("maps JSON translation files by locale", () => {
    expect(phpLaravelJsonTranslationLocaleFromRelativePath("lang/es.json")).toBe(
      "es",
    );
    expect(
      phpLaravelJsonTranslationLocaleFromRelativePath("resources/lang/sk.json"),
    ).toBe("sk");
    expect(
      phpLaravelJsonTranslationLocaleFromRelativePath("lang/en/messages.php"),
    ).toBeNull();
  });

  it("extracts nested PHP array translation keys", () => {
    const source = `<?php

return [
    'welcome' => 'Welcome',
    'nested' => [
        'label' => 'Nested',
    ],
];
`;

    expect(phpLaravelTranslationKeysFromSource(source, "messages")).toEqual([
      { key: "messages.nested", position: { column: 6, lineNumber: 5 } },
      {
        key: "messages.nested.label",
        position: { column: 10, lineNumber: 6 },
      },
      { key: "messages.welcome", position: { column: 6, lineNumber: 4 } },
    ]);
    expect(
      phpLaravelTranslationTargetFromSource(
        source,
        "messages",
        "messages.welcome",
      ),
    ).toEqual({
      key: "messages.welcome",
      position: { column: 6, lineNumber: 4 },
    });
  });

  it("extracts top-level JSON translation keys with positions", () => {
    const source = `{
  "I love programming.": "Me encanta programar.",
  "Escaped \\"quote\\"": "Value",
  "Nested value": { "ignored": true }
}
`;

    expect(phpLaravelJsonTranslationKeysFromSource(source)).toEqual([
      { key: "Escaped \"quote\"", position: { column: 4, lineNumber: 3 } },
      { key: "I love programming.", position: { column: 4, lineNumber: 2 } },
      { key: "Nested value", position: { column: 4, lineNumber: 4 } },
    ]);
    expect(
      phpLaravelJsonTranslationTargetFromSource(
        source,
        "I love programming.",
      ),
    ).toEqual({
      key: "I love programming.",
      position: { column: 4, lineNumber: 2 },
    });
  });

  it("uses dotted-prefix suffix insert text", () => {
    expect(
      phpLaravelTranslationCompletionInsertText(
        "messages.welcome",
        "messages.we",
      ),
    ).toBe("welcome");
    expect(
      phpLaravelTranslationCompletionInsertText("auth.failed", "auth."),
    ).toBe("failed");
  });

  it("uses current word suffix insert text for JSON translation keys", () => {
    expect(
      phpLaravelJsonTranslationCompletionInsertText(
        "I love programming.",
        "I love",
      ),
    ).toBe("love programming.");
    expect(
      phpLaravelJsonTranslationCompletionInsertText("Welcome back", "Wel"),
    ).toBe("Welcome back");
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
