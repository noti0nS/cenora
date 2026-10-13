'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogResult, Recommendations, ShelfKind } from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Modal, Button, Segmented } from './ui';
import { Poster } from './poster';

function RecommendationBody({
  kind,
  mine,
  memberId,
  ensureList,
  onPick,
  onBusyChange,
}: {
  kind: ShelfKind;
  mine: boolean;
  memberId: string;
  ensureList: () => Promise<string>;
  onPick: (id: string, kind: ShelfKind) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<'shelf' | 'discover'>('shelf');
  const [busy, setBusy] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['media', 'recommendations', memberId, kind, mine],
    queryFn: () => api<Recommendations>(`/media/recommendations?kind=${kind}&mine=${mine}`),
  });
  const add = async (item: CatalogResult) => {
    setBusy(item.tmdbId);
    onBusyChange(true);
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
      onBusyChange(false);
    }
  };
  const data = query.data;
  return (
    <div className="stack">
      <Segmented
        label="Origem das recomendações"
        value={view}
        onChange={setView}
        options={[
          { value: 'shelf', label: 'Da estante' },
          { value: 'discover', label: 'Descobrir novidades' },
        ]}
      />
      <p className="muted-note">
        {view === 'shelf'
          ? mine
            ? 'Escolhas da sua fila. Títulos que você terminou ou abandonou ficam de fora.'
            : 'Escolhas do clube que você e o grupo ainda não terminaram.'
          : 'Novos títulos para guardar no clube, sem repetir os que já estão na estante.'}
      </p>
      {query.isPending ? (
        <p className="inline-loading" role="status">
          <Loader2 size={16} className="spin" /> Preparando sugestões…
        </p>
      ) : query.error ? (
        <div role="alert" className="stack">
          <p className="error-note">{errorMessage(query.error)}</p>
          <Button className="secondary" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : data ? (
        <>
          {!data.catalogAvailable ? (
            <p className="muted-note" role="status">
              Conecte o catálogo TMDB para descobrir novidades. A estante usa sua fila e as notas do
              clube enquanto isso.
            </p>
          ) : data.degraded || data.stale ? (
            <p className="muted-note" role="status">
              O TMDB está parcialmente indisponível. Usamos sugestões salvas ou sua fila e as notas
              do clube.
            </p>
          ) : !data.personalized ? (
            <p className="muted-note">
              As sugestões do TMDB são gerais por enquanto. Avalie títulos do catálogo com nota 7 ou
              mais para receber indicações baseadas no seu gosto.
            </p>
          ) : null}
          <ul
            className="recommendation-results"
            aria-label={view === 'shelf' ? 'Sugestões da estante' : 'Novidades do TMDB'}
          >
            {view === 'shelf'
              ? data.shelf.map((item) => (
                  <li key={item.id}>
                    <button className="catalog-result" onClick={() => onPick(item.id, kind)}>
                      <Poster media={item} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.year ?? 'Sem data'}</small>
                        <small className="recommendation-reason">{item.reason}</small>
                      </span>
                      <ArrowRight size={18} />
                    </button>
                  </li>
                ))
              : data.discover.map((item) => (
                  <li key={`${item.kind}:${item.tmdbId}`}>
                    <button
                      className="catalog-result"
                      aria-label={`Adicionar ${item.title} à estante`}
                      disabled={busy !== null}
                      onClick={() => void add(item)}
                    >
                      <Poster media={item} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.year ?? 'Sem data'}</small>
                        <small className="recommendation-reason">{item.reason}</small>
                      </span>
                      {busy === item.tmdbId ? (
                        <Loader2 size={18} className="spin" />
                      ) : (
                        <Plus size={18} />
                      )}
                    </button>
                  </li>
                ))}
          </ul>
          {!data[view].length && (
            <p className="muted-note" role="status">
              {view === 'shelf'
                ? 'Nenhum título elegível por aqui. Adicione mais títulos ou descubra novidades.'
                : 'Nenhuma novidade disponível agora. Experimente avaliar outros títulos ou tente mais tarde.'}
            </p>
          )}
          <Button
            className="secondary"
            busy={query.isFetching}
            disabled={busy !== null}
            onClick={() => void query.refetch()}
          >
            Atualizar sugestões
          </Button>
          <small className="muted-note">
            Sugestões de catálogo por TMDB. Este produto usa a API TMDB, mas não é endossado ou
            certificado pelo TMDB.
          </small>
        </>
      ) : null}
    </div>
  );
}

export function RecommendationsDialog({
  open,
  onClose,
  ...props
}: {
  open: boolean;
  onClose: () => void;
  kind: ShelfKind;
  mine: boolean;
  memberId: string;
  ensureList: () => Promise<string>;
  onPick: (id: string, kind: ShelfKind) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Recomendações"
      description={`Sugestões de ${props.kind === 'movie' ? 'filmes' : props.kind === 'anime' ? 'animes' : 'séries'} para você, da estante e do TMDB.`}
      className="add-modal"
    >
      <RecommendationBody {...props} onBusyChange={setBusy} />
    </Modal>
  );
}
