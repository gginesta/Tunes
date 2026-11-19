import type { ReactNode } from 'react';
import { ArrowLeft, Disc3 } from 'lucide-react';
import type { GameMode, SongCard } from '@tunes/shared';

export const MODE_NAMES: Record<GameMode, string> = {
  original: 'Classic',
  pro: 'Classic Pro',
  expert: 'Classic Expert',
  coop: 'Classic Co-op',
  dinner: 'Dinner Set',
};

export function Brand({ onBack, children }: { onBack?: () => void; children?: ReactNode }) {
  return (
    <header className="tunes-mast">
      {onBack ? (
        <button className="tunes-brand" onClick={onBack} aria-label="Back to Tunes">
          <ArrowLeft size={19} aria-hidden="true" />
          Tunes<span>.</span>
        </button>
      ) : (
        <div className="tunes-brand"><Disc3 size={24} aria-hidden="true" />Tunes<span>.</span></div>
      )}
      {children && <div className="tunes-mast-actions">{children}</div>}
    </header>
  );
}

export function RecordArt({ compact = false, spinning = false }: { compact?: boolean; spinning?: boolean }) {
  return (
    <div className={`tunes-record ${compact ? 'tunes-record-compact' : ''} ${spinning ? 'tunes-record-live' : ''}`} aria-hidden="true">
      <div className="tunes-record-disc">
        <div className="tunes-record-label"><i /></div>
      </div>
      {!compact && <div className="tunes-record-arm"><i /></div>}
    </div>
  );
}

export function Message({ children, kind = 'status' }: { children: ReactNode; kind?: 'status' | 'error' }) {
  return <p className={`tunes-message ${kind === 'error' ? 'tunes-message-error' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>;
}

export function gapLabel(timeline: SongCard[], position: number): string {
  const previous = timeline[position - 1];
  const next = timeline[position];
  if (previous && next) {
    return previous.year === next.year
      ? `Between two ${previous.year} recordings`
      : `Between ${previous.year} and ${next.year}`;
  }
  if (next) return `Before ${next.year}`;
  if (previous) return `After ${previous.year}`;
  return 'First spot on the timeline';
}

export function WorkedExample() {
  return (
    <div className="tunes-example">
      <div aria-hidden="true" className="tunes-example-dates"><b>1980</b><i /><span>?</span><i /><b>1992</b></div>
      <p>A song first released in 1986 goes in the gap between 1980 and 1992.</p>
    </div>
  );
}

let fallbackActionId = 0;

export function makeActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++fallbackActionId}`;
}
