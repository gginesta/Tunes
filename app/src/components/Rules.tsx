import { Disc3, Headphones, Users } from 'lucide-react';
import { useGameStore } from '../store';
import { Brand, WorkedExample } from './TableUi';

export function Rules() {
  const setScreen = useGameStore((s) => s.setScreen);

  return (
    <main className="tunes-shell tunes-rules">
      <Brand onBack={() => setScreen('home')} />
      <div className="tunes-page-heading"><h1>How to play</h1><p>Hear a recording and place its first release in time.</p></div>
      <div className="tunes-lobby-grid">
        <section className="tunes-panel tunes-stack">
          <h2><Disc3 size={24} aria-hidden="true" /> Classic</h2>
          <p>On your turn, put the mystery recording between two dates, or before or after all the cards. Keep it if your placement is right. The first player to the target wins.</p>
          <WorkedExample />
          <p>Opponents can pass or spend a token to claim another gap. A challenger steals the card when your placement misses and theirs fits.</p>
          <p>Name a title for a bonus token, or choose Done guessing to move on. Skip a song for one token or buy a card for three.</p>
        </section>
        <section className="tunes-panel tunes-stack">
          <h2><Users size={24} aria-hidden="true" /> Dinner Set</h2>
          <p>Everyone who is guessing picks a gap on the shared timeline. You can change your pick until you lock it. The table sees the guesses and points together at the reveal.</p>
          <p>Get one point for a correct guess. The recording joins the timeline after each reveal. The highest score wins, and tied players share the title.</p>
        </section>
        <section className="tunes-panel tunes-stack">
          <h2><Headphones size={24} aria-hidden="true" /> Music and roles</h2>
          <p>The controller starts the match and advances the reveal. For a manual table, the DJ sees a private recording cue and plays it from a music source the group may use. The DJ sits out that song’s guessing and challenges.</p>
          <p>The speaker plays automatic packs when available. If required music is interrupted, wait for the operator to resume or replace the recording.</p>
        </section>
        <section className="tunes-panel tunes-stack">
          <h2>Classic variations</h2>
          <p><b>Pro.</b> Place the card and name the title and artist.</p>
          <p><b>Expert.</b> Place the card, name the title and artist, and enter the four-digit release year.</p>
          <p><b>Co-op.</b> Fill one shared timeline. Incorrect placements cost the active player a token.</p>
        </section>
      </div>
    </main>
  );
}
