import "@testing-library/jest-dom/vitest";

// Server tests opt into the node environment; the DOM shims below only apply
// under jsdom.
const hasDom = typeof window !== "undefined" && typeof Element !== "undefined";

// jsdom does not implement scrollIntoView / scrollTo; the renderer's
// generation tail calls scrollIntoView from an effect.
if (hasDom && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (hasDom && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

if (hasDom && !window.matchMedia) {
  window.matchMedia = () =>
    ({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom measures every box as 0×0 and recharts' ResponsiveContainer draws
// nothing at zero size — report a fixed size synchronously on observe.
if (hasDom && !globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    private readonly callback: globalThis.ResizeObserverCallback;

    constructor(callback: globalThis.ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      const rect = { width: 640, height: 200, top: 0, left: 0, x: 0, y: 0 };
      this.callback(
        [
          {
            target,
            contentRect: rect,
            borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
            contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          },
        ] as unknown as globalThis.ResizeObserverEntry[],
        this,
      );
    }

    unobserve() {}
    disconnect() {}
  };
}
