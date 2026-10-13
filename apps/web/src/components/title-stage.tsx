'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { ExternalLink, Link2, Loader2, Pencil, Share2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogResult, Media, MediaDetails } from '@cenora/shared';
import { api, json, score, errorMessage } from '@/lib/api';
import { useTitleTracking } from './use-title-tracking';
import { Modal, Button } from './ui';
import { Poster } from './poster';
import { CatalogSearch } from './add-media';
import { MovieSession } from './movie-session';
import { ShowTracker } from './show-tracker';
import { ManualEditor, PersonDialog } from './title-tools';
import { ShareSheet } from './share-sheet';

export function TitleStage({
  id,
  preview,
  onClose,
  catalogAvailable,
  clubName,
  canRemove,
}: {
  id: string | null;
  preview: Media | null;
  onClose: () => void;
  catalogAvailable: boolean;
  clubName: string | null;
  canRemove: boolean;
}) {
  const query = useQuery({
    queryKey: ['detail', id],
    queryFn: () => api<MediaDetails>(`/media/${id}`),
    enabled: Boolean(id),
  });
  const [lastTitle, setLastTitle] = useState('Título');
  const title = query.data?.title || preview?.title || lastTitle;
  useEffect(() => {
    if (title !== 'Título') setLastTitle(title);
  }, [title]);
  const shown = query.data || preview;
  return (
    <Dialog.Root open={Boolean(id)} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {id && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div
                className="stage-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <m.div
                className="stage"
                initial={{ opacity: 0, y: 36 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              >
                {shown?.posterUrl && (
                  <div className="stage-backdrop" aria-hidden="true">
                    <img src={shown.posterUrl} alt="" />
                  </div>
                )}
                <Dialog.Close className="stage-close" aria-label="Fechar">
                  <X size={20} />
                </Dialog.Close>
                <div className="stage-scroll">
                  <Dialog.Title className="sr-only">{title}</Dialog.Title>
                  <Dialog.Description className="sr-only">
                    Detalhes e progresso de {title}
                  </Dialog.Description>
                  {query.error ? (
                    <div className="stage-error">
                      <p role="alert" className="error-note">
                        {errorMessage(query.error)}
                      </p>
                      <Button onClick={() => query.refetch()}>Tentar novamente</Button>
                    </div>
                  ) : (
                    <div className="stage-grid">
                      <aside className="stage-poster">
                        {shown && (
                          // Keep the stage independent of shelf reordering after tracking saves.
                          <Poster media={shown} className="stage-poster-art" />
                        )}
                      </aside>
                      <div className="stage-main">
                        {query.data ? (
                          <Loaded
                            key={query.data.id}
                            data={query.data}
                            catalogAvailable={catalogAvailable}
                            clubName={clubName}
                            canRemove={canRemove}
                            onRemoved={onClose}
                          />
                        ) : (
                          <Pending title={title} kind={preview?.kind} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
function Pending({ title, kind }: { title: string; kind?: 'movie' | 'tv' }) {
  return (
    <>
      <p className="kind-tag">
        {kind === 'tv' ? 'Série' : kind === 'movie' ? 'Filme' : 'Carregando'}
      </p>
      <h2 className="stage-title" aria-hidden="true">
        {title}
      </h2>
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
      <p className="inline-loading">
        <Loader2 size={16} className="spin" />
        Abrindo…
      </p>
    </>
  );
}
function ShareButton({ data, clubName }: { data: MediaDetails; clubName: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-button share-button" onClick={() => setOpen(true)}>
        <Share2 size={14} />
        Compartilhar
      </button>
      <ShareSheet
        open={open}
        onClose={() => setOpen(false)}
        card={{
          title: data.title,
          kind: data.kind,
          year: data.year,
          posterUrl: data.posterUrl,
          clubName,
          clubRating: data.average,
          myRating: data.personal?.rating ?? null,
        }}
      />
    </>
  );
}
function Loaded({
  data,
  catalogAvailable,
  clubName,
  canRemove,
  onRemoved,
}: {
  data: MediaDetails;
  catalogAvailable: boolean;
  clubName: string | null;
  canRemove: boolean;
  onRemoved: () => void;
}) {
  const qc = useQueryClient();
  const tracking = useTitleTracking(data);
  const [personId, setPersonId] = useState<number | null>(null),
    [linking, setLinking] = useState(false),
    [editing, setEditing] = useState(false),
    [confirmRemoval, setConfirmRemoval] = useState(false),
    [removing, setRemoving] = useState(false);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['detail', data.id] }),
      qc.invalidateQueries({ queryKey: ['media'] }),
    ]);
  const link = async (r: CatalogResult) => {
    await api(
      `/media/${data.id}/link`,
      json('POST', { tmdbId: r.tmdbId, kind: r.kind, revision: data.revision }),
    );
    setLinking(false);
    await refresh();
    toast.success('Título conectado ao catálogo. Suas notas continuam aqui.');
  };
  const remove = async () => {
    setRemoving(true);
    try {
      await api(`/media/${data.id}`, json('DELETE', { revision: data.revision }));
    } catch (error) {
      toast.error(errorMessage(error));
      setRemoving(false);
      setConfirmRemoval(false);
      void refresh();
      return;
    }
    await qc.cancelQueries({ queryKey: ['detail', data.id] });
    setConfirmRemoval(false);
    onRemoved();
    qc.removeQueries({ queryKey: ['detail', data.id] });
    void qc.invalidateQueries({ queryKey: ['media'] });
    void qc.invalidateQueries({ queryKey: ['counts'] });
    void qc.invalidateQueries({ queryKey: ['lists'] });
    toast.success('Título removido da estante.');
  };
  const isTv = data.kind === 'tv';
  const episodeCount = data.seasons.reduce((n, s) => n + s.episodes, 0);
  const providers = data.availability;
  const hasProviders =
    providers.subscription.length + providers.rent.length + providers.buy.length > 0;
  return (
    <>
      <div className="stage-head">
        <p className="kind-tag">
          {isTv ? 'Série' : 'Filme'}
          {data.year && ` · ${data.year}`}
          {!isTv && data.runtime ? ` · ${data.runtime} min` : ''}
          {isTv && data.seasons.length > 0
            ? ` · ${data.seasons.length} ${data.seasons.length === 1 ? 'temporada' : 'temporadas'} · ${episodeCount} episódios`
            : ''}
        </p>
        <div className="stage-head-end">
          <ShareButton data={data} clubName={clubName} />
          {canRemove && (
            <button
              type="button"
              className="text-button danger"
              disabled={tracking.saving || removing}
              onClick={() => setConfirmRemoval(true)}
            >
              <Trash2 size={14} />
              Remover da estante
            </button>
          )}
        </div>
      </div>
      <m.h2
        className="stage-title"
        aria-hidden="true"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        {data.title}
      </m.h2>
      {data.genres.length > 0 && (
        <p className="genre-row">
          {data.genres.slice(0, 4).map((genre) => (
            <span key={genre}>{genre}</span>
          ))}
        </p>
      )}
      <p className="synopsis">
        {data.synopsis || 'Ainda não temos uma sinopse. O título já está guardado.'}
      </p>
      <div className="scores" aria-label="Notas">
        {data.average != null && (
          <div>
            <span>O grupo</span>
            <strong>
              {score(data.average)}
              <small>/10</small>
            </strong>
          </div>
        )}
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
      {isTv ? (
        <ShowTracker data={data} tracking={tracking} />
      ) : (
        <MovieSession data={data} tracking={tracking} />
      )}
      {hasProviders ? (
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
              providers[key].length > 0 && (
                <div className="provider-row" key={key}>
                  <span>{label}</span>
                  <div>
                    {providers[key].map((p) => (
                      <span className="provider" key={p.id}>
                        {p.logo && <img src={p.logo} alt="" width={24} height={24} />}
                        <span>{p.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ),
          )}
          {providers.link && (
            <a
              className="text-button"
              href={providers.link}
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
        <section className="cast-section">
          <h3>Elenco</h3>
          <div className="cast-strip">
            {data.cast.map((p) => (
              <button key={p.id} type="button" onClick={() => setPersonId(p.id)}>
                {p.photo ? (
                  <img src={p.photo} alt="" />
                ) : (
                  <span className="small-avatar">{p.name.charAt(0)}</span>
                )}
                <strong>{p.name}</strong>
                <small>{p.character}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      {!data.tmdbId && (
        <div className="manual-options">
          <button className="text-button" onClick={() => setEditing(true)}>
            <Pencil size={14} />
            Editar informações
          </button>
          {catalogAvailable && (
            <button className="text-button" onClick={() => setLinking(true)}>
              <Link2 size={14} />
              Conectar ao catálogo
            </button>
          )}
        </div>
      )}
      <Modal
        open={confirmRemoval}
        onClose={() => !removing && setConfirmRemoval(false)}
        title="Remover da estante?"
        description={`“${data.title}” será removido para todo o clube, junto com as notas e o progresso de todos. Esta ação não pode ser desfeita.`}
      >
        <div className="stack">
          <Button
            className="secondary"
            disabled={removing}
            data-autofocus
            onClick={() => setConfirmRemoval(false)}
          >
            Cancelar
          </Button>
          <Button
            className="secondary danger"
            busy={removing}
            disabled={tracking.saving}
            onClick={remove}
          >
            <Trash2 size={16} />
            Remover definitivamente
          </Button>
        </div>
      </Modal>
      <Modal
        open={linking}
        onClose={() => setLinking(false)}
        title="Conectar ao catálogo"
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
