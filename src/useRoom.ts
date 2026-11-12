import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, RoomView, ServerMessage, Session } from '../shared/protocol';

const SESSION_KEY = 'imposter.session.v1';
export function getSession(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
    return value && /^[A-Z2-9]{6}$/.test(value.code) && /^[a-f0-9]{64}$/.test(value.token) ? value : null;
  } catch { return null; }
}
export function saveSession(session: Session | null) {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
}
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const data = await response.json() as { code: string; error?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'Request failed. Try again.', response.status);
  return data;
}
export function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
export function useRoom(session: Session | null, onExit: () => void) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connection, setConnection] = useState('Connecting…');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exit = useRef(onExit);
  exit.current = onExit;
  useEffect(() => {
    if (!session) { setRoom(null); return; }
    let stopped = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout>;
    let lastPong = Date.now();
    function retry() {
      if (stopped) return;
      setPending(false);
      setConnection('Disconnected · reconnecting…');
      retryTimer = setTimeout(open, Math.min(10_000, 800 * 2 ** Math.min(attempts++, 4)));
    }
    async function open() {
      if (stopped) return;
      setConnection(attempts ? 'Reconnecting…' : 'Connecting…');
      try {
        await post(`/api/rooms/${session!.code}/resume`, { token: session!.token });
        if (stopped) return;
        const url = new URL(`/api/rooms/${session!.code}/socket`, location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(url, ['imposter', session!.token]);
        socket.current = ws;
        ws.onopen = () => { lastPong = Date.now(); attempts = 0; setConnection('Connected'); setError(''); };
        ws.onmessage = event => {
          if (stopped || socket.current !== ws) return;
          if (event.data === 'pong') { lastPong = Date.now(); return; }
          const message = JSON.parse(event.data as string) as ServerMessage;
          clearTimeout(pendingTimer.current);
          setPending(false);
          if (message.type === 'state') {
            setRoom(message.state); setClockOffset(message.state.serverNow - Date.now());
          } else if (message.type === 'error') setError(message.message);
          else if (message.type === 'left') { stopped = true; exit.current(); }
          else if (message.type === 'expired') {
            stopped = true; setConnection('Room expired'); setError('This room has expired. Return home to create another.');
          }
        };
        ws.onclose = event => {
          if (stopped || socket.current !== ws) return;
          if (event.code === 4001) {
            stopped = true; setConnection('Session moved');
            setError('This player session opened in another tab. Return home here to join as a different player.');
          } else if (event.code === 4004) {
            stopped = true; setConnection('Room expired');
          } else retry();
        };
        ws.onerror = () => { /* onclose schedules a single retry. */ };
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && [400, 401, 404].includes(cause.status)) {
          stopped = true; setConnection('Session unavailable'); setError(cause.message);
        } else retry();
      }
    }
    void open();
    const heartbeat = setInterval(() => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - lastPong > 65_000) ws.close();
        else ws.send('ping');
      }
    }, 20_000);
    return () => {
      stopped = true; clearTimeout(retryTimer); clearInterval(heartbeat); clearTimeout(pendingTimer.current);
      const ws = socket.current;
      if (ws) {
        ws.onclose = null; ws.onmessage = null;
        if (ws.readyState === WebSocket.OPEN) ws.close();
        else if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      }
      socket.current = null;
    };
  }, [session]);
  const send = useCallback((action: Action) => {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Reconnect before taking an action.'); return; }
    setError(''); setPending(true);
    socket.current.send(JSON.stringify(action));
    clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => { setPending(false); setError('Still waiting for the server. Check your connection.'); }, 10_000);
  }, []);
  return { room, connection, error, setError, pending, send, clockOffset };
}
