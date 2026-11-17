import { expect, it } from 'vitest'
import { formatBalance } from '../src/client/formatBalance.ts'

it.each([
  ['0.000000', '¥0.00'], ['12.34000000', '¥12.34'], ['1234.56999', '¥1,234.56'],
  ['0.00000001', '<¥0.01'], ['0.01', '¥0.01'], ['-0.000001', '-¥0.01'],
  ['-12.345', '-¥12.35'], ['-0.0000', '¥0.00'],
  // The Platform wire schema can carry exponent notation, which Big parses natively.
  ['0E-16', '¥0.00'], ['5.0000000000000000', '¥5.00'], ['5e0', '¥5.00'], ['1E-8', '<¥0.01'],
])('formats %s using Platform currency rules', (amount, expected) => {
  expect(formatBalance(amount, 'CNY', 'en')).toBe(expected)
})

it('takes the currency from the wallet rather than a fixed symbol', () => {
  expect(formatBalance('1234.56', 'CNY', 'en')).toBe('¥1,234.56')
  expect(formatBalance('1234.56', 'USD', 'en')).toBe('$1,234.56')
})

it.each<[string, 'CNY' | 'USD', string]>([
  ['de', 'USD', '1.234,56\u00a0$'],
  ['fr', 'USD', '1\u202f234,56\u00a0$'],
  // Spanish only groups from five digits up.
  ['es', 'USD', '1234,56\u00a0$'],
  ['ru', 'CNY', '1\u00a0234,56\u00a0¥'],
  ['uk', 'USD', '1\u00a0234,56\u00a0$'],
  ['ja', 'CNY', '￥1,234.56'],
  ['zh', 'CNY', '¥1,234.56'],
  ['pt', 'CNY', '¥\u00a01.234,56'],
])('follows the %s digit grouping and currency placement', (language, currency, expected) => {
  expect(formatBalance('1234.56', currency, language)).toBe(expected)
})

it('keeps the sub-cent and negative markers in every language', () => {
  expect(formatBalance('0.001', 'USD', 'de')).toBe('<0,01\u00a0$')
  expect(formatBalance('-12.345', 'USD', 'de')).toBe('-12,35\u00a0$')
})
