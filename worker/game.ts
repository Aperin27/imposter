import { NOTICE_MS, OFFLINE_REMOVAL_MS, type Action, type Phase, type RoomNotice, type RoomView } from '../shared/protocol';
import { LEGACY_QUESTION_IDS } from './questions';
import type { QuestionAllocation } from './rotationDeck';

export const ANSWER_MS = 90_000;
export const ROUND_MS = 20 * 60_000;
export const HOST_GRACE_MS = 90_000;
export const ABANDON_MS = 30 * 60_000;
export const ROOM_LIFETIME_MS = 24 * 60 * 60_000;
export class GameError extends Error {}
interface Player {
  id: string; token: string; nickname: string; order: number;
  connected: boolean; left: boolean;
  disconnectedAt?: number | null;
}
interface Round {
  number: number; phase: Exclude<Phase, 'lobby'>; participants: { id: string; nickname: string }[];
  imposterId: string; questions: readonly [string, string];
  answers: Record<string, string>; answerDeadline: number; deadline: number;
  reveal: RoomView['reveal'];
  questionId?: string;
  allocationKey?: string;
  questionCycle?: number;
}
export interface Game {
  code: string; createdAt: number; expiresAt: number; abandonedAt: number | null;
  players: Player[]; nextOrder: number; hostId: string | null;
  hostReconnectAt: number | null; hostNotice: string | null;
  usedQuestions: number[]; round: Round | null;
  usedQuestionIds?: string[];
  revokedTokens?: string[];
  notice?: RoomNotice | null;
  roomInstanceId?: string;
  pendingStart?: { key: string; roundNumber: number } | null;
}
export function upgradeGame(game: Game, now: number): Game {
  game.roomInstanceId ??= crypto.randomUUID();
  game.usedQuestionIds ??= [...new Set(game.usedQuestions.flatMap(index =>
    Number.isInteger(index) && index >= 0 && index < LEGACY_QUESTION_IDS.length ? [LEGACY_QUESTION_IDS[index]] : []))];
  game.revokedTokens ??= [];
  // Untimestamped Stage 1 host notices are historical, not new notifications.
  if (game.notice === undefined) { game.notice = null; game.hostNotice = null; }
  for (const player of game.players) {
    if (player.disconnectedAt === undefined) player.disconnectedAt = player.connected || player.left ? null : now;
  }
  return game;
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
    usedQuestions: [], usedQuestionIds: [], revokedTokens: [], notice: null, round: null,
    roomInstanceId: crypto.randomUUID(), pendingStart: null };
}
export function member(game: Game, token: string): Player {
  if (game.revokedTokens?.includes(token)) throw new GameError('Your offline player was removed by the host. Join again with a new session.');
  const player = game.players.find(p => p.token === token && !p.left);
  if (!player) throw new GameError('Your session is no longer in this room. Join again.');
  return player;
}
export function join(game: Game, name: unknown, token: unknown, now: number): Player {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new GameError('Invalid session token.');
  if (game.revokedTokens?.includes(token)) throw new GameError('This session was removed by the host. Join again with a new session.');
  const existing = game.players.find(p => p.token === token && !p.left);
  if (existing) return existing;
  if (game.round && game.round.phase !== 'revealed') throw new GameError('A round is in progress. Join after the reveal.');
  if (game.players.filter(p => !p.left).length >= 12) throw new GameError('This room is full (12 players).');
  const cleanName = nickname(name);
  if (game.players.some(p => !p.left && p.nickname.toLocaleLowerCase('en') === cleanName.toLocaleLowerCase('en'))) {
    throw new GameError('That nickname is already in this room. Choose another.');
  }
  const player: Player = { id: crypto.randomUUID(), token, nickname: cleanName,
    order: game.nextOrder++, connected: false, left: false, disconnectedAt: now };
  game.players = game.players.filter(p => !p.left);
  game.players.push(player);
  if (!game.hostId) { game.hostId = player.id; game.hostReconnectAt = now + HOST_GRACE_MS; }
  return player;
}
function promote(game: Game, now: number, includeOffline = false) {
  // Intentional departure follows original join order, including an offline successor.
  // Grace expiry considers only connected candidates.
  const next = game.players.filter(p => !p.left && (includeOffline || p.connected)).sort((a, b) => a.order - b.order)[0];
  game.hostId = next?.id ?? null;
  game.hostReconnectAt = next && !next.connected ? now + HOST_GRACE_MS : null;
  game.hostNotice = next ? `${next.nickname} is now the host.` : 'Waiting for a player to reconnect and become host.';
  game.notice = { id: crypto.randomUUID(), text: game.hostNotice, at: now, kind: 'host' };
}
export function connect(game: Game, id: string, now = Date.now()) {
  const player = game.players.find(p => p.id === id && !p.left);
  if (!player) throw new GameError('Player not found.');
  player.connected = true;
  player.disconnectedAt = null;
  game.abandonedAt = null;
  if (!game.hostId) promote(game, now);
  if (game.hostId === id) game.hostReconnectAt = null;
}
export function disconnect(game: Game, id: string, now: number) {
  const player = game.players.find(p => p.id === id && !p.left);
  if (!player || !player.connected) return;
  player.connected = false;
  player.disconnectedAt = now;
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
  if (game.hostReconnectAt !== null && now >= game.hostReconnectAt) promote(game, now);
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
export function validateStart(game: Game, id: string, expectedRound?: number) {
  const player = game.players.find(p => p.id === id && !p.left && p.connected);
  if (!player) throw new GameError('Reconnect before taking an action.');
  if (game.hostId !== id) throw new GameError('Only the host can do that.');
  if (expectedRound !== undefined && (!Number.isInteger(expectedRound) || expectedRound !== (game.round?.number ?? 0))) {
    throw new GameError('That start request belongs to an older round. Refresh the room and try again.');
  }
  if (game.round && game.round.phase !== 'revealed') throw new GameError('Finish the current round first.');
  if (game.players.filter(p => p.connected && !p.left).length < 3) throw new GameError('At least three connected players are needed.');
}
export function act(game: Game, id: string, action: Action, now: number, choose = randomIndex, allocation?: QuestionAllocation) {
  advance(game, now);
  const player = game.players.find(p => p.id === id && !p.left && (p.connected || action.type === 'leave'));
  if (!player) throw new GameError('Reconnect before taking an action.');
  if (action.type === 'leave') {
    player.left = true;
    player.connected = false;
    if (game.hostId === id) promote(game, now, true);
    if (!game.players.some(p => p.connected && !p.left)) game.abandonedAt = now;
    return;
  }
  if (action.type === 'start' || action.type === 'reveal' || action.type === 'removeOffline') {
    if (game.hostId !== id) throw new GameError('Only the host can do that.');
  }
  if (action.type === 'removeOffline') {
    const target = game.players.find(p => p.id === action.playerId && !p.left);
    if (!target) throw new GameError('That player is no longer in the room.');
    if (target.connected) throw new GameError('That player reconnected. Connected players cannot be removed.');
    if (target.disconnectedAt == null || target.disconnectedAt !== action.disconnectedAt) {
      throw new GameError('That player’s connection changed. Check the room and try again.');
    }
    if (now < target.disconnectedAt + OFFLINE_REMOVAL_MS) throw new GameError('Wait until the player has been offline for 90 seconds.');
    game.revokedTokens ??= [];
    game.revokedTokens.push(target.token);
    target.token = '';
    target.left = true;
    game.notice = { id: crypto.randomUUID(), text: `${player.nickname} removed offline player ${target.nickname}.`, at: now, kind: 'removal' };
    return;
  }
  if (action.type === 'start') {
    validateStart(game, id, action.round);
    if (!allocation) throw new GameError('A server question allocation is required.');
    const players = game.players.filter(p => p.connected && !p.left);
    // Left players have no future permissions; their historical names live in the round snapshot.
    game.players = game.players.filter(p => !p.left);
    upgradeGame(game, now);
    game.usedQuestionIds = [...new Set([...game.usedQuestionIds!, allocation.id])];
    const questions: readonly [string, string] = choose(2) === 0
      ? [...allocation.questions] : [allocation.questions[1], allocation.questions[0]];
    game.round = { number: (game.round?.number ?? 0) + 1, phase: 'answering',
      participants: players.map(p => ({ id: p.id, nickname: p.nickname })),
      imposterId: players[choose(players.length)].id, questions, questionId: allocation.id,
      allocationKey: allocation.key, questionCycle: allocation.cycle,
      answers: {}, answerDeadline: now + ANSWER_MS, deadline: now + ROUND_MS, reveal: null };
    game.pendingStart = null;
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
  const notice = game.notice && now < game.notice.at + NOTICE_MS ? game.notice : null;
  return {
    code: game.code, you: id, hostId: game.hostId, hostReconnectAt: game.hostReconnectAt,
    hostNotice: notice?.kind === 'host' ? notice.text : null, notice, serverNow: now,
    players: game.players.map(p => ({ id: p.id, nickname: p.nickname, connected: p.connected,
      left: p.left, submitted: !!round && p.id in round.answers, disconnectedAt: p.disconnectedAt ?? null })),
    phase: round?.phase ?? 'lobby', roundNumber: round?.number ?? 0,
    answerDeadline: round?.answerDeadline ?? null, roundDeadline: round?.deadline ?? null,
    participantIds: round?.participants.map(p => p.id) ?? [],
    question: round && participating && round.phase === 'answering'
      ? round.questions[round.imposterId === id ? 1 : 0] : null,
    commonQuestion: round?.phase === 'discussion' ? round.questions[0] : null,
    yourAnswer: round?.answers[id] ?? null,
    answers: publicAnswers ? round.participants.map(p => ({ playerId: p.id, nickname: p.nickname, answer: round.answers[p.id] ?? null })) : null,
    reveal: round?.phase === 'revealed' ? round.reveal : null,
  };
}
