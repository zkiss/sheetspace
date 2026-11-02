import { useLayoutEffect, useRef } from 'react';
import { createNavigationStageCoordinator } from './navigationStageCoordinator';
import type { NavigationStages } from './navigationStageCoordinator';

/** Keeps stage collaborators live and retires navigation on removal or unmount. */
export function useNavigationStageCoordinator(stages: NavigationStages) {
  const latest = useRef(stages);
  latest.current = stages;
  const coordinator = useRef<ReturnType<typeof createNavigationStageCoordinator>>();
  if (!coordinator.current) coordinator.current = createNavigationStageCoordinator();
  const owner = coordinator.current;

  useLayoutEffect(() => { owner.reconcile(); });
  useLayoutEffect(() => { owner.activate(); return () => owner.deactivate(); }, [owner]);

  return {
    cancel: owner.cancel,
    start: (id: string) => owner.start(id, {
      available: (target) => latest.current.available(target),
      presentation: () => latest.current.presentation(),
      restore: (finish) => latest.current.restore(finish),
      move: (finish) => latest.current.move(finish),
      enter: (target, finish) => latest.current.enter(target, finish),
      targetReady: (target, finish) => latest.current.targetReady(target, finish),
    }),
  };
}
