'use client';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ArrowRight } from 'lucide-react';
import type { Recommendations, ShelfKind } from '@cenora/shared';
import { api, errorMessage } from '@/lib/api';
import { Modal, Button } from './ui';
import { Poster } from './poster';

function RecommendationBody({
  kind,
  mine,
  memberId,
  onPick,
}: {
  kind: ShelfKind;
  mine: boolean;
  memberId: string;
  onPick: (id: string, kind: ShelfKind) => void;
}) {
  const query = useQuery({
    queryKey: ['media', 'recommendations', memberId, kind, mine],
    queryFn: () => api<Recommendations>(`/media/recommendations?kind=${kind}&mine=${mine}`),
  });
  return (
    <div className="stack">
      {query.isPending ? (
        <p className="inline-loading" role="status">
          <Loader2 size={16} className="spin" /> Preparando escolhas…
        </p>
      ) : query.error ? (
        <div role="alert" className="stack">
          <p className="error-note">{errorMessage(query.error)}</p>
          <Button className="secondary" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : query.data ? (
        <>
          {(query.data.degraded || query.data.stale) && (
            <p className="muted-note">
              O TMDB está indisponível. Usamos sugestões salvas ou sua fila e as notas do clube.
            </p>
          )}
          <ul className="recommendation-results" aria-label="Sugestões da estante">
            {query.data.shelf.map((item) => (
              <li key={item.id}>
                <button className="catalog-result" onClick={() => onPick(item.id, kind)}>
                  <Poster media={item} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.year ?? 'Sem data'}</small>
                    <small>{item.reason}</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              </li>
            ))}
          </ul>
          {!query.data.shelf.length && (
            <p className="muted-note">
              Nenhum título elegível por aqui. Adicione mais títulos à estante.
            </p>
          )}
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
  onPick: (id: string, kind: ShelfKind) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="O que assistir"
      description={
        props.mine
          ? 'Escolhas da sua fila, sem títulos que você terminou ou abandonou.'
          : 'Escolhas da estante que você e o grupo ainda não terminaram.'
      }
      className="add-modal"
    >
      <RecommendationBody {...props} />
    </Modal>
  );
}
