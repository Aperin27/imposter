import { env } from 'cloudflare:workers';
import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../worker/index';
import { ABANDON_MS, ANSWER_MS, HOST_GRACE_MS, ROUND_MS, secret, type Game } from '../worker/game';
import type { Action, RoomView, ServerMessage } from '../shared/protocol';
import { ROTATION_SINGLETON } from '../worker/questionRotation';

const bindings = env as unknown as Env;
const sockets: WebSocket[] = [];
const origin = 'https://imposter.test';
const coordinator = () => bindings.QUESTION_ROTATION.get(bindings.QUESTION_ROTATION.idFromName(ROTATION_SINGLETON));
const allocationCount = () => runInDurableObject(coordinator(), (_instance, ctx) =>
  ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM question_allocations').one().count);
const savedGame = (stub: DurableObjectStub) => runInDurableObject(stub, (_instance, ctx) => ctx.storage.get<Game>('game'));
async function request(path: string, data: unknown, headers: Record<string, string> = {}) {
  const response = await worker.fetch(new Request(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(data) }), bindings);
  // Drain DO response streams so an unread body cannot keep an eviction in flight.
  return new Response(await response.arrayBuffer(), response);
}
async function create() {
  const token = secret();
  const response = await request('/api/rooms', { nickname: 'Host', token });
  expect(response.status).toBe(201);
  const { code } = await response.json() as { code: string };
  return { code, token };
}
class Client {
  messages: ServerMessage[] = [];
  latest: RoomView | null = null;
  notify: (() => void) | null = null;
  constructor(public ws: WebSocket) {
    sockets.push(ws);
    ws.addEventListener('message', event => {
      if (event.data === 'pong') return;
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === 'state') this.latest = message.state;
      this.messages.push(message); this.notify?.();
    });
    ws.accept();
  }
  send(action: Action | unknown) { this.ws.send(JSON.stringify(action)); }
  async message(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.notify = null; reject(new Error(`Timed out: ${predicate}; messages: ${JSON.stringify(this.messages.filter(m => m.type !== 'state'))}; phase: ${this.latest?.phase}`)); }, 4000);
      const check = () => {
        const index = this.messages.findIndex(predicate);
        if (index !== -1) {
          const [value] = this.messages.splice(index, 1); clearTimeout(timer); this.notify = null; resolve(value);
        }
      };
      this.notify = check; check();
    });
  }
  async state(predicate: (state: RoomView) => boolean = () => true): Promise<RoomView> {
    if (this.latest && predicate(this.latest)) return this.latest;
    this.messages = this.messages.filter(message => message.type !== 'state');
    const message = await this.message(m => m.type === 'state' && predicate(m.state));
    if (message.type !== 'state') throw new Error('Expected state');
    return message.state;
  }
  async error(text: string) {
    return this.message(m => m.type === 'error' && m.message.includes(text));
  }
}
async function socket(code: string, token: string) {
  const response = await worker.fetch(new Request(`${origin}/api/rooms/${code}/socket`, {
    headers: { Upgrade: 'websocket', Origin: origin, 'Sec-WebSocket-Protocol': `imposter, ${token}` },
  }), bindings);
  expect(response.status).toBe(101);
  return new Client(response.webSocket!);
}
async function group() {
  const { code, token } = await create();
  const host = await socket(code, token);
  const tokens = [token, secret(), secret()];
  await request(`/api/rooms/${code}/join`, { nickname: 'Second', token: tokens[1] });
  const second = await socket(code, tokens[1]);
  await request(`/api/rooms/${code}/join`, { nickname: 'Third', token: tokens[2] });
  const third = await socket(code, tokens[2]);
  const ready = await host.state(s => s.players.filter(p => p.connected).length === 3);
  return { code, tokens, host, second, third, ready, stub: bindings.ROOMS.get(bindings.ROOMS.idFromName(code)) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* already closed */ } }
  await reset();
});

