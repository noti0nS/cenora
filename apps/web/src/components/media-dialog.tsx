'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Star, Plus, Check, Loader2, Link2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  personalLabels,
  groupLabels,
  type MediaDetails,
  type Watchlist,
  type PersonalStatus,
  type GroupStatus,
  type CatalogResult,
} from '@watchlist/shared';
import { api, json, score, errorMessage } from '@/lib/api';
import { Modal, Button, Field } from './ui';
import { Poster } from './poster';
import { CatalogSearch } from './add-media';

export function MediaDialog({
  id,
  lists,
  currentList,
  onClose,
  catalogAvailable,
}: {
  id: string | null;
  lists: Watchlist[];
  currentList: string | null;
  onClose: () => void;
  catalogAvailable: boolean;
}) {
  const query = useQuery({
    queryKey: ['detail', id],
    queryFn: () => api<MediaDetails>(`/media/${id}`),
    enabled: Boolean(id),
  });
  return (
    <Modal
      open={Boolean(id)}
      onClose={onClose}
      title={query.data?.title || 'Uma boa história'}
      className="details-modal"
    >
      <>
        {query.isPending ? (
          <div className="detail-loading">
            <Loader2 size={20} className="spin" />
            Abrindo a história…
          </div>
        ) : query.error ? (
          <div className="stack">
            <p role="alert" className="error-note">
              {errorMessage(query.error)}
            </p>
            <Button onClick={() => query.refetch()}>Tentar novamente</Button>
          </div>
        ) : (
          query.data && (
            <DetailsContent
              key={query.data.id}
              data={query.data}
              lists={lists}
              currentList={currentList}
              catalogAvailable={catalogAvailable}
              onClose={onClose}
            />
          )
        )}
      </>
    </Modal>
  );
}
function DetailsContent({
  data,
  lists,
  currentList,
  catalogAvailable,
  onClose,
}: {
  data: MediaDetails;
  lists: Watchlist[];
  currentList: string | null;
  catalogAvailable: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'personal' | 'group'>('personal'),
    [status, setStatus] = useState<string>(data.personal?.status || 'want'),
    [rating, setRating] = useState(
      data.personal?.rating == null ? '' : String(data.personal.rating),
    ),
    [season, setSeason] = useState(''),
    [episode, setEpisode] = useState(''),
    [personId, setPersonId] = useState<number | null>(null),
    [linking, setLinking] = useState(false),
    [editing, setEditing] = useState(false),
    [remove, setRemove] = useState(false);
  useEffect(() => {
    setStatus(mode === 'personal' ? data.personal?.status || 'want' : data.groupStatus);
    setRating(data.personal?.rating == null ? '' : String(data.personal.rating));
    setSeason(String((mode === 'personal' ? data.personal?.season : data.groupSeason) || ''));
    setEpisode(String((mode === 'personal' ? data.personal?.episode : data.groupEpisode) || ''));
  }, [mode, data.personal?.revision, data.revision]);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['detail', data.id] }),
      qc.invalidateQueries({ queryKey: ['media'] }),
      qc.invalidateQueries({ queryKey: ['lists'] }),
    ]);
  const update = useMutation({
    mutationFn: () =>
      api(
        `/media/${data.id}/${mode}`,
        json('PUT', {
          status,
          season: season ? Number(season) : null,
          episode: episode ? Number(episode) : null,
          ...(mode === 'personal'
            ? {
                rating: rating === '' ? null : Number(rating),
                revision: data.personal?.revision || 0,
              }
            : { revision: data.revision }),
        }),
      ),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['detail', data.id] });
      const previous = qc.getQueryData<MediaDetails>(['detail', data.id]);
      qc.setQueryData<MediaDetails>(['detail', data.id], (old) =>
        old
          ? {
              ...old,
              ...(mode === 'personal'
                ? {
                    personal: {
                      status: status as PersonalStatus,
                      rating: rating === '' ? null : Number(rating),
                      season: season ? Number(season) : null,
                      episode: episode ? Number(episode) : null,
                      revision: old.personal?.revision || 0,
                    },
                  }
                : {
                    groupStatus: status as GroupStatus,
                    groupSeason: season ? Number(season) : null,
                    groupEpisode: episode ? Number(episode) : null,
                  }),
            }
          : old,
      );
      return { previous };
    },
    onError: (e, _, context) => {
      if (context?.previous) qc.setQueryData(['detail', data.id], context.previous);
      toast.error(errorMessage(e));
    },
    onSuccess: () =>
      toast.success(
        mode === 'personal' ? 'Seu progresso foi guardado.' : 'O grupo está atualizado.',
      ),
    onSettled: refresh,
  });
  const link = async (r: CatalogResult) => {
    await api(
      `/media/${data.id}/link`,
      json('POST', { tmdbId: r.tmdbId, kind: r.kind, revision: data.revision }),
    );
    setLinking(false);
    await refresh();
    toast.success('Título conectado ao catálogo. Suas notas continuam aqui.');
  };
  const addTo = async (listId: string) => {
    try {
      await api(`/club/lists/${listId}/items`, json('POST', { mediaId: data.id }));
      await refresh();
      toast.success('Título adicionado à lista.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const removeFromList = async () => {
    try {
      await api(`/club/lists/${currentList}/items/${data.id}`, json('DELETE'));
      await refresh();
      onClose();
      toast.success('Título removido desta lista.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <div className="detail-layout">
        <Poster media={data} className="detail-poster" />
        <div className="detail-copy">
          <p className="detail-meta">
            {data.kind === 'tv' ? 'Série' : 'Filme'}
            {data.year && ` · ${data.year}`}
            {data.runtime && ` · ${data.runtime} min`}
          </p>
          {data.genres.length > 0 && (
            <p className="detail-genres">{data.genres.slice(0, 3).join(' / ')}</p>
          )}
          <p className="synopsis">
            {data.synopsis || 'Ainda não temos uma sinopse. O título já está guardado na lista.'}
          </p>
          <div className="scores">
            <div>
              <span>
                <Star size={12} />O grupo
              </span>
              <strong>
                {score(data.average)}
                <small>/10</small>
              </strong>
            </div>
            {data.tmdbRating != null && (
              <div>
                <span>TMDB</span>
                <strong>
                  {score(data.tmdbRating)}
                  <small>/10</small>
                </strong>
              </div>
            )}
            {data.imdbRating != null && (
              <div>
                <span>IMDb</span>
                <strong>
                  {score(data.imdbRating)}
                  <small>/10</small>
                </strong>
              </div>
            )}
          </div>
          {data.ratingCount > 0 && (
            <details className="ratings-disclosure">
              <summary>
                {data.ratingCount}{' '}
                {data.ratingCount === 1 ? 'amigo deu uma nota' : 'amigos deram uma nota'}
              </summary>
              <div className="friend-ratings">
                {data.ratings.map((r) => (
                  <div key={r.memberId}>
                    <span className="small-avatar">{r.name.charAt(0)}</span>
                    <span>{r.name}</span>
                    <strong>{score(r.rating)}</strong>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
      <section className="tracking-section" aria-label="Progresso">
        <div className="segmented">
          <button
            className={mode === 'personal' ? 'selected' : ''}
            onClick={() => setMode('personal')}
            disabled={update.isPending}
          >
            Você
          </button>
          <button
            className={mode === 'group' ? 'selected' : ''}
            onClick={() => setMode('group')}
            disabled={update.isPending}
          >
            O grupo
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if ((season === '') !== (episode === '')) {
              toast.error('Informe temporada e episódio juntos.');
              return;
            }
            update.mutate();
          }}
        >
          <div className="tracking-controls">
            <Field label={mode === 'personal' ? 'Meu progresso' : 'Nosso progresso'}>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={update.isPending}
              >
                {Object.entries(mode === 'personal' ? personalLabels : groupLabels).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </Field>
            {mode === 'personal' && (
              <Field label="Minha nota · /10">
                <div className="rating-input">
                  <input
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    placeholder="—"
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                    disabled={update.isPending}
                  />
                  {rating && (
                    <button type="button" className="text-button" onClick={() => setRating('')}>
                      Limpar
                    </button>
                  )}
                </div>
              </Field>
            )}
          </div>
          {data.kind === 'tv' && (
            <div className="checkpoint">
              <span>Parei em</span>
              <label>
                Temporada
                <input
                  type="number"
                  min={1}
                  max={999}
                  placeholder="—"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  disabled={update.isPending}
                />
              </label>
              <label>
                Episódio
                <input
                  type="number"
                  min={1}
                  max={9999}
                  placeholder="—"
                  value={episode}
                  onChange={(e) => setEpisode(e.target.value)}
                  disabled={update.isPending}
                />
              </label>
            </div>
          )}
          <Button type="submit" className="save-progress" busy={update.isPending}>
            {mode === 'personal' ? 'Guardar meu progresso' : 'Atualizar o grupo'}
            <Check size={15} />
          </Button>
        </form>
      </section>
      {data.availability.subscription.length +
        data.availability.rent.length +
        data.availability.buy.length >
      0 ? (
        <section className="providers-section">
          <h3>
            Onde assistir <small>Brasil</small>
          </h3>
          {(
            [
              ['subscription', 'Assinatura'],
              ['rent', 'Alugar'],
              ['buy', 'Comprar'],
            ] as const
          ).map(
            ([key, label]) =>
              data.availability[key].length > 0 && (
                <div className="provider-row" key={key}>
                  <span>{label}</span>
                  <div>
                    {data.availability[key].map((p) => (
                      <span className="provider" key={p.id}>
                        {p.logo && <img src={p.logo} alt="" width={24} height={24} />}
                        <span>{p.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ),
          )}
          {data.availability.link && (
            <a
              className="text-button"
              href={data.availability.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver opções de streaming
              <ExternalLink size={13} />
            </a>
          )}
          <p className="attribution">Disponibilidade por JustWatch · pode mudar.</p>
        </section>
      ) : data.tmdbId ? (
        <p className="muted-note availability-empty">
          {data.stale
            ? 'Não foi possível atualizar o streaming agora.'
            : 'Ainda não encontramos opções de streaming no Brasil.'}
        </p>
      ) : null}
      {data.cast.length > 0 && (
        <details className="disclosure cast-section">
          <summary>Quem conta essa história</summary>
          <div className="cast-list">
            {data.cast.map((p) => (
              <button key={p.id} onClick={() => setPersonId(p.id)}>
                {p.photo ? (
                  <img src={p.photo} alt="" />
                ) : (
                  <span className="small-avatar">{p.name.charAt(0)}</span>
                )}
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.character}</small>
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
      <details className="disclosure list-membership">
        <summary>Listas e opções</summary>
        <div className="membership-options">
          {lists.map((l) => (
            <button
              key={l.id}
              disabled={data.lists.includes(l.id)}
              onClick={() => addTo(l.id)}
              className="secondary button"
            >
              {data.lists.includes(l.id) ? <Check size={14} /> : <Plus size={14} />} {l.name}
            </button>
          ))}
        </div>
        {!data.tmdbId && (
          <div className="manual-options">
            <button className="text-button" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Editar informações
            </button>
            <button className="text-button" onClick={() => setLinking(true)}>
              <Link2 size={14} />
              Conectar ao catálogo
            </button>
          </div>
        )}
        {currentList &&
          (remove ? (
            <div className="confirm-box">
              <p>Remover desta lista? As notas e o progresso serão preservados.</p>
              <Button className="danger-button" onClick={removeFromList}>
                Remover
              </Button>
              <button className="text-button" onClick={() => setRemove(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button className="text-button danger" onClick={() => setRemove(true)}>
              <Trash2 size={14} />
              Remover desta lista
            </button>
          ))}
      </details>
      <Modal
        open={linking}
        onClose={() => setLinking(false)}
        title="Encontre a história certa"
        description="O vínculo preserva as notas e o progresso."
        className="add-modal"
      >
        <CatalogSearch
          initial={data.title}
          kind={data.kind}
          catalogAvailable={catalogAvailable}
          onSelect={link}
        />
      </Modal>
      <ManualEditor
        data={data}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={refresh}
      />
      <PersonDialog id={personId} onClose={() => setPersonId(null)} />
    </>
  );
}
function ManualEditor({
  data,
  open,
  onClose,
  onSaved,
}: {
  data: MediaDetails;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState(data.title),
    [year, setYear] = useState(String(data.year || '')),
    [synopsis, setSynopsis] = useState(data.synopsis),
    [poster, setPoster] = useState(data.posterUrl || ''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle(data.title);
      setYear(String(data.year || ''));
      setSynopsis(data.synopsis);
      setPoster(data.posterUrl || '');
    }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        `/media/${data.id}/manual`,
        json('PATCH', {
          title,
          year: year ? Number(year) : null,
          synopsis,
          posterUrl: poster || null,
          revision: data.revision,
        }),
      );
      await onSaved();
      onClose();
      toast.success('Informações salvas.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Um pouco sobre a história">
      <form onSubmit={save} className="stack">
        <Field label="Título">
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Ano">
          <input
            type="number"
            min={1888}
            max={2100}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </Field>
        <Field label="Sinopse">
          <textarea
            rows={4}
            maxLength={4000}
            value={synopsis}
            onChange={(e) => setSynopsis(e.target.value)}
          />
        </Field>
        <Field label="Link do pôster">
          <input type="url" value={poster} onChange={(e) => setPoster(e.target.value)} />
        </Field>
        <Button type="submit" busy={busy}>
          Salvar informações
        </Button>
      </form>
    </Modal>
  );
}
function PersonDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['person', id],
    queryFn: () =>
      api<{ name: string; biography: string; photo: string | null }>(`/media/person/${id}`),
    enabled: Boolean(id),
  });
  return (
    <Modal open={Boolean(id)} onClose={onClose} title={query.data?.name || 'Quem conta a história'}>
      {query.isPending ? (
        <p className="inline-loading">
          <Loader2 className="spin" size={16} />
          Carregando…
        </p>
      ) : query.error ? (
        <p role="alert" className="error-note">
          {errorMessage(query.error)}
        </p>
      ) : (
        <div className="biography">
          {query.data?.photo && <img src={query.data.photo} alt="" />}
          <p>{query.data?.biography}</p>
        </div>
      )}
    </Modal>
  );
}
