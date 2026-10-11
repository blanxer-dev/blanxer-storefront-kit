'use client';
import { useContext } from 'react';
import { formatCurrency } from '../core/format.js';
import { currencyLabel } from '../core/store.js';
import { BlanxerContext } from './context.js';

/** Formatter using the store's currency label (`customization.currency_indicator`, default "Rs."). */
export function useMoney(): (amount: number) => string {
  const ctx = useContext(BlanxerContext);
  const label = currencyLabel(ctx?.store);
  return (amount: number) => `${label} ${formatCurrency(amount)}`;
}

/** `<Money amount={1200} />` → "Rs. 1,200" (store currency label). */
export function Money({ amount, className }: { amount: number; className?: string }) {
  const money = useMoney();
  return <span className={className ? `bx-money ${className}` : 'bx-money'}>{money(amount)}</span>;
}
