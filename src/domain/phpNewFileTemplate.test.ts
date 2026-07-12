import { describe, expect, it } from "vitest";
import { phpLaravelFrameworkProvider } from "./phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "./phpFrameworkNetteProvider";
import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import type { Psr4Root } from "./workspace";
import { phpNewFileTemplate } from "./phpNewFileTemplate";

const appRoot: Psr4Root[] = [
  { dev: false, namespace: "App\\", paths: ["app/"] },
];

describe("phpNewFileTemplate", () => {
  it("renders a Laravel model skeleton", () => {
    expect(
      phpNewFileTemplate("app/Models/Order.php", appRoot, [
        phpLaravelFrameworkProvider,
      ]),
    ).toEqual({
      content: `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Order extends Model
{
}
`,
    });
  });

  it("renders a nested Laravel model skeleton", () => {
    expect(
      phpNewFileTemplate("app/Models/Sub/Order.php", appRoot, [
        phpLaravelFrameworkProvider,
      ]),
    ).toEqual({
      content: `<?php

namespace App\\Models\\Sub;

use Illuminate\\Database\\Eloquent\\Model;

class Order extends Model
{
}
`,
    });
  });

  it("renders a Laravel form request skeleton", () => {
    expect(
      phpNewFileTemplate("app/Http/Requests/StoreOrderRequest.php", appRoot, [
        phpLaravelFrameworkProvider,
      ]),
    ).toEqual({
      content: `<?php

namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;

class StoreOrderRequest extends FormRequest
{
}
`,
    });
  });

  it("renders a classic Nette presenter skeleton", () => {
    expect(
      phpNewFileTemplate("app/Presenters/HomePresenter.php", appRoot, [
        phpNetteFrameworkProvider,
      ]),
    ).toEqual({
      content: `<?php

namespace App\\Presenters;

use Nette\\Application\\UI\\Presenter;

class HomePresenter extends Presenter
{
}
`,
    });
  });

  it("renders a modern colocated Nette presenter skeleton", () => {
    expect(
      phpNewFileTemplate("app/UI/Home/HomePresenter.php", appRoot, [
        phpNetteFrameworkProvider,
      ]),
    ).toEqual({
      content: `<?php

namespace App\\UI\\Home;

use Nette\\Application\\UI\\Presenter;

class HomePresenter extends Presenter
{
}
`,
    });
  });

  it("renders a plain class for a non-presenter in a presenter directory", () => {
    expect(
      phpNewFileTemplate("app/Presenters/HomeService.php", appRoot),
    ).toEqual({
      content: `<?php

namespace App\\Presenters;

class HomeService
{
}
`,
    });
  });

  it("keeps service classes byte-identical to the plain skeleton", () => {
    expect(phpNewFileTemplate("app/Services/X.php", appRoot)).toEqual({
      content: `<?php

namespace App\\Services;

class X
{
}
`,
    });
  });

  it.each([
    ["no active framework", []],
    ["the opposite Nette provider", [phpNetteFrameworkProvider]],
    ["an unrelated custom provider", [{ id: "custom" }]],
  ] satisfies [string, readonly PhpFrameworkProvider[]][])(
    "renders a plain model class with %s",
    (_label, providers) => {
      expect(
        phpNewFileTemplate("app/Models/Order.php", appRoot, providers),
      ).toEqual({
        content: `<?php

namespace App\\Models;

class Order
{
}
`,
      });
      expect(
        phpNewFileTemplate(
          "app/Http/Requests/StoreOrderRequest.php",
          appRoot,
          providers,
        ),
      ).toEqual({
        content: `<?php

namespace App\\Http\\Requests;

class StoreOrderRequest
{
}
`,
      });
    },
  );

  it.each([
    ["no active framework", []],
    ["the opposite Laravel provider", [phpLaravelFrameworkProvider]],
    ["an unrelated custom provider", [{ id: "custom" }]],
  ] satisfies [string, readonly PhpFrameworkProvider[]][])(
    "renders a plain presenter class with %s",
    (_label, providers) => {
      expect(
        phpNewFileTemplate(
          "app/Presenters/HomePresenter.php",
          appRoot,
          providers,
        ),
      ).toEqual({
        content: `<?php

namespace App\\Presenters;

class HomePresenter
{
}
`,
      });
      expect(
        phpNewFileTemplate(
          "app/UI/Home/HomePresenter.php",
          appRoot,
          providers,
        ),
      ).toEqual({
        content: `<?php

namespace App\\UI\\Home;

class HomePresenter
{
}
`,
      });
    },
  );

  it("renders a class skeleton for a PSR-4-covered PHP path", () => {
    expect(phpNewFileTemplate("app/Service.php", appRoot)).toEqual({
      content: `<?php

namespace App;

class Service
{
}
`,
    });
  });

  it("returns null for a path outside the PSR-4 roots", () => {
    expect(phpNewFileTemplate("src/Service.php", appRoot)).toBeNull();
  });

  it("returns null for a non-PHP file", () => {
    expect(
      phpNewFileTemplate("app/Service.ts", appRoot, [
        phpLaravelFrameworkProvider,
      ]),
    ).toBeNull();
  });

  it("returns null for an invalid PHP identifier filename", () => {
    expect(phpNewFileTemplate("app/kebab-case.php", appRoot)).toBeNull();
  });

  it("maps nested directories to namespace segments", () => {
    expect(phpNewFileTemplate("app/Http/Controllers/UserController.php", appRoot)).toEqual({
      content: `<?php

namespace App\\Http\\Controllers;

class UserController
{
}
`,
    });
  });

  it("uses the root namespace for a file directly under the root", () => {
    expect(phpNewFileTemplate("app/User.php", appRoot)).toEqual({
      content: `<?php

namespace App;

class User
{
}
`,
    });
  });

  it("normalizes a trailing slash on the PSR-4 directory", () => {
    const roots: Psr4Root[] = [
      { dev: false, namespace: "Domain\\", paths: ["src/Domain/"] },
    ];

    expect(phpNewFileTemplate("src/Domain/Order.php", roots)).toEqual({
      content: `<?php

namespace Domain;

class Order
{
}
`,
    });
  });
});

describe("phpNewFileTemplate guards", () => {
  it("does not template blade templates", () => {
    expect(
      phpNewFileTemplate("app/Foo.blade.php", appRoot, [
        phpLaravelFrameworkProvider,
      ]),
    ).toBeNull();
  });

  it("does not template a leading-digit filename", () => {
    expect(
      phpNewFileTemplate("app/1Foo.php", appRoot, [
        phpLaravelFrameworkProvider,
      ]),
    ).toBeNull();
  });

  it("prefers the longest matching PSR-4 root", () => {
    const roots: Psr4Root[] = [
      { dev: false, namespace: "App\\", paths: ["app/"] },
      { dev: false, namespace: "App\\Domain\\", paths: ["app/Domain/"] },
    ];

    expect(phpNewFileTemplate("app/Domain/Order.php", roots)).toEqual({
      content: `<?php

namespace App\\Domain;

class Order
{
}
`,
    });
  });
});
