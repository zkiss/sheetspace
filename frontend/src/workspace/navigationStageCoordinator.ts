type StageResult = 'settled' | 'cancelled';
type Stage = (finish: (result: StageResult) => void) => () => void;
type Presentation = { mode: 'canvas' | 'entering' | 'maximised' | 'restoring'; sheetId?: string };

export type NavigationStages = {
  available: (id: string) => boolean;
  presentation: () => Presentation;
  restore: Stage;
  move: Stage;
  enter: (id: string, finish: (result: StageResult) => void) => () => void;
  targetReady: (id: string, finish: (result: StageResult) => void) => () => void;
};

export function createNavigationStageCoordinator() {
  let active: (() => void) | undefined;
  let reconcileActive: (() => void) | undefined;

  function start(id: string, stages: NavigationStages) {
    const previous = active;
    let done = false;
    let dispose: (() => void) | undefined;
    let resolve!: (result: 'ready' | 'cancelled') => void;
    const completion = new Promise<'ready' | 'cancelled'>((finish) => { resolve = finish; });
    const finish = (result: 'ready' | 'cancelled') => {
      if (done) return;
      done = true;
      if (active === cancel) { active = undefined; reconcileActive = undefined; }
      const release = dispose;
      dispose = undefined;
      release?.();
      resolve(result);
    };
    function cancel() { finish('cancelled'); }
    active = cancel;
    reconcileActive = () => { if (!stages.available(id)) cancel(); };
    previous?.();
    function valid() { return !done && active === cancel && stages.available(id); }
    function run(stage: Stage, next: () => void) {
      if (!valid()) { finish('cancelled'); return; }
      let pending = true;
      const release = stage((result) => {
        if (!pending) return;
        pending = false;
        dispose = undefined;
        if (result !== 'settled' || !valid()) { finish('cancelled'); return; }
        next();
      });
      if (pending && !done) dispose = release;
      else if (pending) release();
    }
    const ready = () => { if (valid()) finish('ready'); else finish('cancelled'); };
    const presentation = stages.presentation();
    if (!valid()) finish('cancelled');
    else if ((presentation.mode === 'entering' || presentation.mode === 'maximised') && presentation.sheetId === id) {
      run((finishStage) => stages.targetReady(id, finishStage), ready);
    } else if (presentation.mode !== 'canvas') {
      run(stages.restore, () => run(stages.move, () => run((finishStage) => stages.enter(id, finishStage), ready)));
    } else run(stages.move, ready);
    return { cancel, completion };
  }

  return { start, cancel: () => active?.(), reconcile: () => reconcileActive?.() };
}
