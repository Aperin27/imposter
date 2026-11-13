import { DurableObject } from 'cloudflare:workers';
import type { Action, ServerMessage } from '../shared/protocol';
import { act, advance, connect, createGame, disconnect, GameError, join, member, nextDeadline, randomIndex, upgradeGame, validateStart, view, type Game } from './game';
import { enforcePublicLimit, publicClientKey, PublicRequestError } from './rateLimit';
import { QuestionRotation, ROTATION_SINGLETON } from './questionRotation';
import type { QuestionAllocation } from './rotationDeck';
export { QuestionRotation };

export interface Env {
  ROOMS: DurableObjectNamespace<Room>; ASSETS: Fetcher;
  CREATE_ROOM_LIMITER: RateLimit; JOIN_ROOM_LIMITER: RateLimit;
  QUESTION_ROTATION: DurableObjectNamespace<QuestionRotation>;
}
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
function errorResponse(error: unknown): Response {
  if (error instanceof PublicRequestError) {
    const response = json({ error: error.message }, error.status);
    response.headers.set('Retry-After', '60');
    return response;
  }
  if (error instanceof GameError) return json({ error: error.message }, 400);
  console.error('Room operation failed', error instanceof Error ? error.message : 'Unknown error');
  return json({ error: 'Something went wrong. Please reconnect and try again.' }, 500);
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new GameError('Expected JSON.');
  if (!request.body) throw new GameError('Request body is missing.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); throw new GameError('Request is too large.'); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(buffer));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new GameError('Invalid JSON request.'); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
    try {
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        await enforcePublicLimit(env.CREATE_ROOM_LIMITER, publicClientKey(request), 'create');
        const body = await readBody(request);
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)]).join('');
          const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
          const result = await stub.fetch('https://room/create', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, code }) });
          if (result.status !== 409) return result;
          await result.arrayBuffer();
        }
        return json({ error: 'Could not create a room. Try again.' }, 503);
      }
      const match = /^\/api\/rooms\/([A-Z2-9]{6})\/(join|resume|leave|socket)$/.exec(url.pathname);
      if (!match) return json({ error: 'Room endpoint not found. Check the code.' }, 404);
      const [, code, endpoint] = match;
      if ((endpoint !== 'socket' && request.method !== 'POST') || (endpoint === 'socket' && request.method !== 'GET')) {
        return json({ error: 'Method not allowed.' }, 405);
      }
      if (endpoint === 'socket' && origin !== url.origin) return json({ error: 'A same-origin WebSocket is required.' }, 403);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      url.pathname = `/${endpoint}`;
      const forwarded = new Request(url, request);
      forwarded.headers.set('X-Imposter-Client-Key', publicClientKey(request));
      return await stub.fetch(forwarded);
    } catch (error) { return errorResponse(error); }
  },
} satisfies ExportedHandler<Env>;

