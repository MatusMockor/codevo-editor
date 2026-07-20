import { describe, expect, it } from "vitest";
import { isPhpCodeOffset } from "./phpLexicalContext";

describe("isPhpCodeOffset", () => {
  it("accepts offsets in normal PHP code", () => {
    const source = `<?php\n$service->run();\n`;

    expect(isPhpCodeOffset(source, source.indexOf("run"))).toBe(true);
  });

  it.each([
    `<?php\n// $service->run();\n`,
    `<?php\n# $service->run();\n`,
    `<?php\n/* $service->run(); */\n`,
  ])("rejects offsets inside PHP comments", (source) => {
    expect(isPhpCodeOffset(source, source.indexOf("run"))).toBe(false);
  });

  it.each([
    `<?php\n$value = '$service->run()';\n`,
    `<?php\n$value = "$service->run()";\n`,
  ])("rejects offsets inside PHP strings", (source) => {
    expect(isPhpCodeOffset(source, source.indexOf("run"))).toBe(false);
  });

  it("accepts code after closed strings and comments", () => {
    const source = `<?php\n$value = 'run'; /* run */\n$service->run();\n`;

    expect(isPhpCodeOffset(source, source.lastIndexOf("run"))).toBe(true);
  });

  it("keeps PHP attributes in code context", () => {
    const source = `<?php\n#[Route('/users')]\nfinal class Users {}\n`;

    expect(isPhpCodeOffset(source, source.indexOf("Route"))).toBe(true);
  });
});
