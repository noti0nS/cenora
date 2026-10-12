'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, ArrowRight, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogPage, CatalogResult } from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Modal, Field, Button, Segmented } from './ui';
import { Poster } from './poster';

export function CatalogSearch({
  initial = '',
  onSelect,
  catalogAvailable,
  kind,
}: {
  initial?: string;
  onSelect: (result: CatalogResult) => Promise<void> | void;
  catalogAvailable: boolean;
  kind?: 'movie' | 'tv';
}) {
  const [text, setText] = useState(initial),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [text]);
  const search = useQuery({
    queryKey: ['catalog', q, page],
    queryFn: () => api<CatalogPage>(`/media/search?q=${encodeURIComponent(q)}&page=${page}`),
    enabled: catalogAvailable && q.length >= 2,
  });
  const select = async (result: CatalogResult) => {
    setBusy(result.tmdbId);
    try {
      await onSelect(result);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const results = (search.data?.results || []).filter((r) => !kind || r.kind === kind);
  return (
    <div className="catalog-search">
      <div className="search-input">
        <Search size={17} />
        <input
          data-autofocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            kind === 'tv'
              ? 'Busque uma série ou anime'
              : kind === 'movie'
                ? 'Busque um filme'
                : 'Busque um filme, anime ou série'
          }
          aria-label="Buscar no catálogo"
        />
      </div>
      {!catalogAvailable ? (
        <p className="muted-note">
          A busca fica disponível quando o responsável conecta o catálogo TMDB. Enquanto isso, você
          pode adicionar manualmente.
        </p>
      ) : q.length < 2 ? (
        <p className="muted-note">Comece com um título. Confira o ano para escolher o certo.</p>
      ) : search.isPending ? (
        <p className="inline-loading">
          <Loader2 size={16} className="spin" />
          Procurando…
        </p>
      ) : search.error ? (
        <p role="alert" className="error-note">
          {errorMessage(search.error)}
        </p>
      ) : (
        <>
          <div className="catalog-results">
            {results.map((r) => (
              <button
                className="catalog-result"
                key={`${r.kind}:${r.tmdbId}`}
                disabled={busy !== null}
                onClick={() => select(r)}
              >
                <Poster media={r} />
                <span>
                  <strong>{r.title}</strong>
                  <small>
                    {r.year || 'Sem data'} · {r.kind === 'tv' ? 'Série' : 'Filme'}
                    {r.existingId ? ' · Já no clube' : ''}
                  </small>
                </span>
                {busy === r.tmdbId ? <Loader2 size={18} className="spin" /> : <Plus size={18} />}
              </button>
            ))}
          </div>
          {!results.length && (
            <p className="muted-note">
              Nenhum resultado por aqui. Tente outro nome ou adicione manualmente.
            </p>
          )}
          {(search.data?.totalPages || 0) > 1 && (
            <div className="pagination">
              <Button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <small>
                {page} / {search.data?.totalPages}
              </small>
              <Button
                className="secondary"
                disabled={page === (search.data?.totalPages || 0)}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function AddMedia({
  open,
  onClose,
  defaultKind,
  ensureList,
  catalogAvailable,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  defaultKind: 'movie' | 'tv';
  ensureList: () => Promise<string>;
  catalogAvailable: boolean;
  onAdded: (id: string, kind: 'movie' | 'tv') => void;
}) {
  const qc = useQueryClient();
  const [manual, setManual] = useState(false),
    [title, setTitle] = useState(''),
    [kind, setKind] = useState<'movie' | 'tv'>(defaultKind),
    [year, setYear] = useState(''),
    [synopsis, setSynopsis] = useState(''),
    [poster, setPoster] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setManual(!catalogAvailable);
      setTitle('');
      setKind(defaultKind);
      setYear('');
      setSynopsis('');
      setPoster('');
    }
  }, [open, defaultKind, catalogAvailable]);
  const added = async (id: string, addedKind: 'movie' | 'tv') => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['media'] }),
      qc.invalidateQueries({ queryKey: ['counts'] }),
      qc.invalidateQueries({ queryKey: ['lists'] }),
    ]);
    toast.success(addedKind === 'tv' ? 'Série na estante.' : 'Filme na estante.');
    onAdded(id, addedKind);
  };
  const select = async (r: CatalogResult) => {
    setBusy(true);
    try {
      if (r.existingId) {
        await added(r.existingId, r.kind);
        return;
      }
      const result = await api<{ id: string }>(
        '/media/catalog',
        json('POST', { tmdbId: r.tmdbId, kind: r.kind, listId: await ensureList() }),
      );
      await added(result.id, r.kind);
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ id: string }>(
        '/media/manual',
        json('POST', {
          title,
          kind,
          year: year ? Number(year) : null,
          synopsis,
          posterUrl: poster || null,
          listId: await ensureList(),
        }),
      );
      await added(result.id, kind);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Adicionar à estante"
      description="Encontre um filme ou uma série para guardar."
      className="add-modal"
    >
      <Segmented
        label="Tipo de título"
        value={kind}
        options={[
          { value: 'movie', label: 'Filme' },
          { value: 'tv', label: 'Série' },
        ]}
        onChange={setKind}
      />
      <div className="segmented">
        <button className={!manual ? 'selected' : ''} onClick={() => setManual(false)}>
          Buscar no catálogo
        </button>
        <button className={manual ? 'selected' : ''} onClick={() => setManual(true)}>
          Adicionar manualmente
        </button>
      </div>
      {manual ? (
        <form onSubmit={save} className="stack">
          <Field label="Título">
            <input
              data-autofocus
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="O nome do título"
            />
          </Field>
          <Field label="Ano · opcional">
            <input
              type="number"
              min={1888}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2026"
            />
          </Field>
          <details className="disclosure">
            <summary>Sinopse e pôster · opcionais</summary>
            <div className="stack">
              <Field label="Sinopse">
                <textarea
                  maxLength={4000}
                  rows={3}
                  value={synopsis}
                  onChange={(e) => setSynopsis(e.target.value)}
                />
              </Field>
              <Field label="Link do pôster">
                <input
                  type="url"
                  placeholder="https://…"
                  value={poster}
                  onChange={(e) => setPoster(e.target.value)}
                />
              </Field>
            </div>
          </details>
          <Button type="submit" busy={busy}>
            Guardar na estante
            <ArrowRight size={16} />
          </Button>
        </form>
      ) : (
        <CatalogSearch onSelect={select} catalogAvailable={catalogAvailable} kind={kind} />
      )}
    </Modal>
  );
}
