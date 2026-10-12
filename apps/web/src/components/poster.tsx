'use client';
import { useState } from 'react';
import type { Media, CatalogResult } from '@cenora/shared';
import { clsx } from 'clsx';
export function Poster({
  media,
  className,
}: {
  media: Pick<Media, 'title' | 'posterUrl' | 'kind' | 'year'> | CatalogResult;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  let seed = 0;
  for (const ch of media.title) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <div className={clsx('poster', className)}>
      {media.posterUrl && !failed ? (
        <img
          src={media.posterUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className={`poster-fallback palette-${seed % 8}`} aria-hidden="true">
          <span className="poster-edition">UMA HISTÓRIA PARA COMPARTILHAR</span>
          <div className="poster-orbit" />
          <strong>{media.title}</strong>
          <span className="poster-bottom">
            {media.kind === 'tv' ? 'SÉRIE' : 'FILME'}
            <span>{media.year || '✳'}</span>
          </span>
        </div>
      )}
    </div>
  );
}
