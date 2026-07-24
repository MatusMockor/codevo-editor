import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";

const DEFAULT_OVERSCAN = 8;
const DEFAULT_FALLBACK_VIEWPORT_HEIGHT = 360;
const PINNED_TO_BOTTOM_TOLERANCE = 4;

export interface WindowedRowsInput {
  readonly enabled: boolean;
  readonly itemCount: number;
  readonly estimateHeight: (index: number) => number;
  readonly keyForIndex: (index: number) => string;
  readonly overscan?: number;
  readonly fallbackViewportHeight?: number;
  readonly pinnedIndices?: readonly number[];
  readonly preserveScrollAnchor?: boolean;
}

export interface WindowedRow {
  readonly index: number;
  readonly offsetTop: number;
  readonly pinned: boolean;
}

export interface WindowedRowsResult {
  readonly rows: readonly WindowedRow[];
  readonly totalHeight: number;
  readonly windowOffsetTop: number;
  readonly containerRef: (element: HTMLElement | null) => void;
  readonly onScroll: (event: UIEvent<HTMLElement>) => void;
  readonly measureRow: (key: string, element: HTMLElement | null) => void;
  readonly scrollToIndex: (index: number, align: "nearest" | "start" | "end") => void;
  readonly isPinnedToBottom: () => boolean;
  readonly scrollToBottom: () => void;
}

interface HeightModel {
  readonly offsets: readonly number[];
  readonly totalHeight: number;
  readonly uniformHeight: number | null;
}

interface WindowRange {
  readonly endIndex: number;
  readonly startIndex: number;
}

interface LiveKeys {
  readonly indexByKey: ReadonlyMap<string, number>;
  readonly keysByIndex: readonly string[];
  readonly keys: ReadonlySet<string>;
}

interface ScrollAnchorSnapshot {
  readonly keys: readonly string[];
  readonly offsets: readonly number[];
}

