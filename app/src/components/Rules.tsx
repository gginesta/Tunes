import { ArrowLeft, Music, Target, Coins, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { useGameStore } from '../store';

type RuleColor = 'pink' | 'cyan' | 'amber' | 'violet';

const COLOR_BOX: Record<RuleColor, string> = {
  pink: 'bg-neon-pink/15 border-neon-pink/40 text-neon-pink',
  cyan: 'bg-neon-cyan/15 border-neon-cyan/40 text-neon-cyan',
  amber: 'bg-neon-amber/15 border-neon-amber/40 text-neon-amber',
  violet: 'bg-neon-violet/15 border-neon-violet/40 text-neon-violet',
};

export function Rules() {
  const setScreen = useGameStore((s) => s.setScreen);

  const sections: { icon: React.ReactNode; color: RuleColor; title: string; content?: string; items?: string[] }[] = [
    {
      icon: <Target className="w-6 h-6" />,
      color: 'pink',
      title: 'Objective',
      content:
        'Be the first player to collect the target number of song cards by correctly placing them in chronological order on your timeline.',
    },
    {
      icon: <Music className="w-6 h-6" />,
      color: 'cyan',
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
      icon: <Coins className="w-6 h-6" />,
      color: 'amber',
      title: 'Tokens',
      items: [
        'Skip a song: costs 1 token',
        'Challenge a placement: costs 1 token',
        'Buy a card (auto-placed): costs 3 tokens',
        'Name the song correctly: earn 1 token',
      ],
    },
    {
      icon: <Zap className="w-6 h-6" />,
      color: 'violet',
      title: 'Game Modes',
      items: [
        'Original: Place the card in the correct chronological spot to keep it. Optionally name the song for a bonus token.',
        'Pro: You must place the card correctly AND name the song (title + artist). If you don\'t name it, the card is lost even if placed correctly.',
        'Expert: The ultimate challenge — place correctly, name the song, AND guess the exact release year. All three must be right to keep the card.',
        'Co-op: All players share one timeline and work together. No challenges. Wrong placement costs the active player 1 token. Reach the target together to win!',
      ],
    },
  ];

  return (
    <div className="flex flex-col min-h-screen p-6 text-white">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => setScreen('home')}
          className="btn-icon"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-heading text-2xl font-bold">How to Play</h1>
      </div>

      <div className="max-w-lg mx-auto w-full space-y-5 pb-8">
        {sections.map((section, i) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 200, damping: 22 }}
            className="panel p-5"
          >
            <h3 className="text-base font-bold flex items-center gap-3 mb-3 font-heading">
              <span className={`w-10 h-10 rounded-xl border flex items-center justify-center ${COLOR_BOX[section.color]}`}>
                {section.icon}
              </span>
              {section.title}
            </h3>
            {section.content && (
              <p className="text-white/65 leading-relaxed text-sm">{section.content}</p>
            )}
            {section.items && (
              <ul className="space-y-2.5">
                {section.items.map((item, j) => (
                  <li key={j} className="text-white/65 text-sm flex gap-2.5 leading-relaxed items-start">
                    <span className="w-6 h-6 rounded-full bg-neon-pink text-[#0a0318] font-bold text-[11px] flex items-center justify-center flex-shrink-0">
                      {j + 1}
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
