import { describe, expect, it } from "vitest";
import {
  implementationChooserTitle,
  implementationTargetFromLocation,
} from "./implementationTargets";

describe("implementation target helpers", () => {
  it("labels implementation targets by nearest PHP type and namespace", () => {
    const target = implementationTargetFromLocation(
      {
        range: {
          end: {
            character: 31,
            line: 5,
          },
          start: {
            character: 20,
            line: 5,
          },
        },
        uri: "file:///workspace/app/Services/Analytics/Adapters/FacebookAdapterService.php",
      },
      `<?php
namespace App\\Services\\Analytics\\Adapters;

final class FacebookAdapterService
{
    public function getPlatform(): Platform
    {
    }
}
`,
    );

    expect(target).toEqual({
      detail: "\\App\\Services\\Analytics\\Adapters",
      id: "/workspace/app/Services/Analytics/Adapters/FacebookAdapterService.php:6:21",
      label: "FacebookAdapterService",
      path: "/workspace/app/Services/Analytics/Adapters/FacebookAdapterService.php",
      position: {
        column: 21,
        lineNumber: 6,
      },
    });
  });

  it("names the chooser after the requested symbol when available", () => {
    expect(implementationChooserTitle("getPlatform")).toBe(
      "Choose implementation of getPlatform",
    );
    expect(implementationChooserTitle(null)).toBe("Choose implementation");
  });
});
