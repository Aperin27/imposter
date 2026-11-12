import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Modal({ title, onCancel, children, className = '', open = true }: {
  title: string; onCancel: () => void; children: ReactNode; className?: string; open?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
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
  }, [open]);
  return <dialog ref={dialog} className={`dialog ${className}`} aria-labelledby={titleId}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
        .filter(element => !element.closest('[hidden], [inert]') && getComputedStyle(element).display !== 'none');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id={titleId}>{title}</h2>{children}
  </dialog>;
}
export function Confirm({ title, message, confirm, onConfirm, onCancel, disabled, open = true }: {
  title: string; message: string; confirm: string; onConfirm: () => void; onCancel: () => void; disabled: boolean; open?: boolean;
}) {
  return <Modal title={title} onCancel={onCancel} open={open}>
    <span className="eyebrow">CONFIRM YOUR NEXT MOVE</span><p className="muted">{message}</p><div className="dialog-actions">
      <button className="secondary" data-initial-focus onClick={onCancel}>Cancel</button>
      <button className="primary" disabled={disabled} onClick={onConfirm}>{confirm}</button>
    </div>
  </Modal>;
}
