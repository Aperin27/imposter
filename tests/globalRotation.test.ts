import { env } from 'cloudflare:workers';
import { evictDurableObject, reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/index';
import { ROTATION_SINGLETON } from '../worker/questionRotation';
import { QUESTIONS, type QuestionPair } from '../worker/questions';
import { drawQuestion, shuffle, type RotationDeck } from '../worker/rotationDeck';

const bindings = env as unknown as Env;
const pair = (id: string): QuestionPair => ({ id, questions: [`Normal ${id}?`, `Alternative ${id}?`] });
const a = pair('a'); const b = pair('b'); const c = pair('c');
function deck(remaining = ['b', 'c'], used = ['a']): RotationDeck {
  return { cycle: 4, remaining, used, lastId: 'a' };
}
function coordinator() {
  return bindings.QUESTION_ROTATION.get(bindings.QUESTION_ROTATION.idFromName(ROTATION_SINGLETON));
}
async function storedRotation() {
  return runInDurableObject(coordinator(), (_instance, ctx) => {
    const count = ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM question_allocations').toArray()[0].count;
    const stored = ctx.storage.sql.exec<{ data: string }>('SELECT data FROM rotation_state WHERE singleton = 1').toArray()[0];
    return { count, deck: stored ? JSON.parse(stored.data) as RotationDeck : null };
  });
}
afterEach(async () => { vi.restoreAllMocks(); await reset(); });

describe('global deck transitions and question-bank updates', () => {
  it('shuffles a copy using valid Fisher–Yates bounds', () => {
    const original = ['a', 'b', 'c', 'd'];
    const bounds: number[] = [];
    const result = shuffle(original, length => { bounds.push(length); return 0; });
    expect(bounds).toEqual([4, 3, 2]);
    expect([...result].sort()).toEqual(original);
    expect(result).not.toEqual(original); expect(original).toEqual(['a', 'b', 'c', 'd']);
  });
  it('initializes a randomized first cycle and preserves the stored input object', () => {
    const first = drawQuestion(null, 'first', [a, b, c], () => 0);
    expect(first.deck.cycle).toBe(1);
    expect(first.deck.used).toEqual([first.allocation.id]);
    expect(new Set([...first.deck.remaining, ...first.deck.used])).toEqual(new Set(['a', 'b', 'c']));
    const before = structuredClone(first.deck);
    drawQuestion(first.deck, 'second', [a, b, c], () => 0);
    expect(first.deck).toEqual(before);
  });
  it('inserts additions into the remaining deck without reintroducing used IDs', () => {
    const stored = deck(); const before = structuredClone(stored); const d = pair('d');
    const { deck: next, allocation } = drawQuestion(stored, 'new', [d, c, a, b], () => 0);
    expect(next.cycle).toBe(4); expect(allocation.id).not.toBe('a');
    expect(next.used).toContain('a');
    expect(new Set([...next.remaining, allocation.id])).toEqual(new Set(['b', 'c', 'd']));
    expect(stored).toEqual(before);
  });
  it('treats bank reordering as metadata rather than a reset of progress', () => {
    const stored = deck();
    const { deck: next, allocation } = drawQuestion(stored, 'reordered', [c, a, b], () => 0);
    expect(allocation.id).toBe('b'); expect(next.remaining).toEqual(['c']);
    expect(next.used).toEqual(['a', 'b']); expect(next.cycle).toBe(4);
  });
  it('skips retired unused IDs while retaining used tombstones through the current cycle', () => {
    const stored = deck(['retired-unused', 'b'], ['a', 'retired-used']);
    const { deck: next, allocation } = drawQuestion(stored, 'retired', [a, b], () => 0);
    expect(allocation.id).toBe('b'); expect(next.remaining).toEqual([]);
    expect(next.used).toEqual(['a', 'retired-used', 'b']); expect(next.cycle).toBe(4);
  });
  it('does not allocate a restored ID that was already used in the current cycle', () => {
    const restored = pair('restored');
    const stored = deck(['b'], ['a', 'restored']);
    const { deck: next, allocation } = drawQuestion(stored, 'restored-used', [a, restored, b], () => 0);
    expect(allocation.id).toBe('b'); expect(next.used).toContain('restored');
    expect(next.cycle).toBe(4);
  });
  it('makes a restored but previously unallocated ID eligible in the current cycle', () => {
    const restored = pair('restored');
    const { deck: next, allocation } = drawQuestion(deck(['b']), 'restored-unused', [a, b, restored], () => 0);
    expect(allocation.id).toBe('restored'); expect(next.remaining).toEqual(['b']);
    expect(next.used).toEqual(['a', 'restored']); expect(next.cycle).toBe(4);
  });
  it('uses a newly added pair before restarting a previously exhausted bank', () => {
    const stored = deck([], ['a', 'b']); stored.lastId = 'b';
    const { deck: next, allocation } = drawQuestion(stored, 'added-after-exhaustion', [a, b, c], () => 0);
    expect(allocation.id).toBe('c'); expect(next.cycle).toBe(4);
    expect(next.used).toEqual(['a', 'b', 'c']);
  });
  it('resets after all available pairs are used, ignoring retired history, without an immediate repeat', () => {
    const stored = deck(['retired'], ['a', 'b', 'retired-used']); stored.lastId = 'b';
    const { deck: next, allocation } = drawQuestion(stored, 'boundary', [a, b], () => 0);
    expect(next.cycle).toBe(5); expect(allocation.id).toBe('a');
    expect(next.used).toEqual(['a']); expect(next.remaining).toEqual(['b']);
  });
  it('safely handles the unavoidable repeat with a one-pair bank', () => {
    const choose = vi.fn(() => 0);
    const first = drawQuestion(null, 'single-1', [a], choose);
    const second = drawQuestion(first.deck, 'single-2', [a], choose);
    expect(first.allocation.id).toBe('a'); expect(second.allocation.id).toBe('a');
    expect(second.deck.cycle).toBe(2); expect(choose).not.toHaveBeenCalled();
  });
  it('rejects an empty bank and duplicate IDs without mutating stored progress', () => {
    const stored = deck(); const before = structuredClone(stored);
    expect(() => drawQuestion(stored, 'empty', [], () => 0)).toThrow('No question pairs');
    expect(() => drawQuestion(stored, 'duplicate', [a, a], () => 0)).toThrow('duplicate IDs');
    expect(stored).toEqual(before);
  });
});

describe('persistent QuestionRotation SQLite Durable Object', () => {
  it('allocates all 250 active pairs once, then starts a new cycle without repeating the prior pair', async () => {
    expect(QUESTIONS).toHaveLength(250);
    const stub = coordinator(); const instance = crypto.randomUUID();
    const allocated = [];
    for (let round = 1; round <= QUESTIONS.length; round++) allocated.push(await stub.allocate(`${instance}:${round}`));
    expect(new Set(allocated.map(allocation => allocation.id)).size).toBe(QUESTIONS.length);
    expect(new Set(allocated.map(allocation => allocation.id))).toEqual(new Set(QUESTIONS.map(question => question.id)));
    expect(allocated.every(allocation => allocation.cycle === 1)).toBe(true);
    const next = await stub.allocate(`${instance}:${QUESTIONS.length + 1}`);
    expect(next.cycle).toBe(2); expect(next.id).not.toBe(allocated[allocated.length - 1].id);
    expect((await storedRotation()).count).toBe(QUESTIONS.length + 1);
  });
  it('serializes concurrent allocations for different room-instance keys', async () => {
    const stub = coordinator();
    const keys = Array.from({ length: 32 }, () => `${crypto.randomUUID()}:1`);
    const allocated = await Promise.all(keys.map(key => stub.allocate(key)));
    expect(new Set(allocated.map(allocation => allocation.id)).size).toBe(keys.length);
    expect(allocated.every(allocation => allocation.cycle === 1)).toBe(true);
    expect(allocated.map(allocation => allocation.key)).toEqual(keys);
    const stored = await storedRotation();
    expect(stored.count).toBe(keys.length); expect(stored.deck?.used).toHaveLength(keys.length);
  });
  it('returns the same allocation to concurrent duplicate requests without advancing twice', async () => {
    const stub = coordinator(); const key = `${crypto.randomUUID()}:1`;
    const allocations = await Promise.all(Array.from({ length: 20 }, () => stub.allocate(key)));
    expect(allocations.every(allocation => JSON.stringify(allocation) === JSON.stringify(allocations[0]))).toBe(true);
    const stored = await storedRotation();
    expect(stored.count).toBe(1); expect(stored.deck?.used).toHaveLength(1);
    expect(stored.deck?.remaining).toHaveLength(QUESTIONS.length - 1);
  });
  it('preserves the deck and immutable allocation snapshot through actual eviction', async () => {
    const stub = coordinator(); const instance = crypto.randomUUID();
    const first = await stub.allocate(`${instance}:1`);
    const second = await stub.allocate(`${instance}:2`);
    const before = await storedRotation();
    await evictDurableObject(stub);
    expect(await stub.allocate(`${instance}:1`)).toEqual(first);
    expect(await stub.allocate(`${instance}:2`)).toEqual(second);
    expect(await storedRotation()).toEqual(before);
    const third = await stub.allocate(`${instance}:3`);
    expect([first.id, second.id]).not.toContain(third.id);
    expect((await storedRotation()).count).toBe(3);
  });
  it('retains old-cycle idempotency snapshots after a new cycle begins', async () => {
    const stub = coordinator(); const instance = crypto.randomUUID();
    const first = await stub.allocate(`${instance}:1`);
    for (let round = 2; round <= QUESTIONS.length + 1; round++) await stub.allocate(`${instance}:${round}`);
    const before = await storedRotation();
    expect(before.deck?.cycle).toBe(2);
    expect(await stub.allocate(`${instance}:1`)).toEqual(first);
    expect(await storedRotation()).toEqual(before);
  });
  it('rolls back the deck write when the allocation-ledger insert fails, then safely retries', async () => {
    const stub = coordinator(); const room = crypto.randomUUID();
    await stub.allocate(`${room}:1`);
    const before = await storedRotation();
    const key = `${room}:2`;
    const failure = await runInDurableObject(stub, (instance, ctx) => {
      ctx.storage.sql.exec(`CREATE TRIGGER fail_allocation_insert BEFORE INSERT ON question_allocations
        BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END`);
      try {
        try { instance.allocate(key); return null; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      } finally { ctx.storage.sql.exec('DROP TRIGGER fail_allocation_insert'); }
    });
    expect(failure).toContain('injected ledger failure');
    expect(await storedRotation()).toEqual(before);
    const allocation = await stub.allocate(key);
    expect(allocation.id).toBe(before.deck!.remaining[0]);
    expect(allocation.cycle).toBe(before.deck!.cycle);
    const after = await storedRotation();
    expect(after.count).toBe(before.count + 1);
    expect(after.deck?.used).toHaveLength(before.deck!.used.length + 1);
    expect(await stub.allocate(key)).toEqual(allocation);
    expect(await storedRotation()).toEqual(after);
  });
  it('replays a retired allocation snapshot while skipping retired IDs for fresh allocations', async () => {
    const stub = coordinator(); const room = crypto.randomUUID();
    const first = await stub.allocate(`${room}:1`);
    const before = await storedRotation();
    const retiredNext = before.deck!.remaining[0];
    const result = await runInDurableObject(stub, instance => {
      const activeBank = QUESTIONS as QuestionPair[];
      const originalBank = [...activeBank];
      try {
        activeBank.splice(0, activeBank.length, ...originalBank.filter(pair => pair.id !== first.id && pair.id !== retiredNext));
        return { replay: instance.allocate(`${room}:1`), fresh: instance.allocate(`${room}:2`) };
      } finally { activeBank.splice(0, activeBank.length, ...originalBank); }
    });
    expect(result.replay).toEqual(first);
    expect([first.id, retiredNext]).not.toContain(result.fresh.id);
    expect(result.fresh.cycle).toBe(first.cycle);
    const after = await storedRotation();
    expect(after.count).toBe(before.count + 1);
    expect(after.deck?.used).toContain(first.id);
    expect(after.deck?.remaining).not.toContain(retiredNext);
    expect(QUESTIONS).toHaveLength(250);
  });
  it('replays an existing snapshot with an empty bank but rejects fresh allocation without changing stored state', async () => {
    const stub = coordinator(); const room = crypto.randomUUID();
    const first = await stub.allocate(`${room}:1`);
    const before = await storedRotation();
    const result = await runInDurableObject(stub, instance => {
      const activeBank = QUESTIONS as QuestionPair[];
      const originalBank = activeBank.splice(0);
      try {
        const replay = instance.allocate(`${room}:1`);
        let failure: string | null = null;
        try { instance.allocate(`${room}:2`); }
        catch (error) { failure = error instanceof Error ? error.message : String(error); }
        return { replay, failure };
      } finally { activeBank.splice(0, activeBank.length, ...originalBank); }
    });
    expect(result.replay).toEqual(first);
    expect(result.failure).toBe('No question pairs are currently available.');
    expect(await storedRotation()).toEqual(before);
    expect(QUESTIONS).toHaveLength(250);
  });
  it.each(['', 'not-a-room:1', `${'a'.repeat(36)}:1`, `${crypto.randomUUID()}:0`, `${crypto.randomUUID()}:-1`, `${crypto.randomUUID()}:1.5`, `${crypto.randomUUID()}:1000000000`])('rejects invalid key %j before consuming a question', async key => {
    // Catch inside the DO context: the test runtime otherwise reports an expected
    // synchronous RPC rejection as an unhandled exception as well as rejecting it.
    const message = await runInDurableObject(coordinator(), instance => {
      try { instance.allocate(key); return null; }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    });
    expect(message).toBe('Invalid question allocation key.');
    expect(await storedRotation()).toEqual({ count: 0, deck: null });
  });
});
