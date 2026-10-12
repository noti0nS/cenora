'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Season } from '@cenora/shared';
import { errorMessage } from './api';

interface Settled<T> {
  value: T;
  revision: number;
}

/**
 * Optimistic draft that saves itself shortly after the last change.
 * Writes are serialized so each request carries the revision the previous one produced.
 */
export function useAutosave<T extends object>(
  server: T,
  revision: number,
  save: (value: T, revision: number) => Promise<unknown>,
  settle: () => Promise<Settled<T> | null>,
) {
  const [draft, setDraft] = useState(server);
  const [saving, setSaving] = useState(false);
  const latest = useRef(server);
  const rev = useRef(revision);
  const dirty = useRef(false);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  const settleRef = useRef(settle);
  saveRef.current = save;
  settleRef.current = settle;
  const serverKey = JSON.stringify(server);
  useEffect(() => {
    if (dirty.current || busy.current) return;
    latest.current = server;
    rev.current = revision;
    setDraft(server);
  }, [serverKey, revision]);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      while (dirty.current) {
        dirty.current = false;
        await saveRef.current(latest.current, rev.current);
        rev.current += 1;
      }
    } catch (error) {
      dirty.current = false;
      toast.error(errorMessage(error));
      const fresh = await settleRef.current().catch(() => null);
      if (fresh) {
        latest.current = fresh.value;
        rev.current = fresh.revision;
        setDraft(fresh.value);
      }
      busy.current = false;
      setSaving(false);
      return;
    }
    busy.current = false;
    setSaving(false);
    void settleRef.current();
  }, []);
  const update = useCallback(
    (patch: Partial<T>) => {
      latest.current = { ...latest.current, ...patch };
      setDraft(latest.current);
      dirty.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 450);
    },
    [flush],
  );
  useEffect(() => {
    const onHide = () => {
      if (dirty.current) void flush();
    };
    const onVisibility = () => document.visibilityState === 'hidden' && onHide();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      onHide();
    };
  }, [flush]);
  return { draft, update, saving };
}

export interface Checkpoint {
  season: number | null;
  episode: number | null;
}
export const totalEpisodes = (seasons: Season[]) => seasons.reduce((sum, s) => sum + s.episodes, 0);
/** How many episodes are behind a "watched through S·E" checkpoint. */
export function watchedCount(seasons: Season[], cp: Checkpoint) {
  if (!cp.season || !cp.episode) return 0;
  let count = 0;
  for (const s of seasons) {
    if (s.number < cp.season) count += s.episodes;
    else if (s.number === cp.season) count += Math.min(cp.episode, s.episodes);
  }
  return count;
}
export function seasonProgress(season: Season, cp: Checkpoint) {
  if (!cp.season || !cp.episode || cp.season < season.number) return 0;
  return cp.season > season.number ? season.episodes : Math.min(cp.episode, season.episodes);
}
export function nextEpisode(
  seasons: Season[],
  cp: Checkpoint,
): { season: number; episode: number } | null {
  if (!seasons.length)
    return cp.season && cp.episode
      ? { season: cp.season, episode: cp.episode + 1 }
      : { season: 1, episode: 1 };
  if (!cp.season || !cp.episode) return { season: seasons[0].number, episode: 1 };
  const current = seasons.find((s) => s.number === cp.season);
  if (current && cp.episode < current.episodes)
    return { season: current.number, episode: cp.episode + 1 };
  const later = seasons.find((s) => s.number > cp.season!);
  return later ? { season: later.number, episode: 1 } : null;
}
export function isFinished(seasons: Season[], cp: Checkpoint) {
  return seasons.length > 0 && cp.season !== null && nextEpisode(seasons, cp) === null;
}
