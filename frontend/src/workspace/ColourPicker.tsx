import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { ColourMode } from './colourControlReadout';
import type { LocalOverrideState } from './appearanceControlState';
import { FormatIcon, NoColourIcon } from './FormatIcon';
import { ColourPurposeSwatch } from './ColourPurposeSwatch';
import { BUILT_IN_COLOURS } from './colourPalette';
import { useColourPopoverPosition } from './useColourPopoverPosition';

export function ColourPicker({
  ariaLabel,
  purpose,
  colour,
  customColours,
  disabled,
  onApply,
  onApplyInherited,
  onApplyDefault,
  defaultOptionLabel,
  status,
  descriptionId,
  localOverrideState,
}: {
  ariaLabel: string;
  purpose: 'text' | 'fill';
  colour: `#${string}`;
  customColours: readonly string[];
  disabled: boolean;
  onApply: (colour: `#${string}`) => void;
  onApplyInherited: () => void;
  onApplyDefault: () => void;
  defaultOptionLabel: string;
  status: ColourMode;
  descriptionId: string;
  localOverrideState: LocalOverrideState;
}) {
  const [draft, setDraft] = useState(colour);
  const [open, setOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<typeof status>(status);
  const [hasDraft, setHasDraft] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useColourPopoverPosition(rootRef, open && !disabled);
  const customInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);
  useEffect(() => {
    if (!open) {
      setDraft(colour);
      setDraftMode(status);
      setHasDraft(false);
    }
  }, [colour, open, status]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const closeWhenOutside = (event: Event) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeWhenEscaped = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeWhenOutside, true);
    document.addEventListener('click', closeWhenOutside, true);
    document.addEventListener('keydown', closeWhenEscaped, true);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside, true);
      document.removeEventListener('click', closeWhenOutside, true);
      document.removeEventListener('keydown', closeWhenEscaped, true);
    };
  }, [open, disabled]);
  const previewStatus = open && hasDraft ? draftMode : status;
  const previewColour = open && hasDraft ? draft : colour;
  const triggerContent = previewStatus === 'mixed'
    ? <span className="colour-picker-mixed-indicator">—</span>
    : previewStatus === 'inherited'
      ? <FormatIcon kind="reset" />
      : previewStatus === 'none'
        ? <NoColourIcon />
        : <ColourPurposeSwatch colour={previewColour} purpose={purpose} />;
  const previewDraft = (event: FormEvent<HTMLInputElement>) => {
    setDraft(event.currentTarget.value as `#${string}`);
    setDraftMode('colour');
    setHasDraft(true);
  };
  return (
    <div className="colour-picker" ref={rootRef}>
      <button ref={triggerRef} aria-describedby={descriptionId} aria-expanded={open} aria-haspopup="dialog" aria-label={`${ariaLabel}: ${previewStatus === 'mixed' ? 'mixed' : previewStatus === 'inherited' ? 'inherited' : previewStatus === 'none' ? 'no colour' : previewColour}`} className="colour-picker-trigger" data-colour-mode={previewStatus} data-local-override-state={localOverrideState} data-mixed={previewStatus === 'mixed' || undefined} disabled={disabled} onClick={() => setOpen((current) => !current)} title={ariaLabel} type="button">{triggerContent}</button>
      {open ? <div aria-label={ariaLabel} className="colour-picker-popover" ref={popoverRef} role="dialog">
        <span className="colour-picker-label">Options</span><div className="colour-picker-options">
          <button aria-pressed={previewStatus === 'inherited'} className="colour-picker-option" onClick={() => { onApplyInherited(); setOpen(false); }} type="button"><FormatIcon kind="reset" />Inherit</button>
          <button aria-pressed={previewStatus === 'none'} className="colour-picker-option colour-picker-option-no-colour" onClick={() => { onApplyDefault(); setOpen(false); }} type="button"><NoColourIcon />{defaultOptionLabel}</button>
        </div>
        <span className="colour-picker-label">Palette</span>
        <div className="colour-picker-swatches">
          {BUILT_IN_COLOURS.map((swatch) => <button aria-label={`Use ${swatch}`} aria-pressed={previewStatus === 'colour' && previewColour.toLowerCase() === swatch.toLowerCase()} className="colour-picker-swatch" key={swatch} onClick={() => { onApply(swatch); setOpen(false); }} style={{ '--colour-swatch': swatch } as CSSProperties} type="button" />)}
        </div>
        <span className="colour-picker-label">Sheet colours</span><div className="colour-picker-swatches">
          {customColours.map((swatch) => <button aria-label={`Use ${swatch}`} aria-pressed={previewStatus === 'colour' && previewColour.toLowerCase() === swatch.toLowerCase()} className="colour-picker-swatch" key={swatch} onClick={() => { onApply(swatch as `#${string}`); setOpen(false); }} style={{ '--colour-swatch': swatch } as CSSProperties} type="button" />)}
          {hasDraft && ![...BUILT_IN_COLOURS, ...customColours].includes(draft.toLowerCase()) ? <button aria-label={`Use ${draft}`} className="colour-picker-swatch" onClick={() => { onApply(draft); setOpen(false); }} style={{ '--colour-swatch': draft } as CSSProperties} type="button" /> : null}
          <button aria-label="Add custom colour" className="colour-picker-custom-trigger" onClick={() => { customInputRef.current?.click(); }} type="button">+</button>
        </div>
        <input aria-label="Custom colour" className="colour-picker-custom-input" onChange={previewDraft} onInput={previewDraft} ref={customInputRef} type="color" value={draft} />
      </div> : null}
    </div>
  );
}
