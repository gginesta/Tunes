import { Disc, Check, X, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { useGameStore } from '../../store';
import type { RevealData } from '../../store';

interface RevealOverlayProps {
  reveal: RevealData;
}

/** Revealed song card with mode-specific result breakdown. */
export function RevealOverlay({ reveal }: RevealOverlayProps) {
  const players = useGameStore((s) => s.players);
  const settings = useGameStore((s) => s.settings);
  const mode = settings.mode;
  const isCoop = mode === 'coop';

  const revealedSong = reveal.song;
  const modeResult = reveal.modeResult;

  return (
    <motion.div
      key="reveal"
      initial={{ scale: 0.8, opacity: 0, y: 50 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.8, opacity: 0, y: -50 }}
      className={`reveal-card ${reveal.correct ? 'reveal-correct' : 'reveal-wrong'}`}
    >
      {revealedSong.albumArtUrl ? (
        <img src={revealedSong.albumArtUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 rounded-3xl" />
      ) : (
        <div className="absolute -right-12 -bottom-12 opacity-20">
          <Disc className="w-48 h-48" />
        </div>
      )}
      <motion.div
        initial={{ rotateY: 90 }}
        animate={{ rotateY: 0 }}
        className="text-center z-10"
      >
        <h2 className="font-display text-5xl mb-2 drop-shadow-lg leading-none">{revealedSong.year}</h2>
        <p className="text-lg font-bold leading-tight drop-shadow-md">{revealedSong.title}</p>
        <p className="text-sm text-white/80">{revealedSong.artist}</p>

        <div className="mt-4 space-y-2">
          {/* Mode-specific result breakdown */}
          {modeResult && (mode === 'pro' || mode === 'expert') && (
            <div className="flex flex-col gap-1 text-xs">
              <div className={`flex items-center justify-center gap-1 ${modeResult.placementCorrect ? 'text-green-300' : 'text-red-300'}`}>
                {modeResult.placementCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                Placement
              </div>
              <div className={`flex items-center justify-center gap-1 ${modeResult.songNamed ? 'text-green-300' : 'text-red-300'}`}>
                {modeResult.songNamed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                Song Name
              </div>
              {mode === 'expert' && (
                <div className={`flex items-center justify-center gap-1 ${modeResult.yearCorrect ? 'text-green-300' : 'text-red-300'}`}>
                  {modeResult.yearCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                  Exact Year
                </div>
              )}
            </div>
          )}

          {/* Main result message */}
          <div>
            {reveal.correct ? (
              <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                <Check className="w-5 h-5" /> Correct!
              </div>
            ) : isCoop && modeResult?.coopPenalty ? (
              <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                <X className="w-5 h-5" /> Wrong! -1 Token
              </div>
            ) : reveal.stolenBy ? (
              <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                <AlertTriangle className="w-5 h-5" /> Stolen by{' '}
                {players[reveal.stolenBy]?.name || 'challenger'}!
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-white bg-black/20 px-4 py-2 rounded-full">
                <X className="w-5 h-5" /> {mode === 'pro' || mode === 'expert' ? 'Requirements not met' : 'Wrong placement'}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
