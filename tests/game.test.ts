import { describe, expect, it } from 'vitest';
import { act, advance, ANSWER_MS, ABANDON_MS, connect, createGame, disconnect, HOST_GRACE_MS, join, member, nextDeadline, ROUND_MS, ROOM_LIFETIME_MS, secret, view, type Game } from '../worker/game';
import { QUESTIONS } from '../worker/questions';

const T = 1_000_000;
function lobby(count = 3) {
  const game = createGame('ABC234', T);
  const players = Array.from({ length: count }, (_, i) => join(game, `Player ${i + 1}`, secret(), T));
  players.forEach(p => connect(game, p.id));
  return { game, players, host: players[0] };
}
function start(game: Game, hostId: string, now = T) { act(game, hostId, { type: 'start' }, now, () => 0); }
function end(game: Game, hostId: string, now = T) { act(game, hostId, { type: 'reveal', round: game.round!.number }, now); }

describe('rooms and membership', () => {
  it('resumes one member without changing join order or answer', () => {
    const { game, host } = lobby(); start(game, host.id);
    act(game, host.id, { type: 'answer', answer: '42', round: 1 }, T);
    disconnect(game, host.id, T + 1); connect(game, host.id);
    expect(join(game, host.nickname, host.token, T + 2)).toBe(host);
    expect(game.players).toHaveLength(3);
    expect(view(game, host.id, T).yourAnswer).toBe('42');
    expect(member(game, host.token).order).toBe(0);
  });
  it('rejects duplicate nicknames, invalid names, tokens and unknown members', () => {
    const { game } = lobby();
    expect(() => join(game, '  PLAYER 1 ', secret(), T)).toThrow('nickname is already');
    expect(() => join(game, 'a'.repeat(25), secret(), T)).toThrow('1–24');
    expect(() => join(game, '\u202efake', secret(), T)).toThrow('control');
    expect(() => join(game, 'New player', 'weak', T)).toThrow('token');
    expect(() => member(game, secret())).toThrow('session');
  });
  it('caps rooms at 12 and allows joins only between rounds', () => {
    const { game, host } = lobby(12);
    expect(() => join(game, 'Extra', secret(), T)).toThrow('full');
    start(game, host.id);
    expect(() => join(game, 'Extra', secret(), T)).toThrow('in progress');
    end(game, host.id); act(game, game.players[11].id, { type: 'leave' }, T);
    expect(join(game, 'Extra', secret(), T).nickname).toBe('Extra');
  });
  it('expires abandoned rooms and imposes a 24-hour maximum lifetime', () => {
    const { game, players } = lobby();
    players.forEach(p => disconnect(game, p.id, T));
    expect(advance(game, T + ABANDON_MS - 1)).toBe(false);
    expect(advance(game, T + ABANDON_MS)).toBe(true);
    const active = lobby().game;
    expect(advance(active, T + ROOM_LIFETIME_MS)).toBe(true);
  });
});

