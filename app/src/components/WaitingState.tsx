import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap } from 'lucide-react';
import { useGameStore } from '../store';
import { getSocket } from '../services/socket';
import { triviaQuestions, type TriviaQuestion } from '../data/trivia';

function getRandomQuestion(exclude?: TriviaQuestion): TriviaQuestion {
  const pool = exclude ? triviaQuestions.filter((q) => q !== exclude) : triviaQuestions;
  return pool[Math.floor(Math.random() * pool.length)];
}

function MusicVisualizer() {
  return (
    <div className="flex items-end justify-center gap-1 h-10 mb-4">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className="w-1.5 rounded-full bg-gradient-to-t from-purple-500 to-pink-400 animate-visualizer"
          style={{ animationDelay: `${i * 0.08}s` }}
        />
      ))}
    </div>
  );
}

export function WaitingState() {
  const players = useGameStore((s) => s.players);
  const buzzedPlayers = useGameStore((s) => s.buzzedPlayers);
  const myId = useGameStore((s) => s.myId);
  const currentTurnPlayerId = useGameStore((s) => s.currentTurnPlayerId);

  const [question, setQuestion] = useState<TriviaQuestion>(() => getRandomQuestion());
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [hasBuzzed, setHasBuzzed] = useState(false);
  const triviaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset buzz state when turn changes
  useEffect(() => {
    setHasBuzzed(false);
  }, [currentTurnPlayerId]);

  // Clean up trivia timeout on unmount
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
      return 'bg-white/10 hover:bg-white/20 border-white/20 text-white';
    }
    if (index === question.correctIndex) {
      return 'bg-green-500/30 border-green-400 text-green-300';
    }
    if (index === selectedAnswer && index !== question.correctIndex) {
      return 'bg-red-500/30 border-red-400 text-red-300';
    }
    return 'bg-white/5 border-white/10 text-white/40';
  };

  return (
    <div className="mt-6 flex flex-col items-center w-full max-w-md mx-auto px-4">
      {/* Music visualizer */}
      <MusicVisualizer />

      {/* Trivia section */}
      <div className="w-full bg-white/5 rounded-2xl border border-white/10 p-5 mb-5">
        <p className="text-xs uppercase tracking-widest text-purple-400 font-semibold mb-3">
          Music Trivia
        </p>
        <AnimatePresence mode="wait">
          <motion.div
            key={question.question}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-white font-medium text-sm mb-4 leading-relaxed">
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
            ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400/60 cursor-not-allowed'
            : 'bg-gradient-to-r from-yellow-500 to-orange-500 border-yellow-400 text-black hover:from-yellow-400 hover:to-orange-400 animate-buzz-pulse'
        }`}
      >
        <Zap className="w-6 h-6" />
        {hasBuzzed ? 'Buzzed!' : 'I Know This!'}
      </button>

      {/* Buzzed players */}
      {buzzedPlayers.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
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
                      ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                      : 'bg-white/10 text-white/80 border border-white/20'
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
