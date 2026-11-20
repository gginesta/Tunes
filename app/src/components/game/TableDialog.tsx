import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function TableDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog className="tunes-dialog" ref={dialog} onCancel={onClose} aria-labelledby="table-dialog-title">
      <div className="tunes-row-title">
        <h2 id="table-dialog-title">{title}</h2>
        <button className="tunes-icon-button" onClick={onClose} aria-label="Close"><X size={21} aria-hidden="true" /></button>
      </div>
      {children}
    </dialog>
  );
}
