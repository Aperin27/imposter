import { describe, expect, it } from 'vitest';
import { LEGACY_QUESTION_IDS, QUESTIONS } from '../worker/questions';

const approved = [
  ["What's the biggest red flag on a dating app?", "What's the biggest red flag in a roommate?"],
  ["What's the best thing to keep in your car?", "What's the best thing to keep under your bed?"],
  ['What food would you bring to a desert island?', 'What food could you eat every day?'],
  ['Which friend would you call to pick you up at 3 a.m.?', 'Which friend would you call to help cover up a huge mistake?'],
  ['How many days could you go without showering?', 'How many days could you wear the same outfit?'],
  ['Which app would you be most embarrassed to show your screen time for?', 'Which app would you hide if your crush borrowed your phone?'],
  ['How much money would you need to post your last Google search publicly?', 'How much money would you need to let your friends go through your phone?'],
  ["What's the best excuse to cancel plans with friends?", "What's the best excuse to leave a terrible date?"],
  ['Which celebrity would you trust to babysit your child?', 'Which celebrity would you trust with your biggest secret?'],
  ['How many minutes would you stay at a terrible party to be polite?', 'How many minutes would you give a terrible first date before leaving?'],
];
describe('premium bank content contract', () => {
  it('contains 250 unique permanent IDs without reusing the original retired IDs', () => {
    expect(QUESTIONS).toHaveLength(250);
    expect(new Set(QUESTIONS.map(pair => pair.id)).size).toBe(250);
    for (const pair of QUESTIONS) {
      expect(pair.id).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(LEGACY_QUESTION_IDS as readonly string[]).not.toContain(pair.id);
    }
  });
  it('preserves all ten owner-approved pairs verbatim', () => {
    expect(QUESTIONS.slice(0, 10).map(pair => pair.questions)).toEqual(approved);
  });
  it('contains distinct short questions and matching answer-domain metadata', () => {
    const prompts = QUESTIONS.flatMap(pair => [...pair.questions]);
    expect(new Set(prompts.map(prompt => prompt.toLowerCase().trim())).size).toBe(500);
    for (const pair of QUESTIONS) {
      expect(pair.questions).toHaveLength(2); expect(pair.category).toBeTruthy(); expect(pair.answerType).toBeTruthy();
      for (const prompt of pair.questions) {
        expect(prompt).toBe(prompt.trim()); expect(prompt.length).toBeLessThanOrEqual(180);
        expect(prompt).toMatch(/\?$/); expect(prompt).not.toMatch(/[\p{Cc}\p{Cf}]/u);
      }
    }
  });
  it('balances all eight categories and keeps numerical answers to a minority', () => {
    const counts: Record<string, number> = {};
    for (const pair of QUESTIONS) counts[pair.category!] = (counts[pair.category!] ?? 0) + 1;
    expect(counts).toEqual({ friendship: 32, dating: 32, habits: 31, social: 31, hypothetical: 31, opinions: 31, absurd: 31, numerical: 31 });
    expect(QUESTIONS.filter(pair => pair.answerType === 'number')).toHaveLength(31);
  });
});
