import { env } from 'cloudflare:workers';
import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../worker/index';
import { ABANDON_MS, ANSWER_MS, HOST_GRACE_MS, ROUND_MS, secret, type Game } from '../worker/game';
import type { Action, RoomView, ServerMessage } from '../shared/protocol';

const bindings = env as unknown as Env;
const sockets: WebSocket[] = [];
const origin = 'https://imposter.test';
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
      const timer = setTimeout(() => { this.notify = null; reject(new Error('Timed out waiting for server message')); }, 4000);
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
  it('runs a complete private round over real sockets and starts another', async () => {
    const { code, host, second, third } = await group();
    second.send({ type: 'start' }); await second.error('Only the host');
    host.send({ type: 'start' });
    const clients = [host, second, third];
    const privateStates = await Promise.all(clients.map(c => c.state(s => s.phase === 'answering')));
    expect(new Set(privateStates.map(s => s.question)).size).toBe(2);
    expect(privateStates.every(s => s.reveal === null && s.answers === null)).toBe(true);
    for (const [index, client] of clients.entries()) {
      client.send({ type: 'answer', answer: `Answer ${index}`, round: 1 });
      await client.state(s => s.yourAnswer === `Answer ${index}`);
    }
    const discussion = await Promise.all(clients.map(c => c.state(s => s.phase === 'discussion')));
    expect(discussion.every(s => s.answers?.length === 3 && s.reveal === null)).toBe(true);
    second.send({ type: 'reveal', round: 1 }); await second.error('Only the host');
    host.send({ type: 'reveal', round: 1 });
    const revealed = await Promise.all(clients.map(c => c.state(s => s.phase === 'revealed')));
    expect(revealed[0].reveal?.reason).toBe('host');
    expect(revealed.every(s => s.reveal?.imposterId === revealed[0].reveal?.imposterId)).toBe(true);
    host.send({ type: 'reveal', round: 1 }); await host.error('already');
    host.send({ type: 'start' });
    expect((await host.state(s => s.roundNumber === 2)).phase).toBe('answering');
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
  it('alarms advance answer and round deadlines without any client action', async () => {
    const { host, second, stub } = await group();
    host.send({ type: 'start' }); const initial = await host.state(s => s.phase === 'answering');
    const time = vi.spyOn(Date, 'now').mockReturnValue(initial.answerDeadline!);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const discussion = await second.state(s => s.phase === 'discussion');
    expect(discussion.answers?.every(a => a.answer === null)).toBe(true);
    expect(await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm())).toBe(initial.roundDeadline);
    time.mockReturnValue(initial.roundDeadline!);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await second.state(s => s.phase === 'revealed')).reveal?.reason).toBe('timeout');
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
});
