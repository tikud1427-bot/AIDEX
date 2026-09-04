/**
 * jsdom gaps that Radix's popper-backed primitives hit.
 *
 * The account menu is a real @radix-ui/react-dropdown-menu — the primitive the
 * design system already wraps — because Escape-to-close, outside-click,
 * roving focus and collision-aware anchoring are exactly the things a
 * hand-rolled popover gets wrong. Radix measures the DOM to do that, and jsdom
 * has no layout engine, so a handful of APIs simply are not there.
 *
 * These are STUBS FOR MISSING PLUMBING, not stubs for the behaviour under test.
 * Nothing here reports a position, so nothing here can make a positioning
 * assertion pass. Geometry belongs in e2e/, which runs a real browser.
 */

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!('DOMRect' in globalThis)) {
  (globalThis as unknown as { DOMRect: unknown }).DOMRect = class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
    get top() { return this.y; }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get bottom() { return this.y + this.height; }
    toJSON() { return { ...this }; }
  };
}

// Radix uses pointer capture to keep a press anchored to its trigger.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
