import { useEffect } from 'react';
import { Trophy } from 'lucide-react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store';
import { Brand, Message } from './TableUi';

export function Leaderboard() {
  const leaderboard = useGameStore((s) => s.leaderboard);
  const setScreen = useGameStore((s) => s.setScreen);
  const connected = useGameStore((s) => s.connected);

  useEffect(() => {
    if (connected) getSocket().emit('get-leaderboard');
  }, [connected]);

  return (
    <main className="tunes-shell">
      <Brand onBack={() => setScreen('home')} />
      <div className="tunes-page-heading"><h1>Leaderboard</h1><p>Historical rankings from the original stage-name leaderboard.</p></div>
      {!connected && <Message>Connecting to Tunes…</Message>}
      <section className="tunes-panel" aria-label="Historical standings">
        {leaderboard.length > 0 ? (
          <ol className="tunes-player-list tunes-podium">
            {leaderboard.map((entry, index) => (
              <li key={entry.username} data-leader={index === 0 || undefined}>
                <span className="tunes-avatar">{index === 0 ? <Trophy size={18} aria-label="First place" /> : index + 1}</span>
                <div className="tunes-player-label"><b>{entry.displayName}</b><span>{entry.totalGames} games · {Math.round(entry.winRate * 100)}% win rate · Best streak {entry.bestStreak}</span></div>
                <strong>{entry.totalWins} <span>{entry.totalWins === 1 ? 'win' : 'wins'}</span></strong>
              </li>
            ))}
          </ol>
        ) : <p className="tunes-muted">No historical rankings to show.</p>}
      </section>
    </main>
  );
}
