import { describe, expect, it } from 'vitest';
import { NOTICE_MS, OFFLINE_REMOVAL_MS, type Action } from '../shared/protocol';
import { act, chooseQuestion, connect, createGame, disconnect, join, member, secret, upgradeGame, view } from '../worker/game';
import { LEGACY_QUESTION_IDS, QUESTIONS, type QuestionPair } from '../worker/questions';

const T = 1_000_000;
function lobby(count = 3) {
  const game = createGame('ABC234', T);
  const players = Array.from({ length: count }, (_, i) => join(game, `Player ${i}`, secret(), T));
  players.forEach(player => connect(game, player.id, T));
  return { game, players, host: players[0], target: players[1] };
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
    act(game, host.id, { type: 'start' }, T, length => length === 3 ? 1 : 0);
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
    act(game, host.id, { type: 'start' }, T + OFFLINE_REMOVAL_MS);
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
    act(game, host.id, { type: 'start' }, T, () => 0);
    act(game, target.id, { type: 'answer', round: 1, answer: 'Saved' }, T);
    disconnect(game, host.id, T);
    game.usedQuestions = [0, 3, 17, 3, -1, 100, 1.5];
    delete game.usedQuestionIds; delete game.revokedTokens; delete game.notice;
    game.players.forEach(player => delete player.disconnectedAt);
    game.hostNotice = 'Old permanent host notice';
    delete game.round!.questionId;
    const before = structuredClone(game.round); const grace = game.hostReconnectAt;
    const stored = JSON.parse(JSON.stringify(game));
    upgradeGame(stored, T + 40_000);
    expect(stored.usedQuestionIds).toEqual([LEGACY_QUESTION_IDS[0], LEGACY_QUESTION_IDS[3], LEGACY_QUESTION_IDS[17]]);
    expect(stored.round).toEqual(before); expect(stored.hostReconnectAt).toBe(grace);
    expect(stored.players[0].disconnectedAt).toBe(T + 40_000);
    expect(stored.players[1].disconnectedAt).toBeNull(); expect(stored.hostNotice).toBeNull();
    const after = structuredClone(stored); upgradeGame(stored, T + 80_000);
    expect(stored).toEqual(after);
  });
  it('keeps pair IDs unique and freezes the original index mapping', () => {
    expect(QUESTIONS).toHaveLength(18);
    expect(new Set(QUESTIONS.map(pair => pair.id)).size).toBe(18);
    expect(LEGACY_QUESTION_IDS).toEqual(['film-patience', 'plants-and-mugs', 'imaginary-friends', 'pizza-party', 'camera-roll', 'camping-dinners', 'alarms-and-chances', 'lateness-and-naps', 'ducks-and-children', 'mental-tabs', 'cushions-and-bags', 'bull-and-jokes', 'karaoke-memory', 'secrets-and-laughs', 'queues-and-books', 'hair-and-jackets', 'train-snacks', 'age-and-frying-pans']);
  });
  it('supports reordering, removal and additions without repeating available used IDs', () => {
    const extra: QuestionPair = { id: 'future-pair', questions: ['Normal future?', 'Alternative future?'] };
    const bank = [QUESTIONS[2], extra, QUESTIONS[0]];
    let selection = chooseQuestion([QUESTIONS[0].id, QUESTIONS[1].id], () => 0, bank);
    expect(selection.pair.id).toBe(QUESTIONS[2].id);
    selection = chooseQuestion(selection.history, () => 0, [extra, QUESTIONS[0], QUESTIONS[2]]);
    expect(selection.pair.id).toBe(extra.id);
    selection = chooseQuestion(selection.history, () => 0, bank);
    expect(selection.pair.id).toBe(QUESTIONS[2].id); expect(selection.history).toEqual([QUESTIONS[2].id]);
    expect(() => chooseQuestion([], () => 0, [])).toThrow('No question');
  });
  it('does not let a retired ID or legacy history length break exhaustion detection', () => {
    const all = QUESTIONS.map(pair => pair.id);
    const selection = chooseQuestion([...all, 'retired-id'], () => 0);
    expect(selection.history).toEqual([QUESTIONS[0].id]);
    const added: QuestionPair = { id: 'added', questions: ['N?', 'I?'] };
    expect(chooseQuestion(all, () => 0, [...QUESTIONS, added]).pair).toBe(added);
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
