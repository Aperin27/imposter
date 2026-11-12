import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reset } from 'cloudflare:test';
import worker, { type Env } from '../worker/index';
import { enforcePublicLimit, publicClientKey, PublicRequestError } from '../worker/rateLimit';
import { secret } from '../worker/game';

const bindings = env as unknown as Env;
afterEach(async () => { vi.restoreAllMocks(); await reset(); });
const origin = 'https://imposter.test';
async function request(path: string, token: string, ip: string, nickname = 'Friend', customEnv = bindings) {
  const response = await worker.fetch(new Request(origin + path, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip,
    'X-Forwarded-For': secret(), 'X-Imposter-Client-Key': secret(),
  }, body: JSON.stringify({ nickname, token }) }), customEnv);
  return new Response(await response.arrayBuffer(), response);
}
describe('public room rate limits', () => {
  it('uses only the trusted edge IP, ignoring spoofable forwarded headers and player tokens', () => {
    expect(publicClientKey(new Request(origin, { headers: {
      'CF-Connecting-IP': '192.0.2.1', 'X-Forwarded-For': 'evil', 'X-Imposter-Client-Key': 'evil',
    } }))).toBe('imposter:192.0.2.1');
    expect(publicClientKey(new Request(origin, { headers: { 'X-Forwarded-For': 'evil' } }))).toBe('imposter:local-or-unknown');
  });
  it('returns a friendly 429 and Retry-After for limited creation without creating a room', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const response = await request('/api/rooms', secret(), '192.0.2.2', 'Host', { ...bindings, CREATE_ROOM_LIMITER: { limit } });
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json() as { error: string }).error).toContain('wait a minute');
    expect(limit).toHaveBeenCalledWith({ key: 'imposter:192.0.2.2' });
  });
  it('fails new creation closed with 503 when its binding is missing/unavailable', async () => {
    const limit = vi.fn().mockRejectedValue(new Error('binding unavailable'));
    const response = await request('/api/rooms', secret(), '192.0.2.3', 'Host', { ...bindings, CREATE_ROOM_LIMITER: { limit } });
    expect(response.status).toBe(503);
    await expect(enforcePublicLimit(undefined as unknown as RateLimit, 'key', 'join')).rejects.toMatchObject({ status: 503 });
    await expect(enforcePublicLimit({ limit: async () => ({ success: false }) }, 'key', 'join')).rejects.toBeInstanceOf(PublicRequestError);
  });
  it('enforces the actual local creation binding after ten requests with a shared IP', async () => {
    const ip = crypto.randomUUID();
    for (let i = 0; i < 10; i++) expect((await request('/api/rooms', secret(), ip)).status).toBe(201);
    expect((await request('/api/rooms', secret(), ip)).status).toBe(429);
    expect((await request('/api/rooms', secret(), crypto.randomUUID())).status).toBe(201);
  });
  it('counts unsuccessful room-code probes and allows sixty join attempts per connection', async () => {
    const ip = crypto.randomUUID();
    for (let i = 0; i < 60; i++) expect((await request('/api/rooms/XXXXXX/join', secret(), ip)).status).toBe(404);
    const blocked = await request('/api/rooms/YYYYYY/join', secret(), ip);
    expect(blocked.status).toBe(429); expect(blocked.headers.get('Retry-After')).toBe('60');
    expect((await blocked.json() as { error: string }).error).toContain('join attempts');
  });
  it('lets twelve friends on one Wi-Fi join, then exempts valid member joins and resume when limited', async () => {
    const ip = crypto.randomUUID(); const token = secret();
    const created = await request('/api/rooms', token, ip, 'Host');
    const { code } = await created.json() as { code: string };
    for (let i = 0; i < 11; i++) {
      expect((await request(`/api/rooms/${code}/join`, secret(), ip, `Friend ${i}`)).status).toBe(200);
    }
    for (let i = 11; i < 60; i++) await request('/api/rooms/XXXXXX/join', secret(), ip);
    expect((await request(`/api/rooms/${code}/join`, secret(), ip, 'Over limit')).status).toBe(429);
    expect((await request(`/api/rooms/${code}/join`, token, ip, 'Host')).status).toBe(200);
    expect((await request(`/api/rooms/${code}/resume`, token, ip)).status).toBe(200);
    const upgraded = await worker.fetch(new Request(`${origin}/api/rooms/${code}/socket`, { headers: {
      Origin: origin, Upgrade: 'websocket', 'CF-Connecting-IP': ip, 'Sec-WebSocket-Protocol': `imposter, ${token}`,
    } }), bindings);
    expect(upgraded.status).toBe(101);
    const socket = upgraded.webSocket!;
    const pong = new Promise<string>(resolve => socket.addEventListener('message', event => { if (event.data === 'pong') resolve(event.data); }));
    socket.accept(); socket.send('ping'); expect(await pong).toBe('pong'); socket.close();
  });
});
