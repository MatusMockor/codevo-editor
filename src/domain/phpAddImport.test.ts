import { describe, expect, it } from "vitest";
import {
  parsePhpClassUseBody,
  phpCurrentNamespace,
  phpShortNameIsImported,
  planPhpAddImport,
} from "./phpAddImport";

function applyPlan(
  source: string,
  plan: { offset: number; text: string } | null,
): string {
  if (!plan) {
    throw new Error("expected a non-null add-import plan");
  }

  return source.slice(0, plan.offset) + plan.text + source.slice(plan.offset);
}

describe("phpShortNameIsImported", () => {
  it("detects a plain class import by its short name", () => {
    const source = `<?php

namespace App\\Http;

use App\\Models\\User;
`;

    expect(phpShortNameIsImported(source, "User")).toBe(true);
    expect(phpShortNameIsImported(source, "Post")).toBe(false);
  });

  it("detects an aliased import by its alias, not its last segment", () => {
    const source = `<?php

namespace App\\Http;

use App\\Models\\User as Account;
`;

    expect(phpShortNameIsImported(source, "Account")).toBe(true);
    expect(phpShortNameIsImported(source, "User")).toBe(false);
  });

  it("detects grouped imports", () => {
    const source = `<?php

namespace App\\Http;

use App\\Models\\{User, Post};
`;

    expect(phpShortNameIsImported(source, "User")).toBe(true);
    expect(phpShortNameIsImported(source, "Post")).toBe(true);
  });

  it("ignores a trait use inside the class body", () => {
    const source = `<?php

namespace App\\Http;

class Controller
{
    use SomeTrait;
}
`;

    expect(phpShortNameIsImported(source, "SomeTrait")).toBe(false);
  });
});

describe("parsePhpClassUseBody", () => {
  it("expands grouped aliases", () => {
    expect(parsePhpClassUseBody("Vendor\\{Package as V}")).toEqual([
      expect.objectContaining({ alias: "V", fqn: "Vendor\\Package" }),
    ]);
  });

  it("parses every comma-separated class import", () => {
    expect(
      parsePhpClassUseBody("Vendor\\Package as V, Other\\Type"),
    ).toEqual([
      expect.objectContaining({ alias: "V", fqn: "Vendor\\Package" }),
      expect.objectContaining({ alias: "Type", fqn: "Other\\Type" }),
    ]);
  });
});

describe("phpCurrentNamespace", () => {
  it("returns the declared namespace", () => {
    const source = `<?php

namespace App\\Http\\Controllers;

class Foo {}
`;

    expect(phpCurrentNamespace(source)).toBe("App\\Http\\Controllers");
  });

  it("returns null for the global namespace", () => {
    expect(phpCurrentNamespace("<?php\n\nclass Foo {}\n")).toBeNull();
  });
});

describe("planPhpAddImport", () => {
  it("inserts a use statement into the existing block in sorted order", () => {
    const source = `<?php

namespace App\\Http;

use App\\Models\\Comment;
use App\\Models\\User;

class Controller
{
}
`;

    const result = applyPlan(
      source,
      planPhpAddImport(source, "App\\Models\\Post"),
    );

    expect(result).toBe(`<?php

namespace App\\Http;

use App\\Models\\Comment;
use App\\Models\\Post;
use App\\Models\\User;

class Controller
{
}
`);
  });

  it("inserts before an alphabetically-later first import", () => {
    const source = `<?php

namespace App\\Http;

use App\\Models\\User;

class Controller
{
}
`;

    const result = applyPlan(
      source,
      planPhpAddImport(source, "App\\Models\\Post"),
    );

    expect(result).toBe(`<?php

namespace App\\Http;

use App\\Models\\Post;
use App\\Models\\User;

class Controller
{
}
`);
  });

  it("creates a use block after the namespace when none exists", () => {
    const source = `<?php

namespace App\\Http;

class Controller
{
}
`;

    const result = applyPlan(
      source,
      planPhpAddImport(source, "App\\Models\\Post"),
    );

    expect(result).toBe(`<?php

namespace App\\Http;

use App\\Models\\Post;

class Controller
{
}
`);
  });

  it("normalises a leading backslash on the inserted FQN", () => {
    const source = `<?php

namespace App\\Http;

use App\\Models\\User;

class Controller
{
}
`;

    const result = applyPlan(
      source,
      planPhpAddImport(source, "\\App\\Models\\Post"),
    );

    expect(result).toContain("use App\\Models\\Post;");
    expect(result).not.toContain("use \\App\\Models\\Post;");
  });

  it("returns null when the FQN is already imported", () => {
    const source = `<?php

namespace App\\Http;

use App\\Models\\User;

class Controller
{
}
`;

    expect(planPhpAddImport(source, "App\\Models\\User")).toBeNull();
  });
});
