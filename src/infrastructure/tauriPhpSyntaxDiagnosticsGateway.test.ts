import { describe, expect, it, vi } from "vitest";
import { TauriPhpSyntaxDiagnosticsGateway } from "./tauriPhpSyntaxDiagnosticsGateway";

type GatewayConstructor = ConstructorParameters<
  typeof TauriPhpSyntaxDiagnosticsGateway
>;
type InvokeCommand = NonNullable<GatewayConstructor[0]>;

describe("TauriPhpSyntaxDiagnosticsGateway", () => {
  it("returns no diagnostics outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriPhpSyntaxDiagnosticsGateway(
      invokeCommand,
      () => false,
    );

    await expect(gateway.validate("<?php")).resolves.toEqual([]);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates syntax validation inside Tauri", async () => {
    const diagnostics = [
      {
        character: 3,
        endCharacter: 4,
        endLine: 0,
        line: 0,
        message: "PHP syntax error.",
      },
    ];
    const invokeCommand = vi.fn<InvokeCommand>(async () => diagnostics);
    const gateway = new TauriPhpSyntaxDiagnosticsGateway(
      invokeCommand,
      () => true,
    );

    await expect(gateway.validate("<?php ?")).resolves.toEqual(diagnostics);
    expect(invokeCommand).toHaveBeenCalledWith("parse_php_syntax", {
      source: "<?php ?",
    });
  });
});
