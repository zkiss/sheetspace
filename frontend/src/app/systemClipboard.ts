import { clipboardHtml, clipboardMarkerFromHtml } from '@grid/clipboardHtml';

export type SystemClipboardContent = { text: string; marker?: string };

export const systemClipboard = {
  canWrite: () => typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function',
  canRead: () => typeof navigator.clipboard?.read === 'function',
  async write(content: SystemClipboardContent): Promise<void> {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([content.text], { type: 'text/plain' }),
      'text/html': new Blob([clipboardHtml(content)], { type: 'text/html' }),
    })]);
  },
  async read(): Promise<SystemClipboardContent> {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes('text/plain')) continue;
      const text = await (await item.getType('text/plain')).text();
      const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
      return { text, marker: clipboardMarkerFromHtml(html) };
    }
    throw new Error('The clipboard does not contain text.');
  },
};
