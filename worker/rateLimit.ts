export class PublicRequestError extends Error {
  constructor(message: string, public status: 429 | 503) { super(message); }
}

export function publicClientKey(request: Request): string {
  // Cloudflare supplies this header at the edge. Never trust X-Forwarded-For or client tokens.
  return `imposter:${request.headers.get('CF-Connecting-IP') || 'local-or-unknown'}`;
}

export async function enforcePublicLimit(limiter: RateLimit, key: string, kind: 'create' | 'join') {
  let success: boolean;
  try { ({ success } = await limiter.limit({ key })); }
  catch { throw new PublicRequestError('New rooms and players are temporarily unavailable. Existing players can still reconnect. Please try again shortly.', 503); }
  if (!success) throw new PublicRequestError(kind === 'create'
    ? 'Too many rooms created from this connection. Please wait a minute and try again.'
    : 'Too many join attempts from this connection. Please wait a minute and try again.', 429);
}
