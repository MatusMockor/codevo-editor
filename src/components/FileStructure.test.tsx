// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PhpFileOutline,
  PhpFileOutlineNode,
} from "../domain/phpFileOutline";
import { FileStructure } from "./FileStructure";

describe("FileStructure", () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders a footer hint row", async () => {
    await renderFileStructure();
    expect(host.querySelector(".palette-footer")).not.toBeNull();
  });

  it("scrolls the selected symbol when navigating with arrow keys", async () => {
    await renderFileStructure();
    scrollIntoView.mockClear();

    await act(async () => {
      searchInput().dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowDown",
        }),
      );
    });

    const options = symbolOptions();

    expect(options[1].className).toContain("active");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("closes with Escape even when focus is on the inherited-members checkbox", async () => {
    const onClose = vi.fn();
    await renderFileStructure({ onClose });

    await act(async () => {
      checkbox().dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape",
        }),
      );
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders a round kind icon with the right letter and kind for each symbol", async () => {
    await renderFileStructure({ outline: symbolOutline() });

    const icons = symbolIcons();
    const byLabel = (label: string) =>
      icons.find((icon) => icon.closest("[role=option]")?.textContent?.includes(label));

    const methodIcon = byLabel("handle");
    expect(methodIcon?.dataset.kind).toBe("method");
    expect(methodIcon?.textContent).toBe("m");

    const propertyIcon = byLabel("userRepository");
    expect(propertyIcon?.dataset.kind).toBe("property");
    expect(propertyIcon?.textContent).toBe("p");

    const constantIcon = byLabel("MAX_RETRIES");
    expect(constantIcon?.dataset.kind).toBe("constant");
    expect(constantIcon?.textContent).toBe("c");
  });

  it("renders visibility badges with the right glyph and visibility, and none when undefined", async () => {
    await renderFileStructure({ outline: symbolOutline() });

    const optionFor = (label: string) =>
      symbolOptions().find((option) => option.textContent?.includes(label)) ?? null;

    const publicBadge = optionFor("handle")?.querySelector<HTMLElement>(
      ".symbol-visibility",
    );
    expect(publicBadge?.dataset.visibility).toBe("public");
    expect(publicBadge?.textContent).toBe("+");

    const privateBadge = optionFor("userRepository")?.querySelector<HTMLElement>(
      ".symbol-visibility",
    );
    expect(privateBadge?.dataset.visibility).toBe("private");
    expect(privateBadge?.textContent).toBe("−");

    const protectedBadge = optionFor("validate")?.querySelector<HTMLElement>(
      ".symbol-visibility",
    );
    expect(protectedBadge?.dataset.visibility).toBe("protected");
    expect(protectedBadge?.textContent).toBe("#");

    const noBadge = optionFor("MAX_RETRIES")?.querySelector(".symbol-visibility");
    expect(noBadge).toBeNull();
  });

  it("renders a method signature with parameters and return type", async () => {
    await renderFileStructure({ outline: symbolOutline() });

    const option = symbolOptions().find((row) =>
      row.textContent?.includes("handle"),
    );
    const signature = option?.querySelector<HTMLElement>(".signature");

    expect(signature?.textContent).toBe("(Request $request): void");
  });

  it("renders a property signature as a type annotation", async () => {
    await renderFileStructure({ outline: symbolOutline() });

    const option = symbolOptions().find((row) =>
      row.textContent?.includes("userRepository"),
    );
    const signature = option?.querySelector<HTMLElement>(".signature");

    expect(signature?.textContent).toBe(": UserRepository");
  });

  it("falls back to the plain name when signature fields are absent", async () => {
    await renderFileStructure({ outline: outline() });

    const option = symbolOptions().find((row) =>
      row.textContent?.includes("isValid"),
    );

    expect(option?.querySelector(".symbol-icon")).not.toBeNull();
    expect(option?.querySelector(".signature")?.textContent ?? "").toBe("");
    expect(option?.querySelector("strong")?.textContent).toBe("isValid");
  });

  async function renderFileStructure(
    overrides: Partial<{
      onClose: () => void;
      outline: PhpFileOutline;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <FileStructure
          canIncludeInheritedMembers={true}
          fileName="LocalUser.php"
          isLoading={false}
          isOpen={true}
          onChangeScope={vi.fn()}
          onClose={overrides.onClose ?? vi.fn()}
          onOpenNode={vi.fn()}
          outline={overrides.outline ?? outline()}
          scope="inherited"
        />,
      );
      await Promise.resolve();
    });
  }

  function symbolIcons(): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>(".symbol-icon"));
  }

  function searchInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search symbols"]',
    );

    if (!input) {
      throw new Error("Search input was not rendered.");
    }

    return input;
  }

  function checkbox(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]');

    if (!input) {
      throw new Error("Inherited members checkbox was not rendered.");
    }

    return input;
  }

  function symbolOptions(): HTMLButtonElement[] {
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
  }
});

function outline(): PhpFileOutline {
  return {
    nodes: [
      node({
        children: [
          node({ id: "method-valid", label: "isValid", lineNumber: 10 }),
          node({ id: "method-empty", label: "isEmpty", lineNumber: 20 }),
          node({ id: "method-enabled", label: "isEnabled", lineNumber: 30 }),
        ],
        id: "class-local-user",
        kind: "class",
        label: "LocalUser",
      }),
    ],
  };
}

function symbolOutline(): PhpFileOutline {
  return {
    nodes: [
      node({
        children: [
          node({
            id: "property-repo",
            kind: "property",
            label: "userRepository",
            lineNumber: 8,
            returnType: "UserRepository",
            visibility: "private",
          }),
          node({
            id: "method-handle",
            kind: "method",
            label: "handle",
            lineNumber: 12,
            parameters: [{ name: "$request", type: "Request" }],
            returnType: "void",
            visibility: "public",
          }),
          node({
            id: "method-validate",
            kind: "method",
            label: "validate",
            lineNumber: 20,
            parameters: [{ name: "$id", type: "int" }],
            returnType: "bool",
            visibility: "protected",
          }),
          node({
            id: "const-max",
            kind: "constant",
            label: "MAX_RETRIES",
            lineNumber: 4,
          }),
        ],
        id: "class-user-service",
        kind: "class",
        label: "UserService",
      }),
    ],
  };
}

function node(
  overrides: Partial<PhpFileOutlineNode> & {
    id: string;
    label: string;
  },
): PhpFileOutlineNode {
  const { id, label, ...rest } = overrides;

  return {
    children: [],
    column: 3,
    fullyQualifiedName: `App\\LocalUser::${label}`,
    id,
    kind: "method",
    label,
    lineNumber: 1,
    path: "/workspace/app/LocalUser.php",
    relativePath: "app/LocalUser.php",
    ...rest,
  };
}
