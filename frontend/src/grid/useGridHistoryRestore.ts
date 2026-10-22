import { useEffect, type RefObject } from 'react';

export function useGridHistoryRestore({ onSettled, restore, scrollContainerRef }: {
  onSettled?: (generation: number) => void;
  restore?: { generation: number; left: number; top: number };
  scrollContainerRef: RefObject<HTMLElement>;
}) {
  useEffect(() => {
    if (!restore || !scrollContainerRef.current) return;
    const scrollContainer = scrollContainerRef.current;
    scrollContainer.scrollLeft = Math.min(Math.max(0, restore.left), Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth));
    scrollContainer.scrollTop = Math.min(Math.max(0, restore.top), Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight));
    onSettled?.(restore.generation);
  }, [onSettled, restore, scrollContainerRef]);
}
