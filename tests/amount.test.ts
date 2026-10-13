import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountCents } from '../src/amount';

test('manual transfer amounts accept common European and English formats', () => {
  const cases: [string, number | null][] = [
    ['12.50', 1250],
    ['12,50', 1250],
    ['12,5', 1250],
    ['1,234.56', 123456],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['1,234', 123400],
    ['1234', 123400],
    ['€ 20', 2000],
    ['20 EUR', 2000],
    ['12.345,6', 1234560],
    ['1.234.567,89', 123456789],
    ['1234.5', 123450],
  ];
  for (const [input, cents] of cases) assert.equal(parseAmountCents(input), cents, input);
});

test('unclear amounts are rejected instead of guessed', () => {
  for (const input of ['', '0', 'abc', '1.2.3', '1.234.56', '12.', '1234,567', '-5'])
    assert.ok(!parseAmountCents(input), input);
});
