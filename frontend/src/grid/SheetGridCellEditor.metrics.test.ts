// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseFormulaSyntax } from '@workbook/formula/syntax';

it('aligns coloured token advances and every wrapped character with the editable textarea in Chromium', () => {
  const draft = `=SUM(@'Revenue'[12], @$'Cost'[$12]) + @'Revenue'[12] * 123.45 - @'Cost'[12] / 2 + TRUE + "literal"\n${'@A[1]+@B[2]*12345+'.repeat(8)}`;
  const tokens = parseFormulaSyntax(draft).tokens;
  const spans = tokens.map(({ kind, sourceSpan }) =>
    `<span class="formula-syntax-token formula-syntax-token-${kind}">${escapeHtml(draft.slice(sourceSpan.start, sourceSpan.end))}</span>`).join('');
  const css = fs.readFileSync(new URL('./SheetGridCell.css', import.meta.url), 'utf8');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sheetspace-editor-metrics-'));
  try {
    const page = path.join(directory, 'metrics.html');
    fs.writeFileSync(page, `<!doctype html><style>
      body { font: 16px system-ui; }
      ${css}
      .sheet-grid-cell-editor, .sheet-grid-cell-editor-highlight { left: 0; top: 0; width: 280px; height: 1000px; overflow: hidden; }
    </style>
    <pre class="sheet-grid-cell-editor-highlight">${spans}</pre>
    <textarea class="sheet-grid-cell-editor">${escapeHtml(draft)}</textarea>
    <script>(${measureEditorMetrics.toString()})();</script>`);
    const html = execFileSync('chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', new URL(`file://${page}`).href,
    ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] }) as string;

    const result = /<output id="metrics">([^<]+)<\/output>/.exec(html);
    expect(result, html).not.toBeNull();
    const metrics = JSON.parse(result![1]) as { errors: string[]; lines: number; characters: number };
    expect(metrics.errors).toEqual([]);
    expect(metrics.lines).toBeGreaterThan(5);
    expect(metrics.characters).toBe(draft.length);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Runs in a real browser: the plain-text mirror uses the textarea's computed
// typography, while Range rectangles expose the overlay's actual token layout.
function measureEditorMetrics() {
  const editor = document.querySelector('textarea')!;
  const overlay = document.querySelector('pre')!;
  const style = getComputedStyle(editor);
  const errors: string[] = [];
  const mirror = document.createElement('div');
  const properties = [
    'box-sizing', 'border-width', 'border-style', 'padding', 'width', 'height',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
    'font-variant', 'font-kerning', 'font-feature-settings', 'font-variation-settings',
    'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'text-indent',
    'text-transform', 'white-space', 'overflow-wrap', 'word-break', 'text-align',
  ];
  for (const property of properties) mirror.style.setProperty(property, style.getPropertyValue(property));
  mirror.style.lineHeight = String(Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize));
  mirror.style.cssText += ';position:fixed;left:0;top:0;overflow:hidden;';
  mirror.textContent = editor.value;
  document.body.append(mirror);
  const canvas = document.createElement('canvas').getContext('2d')!;
  for (const token of overlay.querySelectorAll('span')) {
    const tokenStyle = getComputedStyle(token);
    for (const property of properties.slice(6)) {
      if (style.getPropertyValue(property) !== tokenStyle.getPropertyValue(property)) errors.push(`token ${property}`);
    }
    canvas.font = style.font;
    const plainWidth = canvas.measureText(token.textContent!).width;
    canvas.font = tokenStyle.font;
    if (Math.abs(canvas.measureText(token.textContent!).width - plainWidth) > 0.01) errors.push('token advance');
  }
  function positions(element: HTMLElement) {
    const positions: { x: number; y: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let offset = 0; offset < node.textContent!.length; offset++) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        positions.push({ x: rect.x, y: rect.y });
      }
    }
    return positions;
  }
  const coloured = positions(overlay);
  const plain = positions(mirror);
  for (let offset = 0; offset < plain.length; offset++) {
    // Inline text runs can round fractional glyph advances independently.
    if (Math.abs(coloured[offset].x - plain[offset].x) > 0.125
      || Math.abs(coloured[offset].y - plain[offset].y) > 0.02) errors.push(`character ${offset}: ${JSON.stringify(coloured[offset])} vs ${JSON.stringify(plain[offset])}`);
  }
  // Reducing the viewport reveals the real textarea's content height, including
  // its wrapping, rather than comparing only the outer container geometry.
  for (const element of [editor, overlay, mirror]) element.style.height = '24px';
  if (editor.scrollHeight !== mirror.scrollHeight || editor.scrollHeight !== overlay.scrollHeight) errors.push('wrapped content height');
  const output = document.createElement('output');
  output.id = 'metrics';
  output.textContent = JSON.stringify({ errors, lines: new Set(plain.map(({ y }) => y)).size, characters: plain.length });
  document.body.append(output);
}