interface Attachment { playerId: string; active: boolean }
export class Room extends DurableObject<Env> {
  private game: Game | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.game = await ctx.storage.get<Game>('game') ?? null;
      if (!this.game) return;
      // Hibernation keeps sockets and attachments; a restart can lose sockets.
      const liveIds = new Set(ctx.getWebSockets().filter(ws => this.attachment(ws)?.active)
        .map(ws => this.attachment(ws)!.playerId));
      const beforeUpgrade = JSON.stringify(this.game);
      upgradeGame(this.game, Date.now());
      let changed = beforeUpgrade !== JSON.stringify(this.game);
      for (const player of this.game.players) {
        if (player.connected && !liveIds.has(player.id)) {
          disconnect(this.game, player.id, Date.now()); changed = true;
        }
      }
      if (changed) await this.persist();
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private attachment(ws: WebSocket): Attachment | null {
    return ws.deserializeAttachment() as Attachment | null;
  }
  private send(ws: WebSocket, message: ServerMessage) {
    try { ws.send(JSON.stringify(message)); } catch { /* Close/error event handles membership. */ }
  }
  private broadcast() {
    if (!this.game) return;
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.attachment(ws);
      if (attachment?.active && this.game.players.some(p => p.id === attachment.playerId && !p.left)) {
        this.send(ws, { type: 'state', state: view(this.game, attachment.playerId, now) });
      }
    }
  }
  private async persist(game = this.game) {
    if (!game) return;
    await this.ctx.storage.transaction(async storage => {
      await storage.put('game', game);
      await storage.setAlarm(nextDeadline(game));
    });
  }
  private async startRound(playerId: string, expectedRound?: number) {
    const game = this.game!;
    validateStart(game, playerId, expectedRound);
    const roundNumber = (game.round?.number ?? 0) + 1;
    // Persist the intent before crossing the DO boundary. A retry uses this same key.
    game.pendingStart ??= { key: `${game.roomInstanceId}:${roundNumber}`, roundNumber };
    if (game.pendingStart.roundNumber !== roundNumber) throw new GameError('The pending round cannot be recovered. Reconnect and try again.');
    await this.persist();
    const key = game.pendingStart.key;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let allocation: QuestionAllocation;
    try {
      const coordinator = this.env.QUESTION_ROTATION.get(this.env.QUESTION_ROTATION.idFromName(ROTATION_SINGLETON));
      const response = await Promise.race([
        coordinator.allocate(key),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Allocation timed out')), 8000); }),
      ]);
      if (response.key !== key || !response.id || response.questions?.length !== 2
        || response.questions.some(question => typeof question !== 'string' || !question.trim())) throw new Error('Invalid allocation');
      allocation = { key, id: response.id, cycle: response.cycle, questions: [response.questions[0], response.questions[1]] };
    } catch {
      if (await this.expireIfDue()) return;
      throw new GameError('Question rotation is temporarily unavailable. Try Start round again. Your room is safe.');
    } finally { clearTimeout(timeout); }
    if (await this.expireIfDue() || !this.game) return;
    const candidate = structuredClone(this.game);
    act(candidate, playerId, { type: 'start', round: expectedRound }, Date.now(), randomIndex, allocation);
    try { await this.persist(candidate); }
    catch { throw new GameError('The round could not be saved. Try Start round again. Your question reservation is safe.'); }
    this.game = candidate;
  }
  private async expireIfDue(): Promise<boolean> {
    if (!this.game || !advance(this.game, Date.now())) return false;
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: 'expired' }); ws.close(4004, 'Room expired');
    }
    this.game = null;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    // Serialize parsing, state transitions and persistence, including competing joins.
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const path = new URL(request.url).pathname;
        await this.expireIfDue();
        if (path === '/create') {
          if (this.game) { await this.persist(); this.broadcast(); return json({ error: 'Code already used.' }, 409); }
          const body = await readBody(request);
          const game = createGame(String(body.code), Date.now());
          join(game, body.nickname, body.token, Date.now());
          this.game = game;
          await this.persist();
          return json({ code: game.code }, 201);
        }
        if (!this.game) {
          if (path === '/join') await enforcePublicLimit(this.env.JOIN_ROOM_LIMITER,
            request.headers.get('X-Imposter-Client-Key') ?? 'imposter:local-or-unknown', 'join');
          return json({ error: 'Room not found or expired. Check the code or create a new room.' }, 404);
        }
        if (path === '/resume' || path === '/leave') {
          const body = await readBody(request);
          const player = member(this.game, String(body.token));
          if (path === '/leave') {
            act(this.game, player.id, { type: 'leave' }, Date.now());
            for (const ws of this.ctx.getWebSockets()) {
              if (this.attachment(ws)?.playerId === player.id) {
                ws.serializeAttachment({ playerId: player.id, active: false });
                this.send(ws, { type: 'left' }); ws.close(1000, 'Left room');
              }
            }
          }
          await this.persist(); this.broadcast();
          return json({ code: this.game.code });
        }
        if (path === '/join') {
          const body = await readBody(request);
          if (!this.game.players.some(p => !p.left && p.token === body.token)) {
            await enforcePublicLimit(this.env.JOIN_ROOM_LIMITER, request.headers.get('X-Imposter-Client-Key') ?? 'imposter:local-or-unknown', 'join');
          }
          join(this.game, body.nickname, body.token, Date.now());
          await this.persist(); this.broadcast();
          return json({ code: this.game.code });
        }
        if (path !== '/socket' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          return json({ error: 'Expected a WebSocket connection.' }, 426);
        }
        // A protocol credential keeps the bearer token out of URLs and access-log paths.
        const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(p => p.trim()) ?? [];
        if (protocols.length !== 2 || protocols[0] !== 'imposter' || !/^[a-f0-9]{64}$/.test(protocols[1])) {
          return json({ error: 'Invalid room session.' }, 401);
        }
        const player = member(this.game, protocols[1]);
        const pair = new WebSocketPair();
        for (const old of this.ctx.getWebSockets()) {
          if (this.attachment(old)?.playerId === player.id) {
            old.serializeAttachment({ playerId: player.id, active: false });
            old.close(4001, 'Session opened in another tab');
          }
        }
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ playerId: player.id, active: true } satisfies Attachment);
        connect(this.game, player.id, Date.now());
        await this.persist(); this.broadcast();
        return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'imposter' } });
      } catch (error) {
        if (this.game) { await this.persist(); this.broadcast(); }
        return errorResponse(error);
      }
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (await this.expireIfDue() || !this.game) return;
      const attachment = this.attachment(ws);
      if (!attachment?.active) return;
      try {
        if (typeof message !== 'string' || message.length > 1024) throw new GameError('Invalid or oversized action.');
        let action: Action;
        try { action = JSON.parse(message) as Action; } catch { throw new GameError('Invalid action.'); }
        if (!action || !['start', 'answer', 'reveal', 'leave', 'removeOffline'].includes(action.type)) throw new GameError('Unknown action.');
        if (action.type === 'start') await this.startRound(attachment.playerId, action.round);
        else { act(this.game, attachment.playerId, action, Date.now()); await this.persist(); }
        this.broadcast();
        if (action.type === 'leave') {
          ws.serializeAttachment({ ...attachment, active: false });
          this.send(ws, { type: 'left' }); ws.close(1000, 'Left room');
        }
      } catch (error) {
        // Deadline transitions must persist even when a late/invalid action is rejected.
        await this.persist(); this.broadcast();
        this.send(ws, { type: 'error', message: error instanceof GameError ? error.message : 'Action failed. Try reconnecting.' });
      }
    });
  }
  async webSocketClose(ws: WebSocket) {
    await this.ctx.blockConcurrencyWhile(async () => {
      const attachment = this.attachment(ws);
      if (!attachment?.active || !this.game) return;
      ws.serializeAttachment({ ...attachment, active: false });
      // The configured runtime auto-replies to close frames. Received sentinel codes
      // such as 1005/1006 must never be sent back as WebSocket close codes.
      if (await this.expireIfDue() || !this.game) return;
      disconnect(this.game, attachment.playerId, Date.now());
      await this.persist(); this.broadcast();
    });
  }
  async webSocketError(ws: WebSocket) {
    ws.close(1011, 'Connection interrupted');
    await this.webSocketClose(ws);
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (await this.expireIfDue() || !this.game) return;
      await this.persist(); this.broadcast();
    });
  }
}
