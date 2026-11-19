import { Check, Disc3, Plus } from 'lucide-react';
import type { SongCard } from '@tunes/shared';
import { gapLabel } from '../TableUi';

interface GapTimelineProps {
  cards: SongCard[];
  heading: string;
  selected?: number | null;
  marked?: number | null;
  unavailable?: number[];
  onSelect?: (position: number) => void;
}

export function GapTimeline({ cards, heading, selected, marked, unavailable = [], onSelect }: GapTimelineProps) {
  return (
    <section className="tunes-panel tunes-timeline" aria-label={heading}>
      <div className="tunes-row-title">
        <h2>{heading}</h2>
        <span className="tunes-pill">{cards.length} {cards.length === 1 ? 'card' : 'cards'}</span>
      </div>
      <div className="tunes-timeline-scroll" tabIndex={onSelect ? undefined : 0} aria-label="Scrollable timeline">
        <ol className="tunes-timeline-track" aria-label="Earliest to latest" role="list">
          {Array.from({ length: cards.length + 1 }, (_, position) => {
            const card = cards[position];
            const picked = selected === position;
            const submitted = marked === position;
            return (
              <li key={card?.id ?? 'last'} className="tunes-timeline-item">
                {onSelect ? (
                  <button className="tunes-gap" type="button"
                    aria-label={gapLabel(cards, position)}
                    aria-pressed={picked}
                    aria-disabled={unavailable.includes(position)}
                    data-marked={submitted || undefined}
                    onClick={() => { if (!unavailable.includes(position)) onSelect(position); }}>
                    {picked || submitted ? <Check size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
                  </button>
                ) : submitted && (
                  <span className="tunes-gap tunes-gap-placed" aria-label={`Submitted ${gapLabel(cards, position).toLowerCase()}`} role="img"><Check size={17} aria-hidden="true" /></span>
                )}
                {card && (
                  <div className={`tunes-timeline-card ${selected === position || selected === position + 1 ? 'is-neighbor' : ''}`}>
                    <Disc3 size={16} aria-hidden="true" />
                    <b>{card.year}</b>
                    <span>{card.title}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {onSelect && <p className="tunes-gap-summary" role="status">{selected === null || selected === undefined ? 'Tap a gap to select it.' : gapLabel(cards, selected)}</p>}
      {!onSelect && !cards.length && <p className="tunes-muted">The first card will start this timeline.</p>}
    </section>
  );
}
