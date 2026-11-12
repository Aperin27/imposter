import type { Session } from '../shared/protocol';

export function readInvite(search: string): { code: string | null; error: string | null } {
  const values = new URLSearchParams(search).getAll('join');
  if (!values.length) return { code: null, error: null };
  const code = values[0].trim().toUpperCase();
  if (values.length !== 1 || !/^[A-Z2-9]{6}$/.test(code)) {
    return { code: null, error: 'That invite has an invalid room code. Ask your host for a new link or enter the code manually.' };
  }
  return { code, error: null };
}
export function inviteLink(origin: string, code: string): string {
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Invalid room code.');
  const url = new URL('/', new URL(origin).origin);
  url.searchParams.set('join', code);
  return url.href;
}
export function existingSessionMessage(session: Session, invitedCode: string): string {
  return session.code === invitedCode
    ? `You’re already in room ${session.code}. Your current player session has been kept.`
    : `This invite is for ${invitedCode}, but you’re already in ${session.code}. Your current session has been kept. Leave your current room explicitly before joining the invited room.`;
}
