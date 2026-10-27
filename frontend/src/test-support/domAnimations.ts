// JSDOM does not run CSS animations. Individual tests can supply controlled
// animations on an element when they need to exercise sampling or cancellation.
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

export {};
