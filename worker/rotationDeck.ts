import { randomIndex } from './game';
import type { QuestionPair } from './questions';

export interface RotationDeck {
  cycle: number;
  remaining: string[];
  used: string[];
  lastId: string | null;
}
export interface QuestionAllocation {
  key: string;
  id: string;
  questions: readonly [string, string];
  cycle: number;
}
export function shuffle<T>(values: readonly T[], choose = randomIndex): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = choose(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

// Pure deck transition; the coordinator commits it together with the allocation ledger.
export function drawQuestion(stored: RotationDeck | null, key: string, bank: readonly QuestionPair[], choose = randomIndex) {
  if (!bank.length) throw new Error('No question pairs are currently available.');
  const active = new Map(bank.map(pair => [pair.id, pair]));
  if (active.size !== bank.length) throw new Error('Question bank contains duplicate IDs.');
  const deck: RotationDeck = stored ? structuredClone(stored)
    : { cycle: 1, remaining: [], used: [], lastId: null };
  const used = new Set(deck.used);
  deck.remaining = deck.remaining.filter(id => active.has(id) && !used.has(id));
  const remaining = new Set(deck.remaining);
  const additions = bank.map(pair => pair.id).filter(id => !used.has(id) && !remaining.has(id));
  if (additions.length) deck.remaining = shuffle([...deck.remaining, ...additions], choose);
  if (!deck.remaining.length) {
    deck.cycle++;
    deck.used = [];
    deck.remaining = shuffle([...active.keys()], choose);
  }
  // Also protects a one-item bank that was expanded after its last allocation.
  if (deck.remaining.length > 1 && deck.remaining[0] === deck.lastId) {
    const other = 1 + choose(deck.remaining.length - 1);
    [deck.remaining[0], deck.remaining[other]] = [deck.remaining[other], deck.remaining[0]];
  }
  const id = deck.remaining.shift()!;
  const pair = active.get(id)!;
  deck.used.push(id);
  deck.lastId = id;
  const allocation: QuestionAllocation = { key, id, questions: [...pair.questions], cycle: deck.cycle };
  return { deck, allocation };
}
