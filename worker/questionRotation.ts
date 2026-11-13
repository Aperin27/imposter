import { DurableObject } from 'cloudflare:workers';
import { QUESTIONS } from './questions';
import { drawQuestion, type QuestionAllocation, type RotationDeck } from './rotationDeck';
import type { Env } from './index';

// Do not change this name: every room in this Worker namespace uses the same durable deck.
export const ROTATION_SINGLETON = 'imposter-global-question-rotation-v1';
export class QuestionRotation extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rotation_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), data TEXT NOT NULL
    )`);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS question_allocations (
      request_key TEXT PRIMARY KEY, data TEXT NOT NULL
    )`);
  }

  allocate(key: string): QuestionAllocation {
    if (typeof key !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}:[1-9][0-9]{0,8}$/.test(key)) {
      throw new Error('Invalid question allocation key.');
    }
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql.exec<{ data: string }>(
        'SELECT data FROM question_allocations WHERE request_key = ?', key).toArray()[0];
      // Snapshots outlive retirements and cycle changes; a retry never advances the deck.
      if (existing) return JSON.parse(existing.data) as QuestionAllocation;
      const stored = this.ctx.storage.sql.exec<{ data: string }>(
        'SELECT data FROM rotation_state WHERE singleton = 1').toArray()[0];
      const { deck, allocation } = drawQuestion(stored ? JSON.parse(stored.data) as RotationDeck : null, key, QUESTIONS);
      this.ctx.storage.sql.exec('INSERT INTO rotation_state (singleton, data) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET data = excluded.data', JSON.stringify(deck));
      this.ctx.storage.sql.exec('INSERT INTO question_allocations (request_key, data) VALUES (?, ?)', key, JSON.stringify(allocation));
      return allocation;
    });
  }
}
