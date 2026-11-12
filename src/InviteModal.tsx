import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { inviteLink } from './invites';
import { Modal } from './Modal';

export function InviteModal({ code, onClose }: { code: string; onClose: () => void }) {
  const link = inviteLink(window.location.origin, code);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(''), 4000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopyStatus('Invite link copied.'); }
    catch { setCopyStatus('Clipboard unavailable. Select and copy the link below.'); }
  }
  return <Modal title="Bring your people." onCancel={onClose} className="invite-dialog">
    <button className="modal-close text-button" aria-label="Close QR code" data-initial-focus onClick={onClose}>✕</button>
    <p className="muted">Scan to join the room. Everyone still chooses a nickname before joining.</p>
    <div className="qr-frame"><QRCodeSVG value={link} size={280} level="M" marginSize={4}
      bgColor="#ffffff" fgColor="#101218" title={`Join Imposter room ${code}`} /></div>
    <div className="invite-room-code" aria-label={`Room code ${code}`}>{code}</div>
    <label htmlFor="invite-link">Invite link</label>
    <input id="invite-link" className="invite-link" readOnly value={link} onFocus={event => event.currentTarget.select()} />
    <button className="primary full" onClick={() => void copy()}>Copy Invite Link <span aria-hidden="true">⧉</span></button>
    <p className="copy-status small muted" role="status">{copyStatus || 'Only the room code is shared. Your player session stays private.'}</p>
  </Modal>;
}
