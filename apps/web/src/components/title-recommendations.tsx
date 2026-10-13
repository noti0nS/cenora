'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogResult, MediaDetails, RelatedTitles, ShelfKind } from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Button } from './ui';
import { Poster } from './poster';

export function TitleRecommendations({
  data,
  ensureList,
  onPick,
}: {
  data: MediaDetails;
  ensureList: () => Promise<string>;
  onPick: (id: string, kind: ShelfKind) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['related', data.id],
    queryFn: () => api<RelatedTitles>(`/media/${data.id}/recommendations`),
  });
  const pick = async (item: CatalogResult) => {
    if (item.existingId) {
      onPick(item.existingId, item.isAnime ? 'anime' : item.kind);
      return;
    }
    setBusy(item.tmdbId);
    try {
      const result = await api<{ id: string; isAnime: boolean }>(
        '/media/catalog',
        json('POST', {
          tmdbId: item.tmdbId,
          kind: item.kind,
          isAnime: item.isAnime,
          listId: await ensureList(),
        }),
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['media'] }),
        qc.invalidateQueries({ queryKey: ['counts'] }),
        qc.invalidateQueries({ queryKey: ['lists'] }),
        qc.invalidateQueries({ queryKey: ['related'] }),
      ]);
      toast.success('Título na estante.');
      onPick(result.id, result.isAnime ? 'anime' : item.kind);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="title-suggestions" aria-label="Parecidos com este título">
      <h3>Parecidos com este título</h3>
      <p className="muted-note">Sugestões do TMDB a partir de {data.title}.</p>
      {query.isPending ? (
        <p className="inline-loading" role="status">
          <Loader2 size={16} className="spin" /> Buscando títulos parecidos…
        </p>
      ) : query.error ? (
        <div className="stack">
          <p className="muted-note" role="status">
            Não foi possível carregar as sugestões agora.
          </p>
          <Button className="secondary" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : query.data?.results.length ? (
        <>
          {query.data.stale && (
            <p className="muted-note">Mostrando sugestões salvas enquanto o TMDB se recupera.</p>
          )}
          <ul className="title-suggestions-strip">
            {query.data.results.map((item) => (
              <li key={`${item.kind}:${item.tmdbId}`}>
                <button
                  className="title-suggestion"
                  disabled={busy !== null}
                  aria-label={
                    item.existingId ? `Abrir ${item.title}` : `Adicionar ${item.title} à estante`
                  }
                  onClick={() => void pick(item)}
                >
                  <Poster media={item} />
                  <strong>{item.title}</strong>
                  <small>
                    {item.existingId ? (
                      'Já na estante'
                    ) : (
                      <>
                        <Plus size={12} /> Adicionar
                      </>
                    )}
                  </small>
                  {busy === item.tmdbId && <Loader2 size={16} className="spin" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted-note">Ainda não há sugestões disponíveis para este título.</p>
      )}
    </section>
  );
}
