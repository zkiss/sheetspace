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

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const resizeObservers = new Set<TestResizeObserver>();

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.add(this);
  }

  private readonly targets = new Set<Element>();

  observe(target: Element) {
    this.targets.add(target);
    if (target instanceof HTMLElement && target.classList.contains('workspace-surface')) {
      this.notify(target, 1000, 800);
    }
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    resizeObservers.delete(this);
  }

  notify(target: Element, width: number, height: number) {
    if (!this.targets.has(target)) return;
    this.callback([{
      borderBoxSize: [{ blockSize: height, inlineSize: width }],
      contentBoxSize: [{ blockSize: height, inlineSize: width }],
      contentRect: testRect({ height, left: 0, top: 0, width }),
      devicePixelContentBoxSize: [{ blockSize: height, inlineSize: width }],
      target,
    } as unknown as ResizeObserverEntry], this);
  }
}

// ResizeObserver-driven UI needs an explicit measured viewport in JSDOM.
export function measuredElementGeometry(element: HTMLElement, initial: { height: number; width: number }) {
  let { height, width } = initial;
  const apply = () => {
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: height },
      clientWidth: { configurable: true, value: width },
      offsetHeight: { configurable: true, value: height },
      offsetWidth: { configurable: true, value: width },
    });
    element.getBoundingClientRect = () => testRect({ height, left: 0, top: 0, width });
  };
  const notify = () => resizeObservers.forEach((observer) => observer.notify(element, width, height));
  apply();
  notify();

  return {
    resize(next: { height: number; width: number }) {
      ({ height, width } = next);
      apply();
      notify();
    },
  };
}

// TanStack Virtual observes the scroll element. This controller gives tests a measured
// viewport and an explicit resize signal, rather than relying on JSDOM's zero geometry.
export function virtualGridGeometry(element: HTMLElement, initial = { height: 160, width: 240 }) {
  return measuredElementGeometry(element, initial);
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = TestResizeObserver;
}
