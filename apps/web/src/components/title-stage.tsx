'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { ExternalLink, Link2, Loader2, Pencil, X, Check } from 'lucide-react';
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

function SaveBadge({ saving }: { saving: boolean }) {
  const [saved, setSaved] = useState(false);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (saving) {
      wasSaving.current = true;
      setSaved(false);
      return;
    }
    if (!wasSaving.current) return;
    wasSaving.current = false;
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [saving]);
  return (
    <span className="save-badge" role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {saving ? (
          <m.span
            key="saving"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Loader2 size={12} className="spin" />
            Salvando
          </m.span>
        ) : saved ? (
          <m.span
            key="saved"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Check size={12} />
            Salvo
          </m.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
export function TitleStage({
  id,
  preview,
  onClose,
  catalogAvailable,
}: {
  id: string | null;
  preview: Media | null;
  onClose: () => void;
  catalogAvailable: boolean;
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
                          <Poster
                            media={shown}
                            layoutId={`poster-${id}`}
                            className="stage-poster-art"
                          />
                        )}
                      </aside>
                      <div className="stage-main">
                        {query.data ? (
                          <Loaded
                            key={query.data.id}
                            data={query.data}
                            catalogAvailable={catalogAvailable}
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
function Loaded({ data, catalogAvailable }: { data: MediaDetails; catalogAvailable: boolean }) {
  const qc = useQueryClient();
  const tracking = useTitleTracking(data);
  const [personId, setPersonId] = useState<number | null>(null),
    [linking, setLinking] = useState(false),
    [editing, setEditing] = useState(false);
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
        <SaveBadge saving={tracking.saving} />
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
