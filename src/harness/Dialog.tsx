import { useEffect, type ReactNode } from 'react';

/** Modal wrapper: overlay + centered box, closes on Escape or backdrop click. */
export function Dialog({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="imp-overlay" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="imp-box" onClick={(e) => e.stopPropagation()}>
        <button className="imp-dialog__close" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
