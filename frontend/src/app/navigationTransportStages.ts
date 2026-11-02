import type { SavedFrame } from '@workspace/maximiseGeometry';
import type { NavigationStages } from '@workspace/navigationStageCoordinator';

type Result = 'settled' | 'cancelled';
export type NavigationTransportRuntime = {
  currentState: () => ReturnType<NavigationStages['presentation']>;
  ensureCanvas: () => Promise<Result>;
  ensureMaximised: (id: string) => Promise<Result>;
  enter: (id: string, saved: SavedFrame, displayed: SavedFrame, programmatic: boolean) => void;
  claimPresentation: () => () => void;
};

export type NavigationTransportFrames = { saved: SavedFrame; displayed: SavedFrame };

function waitForPresentation(promise: Promise<Result>, finish: (result: Result) => void, retire: () => void) {
  let active = true;
  void promise.then((result) => { if (active) finish(result); });
  return () => { active = false; retire(); };
}

/** Adapts semantic presentation settlement to the stage coordinator's callback contract. */
export function navigationTransportStages(
  runtime: NavigationTransportRuntime,
  available: (id: string) => boolean,
  frames: (id: string) => NavigationTransportFrames | undefined,
  move: NavigationStages['move'],
  isCurrent: () => boolean = () => true,
): NavigationStages {
  function wait(promise: Promise<Result>, finish: (result: Result) => void) {
    if (!isCurrent()) return () => {};
    return waitForPresentation(promise, finish, runtime.claimPresentation());
  }
  return {
    available,
    presentation: runtime.currentState,
    restore: (finish) => wait(runtime.ensureCanvas(), finish),
    move,
    enter: (id, finish) => {
      const frame = frames(id);
      if (!frame || !available(id)) { finish('cancelled'); return () => {}; }
      runtime.enter(id, frame.saved, frame.displayed, true);
      if (!isCurrent()) { finish('cancelled'); return () => {}; }
      return wait(runtime.ensureMaximised(id), finish);
    },
    targetReady: (id, finish) => wait(runtime.ensureMaximised(id), finish),
  };
}
