import { motion, AnimatePresence } from 'motion/react';

interface StopConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Stop game confirmation dialog. */
export function StopConfirmDialog({ open, onCancel, onConfirm }: StopConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="stop-confirm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="panel-raised p-6 mx-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-heading text-lg font-bold text-white mb-2">Stop Game?</h3>
            <p className="text-sm text-white/60 mb-6">This will end the current game and return everyone to the lobby.</p>
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="btn btn-ghost flex-1"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="btn btn-danger flex-1"
              >
                Stop Game
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
