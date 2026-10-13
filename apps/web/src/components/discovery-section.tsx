'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogResult, Recommendations, ShelfKind } from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Button } from './ui';
import { Poster } from './poster';

export function DiscoverySection({
  kind,
  memberId,
  ensureList,
  onPick,
}: {
  kind: ShelfKind;
  memberId: string;
  ensureList: () => Promise<string>;
  onPick: (id: string, kind: ShelfKind) => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['media', 'discovery', memberId, kind],
    queryFn: () => api<Recommendations>(`/media/recommendations?kind=${kind}&discover=true`),
    enabled: expanded,
  });
  const add = async (item: CatalogResult) => {
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
    <section className="discovery-section" aria-label="Novidades para você">
      <button
        className="text-button discovery-toggle"
        aria-expanded={expanded}
        aria-controls={`discovery-${kind}`}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        {expanded ? 'Ocultar sugestões' : 'Ver sugestões de novos títulos'}
      </button>
      {expanded && (
        <div id={`discovery-${kind}`} className="discovery-content">
          {query.isPending ? (
            <p className="inline-loading" role="status">
              <Loader2 size={16} className="spin" /> Buscando sugestões…
            </p>
          ) : query.error ? (
            <div className="stack">
              <p className="muted-note" role="status">
                {errorMessage(query.error)}
              </p>
              <Button className="secondary" onClick={() => void query.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : !query.data?.catalogAvailable ? (
            <p className="muted-note">
              As sugestões ficam disponíveis quando o catálogo TMDB está conectado.
            </p>
          ) : query.data ? (
            <>
              <p className="muted-note">
                {query.data.personalized
                  ? 'Sugestões do TMDB a partir dos títulos que você bem avaliou.'
                  : 'Sugestões gerais do TMDB. Suas notas ajudam a personalizar as próximas.'}
              </p>
              {(query.data.degraded || query.data.stale) && (
                <p className="muted-note">
                  O TMDB está parcialmente indisponível; mostramos o que conseguimos recuperar.
                </p>
              )}
              <ul className="title-suggestions-strip">
                {query.data.discover.map((item) => (
                  <li key={`${item.kind}:${item.tmdbId}`}>
                    <button
                      className="title-suggestion"
                      aria-label={`Adicionar ${item.title} à estante`}
                      disabled={busy !== null}
                      onClick={() => void add(item)}
                    >
                      <Poster media={item} />
                      <strong>{item.title}</strong>
                      <small>
                        {busy === item.tmdbId ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <Plus size={12} />
                        )}{' '}
                        Adicionar
                      </small>
                      <span className="sr-only">{item.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!query.data.discover.length && (
                <p className="muted-note">
                  Nenhuma novidade disponível agora. Tente novamente mais tarde.
                </p>
              )}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