export function useWindowedRows(input: WindowedRowsInput): WindowedRowsResult {
  const {
    enabled,
    estimateHeight,
    fallbackViewportHeight = DEFAULT_FALLBACK_VIEWPORT_HEIGHT,
    itemCount,
    keyForIndex,
    overscan = DEFAULT_OVERSCAN,
    pinnedIndices = [],
    preserveScrollAnchor = false,
  } = input;
  const normalizedItemCount = Math.max(0, Math.trunc(itemCount));
  const normalizedOverscan = Math.max(0, Math.trunc(overscan));
  const normalizedFallbackHeight = Math.max(0, fallbackViewportHeight);
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const containerElementRef = useRef<HTMLElement | null>(null);
  const containerWidthRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const scrollAnchorSnapshotRef = useRef<ScrollAnchorSnapshot | null>(null);
  const [containerElement, setContainerElement] = useState<HTMLElement | null>(null);
  const [measurementEpoch, setMeasurementEpoch] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const containerRef = useCallback((element: HTMLElement | null) => {
    containerElementRef.current = element;
    setContainerElement(element);
  }, []);

  const liveKeys = useMemo<LiveKeys>(() => {
    const indexByKey = new Map<string, number>();
    const keysByIndex: string[] = [];
    const keys = new Set<string>();

    for (let index = 0; index < normalizedItemCount; index += 1) {
      const key = keyForIndex(index);
      keysByIndex.push(key);
      keys.add(key);

      if (!indexByKey.has(key)) {
        indexByKey.set(key, index);
      }
    }

    return { indexByKey, keys, keysByIndex };
  }, [keyForIndex, normalizedItemCount]);

  const heightModel = useMemo<HeightModel>(() => {
    const offsets = new Array<number>(normalizedItemCount + 1);
    const measuredHeights = measuredHeightsRef.current;
    let uniformHeight: number | null = null;
    let estimatesAreUniform = true;
    let hasLiveMeasurement = false;
    offsets[0] = 0;

    for (let index = 0; index < normalizedItemCount; index += 1) {
      const estimate = normalizedHeight(estimateHeight(index));
      const key = keyForIndex(index);
      const measuredHeight = enabled ? measuredHeights.get(key) : undefined;
      const height = measuredHeight ?? estimate;
      offsets[index + 1] = offsets[index] + height;

      if (index === 0) {
        uniformHeight = estimate;
      }

      if (uniformHeight !== estimate) {
        estimatesAreUniform = false;
      }

      if (measuredHeight !== undefined) {
        hasLiveMeasurement = true;
      }
    }

    if (!estimatesAreUniform || hasLiveMeasurement) {
      uniformHeight = null;
    }

    return {
      offsets,
      totalHeight: offsets[normalizedItemCount] ?? 0,
      uniformHeight,
    };
  }, [enabled, estimateHeight, keyForIndex, measurementEpoch, normalizedItemCount]);

  useLayoutEffect(() => {
    const measuredHeights = measuredHeightsRef.current;

    if (!enabled) {
      measuredHeights.clear();
      return;
    }

    let pruned = false;

    for (const key of measuredHeights.keys()) {
      if (liveKeys.keys.has(key)) {
        continue;
      }

      measuredHeights.delete(key);
      pruned = true;
    }

    if (!pruned) {
      return;
    }

    setMeasurementEpoch((current) => current + 1);
  }, [enabled, liveKeys]);

  useLayoutEffect(() => {
    if (!containerElement || !enabled) {
      return;
    }

    const measureViewport = () => {
      const nextWidth = containerElement.clientWidth;
      const previousWidth = containerWidthRef.current;
      containerWidthRef.current = nextWidth;
      setViewportHeight(containerElement.clientHeight);

      if (
        previousWidth === null ||
        previousWidth === nextWidth ||
        measuredHeightsRef.current.size === 0
      ) {
        return;
      }

      measuredHeightsRef.current.clear();
      setMeasurementEpoch((current) => current + 1);
    };

    measureViewport();
    const animationFrame = requestAnimationFrame(measureViewport);

    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(animationFrame);
    }

    const resizeObserver = new ResizeObserver(measureViewport);
    resizeObserver.observe(containerElement);

    if (containerElement.parentElement) {
      resizeObserver.observe(containerElement.parentElement);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [containerElement, enabled]);

  useEffect(
    () => () => {
      if (scrollAnimationFrameRef.current === null) {
        return;
      }

      cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    },
    [],
  );

  const effectiveViewportHeight = viewportHeight > 0 ? viewportHeight : normalizedFallbackHeight;
  const maxScrollTop = Math.max(0, heightModel.totalHeight - effectiveViewportHeight);
  const normalizedScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));

  useLayoutEffect(() => {
    const previousSnapshot = scrollAnchorSnapshotRef.current;
    scrollAnchorSnapshotRef.current = {
      keys: liveKeys.keysByIndex,
      offsets: heightModel.offsets,
    };

    if (!containerElement) {
      return;
    }

    let nextScrollTop = normalizedScrollTop;

    if (enabled && preserveScrollAnchor && previousSnapshot) {
      const delta = scrollAnchorDelta(
        previousSnapshot,
        liveKeys.indexByKey,
        heightModel.offsets,
        containerElement.scrollTop,
      );

      if (delta !== null) {
        const currentViewportHeight =
          containerElement.clientHeight > 0
            ? containerElement.clientHeight
            : effectiveViewportHeight;
        const currentMaxScrollTop = Math.max(0, heightModel.totalHeight - currentViewportHeight);
        nextScrollTop = Math.max(
          0,
          Math.min(currentMaxScrollTop, containerElement.scrollTop + delta),
        );
      }
    }

    if (containerElement.scrollTop === nextScrollTop) {
      return;
    }

    containerElement.scrollTop = nextScrollTop;
    pendingScrollTopRef.current = nextScrollTop;
    setScrollTop(nextScrollTop);
  }, [
    containerElement,
    effectiveViewportHeight,
    enabled,
    heightModel.offsets,
    heightModel.totalHeight,
    liveKeys,
    normalizedScrollTop,
    preserveScrollAnchor,
  ]);

  const windowRange = useMemo<WindowRange>(() => {
    if (!enabled) {
      return { endIndex: normalizedItemCount, startIndex: 0 };
    }

    if (normalizedItemCount === 0) {
      return { endIndex: 0, startIndex: 0 };
    }

    const visibleStart = indexAtOffset(heightModel, normalizedItemCount, normalizedScrollTop);
    const startIndex = Math.max(0, visibleStart - normalizedOverscan);
    const viewportBottom = normalizedScrollTop + effectiveViewportHeight;
    let visibleEnd = firstIndexAtOrAfterOffset(heightModel, normalizedItemCount, viewportBottom);

    if (visibleEnd <= visibleStart) {
      visibleEnd = Math.min(normalizedItemCount, visibleStart + 1);
    }

    return {
      endIndex: Math.min(normalizedItemCount, visibleEnd + normalizedOverscan),
      startIndex,
    };
  }, [
    effectiveViewportHeight,
    enabled,
    heightModel,
    normalizedItemCount,
    normalizedOverscan,
    normalizedScrollTop,
  ]);

  const rows = useMemo<readonly WindowedRow[]>(() => {
    const windowRows: WindowedRow[] = [];

    for (let index = windowRange.startIndex; index < windowRange.endIndex; index += 1) {
      windowRows.push({
        index,
        offsetTop: heightModel.offsets[index] ?? 0,
        pinned: false,
      });
    }

    if (!enabled || pinnedIndices.length === 0) {
      return windowRows;
    }

    const includedIndices = new Set(windowRows.map((row) => row.index));

    for (const requestedIndex of pinnedIndices) {
      const index = Math.trunc(requestedIndex);

      if (index < 0 || index >= normalizedItemCount || includedIndices.has(index)) {
        continue;
      }

      includedIndices.add(index);
      windowRows.push({
        index,
        offsetTop: heightModel.offsets[index] ?? 0,
        pinned: true,
      });
    }

    windowRows.sort((left, right) => left.index - right.index);
    return windowRows;
  }, [
    enabled,
    heightModel.offsets,
    normalizedItemCount,
    pinnedIndices,
    windowRange.endIndex,
    windowRange.startIndex,
  ]);

  const onScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }

      pendingScrollTopRef.current = event.currentTarget.scrollTop;

      if (scrollAnimationFrameRef.current !== null) {
        return;
      }

      scrollAnimationFrameRef.current = requestAnimationFrame(() => {
        scrollAnimationFrameRef.current = null;
        setScrollTop(pendingScrollTopRef.current);
      });
    },
    [enabled],
  );

  const measureRow = useCallback(
    (key: string, element: HTMLElement | null) => {
      if (!enabled || !element) {
        return;
      }

      const index = liveKeys.indexByKey.get(key);

      if (index === undefined) {
        return;
      }

      const measuredHeight = normalizedHeight(element.offsetHeight);

      if (measuredHeight <= 0) {
        return;
      }

      const previousHeight =
        measuredHeightsRef.current.get(key) ?? normalizedHeight(estimateHeight(index));

      if (Math.abs(measuredHeight - previousHeight) < 1) {
        return;
      }

      measuredHeightsRef.current.set(key, measuredHeight);
      setMeasurementEpoch((current) => current + 1);
    },
    [enabled, estimateHeight, liveKeys],
  );

  const applyScrollTop = useCallback((nextScrollTop: number) => {
    const container = containerElementRef.current;

    if (!container) {
      return;
    }

    container.scrollTop = nextScrollTop;
    pendingScrollTopRef.current = nextScrollTop;
    setScrollTop(nextScrollTop);
  }, []);

  const scrollToIndex = useCallback(
    (requestedIndex: number, align: "nearest" | "start" | "end") => {
      const container = containerElementRef.current;

      if (!container || normalizedItemCount === 0) {
        return;
      }

      const finiteIndex = Number.isFinite(requestedIndex) ? requestedIndex : 0;
      const index = Math.max(0, Math.min(normalizedItemCount - 1, Math.trunc(finiteIndex)));
      const rowTop = heightModel.offsets[index] ?? 0;
      const rowBottom = heightModel.offsets[index + 1] ?? rowTop;
      const currentScrollTop = container.scrollTop;
      const currentViewportHeight =
        container.clientHeight > 0 ? container.clientHeight : effectiveViewportHeight;
      const currentMaxScrollTop = Math.max(0, heightModel.totalHeight - currentViewportHeight);
      let nextScrollTop = rowTop;

      if (align === "end") {
        nextScrollTop = rowBottom - currentViewportHeight;
      }

      if (align === "nearest") {
        nextScrollTop = currentScrollTop;

        if (rowTop < currentScrollTop) {
          nextScrollTop = rowTop;
        }

        if (rowBottom > currentScrollTop + currentViewportHeight) {
          nextScrollTop = rowBottom - currentViewportHeight;
        }
      }

      applyScrollTop(Math.max(0, Math.min(currentMaxScrollTop, nextScrollTop)));
    },
    [
      applyScrollTop,
      effectiveViewportHeight,
      heightModel.offsets,
      heightModel.totalHeight,
      normalizedItemCount,
    ],
  );

  const isPinnedToBottom = useCallback(() => {
    const container = containerElementRef.current;

    if (!container) {
      return false;
    }

    return (
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - PINNED_TO_BOTTOM_TOLERANCE
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = containerElementRef.current;

    if (!container) {
      return;
    }

    const scrollHeight = Math.max(container.scrollHeight, heightModel.totalHeight);
    applyScrollTop(Math.max(0, scrollHeight - container.clientHeight));
  }, [applyScrollTop, heightModel.totalHeight]);

  return {
    containerRef,
    isPinnedToBottom,
    measureRow,
    onScroll,
    rows,
    scrollToBottom,
    scrollToIndex,
    totalHeight: heightModel.totalHeight,
    windowOffsetTop: enabled ? (heightModel.offsets[windowRange.startIndex] ?? 0) : 0,
  };
}

function normalizedHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return 0;
  }

  return Math.max(0, height);
}

function indexAtOffsets(offsets: readonly number[], offset: number): number {
  const itemCount = Math.max(0, offsets.length - 1);
  let lowerBound = 0;
  let upperBound = itemCount;

  while (lowerBound < upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);

    if ((offsets[middle + 1] ?? 0) <= offset) {
      lowerBound = middle + 1;
      continue;
    }

    upperBound = middle;
  }

  return Math.min(Math.max(0, itemCount - 1), lowerBound);
}

function scrollAnchorDelta(
  previousSnapshot: ScrollAnchorSnapshot,
  currentIndexByKey: ReadonlyMap<string, number>,
  currentOffsets: readonly number[],
  scrollTop: number,
): number | null {
  let previousIndex = indexAtOffsets(previousSnapshot.offsets, scrollTop);
  let currentIndex: number | undefined;

  while (previousIndex < previousSnapshot.keys.length) {
    const key = previousSnapshot.keys[previousIndex];
    currentIndex = key === undefined ? undefined : currentIndexByKey.get(key);

    if (currentIndex !== undefined) {
      break;
    }

    previousIndex += 1;
  }

  if (currentIndex === undefined) {
    return null;
  }

  const previousOffset = previousSnapshot.offsets[previousIndex] ?? 0;
  const currentOffset = currentOffsets[currentIndex] ?? 0;
  return currentOffset - previousOffset;
}

function indexAtOffset(model: HeightModel, itemCount: number, offset: number): number {
  if (model.uniformHeight !== null && model.uniformHeight > 0) {
    return Math.min(itemCount - 1, Math.floor(offset / model.uniformHeight));
  }

  let lowerBound = 0;
  let upperBound = itemCount;

  while (lowerBound < upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);

    if ((model.offsets[middle + 1] ?? 0) <= offset) {
      lowerBound = middle + 1;
      continue;
    }

    upperBound = middle;
  }

  return Math.min(itemCount - 1, lowerBound);
}

function firstIndexAtOrAfterOffset(model: HeightModel, itemCount: number, offset: number): number {
  if (model.uniformHeight !== null && model.uniformHeight > 0) {
    return Math.min(itemCount, Math.ceil(offset / model.uniformHeight));
  }

  let lowerBound = 0;
  let upperBound = itemCount;

  while (lowerBound < upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);

    if ((model.offsets[middle] ?? 0) < offset) {
      lowerBound = middle + 1;
      continue;
    }

    upperBound = middle;
  }

  return lowerBound;
}
