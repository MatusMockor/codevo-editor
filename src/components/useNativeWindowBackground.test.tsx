// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NativeWindowPort } from "../application/nativeWindowPort";
import type { PaletteId, ResolvedColorScheme } from "../domain/appearance";
import { useNativeWindowBackground } from "./useNativeWindowBackground";

function Probe(props: {
  readonly port: NativeWindowPort | null;
  readonly palette: PaletteId;
  readonly scheme: ResolvedColorScheme;
}) {
  useNativeWindowBackground(props.port, props.palette, props.scheme);
  return null;
}

describe("useNativeWindowBackground", () => {
  let host: HTMLDivElement;
  let root: Root;
  const colors: string[] = [];
  const port: NativeWindowPort = {
    setBackgroundColor(color) {
      colors.push(color);
      return Promise.resolve();
    },
    show: () => Promise.resolve(),
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    colors.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("follows runtime palette and scheme changes", () => {
    act(() => root.render(<Probe palette="graphite-teal" port={port} scheme="dark" />));
    act(() => root.render(<Probe palette="graphite-teal" port={port} scheme="light" />));
    act(() => root.render(<Probe palette="graphite-teal" port={port} scheme="light" />));

    expect(colors).toEqual(["#151616", "#EDEEEF"]);
  });

  it("stays silent without a native window", () => {
    act(() => root.render(<Probe palette="graphite-teal" port={null} scheme="light" />));

    expect(colors).toEqual([]);
  });
});
