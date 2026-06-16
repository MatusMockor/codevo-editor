import { describe, expect, it, vi } from "vitest";
import type { PhpFileOutline } from "../domain/phpFileOutline";
import { TauriPhpFileOutlineGateway } from "./tauriPhpFileOutlineGateway";

type PhpFileOutlineGatewayConstructor = ConstructorParameters<
  typeof TauriPhpFileOutlineGateway
>;
type InvokeCommand = NonNullable<PhpFileOutlineGatewayConstructor[0]>;

describe("TauriPhpFileOutlineGateway", () => {
  it("returns an empty outline outside Tauri", async () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const gateway = new TauriPhpFileOutlineGateway(invokeCommand, () => false);

    await expect(
      gateway.getPhpFileOutline("/workspace", "/workspace/src/User.php"),
    ).resolves.toEqual({ nodes: [] });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("delegates outline loading inside Tauri", async () => {
    const outline: PhpFileOutline = {
      nodes: [
        {
          children: [],
          column: 5,
          fullyQualifiedName: "App\\Domain\\User",
          id: "symbol:App\\Domain\\User",
          kind: "class",
          label: "User",
          lineNumber: 12,
          path: "/workspace/src/User.php",
          relativePath: "src/User.php",
        },
      ],
    };
    const invokeCommand = vi.fn<InvokeCommand>(async () => outline);
    const gateway = new TauriPhpFileOutlineGateway(invokeCommand, () => true);

    await expect(
      gateway.getPhpFileOutline("/workspace", "/workspace/src/User.php"),
    ).resolves.toEqual(outline);
    expect(invokeCommand).toHaveBeenCalledWith("get_php_file_outline", {
      path: "/workspace/src/User.php",
      root: "/workspace",
    });
  });
});
