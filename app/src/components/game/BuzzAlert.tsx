import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGameStore } from '../../store';

/** Buzz flash overlay — shown to the active player when someone buzzes. */
export function BuzzAlert() {
  const buzzFlash = useGameStore((s) => s.buzzFlash);
  const [showBuzzAlert, setShowBuzzAlert] = useState(false);
  const prevBuzzFlashRef = useRef(buzzFlash);

  // Show buzz flash when active player gets buzzed
  useEffect(() => {
    if (buzzFlash > prevBuzzFlashRef.current) {
      setShowBuzzAlert(true);
      const t = setTimeout(() => setShowBuzzAlert(false), 2000);
      prevBuzzFlashRef.current = buzzFlash;
      return () => clearTimeout(t);
    }
    prevBuzzFlashRef.current = buzzFlash;
  }, [buzzFlash]);

  return (
    <AnimatePresence>
      {showBuzzAlert && (
        <motion.div
          key="buzz-alert"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 z-50 pointer-events-none flex items-start justify-center pt-20"
        >
          <div className="bg-neon-amber text-[#0a0318] font-black text-xl px-7 py-4 rounded-3xl shadow-[0_0_60px_rgba(255,190,61,0.8)] flex items-center gap-3 animate-pulse">
            <span className="text-3xl">⚡</span>
            <span>Someone knows this!</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
