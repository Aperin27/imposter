import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Modal({ title, onCancel, children, className = '' }: {
  title: string; onCancel: () => void; children: ReactNode; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    element.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={dialog} className={`dialog ${className}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id={titleId}>{title}</h2>{children}
  </dialog>;
}
export function Confirm({ title, message, confirm, onConfirm, onCancel, disabled }: {
  title: string; message: string; confirm: string; onConfirm: () => void; onCancel: () => void; disabled: boolean;
}) {
  return <Modal title={title} onCancel={onCancel}>
    <p className="muted">{message}</p><div className="dialog-actions">
      <button className="secondary" data-initial-focus onClick={onCancel}>Cancel</button>
      <button className="primary" disabled={disabled} onClick={onConfirm}>{confirm}</button>
    </div>
  </Modal>;
}
