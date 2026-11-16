export function workspacePanHandle(ownsPreview: () => boolean, move: (x: number, y: number) => void, end: () => void) {
  let ended = false;
  return {
    move: (x: number, y: number) => { if (!ended && ownsPreview()) move(x, y); },
    end: () => {
      if (!ended && ownsPreview()) end();
      ended = true;
    },
  };
}
