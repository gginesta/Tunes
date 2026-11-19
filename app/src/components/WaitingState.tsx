import { useEffect, useState } from 'react';
import { Music2, Zap } from 'lucide-react';
import { useGameStore } from '../store';
import { getSocket } from '../services/socket';
import type { TriviaQuestion } from '../data/trivia';
import { Message } from './TableUi';

export function WaitingState() {
  const players = useGameStore((s) => s.players);
  const buzzedPlayers = useGameStore((s) => s.buzzedPlayers);
  const myId = useGameStore((s) => s.myId);
  const connected = useGameStore((s) => s.connected);
  const triviaScore = useGameStore((s) => s.triviaScore);
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [hasBuzzed, setHasBuzzed] = useState(false);
  const [triviaOpen, setTriviaOpen] = useState(false);
  const question = questions[questionIndex];

  useEffect(() => {
    if (!triviaOpen || questions.length) return;
    let cancelled = false;
    void import('../data/trivia').then(({ triviaQuestions }) => {
      if (cancelled) return;
      setQuestions(triviaQuestions);
      setQuestionIndex(Math.floor(Math.random() * triviaQuestions.length));
    });
    return () => { cancelled = true; };
  }, [triviaOpen, questions.length]);

  return (
    <details className="tunes-panel tunes-disclosure" onToggle={(event) => setTriviaOpen(event.currentTarget.open)}>
      <summary><Music2 size={18} aria-hidden="true" /> While you wait</summary>
      <div className="tunes-stack tunes-trivia">
        <button className="tunes-button tunes-button-secondary" disabled={!connected || hasBuzzed} onClick={() => {
          const socket = getSocket();
          if (socket.connected) { socket.emit('buzz'); setHasBuzzed(true); }
        }}><Zap size={16} aria-hidden="true" /> {hasBuzzed ? 'Buzz sent' : 'I know this song'}</button>
        {buzzedPlayers.length > 0 && <p className="tunes-muted">{buzzedPlayers.map((id) => id === myId ? 'You' : players[id]?.name || 'A guest').join(', ')} buzzed.</p>}
        {!question ? <Message>Loading trivia…</Message> : (
          <>
            <div className="tunes-row-title"><b>Music trivia</b><span className="tunes-pill">{triviaScore.correct}/{triviaScore.total} correct</span></div>
            <p>{question.question}</p>
            <div className="tunes-field-grid" role="group" aria-label="Trivia answers">
              {question.options.map((option, index) => (
                <button className="tunes-button tunes-button-secondary" key={index} aria-disabled={selected !== null} onClick={() => {
                  if (selected !== null) return;
                  setSelected(index);
                  useGameStore.getState().addTriviaAnswer(index === question.correctIndex);
                }}>{option}</button>
              ))}
            </div>
            {selected !== null && (
              <>
                <Message>{selected === question.correctIndex ? 'Correct!' : `Answer: ${question.options[question.correctIndex]}`}</Message>
                <button className="tunes-link" onClick={() => {
                  setSelected(null);
                  setQuestionIndex((index) => (index + 1) % questions.length);
                }}>Next question</button>
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
