import { describe, expect, it } from 'vitest';
import { NOTICE_MS, OFFLINE_REMOVAL_MS, type Action } from '../shared/protocol';
import { act, advance, connect, createGame, disconnect, join, member, secret, upgradeGame, validateStart, view, type Game } from '../worker/game';
import { LEGACY_QUESTION_IDS, QUESTIONS, type QuestionPair } from '../worker/questions';
import { drawQuestion, type RotationDeck } from '../worker/rotationDeck';

const T = 1_000_000;
function lobby(count = 3) {
  const game = createGame('ABC234', T);
  const players = Array.from({ length: count }, (_, i) => join(game, `Player ${i}`, secret(), T));
  players.forEach(player => connect(game, player.id, T));
  return { game, players, host: players[0], target: players[1] };
}

const decks = new WeakMap<Game, RotationDeck>();
function start(game: Game, hostId: string, now = T, choose = (_length: number) => 0) {
  advance(game, now);
  validateStart(game, hostId);
  const selection = drawQuestion(decks.get(game) ?? null,
    `${game.roomInstanceId}:${(game.round?.number ?? 0) + 1}`, QUESTIONS, length => length - 1);
  act(game, hostId, { type: 'start' }, now, choose, selection.allocation);
  decks.set(game, selection.deck);
}

describe('offline removal', () => {
  it('allows only the current host after a full 90 seconds offline', () => {
    const { game, players, host, target } = lobby();
    disconnect(game, target.id, T);
    const remove: Action = { type: 'removeOffline', playerId: target.id, disconnectedAt: T };
    expect(() => act(game, players[2].id, remove, T + OFFLINE_REMOVAL_MS)).toThrow('Only the host');
    expect(() => act(game, host.id, remove, T + OFFLINE_REMOVAL_MS - 1)).toThrow('90 seconds');
    const token = target.token;
    act(game, host.id, remove, T + OFFLINE_REMOVAL_MS);
    expect(target.left).toBe(true); expect(target.token).toBe('');
    expect(() => member(game, token)).toThrow('removed by the host');
    expect(() => connect(game, target.id, T + OFFLINE_REMOVAL_MS)).toThrow('not found');
    expect(game.hostId).toBe(host.id);
    expect(view(game, host.id, T + OFFLINE_REMOVAL_MS).notice?.text).toContain('removed offline player Player 1');
    expect(() => act(game, host.id, remove, T + OFFLINE_REMOVAL_MS)).toThrow('no longer');
  });
  it('reconnect-first rejects removal, including an old confirmation after a second disconnect', () => {
    const { game, host, target } = lobby();
    disconnect(game, target.id, T);
    const remove: Action = { type: 'removeOffline', playerId: target.id, disconnectedAt: T };
    connect(game, target.id, T + OFFLINE_REMOVAL_MS);
    expect(target.disconnectedAt).toBeNull();
    expect(() => act(game, host.id, remove, T + OFFLINE_REMOVAL_MS)).toThrow('Connected players');
    disconnect(game, target.id, T + OFFLINE_REMOVAL_MS);
    expect(() => act(game, host.id, remove, T + 2 * OFFLINE_REMOVAL_MS)).toThrow('connection changed');
    expect(() => act(game, host.id, { ...remove, disconnectedAt: NaN }, T + 2 * OFFLINE_REMOVAL_MS)).toThrow('connection changed');
  });
  it('removal-first frees the slot and nickname, but revokes the credential even after pruning', () => {
    const { game, host, target } = lobby(12); const oldToken = target.token;
    disconnect(game, target.id, T);
    act(game, host.id, { type: 'removeOffline', playerId: target.id, disconnectedAt: T }, T + OFFLINE_REMOVAL_MS);
    const replacement = join(game, target.nickname, secret(), T + OFFLINE_REMOVAL_MS);
    expect(game.players.filter(player => !player.left)).toHaveLength(12);
    expect(replacement.order).toBeGreaterThan(target.order);
    expect(() => join(game, 'Different name', oldToken, T)).toThrow('removed by the host');
    expect(() => member(game, oldToken)).toThrow('removed by the host');
  });
  it('keeps the removed imposter, submitted answers, questions and deadlines in round history', () => {
    const { game, host, target } = lobby();
    start(game, host.id, T, length => length === 3 ? 1 : 0);
    expect(game.round!.imposterId).toBe(target.id);
    act(game, target.id, { type: 'answer', round: 1, answer: 'Historical answer' }, T);
    const roundBefore = structuredClone(game.round);
    disconnect(game, target.id, T);
    act(game, host.id, { type: 'removeOffline', playerId: target.id, disconnectedAt: T }, T + OFFLINE_REMOVAL_MS);
    expect(game.round!.phase).toBe('discussion');
    expect({ ...game.round, phase: roundBefore!.phase }).toEqual(roundBefore);
    expect(view(game, host.id, T).answers?.find(a => a.playerId === target.id)?.answer).toBe('Historical answer');
    act(game, host.id, { type: 'reveal', round: 1 }, T + OFFLINE_REMOVAL_MS);
    expect(game.round!.reveal?.imposterName).toBe(target.nickname);
    const newPlayer = join(game, target.nickname, secret(), T + OFFLINE_REMOVAL_MS);
    connect(game, newPlayer.id, T + OFFLINE_REMOVAL_MS);
    start(game, host.id, T + OFFLINE_REMOVAL_MS);
    expect(game.round!.number).toBe(2);
    expect(game.round!.participants.map(p => p.id)).not.toContain(target.id);
  });
  it('ignores duplicate close events so they cannot extend the offline grace', () => {
    const { game, target } = lobby();
    disconnect(game, target.id, T); disconnect(game, target.id, T + 40_000);
    expect(target.disconnectedAt).toBe(T);
  });
});

