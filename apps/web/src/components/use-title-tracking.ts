'use client';
import { useQueryClient } from '@tanstack/react-query';
import type { GroupStatus, MediaDetails, PersonalStatus } from '@cenora/shared';
import { api, json } from '@/lib/api';
import { useAutosave } from '@/lib/tracking';

export interface PersonalDraft {
  status: PersonalStatus;
  rating: number | null;
  season: number | null;
  episode: number | null;
}
export interface GroupDraft {
  status: GroupStatus;
  season: number | null;
  episode: number | null;
}
const personalOf = (d: MediaDetails): PersonalDraft => ({
  status: d.personal?.status ?? 'want',
  rating: d.personal?.rating ?? null,
  season: d.personal?.season ?? null,
  episode: d.personal?.episode ?? null,
});
const groupOf = (d: MediaDetails): GroupDraft => ({
  status: d.groupStatus,
  season: d.groupSeason,
  episode: d.groupEpisode,
});
export function useTitleTracking(data: MediaDetails) {
  const qc = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['detail', data.id] }),
      qc.invalidateQueries({ queryKey: ['media'] }),
    ]);
    return qc.getQueryData<MediaDetails>(['detail', data.id]) ?? null;
  };
  const personal = useAutosave(
    personalOf(data),
    data.personal?.revision ?? 0,
    (value, revision) =>
      api(`/media/${data.id}/personal`, {
        ...json('PUT', { ...value, revision }),
        keepalive: true,
      }),
    async () => {
      const fresh = await refresh();
      return fresh ? { value: personalOf(fresh), revision: fresh.personal?.revision ?? 0 } : null;
    },
  );
  const group = useAutosave(
    groupOf(data),
    data.revision,
    (value, revision) =>
      api(`/media/${data.id}/group`, {
        ...json('PUT', { ...value, revision }),
        keepalive: true,
      }),
    async () => {
      const fresh = await refresh();
      return fresh ? { value: groupOf(fresh), revision: fresh.revision } : null;
    },
  );
  return { personal, group, saving: personal.saving || group.saving, refresh };
}
export type TitleTracking = ReturnType<typeof useTitleTracking>;
