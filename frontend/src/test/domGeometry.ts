export function testRect({ height, left, top, width }: { height: number; left: number; top: number; width: number }) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => undefined,
  } as DOMRect;
}

export function workspaceRect() {
  return testRect({ left: 20, top: 30, width: 1000, height: 800 });
}

