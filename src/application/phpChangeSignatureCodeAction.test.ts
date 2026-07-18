import { describe, expect, it } from "vitest";
import { phpChangeSignatureCodeAction } from "./phpChangeSignatureCodeAction";

describe("phpChangeSignatureCodeAction", () => {
  it("offers the workflow on declarations and direct calls", () => {
    const declaration = "<?php function total(int $count): int {}";
    const call = "<?php total(1);";

    expect(action(declaration, declaration.indexOf("total"))).toMatchObject({
      interaction: { kind: "change-signature", path: "/workspace/a.php" },
      title: "Change signature…",
    });
    expect(action(call, call.indexOf("total"))).not.toBeNull();
  });

  it("does not offer the workflow on unrelated identifiers", () => {
    const source = "<?php $total = 1;";
    expect(action(source, source.indexOf("total"))).toBeNull();
  });
});

function action(source: string, offset: number) {
  return phpChangeSignatureCodeAction({
    offset,
    path: "/workspace/a.php",
    rootPath: "/workspace",
    source,
  });
}