describe('stored-room and question bank upgrades', () => {
  it('upgrades Stage 1 indices once without changing an active round or host grace', () => {
    const { game, host, target } = lobby();
    start(game, host.id);
    act(game, target.id, { type: 'answer', round: 1, answer: 'Saved' }, T);
    disconnect(game, host.id, T);
    game.usedQuestions = [0, 3, 17, 3, -1, 100, 1.5];
    const previousInstance = game.roomInstanceId;
    delete game.usedQuestionIds; delete game.revokedTokens; delete game.notice; delete game.roomInstanceId; delete game.pendingStart;
    game.players.forEach(player => delete player.disconnectedAt);
    game.hostNotice = 'Old permanent host notice';
    delete game.round!.questionId; delete game.round!.allocationKey; delete game.round!.questionCycle;
    const before = structuredClone(game.round); const grace = game.hostReconnectAt;
    const stored = JSON.parse(JSON.stringify(game));
    upgradeGame(stored, T + 40_000);
    expect(stored.usedQuestionIds).toEqual([LEGACY_QUESTION_IDS[0], LEGACY_QUESTION_IDS[3], LEGACY_QUESTION_IDS[17]]);
    expect(stored.round).toEqual(before); expect(stored.hostReconnectAt).toBe(grace);
    expect(stored.roomInstanceId).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    expect(stored.roomInstanceId).not.toBe(previousInstance);
    expect(stored.players[0].disconnectedAt).toBe(T + 40_000);
    expect(stored.players[1].disconnectedAt).toBeNull(); expect(stored.hostNotice).toBeNull();
    const after = structuredClone(stored); upgradeGame(stored, T + 80_000);
    expect(stored).toEqual(after);
  });
  it('keeps pair IDs unique and freezes the original index mapping', () => {
    expect(QUESTIONS).toHaveLength(250);
    expect(new Set(QUESTIONS.map(pair => pair.id)).size).toBe(250);
    expect(LEGACY_QUESTION_IDS).toEqual(['film-patience', 'plants-and-mugs', 'imaginary-friends', 'pizza-party', 'camera-roll', 'camping-dinners', 'alarms-and-chances', 'lateness-and-naps', 'ducks-and-children', 'mental-tabs', 'cushions-and-bags', 'bull-and-jokes', 'karaoke-memory', 'secrets-and-laughs', 'queues-and-books', 'hair-and-jackets', 'train-snacks', 'age-and-frying-pans']);
  });
  it('supports reordering, removal and additions without repeating available used IDs', () => {
    const extra: QuestionPair = { id: 'future-pair', questions: ['Normal future?', 'Alternative future?'] };
    const bank = [QUESTIONS[2], extra, QUESTIONS[0]];
    const prior: RotationDeck = { cycle: 3, used: [QUESTIONS[0].id, QUESTIONS[1].id], remaining: [QUESTIONS[2].id], lastId: QUESTIONS[1].id };
    let selection = drawQuestion(prior, 'first', bank, length => length - 1);
    expect(selection.allocation.id).toBe(QUESTIONS[2].id);
    expect(selection.deck.cycle).toBe(3);
    selection = drawQuestion(selection.deck, 'second', [extra, QUESTIONS[0], QUESTIONS[2]], length => length - 1);
    expect(selection.allocation.id).toBe(extra.id);
    selection = drawQuestion(selection.deck, 'third', bank, length => length - 1);
    expect(selection.allocation.id).toBe(QUESTIONS[2].id); expect(selection.deck.used).toEqual([QUESTIONS[2].id]);
    expect(selection.deck.cycle).toBe(4);
    expect(() => drawQuestion(null, 'empty', [], () => 0)).toThrow('No question');
  });
  it('does not let a retired ID or legacy history length break exhaustion detection', () => {
    const all = QUESTIONS.map(pair => pair.id);
    const prior: RotationDeck = { cycle: 7, used: [...all, 'retired-id'], remaining: [], lastId: null };
    const selection = drawQuestion(prior, 'next-cycle', QUESTIONS, length => length - 1);
    expect(selection.deck.used).toEqual([QUESTIONS[0].id]); expect(selection.deck.cycle).toBe(8);
    const added: QuestionPair = { id: 'added', questions: ['N?', 'I?'] };
    expect(drawQuestion(prior, 'new-pair', [...QUESTIONS, added], length => length - 1).allocation.id).toBe(added.id);
    expect(drawQuestion(prior, 'new-pair', [...QUESTIONS, added], length => length - 1).deck.cycle).toBe(7);
  });
  it('expires host/removal notices without replaying historical strings in snapshots', () => {
    const { game, host, players } = lobby();
    act(game, host.id, { type: 'leave' }, T);
    const first = view(game, players[1].id, T);
    expect(first.notice?.text).toContain('now the host'); expect(first.hostNotice).toContain('now the host');
    const expired = view(game, players[1].id, T + NOTICE_MS);
    expect(expired.notice).toBeNull(); expect(expired.hostNotice).toBeNull();
    act(game, players[1].id, { type: 'leave' }, T + NOTICE_MS);
    expect(view(game, players[2].id, T + NOTICE_MS).notice?.id).not.toBe(first.notice?.id);
  });
});