describe('round permissions, privacy and timing', () => {
  it('requires the host and at least three connected players', () => {
    const { game, host, players } = lobby(2);
    expect(() => start(game, players[1].id)).toThrow('Only the host');
    expect(() => start(game, host.id)).toThrow('At least three');
    const third = join(game, 'Third', secret(), T); connect(game, third.id);
    start(game, host.id);
    expect(() => start(game, host.id)).toThrow('Finish');
    expect(() => end(game, third.id)).toThrow('Only the host');
  });
  it('delivers one private question, no identity or pair, and no other answers', () => {
    const { game, host, players } = lobby(4); start(game, host.id);
    act(game, players[1].id, { type: 'answer', answer: 'TOP SECRET ANSWER', round: 1 }, T);
    const views = players.map(p => view(game, p.id, T));
    expect(views[0].question).toBe(QUESTIONS[0][1]);
    expect(views.slice(1).map(v => v.question)).toEqual(Array(3).fill(QUESTIONS[0][0]));
    for (const [i, snapshot] of views.entries()) {
      expect(snapshot.reveal).toBeNull(); expect(snapshot.answers).toBeNull();
      const wire = JSON.stringify(snapshot);
      expect(wire).not.toContain('imposterId'); expect(wire).not.toContain('token'); expect(wire).not.toContain('questions');
      expect(wire).not.toContain(QUESTIONS[0][i === 0 ? 0 : 1]);
      if (i !== 1) expect(wire).not.toContain('TOP SECRET ANSWER');
    }
  });
  it('rejects duplicate/invalid answers and stale round actions', () => {
    const { game, host } = lobby(); start(game, host.id);
    expect(() => act(game, host.id, { type: 'answer', answer: ' ', round: 1 }, T)).toThrow('1–160');
    act(game, host.id, { type: 'answer', answer: '  7  ', round: 1 }, T);
    expect(() => act(game, host.id, { type: 'answer', answer: '8', round: 1 }, T)).toThrow('already');
    expect(() => act(game, host.id, { type: 'answer', answer: '8', round: 0 }, T)).toThrow('older');
    end(game, host.id); start(game, host.id);
    expect(() => act(game, host.id, { type: 'reveal', round: 1 }, T)).toThrow('older');
  });
  it('reveals every answer together once everyone submits, preserving the round deadline', () => {
    const { game, host, players } = lobby(); start(game, host.id);
    players.forEach((p, i) => act(game, p.id, { type: 'answer', answer: String(i), round: 1 }, T + i));
    const snapshots = players.map(p => view(game, p.id, T + 3));
    expect(snapshots.every(v => v.phase === 'discussion' && v.reveal === null && v.question === null)).toBe(true);
    expect(snapshots[0].answers?.map(a => a.answer)).toEqual(['0', '1', '2']);
    expect(game.round!.deadline).toBe(T + ROUND_MS);
  });
  it('a disconnected player cannot block the 90-second answer deadline', () => {
    const { game, host, players } = lobby(); start(game, host.id);
    disconnect(game, players[2].id, T + 1);
    act(game, host.id, { type: 'answer', answer: '10', round: 1 }, T + 1);
    expect(nextDeadline(game)).toBe(T + ANSWER_MS);
    advance(game, T + ANSWER_MS - 1); expect(game.round!.phase).toBe('answering');
    advance(game, T + ANSWER_MS); expect(game.round!.phase).toBe('discussion');
    expect(view(game, host.id, T).answers?.map(a => a.answer)).toEqual(['10', null, null]);
    expect(() => act(game, players[1].id, { type: 'answer', answer: 'late', round: 1 }, T + ANSWER_MS)).toThrow('ended');
  });
  it.each(['answering', 'discussion'] as const)('host reveal is public and final during %s', phase => {
    const { game, host, players } = lobby(); start(game, host.id);
    if (phase === 'discussion') advance(game, T + ANSWER_MS);
    end(game, host.id, phase === 'discussion' ? T + ANSWER_MS : T);
    const snapshots = players.map(p => view(game, p.id, T));
    expect(snapshots.every(v => v.phase === 'revealed' && v.reveal?.imposterId === host.id)).toBe(true);
    expect(snapshots[0].reveal).toMatchObject({ normalQuestion: QUESTIONS[0][0], imposterQuestion: QUESTIONS[0][1], reason: 'host', revealedBy: host.nickname });
    expect(() => end(game, host.id)).toThrow('already');
    expect(() => act(game, host.id, { type: 'answer', answer: 'late', round: 1 }, T)).toThrow('ended');
  });
  it('automatically reveals at exactly 20 minutes and repeated alarms are harmless', () => {
    const { game, host } = lobby(); start(game, host.id);
    advance(game, T + ROUND_MS - 1); expect(game.round!.phase).toBe('discussion');
    advance(game, T + ROUND_MS); expect(game.round!.reveal?.reason).toBe('timeout');
    const reveal = game.round!.reveal;
    advance(game, T + ROUND_MS + 1); expect(game.round!.reveal).toEqual(reveal);
  });
  it('cycles through the backend library without repeating a question pair', () => {
    const { game, host } = lobby(); const seen = new Set<string>();
    for (let i = 0; i < QUESTIONS.length; i++) {
      start(game, host.id); seen.add(game.round!.questions[0]); end(game, host.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(15); expect(seen.size).toBe(QUESTIONS.length);
    start(game, host.id); expect(game.usedQuestions).toHaveLength(1);
  });
  it('keeps departed participants in the round snapshot but revokes their permissions', () => {
    const { game, host, players } = lobby(); start(game, host.id);
    act(game, players[1].id, { type: 'leave' }, T);
    expect(() => member(game, players[1].token)).toThrow('session');
    advance(game, T + ANSWER_MS);
    expect(view(game, host.id, T).answers?.find(p => p.playerId === players[1].id)?.nickname).toBe('Player 2');
  });
});

describe('host succession', () => {
  it('transfers intentional departure immediately in original join order, even to an offline successor', () => {
    const { game, host, players } = lobby(4);
    disconnect(game, players[1].id, T);
    act(game, host.id, { type: 'leave' }, T);
    expect(game.hostId).toBe(players[1].id); expect(game.hostReconnectAt).toBe(T + HOST_GRACE_MS);
    advance(game, T + HOST_GRACE_MS);
    expect(game.hostId).toBe(players[2].id); expect(game.hostNotice).toContain('Player 3');
    act(game, players[2].id, { type: 'leave' }, T + HOST_GRACE_MS);
    expect(game.hostId).toBe(players[1].id);
    advance(game, T + 2 * HOST_GRACE_MS);
    expect(game.hostId).toBe(players[3].id);
  });
  it('holds privileges for a reconnect within 90 seconds', () => {
    const { game, host } = lobby(); disconnect(game, host.id, T);
    advance(game, T + HOST_GRACE_MS - 1); expect(game.hostId).toBe(host.id);
    connect(game, host.id); expect(game.hostReconnectAt).toBeNull();
    advance(game, T + HOST_GRACE_MS + 1); expect(game.hostId).toBe(host.id);
  });
  it('promotes after grace and never automatically restores the original host', () => {
    const { game, host, players } = lobby(); disconnect(game, host.id, T);
    advance(game, T + HOST_GRACE_MS); expect(game.hostId).toBe(players[1].id);
    connect(game, host.id); expect(game.hostId).toBe(players[1].id);
    expect(() => start(game, host.id)).toThrow('Only the host');
    disconnect(game, players[1].id, T + HOST_GRACE_MS);
    advance(game, T + 2 * HOST_GRACE_MS); expect(game.hostId).toBe(host.id);
  });
  it('has no host until someone returns after all disconnect and grace expires', () => {
    const { game, players } = lobby(); players.forEach(p => disconnect(game, p.id, T));
    advance(game, T + HOST_GRACE_MS); expect(game.hostId).toBeNull();
    connect(game, players[2].id); expect(game.hostId).toBe(players[2].id);
    connect(game, players[0].id); expect(game.hostId).toBe(players[2].id);
  });
});
