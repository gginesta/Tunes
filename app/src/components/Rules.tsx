import { ArrowLeft, Music, Target, Coins, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { useGameStore } from '../store';

export function Rules() {
  const setScreen = useGameStore((s) => s.setScreen);

  const sections = [
    {
      icon: <Target className="w-6 h-6 text-[#1DB954]" />,
      title: 'Objective',
      content:
        'Be the first player to collect the target number of song cards by correctly placing them in chronological order on your timeline.',
    },
    {
      icon: <Music className="w-6 h-6 text-[#1DB954]" />,
      title: 'How to Play',
      items: [
        'Each round, a mystery song plays for all players.',
        "The active player must place the song card on their timeline in the correct chronological position.",
        'Other players can challenge the placement by spending a token.',
        'After the challenge window, the song is revealed.',
        'If placement is correct, the active player keeps the card.',
        'If incorrect and someone challenged, the first challenger steals the card!',
      ],
    },
    {
      icon: <Coins className="w-6 h-6 text-[#FFD700]" />,
      title: 'Tokens',
      items: [
        'Skip a song: costs 1 token',
        'Challenge a placement: costs 1 token',
        'Buy a card (auto-placed): costs 3 tokens',
        'Name the song correctly: earn 1 token',
      ],
    },
    {
      icon: <Zap className="w-6 h-6 text-purple-400" />,
      title: 'Game Modes',
      items: [
        'Original: Place the card in the right spot. Optionally name the song for a bonus token.',
        'Pro: Must place correctly AND name the song.',
        'Expert: Must place, name, AND guess the exact year.',
        'Co-op: Shared timeline, work together! Lose a token on wrong placement.',
      ],
    },
  ];

  return (
    <div className="flex flex-col min-h-screen p-6 text-white bg-[#1a1a2e]">
      <div className="flex items-center mb-8">
        <button
          onClick={() => setScreen('home')}
          className="p-2 bg-white/5 rounded-full hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </button>
        <h1 className="text-2xl font-black ml-4">How to Play</h1>
      </div>

      <div className="max-w-lg mx-auto w-full space-y-6">
        {sections.map((section, i) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white/5 rounded-3xl p-6 border border-white/10"
          >
            <h3 className="text-lg font-bold flex items-center gap-3 mb-4">
              {section.icon}
              {section.title}
            </h3>
            {section.content && (
              <p className="text-gray-300 leading-relaxed">{section.content}</p>
            )}
            {section.items && (
              <ul className="space-y-2">
                {section.items.map((item, j) => (
                  <li key={j} className="text-gray-300 text-sm flex gap-2">
                    <span className="text-[#1DB954] font-bold mt-0.5">
                      {j + 1}.
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
