import { describe, expect, it } from "vitest";
import {
  extractFlatTranslationKeys,
  extractPhpArrayKeyPaths,
} from "./laravelKeyExtraction";

describe("extractPhpArrayKeyPaths", () => {
  it("extracts flat string keys", () => {
    const source = `<?php

return [
    'name' => 'Codevo',
    'env' => 'production',
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["env", "name"]);
  });

  it("extracts nested keys as dot-notation including intermediate levels", () => {
    const source = `<?php

return [
    'services' => [
        'stripe' => [
            'key' => 'sk_test',
        ],
    ],
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual([
      "services",
      "services.stripe",
      "services.stripe.key",
    ]);
  });

  it("extracts a mix of flat and nested keys", () => {
    const source = `<?php

return [
    'name' => 'Codevo',
    'mail' => [
        'from' => [
            'address' => 'hello@example.com',
            'name' => 'Codevo',
        ],
    ],
    'timezone' => 'UTC',
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual([
      "mail",
      "mail.from",
      "mail.from.address",
      "mail.from.name",
      "name",
      "timezone",
    ]);
  });

  it("ignores numeric / list indexes", () => {
    const source = `<?php

return [
    'providers' => [
        App\\Providers\\AppServiceProvider::class,
        App\\Providers\\RouteServiceProvider::class,
    ],
    'aliases' => [
        'App' => 'Illuminate\\Support\\Facades\\App',
    ],
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual([
      "aliases",
      "aliases.App",
      "providers",
    ]);
  });

  it("ignores explicit numeric string keys", () => {
    const source = `<?php

return [
    '0' => 'first',
    'name' => 'Codevo',
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["name"]);
  });

  it("does not pick up keys from string values", () => {
    const source = `<?php

return [
    'label' => 'fake' . "'other' => 'value'",
    'real' => true,
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["label", "real"]);
  });

  it("does not pick up a => that lives inside a string value", () => {
    const source = `<?php

return [
    'template' => 'name => :name',
    'real' => true,
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["real", "template"]);
  });

  it("does not pick up keys from comments", () => {
    const source = `<?php

return [
    // 'commented' => 'value',
    'name' => 'Codevo',
    /* 'blocked' => [ 'nested' => true ] */
    'env' => 'production',
    # 'hashed' => 'value',
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["env", "name"]);
  });

  it("supports the array() long syntax", () => {
    const source = `<?php

return array(
    'name' => 'Codevo',
    'nested' => array(
        'deep' => true,
    ),
);
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual([
      "name",
      "nested",
      "nested.deep",
    ]);
  });

  it("returns an empty array for an empty return array", () => {
    const source = `<?php

return [];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual([]);
  });

  it("returns an empty array when there is no return array", () => {
    const source = `<?php

$config = ['name' => 'Codevo'];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual([]);
  });

  it("ignores numeric keys but keeps their nested associative children", () => {
    const source = `<?php

return [
    'connections' => [
        0 => [
            'driver' => 'mysql',
        ],
    ],
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual([
      "connections",
      "connections.driver",
    ]);
  });

  it("deduplicates repeated key paths", () => {
    const source = `<?php

return [
    'name' => 'first',
    'name' => 'second',
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["name"]);
  });

  it("does not throw on unbalanced / unparsable input and returns best effort", () => {
    const source = `<?php

return [
    'name' => 'Codevo',
    'broken' => [
`;

    expect(() => extractPhpArrayKeyPaths(source)).not.toThrow();
    expect(extractPhpArrayKeyPaths(source)).toContain("name");
  });

  it("unescapes escaped quotes inside keys", () => {
    const source = `<?php

return [
    'a\\'b' => 'value',
    'plain' => true,
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["a'b", "plain"]);
  });

  it("ignores keys that live inside a PHP attribute", () => {
    const source = `<?php

#[SomeAttribute(['fake' => 'value'])]
return [
    'name' => 'Codevo',
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["name"]);
  });

  it("keeps dotted segments as a single key segment", () => {
    const source = `<?php

return [
    'a.b' => 'value',
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual(["a.b"]);
  });

  it("handles double-quoted keys", () => {
    const source = `<?php

return [
    "name" => "Codevo",
    "nested" => [
        "deep" => true,
    ],
];
`;

    expect(extractPhpArrayKeyPaths(source)).toEqual([
      "name",
      "nested",
      "nested.deep",
    ]);
  });
});

describe("extractFlatTranslationKeys", () => {
  it("extracts top-level keys from a JSON object", () => {
    const json = `{
  "Welcome": "Vitajte",
  "Goodbye": "Dovidenia"
}`;

    expect(extractFlatTranslationKeys(json)).toEqual(["Goodbye", "Welcome"]);
  });

  it("returns an empty array for an empty object", () => {
    expect(extractFlatTranslationKeys("{}")).toEqual([]);
  });

  it("returns an empty array for invalid JSON", () => {
    expect(extractFlatTranslationKeys("{ not valid")).toEqual([]);
  });

  it("returns an empty array for a non-object JSON value", () => {
    expect(extractFlatTranslationKeys('["a", "b"]')).toEqual([]);
  });

  it("deduplicates and sorts keys", () => {
    const json = `{ "b": "1", "a": "2" }`;

    expect(extractFlatTranslationKeys(json)).toEqual(["a", "b"]);
  });
});