describe('Worker and SQLite Durable Object integration', () => {
  it('shares one deck across concurrent room starts and rejects invalid/stale starts before allocation', async () => {
    const groups = await Promise.all([group(), group(), group()]);
    groups[0].second.send({ type: 'start', round: 0 }); await groups[0].second.error('Only the host');
    expect(await allocationCount()).toBe(0);
    for (const current of groups) current.host.send({ type: 'start', round: 0 });
    await Promise.all(groups.map(current => current.host.state(s => s.phase === 'answering')));
    const saved = await Promise.all(groups.map(current => savedGame(current.stub)));
    expect(new Set(saved.map(game => game!.round!.questionId)).size).toBe(3);
    expect(new Set(saved.map(game => game!.round!.questionCycle))).toEqual(new Set([1]));
    expect(await allocationCount()).toBe(3);
    const first = groups[0];
    first.host.send({ type: 'start', round: 0 }); await first.host.error('older round');
    first.host.send({ type: 'reveal', round: 1 }); await first.host.state(s => s.phase === 'revealed');
    first.host.send({ type: 'start', round: 0 }); await first.host.error('older round');
    expect(await allocationCount()).toBe(3);
  });
  it('does not allocate for too few connected members or while a round is running', async () => {
    const current = await group();
    current.third.ws.close();
    await current.host.state(s => s.players.filter(p => p.connected).length === 2);
    current.host.send({ type: 'start', round: 0 }); await current.host.error('At least three');
    expect(await allocationCount()).toBe(0);
    const third = await socket(current.code, current.tokens[2]); await third.state();
    current.host.send({ type: 'start', round: 0 }); await current.host.state(s => s.phase === 'answering');
    current.host.send({ type: 'start', round: 1 }); await current.host.error('Finish');
    expect(await allocationCount()).toBe(1);
  });
  it.each(['before-allocation', 'lost-reply', 'room-save'] as const)('recovers %s failure with one durable start key across room eviction', async failure => {
    const current = await group();
    if (failure === 'room-save') {
      await runInDurableObject(current.stub, instance => {
        const target = instance as unknown as { persist: (candidate?: Game | null) => Promise<void> };
        const original = target.persist.bind(target);
        let once = true;
        vi.spyOn(target, 'persist').mockImplementation(async candidate => {
          if (once && candidate?.round?.phase === 'answering') { once = false; throw new Error('Simulated room commit failure'); }
          await original(candidate);
        });
      });
    } else {
      await runInDurableObject(coordinator(), instance => {
        const original = instance.allocate.bind(instance);
        vi.spyOn(Object.getPrototypeOf(instance) as typeof instance, 'allocate').mockImplementationOnce(key => {
          if (failure === 'lost-reply') original(key);
          throw new Error('Simulated coordinator reply failure');
        });
      });
    }
    current.host.send({ type: 'start', round: 0 });
    await current.host.error(failure === 'room-save' ? 'could not be saved' : 'temporarily unavailable');
    const pending = (await savedGame(current.stub))!;
    expect(pending.round).toBeNull(); expect(pending.pendingStart?.roundNumber).toBe(1);
    const key = pending.pendingStart!.key;
    expect(await allocationCount()).toBe(failure === 'before-allocation' ? 0 : 1);
    await evictDurableObject(current.stub);
    current.host.send({ type: 'start', round: 0 });
    await current.host.state(s => s.phase === 'answering');
    const recovered = (await savedGame(current.stub))!;
    expect(recovered.round!.allocationKey).toBe(key); expect(recovered.pendingStart).toBeNull();
    const ledger = await coordinator().allocate(key);
    expect(recovered.round!.questionId).toBe(ledger.id);
    expect(new Set(recovered.round!.questions)).toEqual(new Set(ledger.questions));
    expect(await allocationCount()).toBe(1);
  });
  it('keeps rotation progress through room expiry and reuse of the same room code', async () => {
    const current = await group(); current.host.send({ type: 'start', round: 0 });
    await current.host.state(s => s.phase === 'answering');
    const original = (await savedGame(current.stub))!;
    const time = vi.spyOn(Date, 'now').mockReturnValue(original.expiresAt);
    await runDurableObjectAlarm(current.stub);
    expect(await savedGame(current.stub)).toBeUndefined(); expect(await allocationCount()).toBe(1);
    time.mockRestore();
    const token = secret();
    const recreated = await current.stub.fetch('https://room/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: current.code, nickname: 'New Host', token }) });
    expect(recreated.status).toBe(201); await recreated.arrayBuffer();
    const host = await socket(current.code, token);
    for (const nickname of ['New second', 'New third']) {
      const next = secret(); await request(`/api/rooms/${current.code}/join`, { token: next, nickname }); await socket(current.code, next);
    }
    await host.state(s => s.players.filter(p => p.connected).length === 3);
    host.send({ type: 'start', round: 0 }); await host.state(s => s.phase === 'answering');
    const saved = (await savedGame(current.stub))!;
    expect(saved.roomInstanceId).not.toBe(original.roomInstanceId);
    expect(saved.round!.allocationKey).not.toBe(original.round!.allocationKey);
    expect(saved.round!.questionId).not.toBe(original.round!.questionId);
    expect(saved.round!.questionCycle).toBe(1); expect(await allocationCount()).toBe(2);
  });
  it('does not start a room that expires while waiting for its reserved allocation', async () => {
    const current = await group(); const expiry = (await savedGame(current.stub))!.expiresAt;
    await runInDurableObject(coordinator(), instance => {
      const original = instance.allocate.bind(instance);
      vi.spyOn(Object.getPrototypeOf(instance) as typeof instance, 'allocate').mockImplementationOnce(key => {
        const allocation = original(key); vi.spyOn(Date, 'now').mockReturnValue(expiry); return allocation;
      });
    });
    current.host.send({ type: 'start', round: 0 });
    await current.host.message(message => message.type === 'expired');
    expect(await savedGame(current.stub)).toBeUndefined(); expect(await allocationCount()).toBe(1);
  });
  it('runs a complete private round over real sockets and starts another', async () => {
    const { code, host, second, third, tokens, stub } = await group();
    second.send({ type: 'start' }); await second.error('Only the host');
    host.send({ type: 'start' });
    const clients = [host, second, third];
    const privateStates = await Promise.all(clients.map(c => c.state(s => s.phase === 'answering')));
    expect(new Set(privateStates.map(s => s.question)).size).toBe(2);
    expect(privateStates.every(s => s.reveal === null && s.answers === null && s.commonQuestion === null)).toBe(true);
    for (const [index, client] of clients.entries()) {
      client.send({ type: 'answer', answer: `Answer ${index}`, round: 1 });
      await client.state(s => s.yourAnswer === `Answer ${index}`);
    }
    const discussion = await Promise.all(clients.map(c => c.state(s => s.phase === 'discussion')));
    expect(discussion.every(s => s.answers?.length === 3 && s.reveal === null)).toBe(true);
    const saved = (await savedGame(stub))!;
    const [common, alternate] = saved.round!.questions;
    for (const snapshot of discussion) {
      expect(snapshot.commonQuestion).toBe(common);
      expect(snapshot.question).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain(alternate);
      expect(JSON.stringify(snapshot)).not.toContain('imposterId');
    }
    await evictDurableObject(stub);
    const imposterIndex = discussion.findIndex(s => s.you === saved.round!.imposterId);
    const resumed = await socket(code, tokens[imposterIndex]);
    const recovered = await resumed.state(s => s.phase === 'discussion');
    expect(recovered.commonQuestion).toBe(common); expect(recovered.reveal).toBeNull();
    clients[imposterIndex] = resumed;
    const activeHost = clients[0], activeSecond = clients[1];
    activeSecond.send({ type: 'reveal', round: 1 }); await activeSecond.error('Only the host');
    activeHost.send({ type: 'reveal', round: 1 });
    const revealed = await Promise.all(clients.map(c => c.state(s => s.phase === 'revealed')));
    expect(revealed[0].reveal?.reason).toBe('host');
    expect(revealed.every(s => s.reveal?.normalQuestion === common && s.reveal?.imposterQuestion === alternate)).toBe(true);
    expect(revealed.every(s => s.reveal?.imposterId === revealed[0].reveal?.imposterId)).toBe(true);
    activeHost.send({ type: 'reveal', round: 1 }); await activeHost.error('already');
    activeHost.send({ type: 'start' });
    expect((await activeHost.state(s => s.roundNumber === 2)).phase).toBe('answering');
    expect((await request(`/api/rooms/${code}/join`, { nickname: 'Late', token: secret() })).status).toBe(400);
  });
  it('preserves answers, deadlines and socket membership across hibernation and replacement', async () => {
    const { code, tokens, host, second, third, stub } = await group();
    host.send({ type: 'start' }); const first = await host.state(s => s.phase === 'answering');
    second.send({ type: 'answer', answer: 'Saved privately', round: 1 });
    const answered = await second.state(s => s.yourAnswer === 'Saved privately');
    const saved = await runInDurableObject(stub, async (_instance, ctx) => ctx.storage.get<Game>('game'));
    expect(saved?.round?.answers[answered.you]).toBe('Saved privately');
    expect(await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm())).toBe(first.answerDeadline);
    await evictDurableObject(stub);
    const resumed = await socket(code, tokens[1]);
    const snapshot = await resumed.state(s => s.phase === 'answering');
    expect(snapshot.you).toBe(answered.you); expect(snapshot.yourAnswer).toBe('Saved privately');
    expect(snapshot.players).toHaveLength(3); expect(snapshot.players.every(p => p.connected)).toBe(true);
    expect(snapshot.answerDeadline).toBe(first.answerDeadline); expect(snapshot.roundDeadline).toBe(first.roundDeadline);
    resumed.send({ type: 'answer', answer: 'Changed', round: 1 }); await resumed.error('already');
    host.send({ type: 'reveal', round: 1 });
    await third.state(s => s.phase === 'revealed');
    const result = await resumed.state(s => s.phase === 'revealed');
    expect(result.answers?.find(a => a.playerId === answered.you)?.answer).toBe('Saved privately');
  });
  it('recovers the same assigned questions and answer after a restart that drops every socket', async () => {
    const current = await group();
    current.host.send({ type: 'start', round: 0 });
    await current.host.state(state => state.phase === 'answering');
    current.second.send({ type: 'answer', round: 1, answer: 'Survives socket loss' });
    await current.second.state(state => state.yourAnswer === 'Survives socket loss');
    const before = (await savedGame(current.stub))!;
    await evictDurableObject(current.stub, { webSockets: 'close' });
    await evictDurableObject(coordinator());
    const host = await socket(current.code, current.tokens[0]);
    const second = await socket(current.code, current.tokens[1]);
    const recovered = await second.state(state => state.phase === 'answering');
    expect(recovered.yourAnswer).toBe('Survives socket loss');
    const after = (await savedGame(current.stub))!;
    expect(after.roomInstanceId).toBe(before.roomInstanceId);
    expect(after.round).toEqual(before.round);
    expect(after.hostId).toBe(before.hostId);
    expect(await allocationCount()).toBe(1);
    expect((await coordinator().allocate(before.round!.allocationKey!)).id).toBe(before.round!.questionId);
    host.send({ type: 'start', round: 0 }); await host.error('older round');
    expect(await allocationCount()).toBe(1);
  });
  it('alarms advance answer and round deadlines without any client action', async () => {
    const { code, tokens, host, second, third, stub } = await group();
    host.send({ type: 'start' }); const initial = await host.state(s => s.phase === 'answering');
    const time = vi.spyOn(Date, 'now').mockReturnValue(initial.answerDeadline!);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const discussion = await second.state(s => s.phase === 'discussion');
    expect(discussion.answers?.every(a => a.answer === null)).toBe(true);
    const savedRound = (await savedGame(stub))!.round!;
    const snapshots = await Promise.all([host, second, third].map(c => c.state(s => s.phase === 'discussion')));
    for (const snapshot of snapshots) {
      expect(snapshot.commonQuestion).toBe(savedRound.questions[0]);
      expect(snapshot.reveal).toBeNull(); expect(snapshot.question).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain(savedRound.questions[1]);
      expect(JSON.stringify(snapshot)).not.toContain('imposterId');
    }
    expect(await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm())).toBe(initial.roundDeadline);
    await evictDurableObject(stub, { webSockets: 'close' });
    const resumed = await socket(code, tokens[1]);
    expect((await resumed.state(s => s.phase === 'discussion')).commonQuestion).toBe(discussion.commonQuestion);
    time.mockReturnValue(initial.roundDeadline!);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const final = await resumed.state(s => s.phase === 'revealed');
    expect(final.reveal?.reason).toBe('timeout');
    expect(final.reveal?.normalQuestion).toBe(discussion.commonQuestion);
    const saved = await runInDurableObject(stub, (_instance, ctx) => ctx.storage.get<Game>('game'));
    expect(saved?.round?.phase).toBe('revealed');
  });
  it('host HTTP leave promotes immediately and invalidates the old session', async () => {
    const { code, tokens, second, third, ready } = await group();
    expect((await request(`/api/rooms/${code}/leave`, { token: tokens[0] })).status).toBe(200);
    const next = await second.state(s => s.hostId !== ready.hostId);
    expect(next.hostId).toBe(next.you); expect(next.hostNotice).toBe('Second is now the host.');
    expect((await request(`/api/rooms/${code}/resume`, { token: tokens[0] })).status).toBe(400);
    await request(`/api/rooms/${code}/leave`, { token: tokens[1] });
    expect((await third.state(s => s.hostNotice === 'Third is now the host.')).hostId).toBe(ready.players[2].id);
  });
  it('holds an unexpectedly disconnected host for 90 seconds, then transfers once', async () => {
    const { code, tokens, host, second, stub, ready } = await group();
    host.ws.close(1000, 'simulated transport loss');
    const held = await second.state(s => s.hostReconnectAt !== null);
    expect(held.hostId).toBe(ready.hostId);
    expect(held.hostReconnectAt! - held.serverNow).toBeGreaterThan(HOST_GRACE_MS - 1000);
    vi.spyOn(Date, 'now').mockReturnValue(held.hostReconnectAt!);
    await runDurableObjectAlarm(stub);
    const promoted = await second.state(s => s.hostId === s.you);
    const returned = await socket(code, tokens[0]);
    expect((await returned.state()).hostId).toBe(promoted.you);
    returned.send({ type: 'start' }); await returned.error('Only the host');
  });
  it('deletes abandoned room state and rejects old tokens after expiration', async () => {
    const { code, token } = await create();
    const stub = bindings.ROOMS.get(bindings.ROOMS.idFromName(code));
    const saved = await runInDurableObject(stub, (_instance, ctx) => ctx.storage.get<Game>('game'));
    vi.spyOn(Date, 'now').mockReturnValue(saved!.createdAt + ABANDON_MS);
    await runDurableObjectAlarm(stub);
    expect(await runInDurableObject(stub, (_instance, ctx) => ctx.storage.get('game'))).toBeUndefined();
    expect((await request(`/api/rooms/${code}/resume`, { token })).status).toBe(404);
  });
  it('rejects cross-origin, unauthenticated, malformed and oversized requests', async () => {
    const { code } = await create();
    expect((await request('/api/rooms', {}, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await request(`/api/rooms/${code}/join`, { nickname: 'x'.repeat(3000), token: secret() })).status).toBe(400);
    const result = await worker.fetch(new Request(`${origin}/api/rooms/${code}/socket`, { headers: { Upgrade: 'websocket', Origin: origin, 'Sec-WebSocket-Protocol': `imposter, ${secret()}` } }), bindings);
    expect(result.status).toBe(400);
    expect((await request('/api/rooms/XXXXXX/join', { nickname: 'Unknown', token: secret() })).status).toBe(404);
  });
  it('removes offline members publicly without losing saved answers or deadlines across hibernation', async () => {
    const { code, tokens, host, second, third, stub } = await group();
    host.send({ type: 'start' }); const started = await host.state(s => s.phase === 'answering');
    second.send({ type: 'answer', round: 1, answer: 'Retain this answer' });
    const answered = await second.state(s => s.yourAnswer === 'Retain this answer');
    second.ws.close();
    const offline = await host.state(s => s.players.some(p => p.id === answered.you && !p.connected));
    const disconnectedAt = offline.players.find(p => p.id === answered.you)!.disconnectedAt!;
    third.send({ type: 'removeOffline', playerId: answered.you, disconnectedAt }); await third.error('Only the host');
    host.send({ type: 'removeOffline', playerId: answered.you, disconnectedAt }); await host.error('90 seconds');
    vi.spyOn(Date, 'now').mockReturnValue(disconnectedAt + 90_000);
    host.send({ type: 'removeOffline', playerId: answered.you, disconnectedAt });
    const removed = await third.state(s => !!s.notice?.text.includes('removed offline player Second'));
    expect(removed.players.find(p => p.id === answered.you)?.left).toBe(true);
    expect(removed.roundDeadline).toBe(started.roundDeadline);
    expect(removed.answers?.find(a => a.playerId === answered.you)?.answer).toBe('Retain this answer');
    await evictDurableObject(stub);
    expect((await request(`/api/rooms/${code}/resume`, { token: tokens[1] })).status).toBe(400);
    expect((await request(`/api/rooms/${code}/join`, { token: tokens[1], nickname: 'Changed' })).status).toBe(400);
    host.send({ type: 'reveal', round: 1 }); const final = await third.state(s => s.phase === 'revealed');
    expect(final.answers?.find(a => a.playerId === answered.you)?.answer).toBe('Retain this answer');
    expect((await request(`/api/rooms/${code}/join`, { token: secret(), nickname: 'Second' })).status).toBe(200);
  });
  it('reconnect-first defeats an old removal confirmation under the real room lock', async () => {
    const { code, tokens, host, second } = await group(); const secondState = await second.state();
    second.ws.close();
    const offline = await host.state(s => s.players.some(p => p.id === secondState.you && !p.connected));
    const disconnectedAt = offline.players.find(p => p.id === secondState.you)!.disconnectedAt!;
    vi.spyOn(Date, 'now').mockReturnValue(disconnectedAt + 90_000);
    const returned = await socket(code, tokens[1]); await returned.state();
    host.send({ type: 'removeOffline', playerId: secondState.you, disconnectedAt }); await host.error('Connected players');
    expect((await request(`/api/rooms/${code}/resume`, { token: tokens[1] })).status).toBe(200);
  });
  it('migrates a stored Stage 1 room on wake without replacing round history or deadlines', async () => {
    const { code, tokens, host, second, third, stub } = await group();
    host.send({ type: 'start' }); const started = await host.state(s => s.phase === 'answering');
    third.send({ type: 'answer', round: 1, answer: 'Legacy answer' }); await third.state(s => s.yourAnswer === 'Legacy answer');
    second.ws.close(); await host.state(s => s.players.some(p => p.nickname === 'Second' && !p.connected));
    const original = await runInDurableObject(stub, async (_instance, ctx) => {
      const old = (await ctx.storage.get<Game>('game'))!;
      delete old.usedQuestionIds; delete old.revokedTokens; delete old.notice; delete old.round!.questionId;
      old.players.forEach(p => delete p.disconnectedAt);
      old.usedQuestions = [0, 3, 17]; old.hostNotice = 'Outdated notice';
      await ctx.storage.put('game', old); return old;
    });
    await evictDurableObject(stub);
    const upgradedAt = started.serverNow + 10_000; vi.spyOn(Date, 'now').mockReturnValue(upgradedAt);
    expect((await request(`/api/rooms/${code}/resume`, { token: tokens[0] })).status).toBe(200);
    const saved = (await runInDurableObject(stub, (_instance, ctx) => ctx.storage.get<Game>('game')))!;
    expect(saved.round).toEqual(original.round); expect(saved.hostId).toBe(original.hostId);
    expect(saved.hostReconnectAt).toBe(original.hostReconnectAt);
    expect(saved.usedQuestionIds).toEqual(['film-patience', 'pizza-party', 'age-and-frying-pans']);
    expect(saved.players.find(p => p.nickname === 'Second')?.disconnectedAt).toBe(upgradedAt);
    expect(saved.players.find(p => p.nickname === 'Host')?.connected).toBe(true);
    expect(saved.hostNotice).toBeNull();
    expect(await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm())).toBe(started.answerDeadline);
    host.send({ type: 'answer', round: 1, answer: 'Still playing' });
    const state = await third.state(s => s.players.some(p => p.id === s.hostId && p.submitted));
    expect(state.answers).toBeNull(); expect(state.reveal).toBeNull(); expect(state.yourAnswer).toBe('Legacy answer');
  });
});
