import assert from 'node:assert/strict';

// Node 22+; run against a disposable Chromium debugging profile and a Vite dev server.
const debuggingUrl = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9222';
const appUrl = process.env.SHEETSPACE_URL ?? 'http://127.0.0.1:5173';
const targets = await (await fetch(`${debuggingUrl}/json/list`)).json();
const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 150))');
const surface = '[data-testid="workspace-surface"]';
const body = '[data-testid="sheet-frame-body"]';
const frame = '[data-testid="sheet-frame"]';
const cell = '[data-cell-key="A1"]';
const state = () => evaluate(`(() => { const d = document.querySelector('${surface}').dataset; return { x: +d.viewportX, y: +d.viewportY, scale: +d.viewportScale }; })()`);
async function point(selector) {
  return evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
}
async function mouse(type, position, extra = {}) {
  await send('Input.dispatchMouseEvent', { type, ...position, ...extra });
}
async function click(selector, count = 1) {
  const position = await point(selector);
  await mouse('mousePressed', position, { button: 'left', buttons: 1, clickCount: count });
  await mouse('mouseReleased', position, { button: 'left', buttons: 0, clickCount: count });
  await settle();
}
async function reset() {
  await click('[aria-label="Reset workspace viewport"]');
  await evaluate(`document.querySelector('${body}').scrollTo(0, 0)`);
  await settle();
}
async function wheel(position, deltaX, deltaY, modifiers = 0) {
  await mouse('mouseMoved', position);
  await mouse('mouseWheel', position, { deltaX, deltaY, modifiers });
  await settle();
}
async function space(type) {
  await send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: type === 'keyDown' ? ' ' : undefined });
}
async function drag(selector, button = 'left') {
  const start = await point(selector);
  const buttons = button === 'middle' ? 4 : 1;
  await mouse('mouseMoved', start);
  await mouse('mousePressed', start, { button, buttons, clickCount: 1 });
  await mouse('mouseMoved', { x: start.x + 45, y: start.y + 25 }, { button, buttons });
  await mouse('mouseReleased', { x: start.x + 45, y: start.y + 25 }, { button, buttons: 0, clickCount: 1 });
  await settle();
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`); }

try {
  console.log((await send('Browser.getVersion')).product);
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: appUrl });
  await settle();
  await evaluate(`(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { App } = await import('/src/app/App.tsx');
    const { sheetDocument, workbookWithSheets } = await import('/src/test-support/workbookFactories.ts');
    const host = document.createElement('div'); host.id = 'root'; document.body.replaceChildren(host);
    createRoot(host).render(React.createElement(App, { initialWorkbook: workbookWithSheets([
      sheetDocument({ id: 'native', name: 'Native', position: { x: 60, y: 40 }, frameSize: { width: 420, height: 300 }, rowCount: 200, columnCount: 30, cells: { A1: 'hello' } })
    ]) }));
  })()`);
  await settle();
  const background = await evaluate(`(() => { const r = document.querySelector('${surface}').getBoundingClientRect(); return { x: r.right - 100, y: r.bottom - 100 }; })()`);
  await wheel(background, 40, 60);
  assert.deepEqual(await state(), { x: -40, y: -60, scale: 1 });
  console.log('PASS native background wheel pans both axes');
  await reset();
  await wheel(await point(body), 90, 120);
  const scroll = await evaluate(`({ x: document.querySelector('${body}').scrollLeft, y: document.querySelector('${body}').scrollTop })`);
  assert.ok(scroll.x > 0 && scroll.y > 0);
  assert.deepEqual(await state(), { x: 0, y: 0, scale: 1 });
  await evaluate(`document.querySelector('${body}').scrollTo(1e8, 1e8)`);
  await settle();
  await wheel(await point(body), 90, 120);
  assert.deepEqual(await state(), { x: 0, y: 0, scale: 1 });
  console.log('PASS native grid scrolling, including edge isolation');
  await reset();
  const anchor = await point(cell);
  const surfaceTop = await evaluate(`document.querySelector('${surface}').getBoundingClientRect().top`);
  await wheel(anchor, 0, -100, 2);
  const zoom = await state();
  assert.ok(zoom.scale > 1);
  near((anchor.x - zoom.x) / zoom.scale, anchor.x);
  near((anchor.y - surfaceTop - zoom.y) / zoom.scale, anchor.y - surfaceTop);
  near(await evaluate('window.visualViewport.scale'), 1);
  console.log('PASS Ctrl-wheel anchored workspace zoom without browser zoom');
  await reset();
  await send('Input.synthesizePinchGesture', { x: anchor.x, y: anchor.y, scaleFactor: 1.5, gestureSourceType: 'mouse' });
  await settle();
  const pinch = await state();
  assert.ok(pinch.scale > 1);
  near((anchor.x - pinch.x) / pinch.scale, anchor.x);
  near((anchor.y - surfaceTop - pinch.y) / pinch.scale, anchor.y - surfaceTop);
  near(await evaluate('window.visualViewport.scale'), 1);
  console.log('PASS browser-synthesized mouse-source pinch anchored zoom');
  for (const target of [cell, '[data-testid="sheet-frame-header"]', '[data-resize-handle="right"]']) {
    await reset();
    await click(cell);
    const beforeFrame = await evaluate(`document.querySelector('${frame}').getAttribute('style')`);
    await space('keyDown');
    await drag(target);
    await space('keyUp');
    assert.deepEqual(await state(), { x: 45, y: 25, scale: 1 });
    assert.equal(await evaluate(`document.querySelector('${frame}').getAttribute('style')`), beforeFrame);
    assert.equal(await evaluate('document.querySelectorAll("textarea").length'), 0);
    assert.equal(await evaluate('getSelection().toString()'), '');
  }
  console.log('PASS Space drag across cell, header and resize handle without edits or frame changes');
  await reset();
  await drag(cell, 'middle');
  assert.deepEqual(await state(), { x: 45, y: 25, scale: 1 });
  console.log('PASS middle drag without autoscroll');
  await reset();
  await click(cell, 2);
  const oldText = await evaluate('document.querySelector("textarea").value');
  await space('keyDown'); await space('keyUp');
  assert.equal(await evaluate('document.querySelector("textarea").value'), `${oldText} `);
  assert.deepEqual(await state(), { x: 0, y: 0, scale: 1 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  console.log('PASS editor Space stays text input');
  await click(cell);
  await space('keyDown');
  const start = await point(cell);
  await mouse('mousePressed', start, { button: 'left', buttons: 1 });
  await mouse('mouseMoved', { x: start.x + 15, y: start.y + 10 }, { button: 'left', buttons: 1 });
  await space('keyUp');
  const ended = await state();
  await mouse('mouseMoved', { x: start.x + 100, y: start.y + 100 }, { button: 'left', buttons: 1 });
  await mouse('mouseReleased', start, { button: 'left', buttons: 0 });
  assert.deepEqual(await state(), ended);
  assert.equal(await evaluate(`document.querySelector('${surface}').classList.contains('workspace-surface-panning')`), false);
  console.log('PASS releasing Space ends native pointer capture before button release');
} finally {
  socket.close();
}
