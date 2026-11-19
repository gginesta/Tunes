import { useEffect } from 'react';
import type { GameMode } from '@tunes/shared';
import { getGuestToken, getSocket } from '../services/socket';
import { useGameStore } from '../store';
import { Brand, Message, MODE_NAMES } from './TableUi';

function stageName() {
  try { return localStorage.getItem('tunes_display_name') || 'You'; } catch { return 'You'; }
}

export function PlayerProfile() {
  const myStats = useGameStore((s) => s.myStats);
  const myHistory = useGameStore((s) => s.myHistory);
  const setScreen = useGameStore((s) => s.setScreen);
  const connected = useGameStore((s) => s.connected);

  useEffect(() => {
    if (!connected) return;
    const guestToken = getGuestToken();
    const socket = getSocket();
    socket.emit('get-my-stats', { guestToken });
    socket.emit('get-my-history', { guestToken });
  }, [connected]);

  const stats = myStats ? [
    { label: 'Matches', value: myStats.totalGames },
    { label: 'Wins', value: myStats.totalWins },
    { label: 'Win rate', value: `${Math.round(myStats.winRate * 100)}%` },
    { label: 'Best streak', value: myStats.bestStreak },
    { label: 'Placement accuracy', value: myStats.totalPlacements ? `${Math.round(myStats.totalCorrect / myStats.totalPlacements * 100)}%` : '—' },
    { label: 'Challenges won', value: myStats.totalChallengesWon },
  ] : [];
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  return (
    <main className="tunes-shell">
      <Brand onBack={() => setScreen('home')} />
      <div className="tunes-page-heading"><h1>My stats</h1><p>{stageName()} · This device’s guest record</p></div>
      {!connected && <Message>Connecting to Tunes…</Message>}
      <div className="tunes-lobby-grid">
        <section className="tunes-panel tunes-stack">
          <h2>Record</h2>
          {stats.length ? <dl className="tunes-mini-stats">
            {stats.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl> : <p className="tunes-muted">Finish a match to start your record.</p>}
        </section>
        <section className="tunes-panel tunes-stack">
          <h2>Recent matches</h2>
          {myHistory.length ? <ul className="tunes-reveal-picks">
            {myHistory.map((match) => {
              const name = MODE_NAMES[match.mode as GameMode] || match.mode;
              const date = new Date(match.playedAt);
              const outcome = match.outcome === 'abandoned' ? 'Ended early' : match.outcome === 'tied' && match.isWinner ? 'Tied for first' : match.isWinner ? 'Win' : 'Loss';
              return <li key={match.id}><div><b>{name}</b><span>{Number.isNaN(date.valueOf()) ? match.playedAt : formatter.format(date)} · {match.cardsWon} {match.mode === 'dinner' ? 'points' : 'cards'}</span></div><strong>{outcome}</strong></li>;
            })}
          </ul> : <p className="tunes-muted">No matches yet.</p>}
        </section>
      </div>
    </main>
  );
}
