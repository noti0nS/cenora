import { describe, expect, it } from 'vitest';
import { metadataSeasons, progressUnits } from '../src/ranking';

describe('ranking checkpoint projection', () => {
  it('never guesses unknown prior seasons or creates completed manual seasons', () => {
    expect(progressUnits('tv', { status: 'watched', season: 5, episode: 2 }, [])).toEqual([
      { unit: 'episode', season: 5, count: 2 },
    ]);
  });
  it('bounds known episodes and counts only fully completed seasons', () => {
    expect(
      progressUnits('tv', { status: 'watching', season: 2, episode: 999 }, [
        { number: 1, name: 'T1', episodes: 2 },
        { number: 2, name: 'T2', episodes: 4 },
      ]),
    ).toEqual([
      { unit: 'episode', season: 1, count: 2 },
      { unit: 'season', season: 1, count: 1 },
      { unit: 'episode', season: 2, count: 4 },
      { unit: 'season', season: 2, count: 1 },
    ]);
  });
  it('handles missing, corrupt and invalid metadata without blocking tracking', () => {
    for (const metadata of [null, '{', '{}', '{"seasons":[{"number":-1,"episodes":0}]}'])
      expect(metadataSeasons(metadata)).toEqual([]);
  });
});
