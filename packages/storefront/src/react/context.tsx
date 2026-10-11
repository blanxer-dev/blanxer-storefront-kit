'use client';
import { createContext, useContext } from 'react';
import type { Store } from '../core/types.js';

export type NoticeType = 'success' | 'error' | 'info';
export interface Notice {
  type: NoticeType;
  title: string;
  message?: string;
}

export interface BlanxerContextValue {
  store: Store;
  storeId: string;
  apiBase: string;
  notify: (n: Notice) => void;
}

export const BlanxerContext = createContext<BlanxerContextValue | null>(null);

/** Store, store id, API base and `notify` from the nearest `<BlanxerProvider>`. */
export function useBlanxer(): BlanxerContextValue {
  const v = useContext(BlanxerContext);
  if (!v) throw new Error('[@blanxer/storefront] Wrap your app in <BlanxerProvider store={…}> (see the starter app/layout.tsx).');
  return v;
}

/** The (browser-safe) store document. */
export const useStore = (): Store => useBlanxer().store;
