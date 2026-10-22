import { useEffect, type RefObject } from 'react';

export function useGridHistoryRestore({ navigationGeneration, onSettled, restore, scrollContainerRef }: {
  navigationGeneration?: number;
  onSettled?: (generation: number) => void;
  restore?: { generation: number; left: number; top: number };
  scrollContainerRef: RefObject<HTMLElement>;
}) {
  useEffect(() => {
    const generation = restore?.generation ?? navigationGeneration;
    if (generation === undefined || !scrollContainerRef.current) return;
    const scrollContainer = scrollContainerRef.current;
    if (restore) {
      scrollContainer.scrollLeft = Math.min(Math.max(0, restore.left), Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth));
      scrollContainer.scrollTop = Math.min(Math.max(0, restore.top), Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight));
    }
    onSettled?.(generation);
  }, [navigationGeneration, onSettled, restore, scrollContainerRef]);
}
