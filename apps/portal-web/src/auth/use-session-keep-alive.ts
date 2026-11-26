import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { postKeepAlive } from './keep-alive';
import { openSessionChannel, type SessionChannel } from './session-channel';

/** How often an active resident's session is renewed: under the 5-minute access token, well under the 30-minute idle limit. */
export const KEEP_ALIVE_INTERVAL_MS = 4 * 60_000;
/** The idle limit assumed when portal-api reports none (the Keycloak client's refresh-token lifespan). */
export const IDLE_FALLBACK_MS = 30 * 60_000;

/** The later of two deadlines: renewals only move the session's deadline forward, whichever tab hears of them first. */
const later = (current: number | null, next: number): number => (current === null ? next : Math.max(current, next));

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

export interface SessionKeepAlive {
  /** When the session lapses unless renewed (epoch ms); `null` until the first renewal answers. */
  idleExpiresAt: number | null;
  /** Renews now, as Stay signed in does. A 401 reaches `useSessionEndedRedirect` through the mutation cache. */
  renew: () => void;
}

/**
 * Keeps a signed-in resident's session alive while they use the site, and only then: it renews on sign-in, then at
 * most every KEEP_ALIVE_INTERVAL_MS while the tab is visible and the resident has clicked, typed, scrolled or touched
 * since the last renewal. An idle or hidden tab never renews, so Keycloak's idle limit still ends an abandoned
 * session. Activity after a long pause (back from fetching a document) renews at once rather than at the next tick.
 * The tabs share the deadline (`openSessionChannel`): a renewal in one moves it in all, so a tab another tab kept alive
 * doesn't warn. Each tab still renews only for its own activity.
 */
export function useSessionKeepAlive(signedIn: boolean): SessionKeepAlive {
  const [idleExpiresAt, setIdleExpiresAt] = useState<number | null>(null);
  const lastActivity = useRef(0);
  const lastRenewal = useRef(0);
  const channel = useRef<SessionChannel | null>(null);

  const { mutate } = useMutation({
    mutationKey: ['auth', 'keep-alive'],
    mutationFn: postKeepAlive,
    onSuccess: (answer) => {
      const deadline = answer ?? Date.now() + IDLE_FALLBACK_MS;
      setIdleExpiresAt((current) => later(current, deadline));
      channel.current?.announceRenewed(deadline);
    },
  });

  useEffect(() => {
    if (!signedIn) return undefined;
    const opened = openSessionChannel({
      onRenewed: (deadline) => setIdleExpiresAt((current) => later(current, deadline)),
    });
    channel.current = opened;
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [signedIn]);

  const renew = useCallback(() => {
    lastRenewal.current = Date.now();
    mutate();
  }, [mutate]);

  useEffect(() => {
    if (!signedIn) return undefined;
    renew();

    const renewIfActive = () => {
      const now = Date.now();
      const due = now - lastRenewal.current >= KEEP_ALIVE_INTERVAL_MS;
      const active = lastActivity.current > lastRenewal.current;
      if (due && active && document.visibilityState === 'visible') renew();
    };
    const onActivity = () => {
      lastActivity.current = Date.now();
      renewIfActive();
    };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { passive: true, capture: true });
    const timer = window.setInterval(renewIfActive, KEEP_ALIVE_INTERVAL_MS);
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
      window.clearInterval(timer);
    };
  }, [signedIn, renew]);

  // A signed-out visitor has no deadline; signing in again is a full page load, which starts from null.
  return { idleExpiresAt: signedIn ? idleExpiresAt : null, renew };
}
