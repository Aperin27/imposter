export type Phase = 'lobby' | 'answering' | 'discussion' | 'revealed';
export interface PublicPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  left: boolean;
  submitted: boolean;
  disconnectedAt?: number | null;
}
export interface RoomNotice { id: string; text: string; at: number; kind: 'host' | 'removal' }
export const NOTICE_MS = 8_000;
export const OFFLINE_REMOVAL_MS = 90_000;
export interface RoomView {
  code: string;
  you: string;
  hostId: string | null;
  hostReconnectAt: number | null;
  hostNotice: string | null;
  notice?: RoomNotice | null;
  players: PublicPlayer[];
  phase: Phase;
  roundNumber: number;
  serverNow: number;
  answerDeadline: number | null;
  roundDeadline: number | null;
  participantIds: string[];
  question: string | null;
  yourAnswer: string | null;
  answers: { playerId: string; nickname: string; answer: string | null }[] | null;
  reveal: {
    imposterId: string;
    imposterName: string;
    normalQuestion: string;
    imposterQuestion: string;
    reason: 'host' | 'timeout';
    revealedBy: string | null;
  } | null;
}
export type Action = { type: 'start'; round?: number } | { type: 'answer'; answer: string; round: number }
  | { type: 'reveal'; round: number } | { type: 'leave' }
  | { type: 'removeOffline'; playerId: string; disconnectedAt: number };
export type ServerMessage = { type: 'state'; state: RoomView }
  | { type: 'error'; message: string } | { type: 'left' } | { type: 'expired' };
export interface Session { code: string; token: string }
