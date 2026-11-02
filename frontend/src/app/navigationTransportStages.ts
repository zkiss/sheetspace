import type { SavedFrame } from '@workspace/maximiseGeometry';
import type { NavigationStages } from '@workspace/navigationStageCoordinator';

type Result = 'settled' | 'cancelled';
export type NavigationTransportRuntime = {
  currentState: () => ReturnType<NavigationStages['presentation']>;
  ensureCanvas: () => Promise<Result>;
  ensureMaximised: (id: string) => Promise<Result>;
  enter: (id: string, saved: SavedFrame, displayed: SavedFrame, programmatic: boolean) => void;
};

export type NavigationTransportFrames = { saved: SavedFrame; displayed: SavedFrame };

function waitForPresentation(promise: Promise<Result>, finish: (result: Result) => void) {
  let active = true;
  void promise.then((result) => { if (active) finish(result); });
  return () => { active = false; };
}

/** Adapts semantic presentation settlement to the stage coordinator's callback contract. */
export function navigationTransportStages(
  runtime: NavigationTransportRuntime,
  available: (id: string) => boolean,
  frames: (id: string) => NavigationTransportFrames | undefined,
  move: NavigationStages['move'],
  isCurrent: () => boolean = () => true,
): NavigationStages {
  return {
    available,
    presentation: runtime.currentState,
    restore: (finish) => waitForPresentation(runtime.ensureCanvas(), finish),
    move,
    enter: (id, finish) => {
      const frame = frames(id);
      if (!frame || !available(id)) { finish('cancelled'); return () => {}; }
      runtime.enter(id, frame.saved, frame.displayed, true);
      if (!isCurrent()) { finish('cancelled'); return () => {}; }
      return waitForPresentation(runtime.ensureMaximised(id), finish);
    },
    targetReady: (id, finish) => waitForPresentation(runtime.ensureMaximised(id), finish),
  };
}
