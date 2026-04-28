import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap } from 'lucide-react';
import { useGameStore } from '../store';
import { getSocket } from '../services/socket';
import { triviaQuestions, type TriviaQuestion, type TriviaCategory } from '../data/trivia';

const CATEGORY_LABELS: Record<TriviaCategory, string> = {
  general: 'Trivia · Music History',
  lyrics: 'Trivia · Finish the Lyric',
  first: 'Trivia · Which Came First?',
  true_false: 'Trivia · True or False',
  decades: 'Trivia · Name the Decade',
  instruments: 'Trivia · Instruments',
  origins: 'Trivia · Music Origins',
};

function getRandomQuestion(exclude?: TriviaQuestion): TriviaQuestion {
  const pool = exclude ? triviaQuestions.filter((q) => q !== exclude) : triviaQuestions;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function WaitingState() {
  const players = useGameStore((s) => s.players);
  const buzzedPlayers = useGameStore((s) => s.buzzedPlayers);
  const myId = useGameStore((s) => s.myId);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);
  const triviaScore = useGameStore((s) => s.triviaScore);

  const [question, setQuestion] = useState<TriviaQuestion>(() => getRandomQuestion());
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [hasBuzzed, setHasBuzzed] = useState(false);
  const triviaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHasBuzzed(false);
  }, [currentTurnPlayerId]);

  useEffect(() => {
    return () => {
      if (triviaTimeoutRef.current !== null) {
        clearTimeout(triviaTimeoutRef.current);
      }
    };
  }, []);

  const loadNextQuestion = useCallback(() => {
    setQuestion((prev) => getRandomQuestion(prev));
    setSelectedAnswer(null);
    setShowResult(false);
  }, []);

  const handleAnswer = (index: number) => {
    if (showResult) return;
    setSelectedAnswer(index);
    setShowResult(true);
    useGameStore.getState().addTriviaAnswer(index === question.correctIndex);
    triviaTimeoutRef.current = setTimeout(loadNextQuestion, 2000);
  };

  const handleBuzz = () => {
    if (hasBuzzed) return;
    const socket = getSocket();
    socket.emit('buzz');
    setHasBuzzed(true);
  };

  const getButtonStyle = (index: number) => {
    if (!showResult) {
      return 'bg-white/8 hover:bg-white/15 border-white/15 text-white';
    }
    if (index === question.correctIndex) {
      return 'bg-green-500/30 border-green-400 text-green-200';
    }
    if (index === selectedAnswer && index !== question.correctIndex) {
      return 'bg-red-500/30 border-red-400 text-red-200';
    }
    return 'bg-white/5 border-white/10 text-white/40';
  };

  return (
    <div className="mt-3 flex flex-col items-center w-full max-w-md mx-auto px-2">
      {/* Trivia panel */}
      <div className="w-full panel p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-neon-amber font-bold">
            {CATEGORY_LABELS[question.category || 'general']}
          </p>
          <span className="text-xs font-bold text-white/45 tabular-nums">
            {triviaScore.correct}/{triviaScore.total}
          </span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={question.question}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-white font-heading font-medium text-base mb-4 leading-snug">
              {question.question}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {question.options.map((option, i) => (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={showResult}
                  className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200 ${getButtonStyle(i)}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Buzz button */}
      <button
        onClick={handleBuzz}
        disabled={hasBuzzed}
        className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 border-2 transition-all duration-200 ${
          hasBuzzed
            ? 'bg-green-500/20 border-green-500/40 text-green-300'
            : 'bg-gradient-to-r from-neon-amber to-orange-400 border-neon-amber text-[#0a0318] glow-amber animate-buzz-pulse'
        }`}
      >
        <Zap className="w-6 h-6" />
        {hasBuzzed ? 'Buzzed!' : 'I Know This!'}
      </button>

      {/* Buzzed players */}
      {buzzedPlayers.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <AnimatePresence>
            {buzzedPlayers.map((pid) => {
              const player = players[pid];
              if (!player) return null;
              return (
                <motion.span
                  key={pid}
                  initial={{ opacity: 0, scale: 0.5, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
                    pid === myId
                      ? 'bg-neon-amber/20 text-neon-amber border border-neon-amber/40'
                      : 'bg-neon-amber/10 text-neon-amber/80 border border-neon-amber/25'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  {player.name}
                </motion.span>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
