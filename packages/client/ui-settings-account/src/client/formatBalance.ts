/** Platform Web currency formatting for account balances; source amounts retain decimal precision. */
import { Big } from 'big.js'
import type { AccountWallet } from '@deepseek-ai/dsh-deepseek-account/types'

const MINIMUM = new Big('0.01')

/**
 * Format a balance using Platform Web's two-decimal and sub-cent display rules.
 * @param amount - validated decimal balance string.
 * @param currency - wallet currency code; its symbol and placement come from the locale.
 * @param language - active UI language tag for digit grouping and currency display.
 * @returns signed currency text with locale-grouped digits.
 */
export function formatBalance(amount: string, currency: AccountWallet['currency'], language: string): string {
  const value = new Big(amount)
  const format = (magnitude: Big | number): string => new Intl.NumberFormat(language, {
    style: 'currency', currency, currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(typeof magnitude === 'number' ? magnitude : Number(magnitude.toFixed(2)))
  if (value.eq(0)) return format(0)
  if (value.lt(0)) return format(value.gt(MINIMUM.neg()) ? -0.01 : -Number(value.abs().toFixed(2)))
  if (value.lt(MINIMUM)) return `<${format(0.01)}`
  return format(value.round(2, Big.roundDown))
}
