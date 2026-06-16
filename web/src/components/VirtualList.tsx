import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  overscan?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (nearBottom: boolean) => void;
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  emptyMessage?: ReactNode;
}

export function VirtualList<T>({
  items,
  itemHeight,
  overscan = 10,
  scrollRef: externalScrollRef,
  onScroll,
  getItemKey,
  renderItem,
  emptyMessage,
}: VirtualListProps<T>) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef ?? internalScrollRef;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const measure = () => setViewportHeight(el.clientHeight);
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    onScroll?.(distFromBottom <= 50);
  }, [onScroll, scrollRef]);

  if (items.length === 0) {
    return (
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: "auto",
          background: "#2b2d31",
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: "auto",
        background: "#2b2d31",
        position: "relative",
      }}
    >
      <div style={{ height: totalHeight, position: "relative", width: "100%" }}>
        {items.slice(startIndex, endIndex).map((item, offset) => {
          const index = startIndex + offset;
          return (
            <div
              key={getItemKey(item, index)}
              style={{
                position: "absolute",
                top: index * itemHeight,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
