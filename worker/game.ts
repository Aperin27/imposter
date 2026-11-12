import type { Action, Phase, RoomView } from '../shared/protocol';
import { QUESTIONS } from './questions';

export const ANSWER_MS = 90_000;
export const ROUND_MS = 20 * 60_000;
export const HOST_GRACE_MS = 90_000;
export const ABANDON_MS = 30 * 60_000;
export const ROOM_LIFETIME_MS = 24 * 60 * 60_000;
export class GameError extends Error {}
interface Player {
  id: string; token: string; nickname: string; order: number;
  connected: boolean; left: boolean;
}
interface Round {
  number: number; phase: Exclude<Phase, 'lobby'>; participants: { id: string; nickname: string }[];
  imposterId: string; questions: readonly [string, string];
  answers: Record<string, string>; answerDeadline: number; deadline: number;
  reveal: RoomView['reveal'];
}
export interface Game {
  code: string; createdAt: number; expiresAt: number; abandonedAt: number | null;
  players: Player[]; nextOrder: number; hostId: string | null;
  hostReconnectAt: number | null; hostNotice: string | null;
  usedQuestions: number[]; round: Round | null;
}
export function randomIndex(length: number): number {
  // Rejection sampling avoids modulo bias.
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % length);
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
}
export function secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
export function nickname(value: unknown): string {
  if (typeof value !== 'string') throw new GameError('Enter a nickname.');
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new GameError('Use a nickname of 1–24 characters without control characters.');
  }
  return name;
}
export function createGame(code: string, now: number): Game {
  return { code, createdAt: now, expiresAt: now + ROOM_LIFETIME_MS, abandonedAt: now,
    players: [], nextOrder: 0, hostId: null, hostReconnectAt: null, hostNotice: null,
    usedQuestions: [], round: null };
}
export function member(game: Game, token: string): Player {
  const player = game.players.find(p => p.token === token && !p.left);
  if (!player) throw new GameError('Your session is no longer in this room. Join again.');
  return player;
}
export function join(game: Game, name: unknown, token: unknown, now: number): Player {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new GameError('Invalid session token.');
  const existing = game.players.find(p => p.token === token && !p.left);
  if (existing) return existing;
  if (game.round && game.round.phase !== 'revealed') throw new GameError('A round is in progress. Join after the reveal.');
  if (game.players.filter(p => !p.left).length >= 12) throw new GameError('This room is full (12 players).');
  const cleanName = nickname(name);
  if (game.players.some(p => !p.left && p.nickname.toLocaleLowerCase('en') === cleanName.toLocaleLowerCase('en'))) {
    throw new GameError('That nickname is already in this room. Choose another.');
  }
  const player: Player = { id: crypto.randomUUID(), token, nickname: cleanName,
    order: game.nextOrder++, connected: false, left: false };
  game.players = game.players.filter(p => !p.left);
  game.players.push(player);
  if (!game.hostId) { game.hostId = player.id; game.hostReconnectAt = now + HOST_GRACE_MS; }
  return player;
}
function promote(game: Game, now?: number) {
  // Intentional departure follows original join order, including an offline successor.
  // Grace expiry considers only connected candidates.
  const next = game.players.filter(p => !p.left && (now !== undefined || p.connected)).sort((a, b) => a.order - b.order)[0];
  game.hostId = next?.id ?? null;
  game.hostReconnectAt = next && !next.connected ? now! + HOST_GRACE_MS : null;
  game.hostNotice = next ? `${next.nickname} is now the host.` : 'Waiting for a player to reconnect and become host.';
}
export function connect(game: Game, id: string) {
  const player = game.players.find(p => p.id === id && !p.left);
  if (!player) throw new GameError('Player not found.');
  player.connected = true;
  game.abandonedAt = null;
  if (!game.hostId) promote(game);
  if (game.hostId === id) game.hostReconnectAt = null;
}
export function disconnect(game: Game, id: string, now: number) {
  const player = game.players.find(p => p.id === id && !p.left);
  if (!player || !player.connected) return;
  player.connected = false;
  if (game.hostId === id) game.hostReconnectAt = now + HOST_GRACE_MS;
  if (!game.players.some(p => p.connected && !p.left)) game.abandonedAt = now;
}
function reveal(game: Game, reason: 'host' | 'timeout', by: string | null) {
  const round = game.round!;
  if (round.phase === 'revealed') throw new GameError('The imposter has already been revealed.');
  round.phase = 'revealed';
  round.reveal = { imposterId: round.imposterId,
    imposterName: round.participants.find(p => p.id === round.imposterId)!.nickname,
    normalQuestion: round.questions[0], imposterQuestion: round.questions[1], reason, revealedBy: by };
}
export function advance(game: Game, now: number): boolean {
  if (game.hostReconnectAt !== null && now >= game.hostReconnectAt) promote(game);
  const round = game.round;
  if (round && round.phase !== 'revealed') {
    if (now >= round.deadline) reveal(game, 'timeout', null);
    else if (round.phase === 'answering' && now >= round.answerDeadline) round.phase = 'discussion';
  }
  return now >= game.expiresAt || (game.abandonedAt !== null && now >= game.abandonedAt + ABANDON_MS);
}
export function nextDeadline(game: Game): number {
  const deadlines = [game.expiresAt];
  if (game.abandonedAt !== null) deadlines.push(game.abandonedAt + ABANDON_MS);
  if (game.hostReconnectAt !== null) deadlines.push(game.hostReconnectAt);
  if (game.round?.phase === 'answering') deadlines.push(game.round.answerDeadline);
  if (game.round && game.round.phase !== 'revealed') deadlines.push(game.round.deadline);
  return Math.min(...deadlines);
}
export function act(game: Game, id: string, action: Action, now: number, choose = randomIndex) {
  advance(game, now);
  const player = game.players.find(p => p.id === id && !p.left && (p.connected || action.type === 'leave'));
  if (!player) throw new GameError('Reconnect before taking an action.');
  if (action.type === 'leave') {
    player.left = true;
    player.connected = false;
    if (game.hostId === id) promote(game, now);
    if (!game.players.some(p => p.connected && !p.left)) game.abandonedAt = now;
    return;
  }
  if (action.type === 'start' || action.type === 'reveal') {
    if (game.hostId !== id) throw new GameError('Only the host can do that.');
  }
  if (action.type === 'start') {
    if (game.round && game.round.phase !== 'revealed') throw new GameError('Finish the current round first.');
    const players = game.players.filter(p => p.connected && !p.left);
    if (players.length < 3) throw new GameError('At least three connected players are needed.');
    // Left players have no future permissions; their historical names live in the round snapshot.
    game.players = game.players.filter(p => !p.left);
    if (game.usedQuestions.length === QUESTIONS.length) game.usedQuestions = [];
    const choices = QUESTIONS.map((_, i) => i).filter(i => !game.usedQuestions.includes(i));
    const index = choices[choose(choices.length)];
    game.usedQuestions.push(index);
    game.round = { number: (game.round?.number ?? 0) + 1, phase: 'answering',
      participants: players.map(p => ({ id: p.id, nickname: p.nickname })),
      imposterId: players[choose(players.length)].id, questions: QUESTIONS[index],
      answers: {}, answerDeadline: now + ANSWER_MS, deadline: now + ROUND_MS, reveal: null };
    return;
  }
  const round = game.round;
  if (!round) throw new GameError('No round is running.');
  if (action.round !== round.number) throw new GameError('That action belongs to an older round.');
  if (action.type === 'reveal') { reveal(game, 'host', player.nickname); return; }
  if (action.type !== 'answer') throw new GameError('Unknown action.');
  if (round.phase !== 'answering') throw new GameError('Answering has ended.');
  if (!round.participants.some(p => p.id === id)) throw new GameError('You are watching this round.');
  if (id in round.answers) throw new GameError('You have already submitted an answer.');
  if (typeof action.answer !== 'string' || !action.answer.trim() || action.answer.trim().length > 160
    || /[\p{Cc}\p{Cf}]/u.test(action.answer.trim())) throw new GameError('Use an answer of 1–160 characters on one line.');
  round.answers[id] = action.answer.trim();
  if (round.participants.every(p => p.id in round.answers)) round.phase = 'discussion';
}
export function view(game: Game, id: string, now: number): RoomView {
  const round = game.round;
  const participating = round?.participants.some(p => p.id === id);
  const publicAnswers = round && round.phase !== 'answering';
  return {
    code: game.code, you: id, hostId: game.hostId, hostReconnectAt: game.hostReconnectAt,
    hostNotice: game.hostNotice, serverNow: now,
    players: game.players.map(p => ({ id: p.id, nickname: p.nickname, connected: p.connected,
      left: p.left, submitted: !!round && p.id in round.answers })),
    phase: round?.phase ?? 'lobby', roundNumber: round?.number ?? 0,
    answerDeadline: round?.answerDeadline ?? null, roundDeadline: round?.deadline ?? null,
    participantIds: round?.participants.map(p => p.id) ?? [],
    question: round && participating && round.phase === 'answering'
      ? round.questions[round.imposterId === id ? 1 : 0] : null,
    yourAnswer: round?.answers[id] ?? null,
    answers: publicAnswers ? round.participants.map(p => ({ playerId: p.id, nickname: p.nickname, answer: round.answers[p.id] ?? null })) : null,
    reveal: round?.phase === 'revealed' ? round.reveal : null,
  };
}
