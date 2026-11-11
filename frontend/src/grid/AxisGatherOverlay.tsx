import type { CSSProperties } from 'react';
import type { AxisGatherDeck, AxisGatherFlight } from './useAxisGather';

function cardStyle(card: { width: number; height: number }, x: number, y: number): CSSProperties {
  return {
    height: card.height,
    left: x,
    position: 'absolute',
    top: y,
    width: card.width,
  };
}

/**
 * Draws the physical header cards the user is dragging and their release
 * flight. Both live inside the grid's content coordinates so they stay aligned
 * with the sticky headers while the workspace plane is scaled.
 */
export function AxisGatherOverlay({ deck, flight }: {
  deck: AxisGatherDeck | null;
  flight: AxisGatherFlight | null;
}) {
  return (
    <>
      {deck && (
        <div aria-hidden="true" className={`sheet-grid-axis-deck sheet-grid-axis-deck-${deck.axis}`}>
          {deck.cards.map((card) => (
            <div className="sheet-grid-axis-card" key={card.id} style={{ ...cardStyle(card, card.x, card.y), zIndex: card.id === deck.primaryId ? 1 : 0 }}>
              {card.label}
            </div>
          ))}
        </div>
      )}
      {flight && (
        <div aria-hidden="true" className={`sheet-grid-axis-flight sheet-grid-axis-flight-${flight.axis}`}>
          {flight.cards.map((card) => (
            <div
              className="sheet-grid-axis-card sheet-grid-axis-flight-card"
              key={card.id}
              style={{
                ...cardStyle(card, 0, 0),
                '--flight-from-x': `${card.x}px`,
                '--flight-from-y': `${card.y}px`,
                '--flight-to-x': `${card.toX}px`,
                '--flight-to-y': `${card.toY}px`,
              } as CSSProperties}
            >
              {card.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
