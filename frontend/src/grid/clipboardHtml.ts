export function clipboardHtml(content: { text: string; marker?: string }): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<pre data-sheetspace-clipboard="${escape(content.marker ?? '')}">${escape(content.text)}</pre>`;
}

export function clipboardMarkerFromHtml(html: string): string | undefined {
  if (!html) return undefined;
  return new DOMParser().parseFromString(html, 'text/html').querySelector('[data-sheetspace-clipboard]')?.getAttribute('data-sheetspace-clipboard') || undefined;
}
