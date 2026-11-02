import { createNavigationStageCoordinator } from '@workspace/navigationStageCoordinator';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';
import type { WorkspaceTargetRect } from '@workspace/workspaceGeometry';
import { navigationTransportStages } from './navigationTransportStages';
import type { NavigationTransportFrames, NavigationTransportRuntime } from './navigationTransportStages';

type Failure = 'cancelled' | 'unavailable';
type Options = { forceOversized?: boolean; minimumScale?: number; naturalScale?: number; preserveVisibleAxes?: boolean };
type Motion = (settled: () => void, cancelled: () => void, staged: boolean) => () => void;
type Callbacks = { onSettled: () => void; onFailure: (reason: Failure) => void };
type Controller = {
  navigateToTarget: (target: WorkspaceTargetRect, options: Options & { onSettled: () => void; onCancelled: () => void }) => () => void;
  restoreViewport: (viewport: WorkspaceViewport, settled: () => void, cancelled: () => void) => () => void;
};

export function createNavigationTransport(runtime: NavigationTransportRuntime, controller: Controller, available: (id: string) => boolean, frames: (id: string) => NavigationTransportFrames | undefined) {
  let active: { id: string; staged: boolean; cancel: () => void; unavailable: () => void } | undefined;
  let live = true;

  function start(id: string, motion: Motion, callbacks: Callbacks) {
    const presentation = runtime.currentState();
    const staged = presentation.mode !== 'canvas';
    const previous = active;
    let done = false;
    let retired = false;
    let release: (() => void) | undefined;
    let releasePresentation: (() => void) | undefined;
    const operation = { id, staged, cancel: () => finish('cancelled'), unavailable: () => finish('unavailable') };
    const current = () => live && active === operation && !done;
    function finish(result: 'ready' | Failure) {
      if (done) return;
      const owned = current();
      done = true;
      retired = result !== 'ready';
      if (active === operation) active = undefined;
      const dispose = release;
      release = undefined;
      dispose?.();
      const retirePresentation = releasePresentation;
      releasePresentation = undefined;
      retirePresentation?.();
      if (!owned || active || !live) return;
      if (result === 'ready') callbacks.onSettled();
      else callbacks.onFailure(result);
    }
    if (!live) return () => {};
    active = operation;
    const valid = available(id);
    if (current() && valid && staged) {
      const retire = runtime.claimPresentation();
      if (current()) releasePresentation = retire;
      else retire();
    }
    previous?.cancel();
    if (!current()) return () => {};
    if (!valid || !available(id)) { finish('unavailable'); return () => {}; }
    if (!staged) {
      const cancel = motion(() => finish(available(id) ? 'ready' : 'unavailable'), () => finish(available(id) ? 'cancelled' : 'unavailable'), staged);
      if (current()) release = cancel;
      else if (retired) cancel();
    } else {
      const coordinator = createNavigationStageCoordinator();
      const stages = navigationTransportStages(runtime, available, frames, (settle) => motion(() => settle('settled'), () => settle('cancelled'), staged), current);
      stages.presentation = () => presentation;
      const running = coordinator.start(id, stages);
      if (current()) release = running.cancel;
      else running.cancel();
      void running.completion.then((result) => finish(!available(id) ? 'unavailable' : result === 'ready' ? 'ready' : 'cancelled'));
    }
    return operation.cancel;
  }

  return {
    stageDestination: () => runtime.currentState().mode !== 'canvas',
    activeDestination: () => active?.id,
    activeStaged: () => active?.staged ?? false,
    cancel: () => active?.cancel(),
    reconcile: () => { if (active && !available(active.id)) active.unavailable(); },
    deactivate: () => { live = false; active?.cancel(); },
    activate: () => { live = true; },
    target: (id: string, target: WorkspaceTargetRect, options: Options, callbacks: Callbacks) => start(id, (settled, cancelled) => controller.navigateToTarget(target, { ...options, onSettled: settled, onCancelled: cancelled }), callbacks),
    restore: (id: string, viewport: WorkspaceViewport, callbacks: Callbacks) => start(id, (settled, cancelled) => controller.restoreViewport(viewport, settled, cancelled), callbacks),
    content: (id: string, target: WorkspaceTargetRect, outsideViewport: boolean, callbacks: Callbacks) => start(id, (settled, cancelled, staged) => outsideViewport || staged ? controller.navigateToTarget(target, { preserveVisibleAxes: true, onSettled: settled, onCancelled: cancelled }) : (settled(), () => {}), callbacks),
  };
}
