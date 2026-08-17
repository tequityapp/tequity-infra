import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('architecture decision records', () => {
  it('assigns each decision number to exactly one record', () => {
    const decisions = readdirSync(resolve(__dirname, '..', 'docs', 'decisions'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const numbers = decisions.map((decision) => decision.match(/^(\d{4})-/)?.[1]);

    expect(numbers.every(Boolean)).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
