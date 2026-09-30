'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bounty, BountyInput, DemoState, INITIAL_STATE, advanceBounty, createBounty, parseSavedState, toggleWallet } from './demo';

const STORAGE_KEY = 'vector-demo-state-v1';

export function useDemo() {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try {
      setState(parseSavedState(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      setStorageError(true);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      setStorageError(true);
    }
  }, [hydrated, state]);

  const commit = useCallback((updater: (current: DemoState) => DemoState) => {
    setState((current) => updater(current));
  }, []);

  const connectWallet = useCallback(() => commit((current) => toggleWallet(current)), [commit]);
  const addBounty = useCallback((input: BountyInput): Bounty => {
    let created: Bounty | undefined;
    commit((current) => {
      const next = createBounty(current, input);
      created = next.bounties[0];
      return next;
    });
    if (!created) throw new Error('Unable to create bounty.');
    return created;
  }, [commit]);
  const advance = useCallback((id: string) => commit((current) => advanceBounty(current, id)), [commit]);
  const reset = useCallback(() => setState({ ...INITIAL_STATE, bounties: INITIAL_STATE.bounties.map((item) => ({ ...item })), activity: INITIAL_STATE.activity.map((item) => ({ ...item })) }), []);

  return { state, hydrated, storageError, connectWallet, addBounty, advance, reset };
}
