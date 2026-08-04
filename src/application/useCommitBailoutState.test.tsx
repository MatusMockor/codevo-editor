// @vitest-environment jsdom

import { act, Profiler, useEffect, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCommitBailoutState } from "./useCommitBailoutState";

describe("useCommitBailoutState", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("exposes the initial state and stores a lazy initializer result", () => {
    const observed: number[] = [];
    render((value: number) => {
      observed.push(value);
    }, 7);

    expect(observed[0]).toBe(7);
  });

  it("publishes a changed value", () => {
    const observed: number[] = [];
    const publish = render((value: number) => {
      observed.push(value);
    }, 1);

    act(() => {
      publish(2);
    });

    expect(observed[observed.length - 1]).toBe(2);
  });

  it("resolves a functional update against the latest published value", () => {
    const observed: number[] = [];
    const publish = render((value: number) => {
      observed.push(value);
    }, 1);

    act(() => {
      publish((current) => current + 1);
      publish((current) => current + 1);
    });

    expect(observed[observed.length - 1]).toBe(3);
  });

  it("skips the dispatch when the published value is unchanged", () => {
    const commits: string[] = [];
    const publish = render(() => undefined, 1, commits);
    commits.length = 0;

    act(() => {
      publish(1);
    });

    expect(commits).toEqual([]);
  });

  it("skips the dispatch when a functional update preserves the current value", () => {
    const commits: string[] = [];
    const publish = render(() => undefined, 1, commits);
    commits.length = 0;

    act(() => {
      publish((current) => current);
    });

    expect(commits).toEqual([]);
  });

  it("skips a value-preserving publication made from the effect flush of a commit", () => {
    const commits: string[] = [];
    let publishOther: Dispatch<SetStateAction<number>> = () => undefined;
    let publishStable: Dispatch<SetStateAction<readonly string[]>> = () => undefined;
    const stableValue: readonly string[] = [];

    function Probe() {
      const [other, setOther] = useCommitBailoutState(0);
      const [tracked, setTracked] = useCommitBailoutState<readonly string[]>(stableValue);
      publishOther = setOther;
      publishStable = setTracked;
      useEffect(() => {
        publishStable(stableValue);
      }, [other, tracked]);

      return null;
    }

    act(() => {
      root.render(
        <Profiler
          id="probe"
          onRender={(_id, phase) => {
            commits.push(phase);
          }}
        >
          <Probe />
        </Profiler>,
      );
    });
    commits.length = 0;

    act(() => {
      publishOther(1);
    });

    expect(commits).toEqual(["update"]);
  });

  it("keeps the publisher identity stable across renders", () => {
    const publishers: Dispatch<SetStateAction<number>>[] = [];
    const publish = render(
      () => undefined,
      0,
      undefined,
      (setter) => {
        publishers.push(setter);
      },
    );

    act(() => {
      publish(1);
    });

    expect(publishers.length).toBeGreaterThan(1);
    expect(new Set(publishers).size).toBe(1);
  });

  function render(
    observe: (value: number) => void,
    initial: number,
    commits?: string[],
    observePublisher?: (publisher: Dispatch<SetStateAction<number>>) => void,
  ): Dispatch<SetStateAction<number>> {
    let publisher: Dispatch<SetStateAction<number>> = () => undefined;

    function Probe() {
      const [value, publish] = useCommitBailoutState(() => initial);
      publisher = publish;
      observe(value);
      observePublisher?.(publish);

      return null;
    }

    act(() => {
      root.render(
        <Profiler
          id="probe"
          onRender={(_id, phase) => {
            commits?.push(phase);
          }}
        >
          <Probe />
        </Profiler>,
      );
    });

    return (action) => publisher(action);
  }
});
