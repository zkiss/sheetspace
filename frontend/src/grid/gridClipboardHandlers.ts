import type { ClipboardEvent } from 'react';
import type { SheetGridProps } from './SheetGridProps';
import { isNativeEditorTarget } from './gridScrollInput';
import { clipboardHtml, clipboardMarkerFromHtml } from './clipboardHtml';

export function gridClipboardHandlers(clipboardInteraction: SheetGridProps['clipboardInteraction']) {
  function isNativeEditorEvent(event: ClipboardEvent<HTMLDivElement>) {
    return isNativeEditorTarget(event.target);
  }

  function copySelection(event: ClipboardEvent<HTMLDivElement>) {
    if (isNativeEditorEvent(event)) return;
    const copied = clipboardInteraction?.copy();
    if (!copied) return;
    event.clipboardData.setData('text/plain', copied.text);
    event.clipboardData.setData('application/x-sheetspace-clipboard', copied.marker);
    event.clipboardData.setData('text/html', clipboardHtml(copied));
    event.preventDefault();
  }

  function cutSelection(event: ClipboardEvent<HTMLDivElement>) {
    if (isNativeEditorEvent(event)) return;
    const cut = clipboardInteraction?.cut?.();
    if (!cut) return;
    event.clipboardData.setData('text/plain', cut.text);
    event.clipboardData.setData('application/x-sheetspace-clipboard', cut.marker);
    event.clipboardData.setData('text/html', clipboardHtml(cut));
    event.preventDefault();
  }

  function pasteSelection(event: ClipboardEvent<HTMLDivElement>) {
    if (isNativeEditorEvent(event)) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text && !event.clipboardData.types.includes('text/plain')) return;
    clipboardInteraction?.paste({
      text,
      marker: event.clipboardData.getData('application/x-sheetspace-clipboard') || clipboardMarkerFromHtml(event.clipboardData.getData('text/html')),
    });
    event.preventDefault();
  }

  return { copySelection, cutSelection, pasteSelection };
}
