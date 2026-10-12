'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Check, Split, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import type { ImportEntry, CatalogResult } from '@watchlist/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Modal, Button, Field } from './ui';
import { CatalogSearch } from './add-media';
type Draft = ImportEntry & { checked: boolean; key: number };
export function ImportDialog({
  open,
  onClose,
  catalogAvailable,
}: {
  open: boolean;
  onClose: () => void;
  catalogAvailable: boolean;
}) {
  const qc = useQueryClient();
  const preset = useQuery({
    queryKey: ['importPreset'],
    queryFn: () => api<ImportEntry[]>('/club/import-preset'),
    enabled: open,
    staleTime: Infinity,
  });
  const presetDraft = () =>
    (preset.data || []).map((entry, key) => ({
      ...entry,
      originalTitle: entry.title,
      key,
      checked: true,
    }));
  const [entries, setEntries] = useState<Draft[]>([]),
    [mode, setMode] = useState<'screenshots' | 'paste'>('screenshots'),
    [paste, setPaste] = useState(''),
    [category, setCategory] = useState('Filmes'),
    [kind, setKind] = useState<'movie' | 'tv'>('movie'),
    [match, setMatch] = useState<number | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setEntries(presetDraft());
      setConfirmed(false);
      setError('');
      setProgress(0);
      setMode('screenshots');
    }
  }, [open]);
  useEffect(() => {
    if (open && mode === 'screenshots' && preset.data) {
      setEntries((previous) => (previous.length ? previous : presetDraft()));
    }
  }, [open, mode, preset.data]);
  const selected = entries.filter((e) => e.checked);
  const active = entries.find((e) => e.key === match);
  const patch = (key: number, values: Partial<Draft>) => {
    setEntries((old) => old.map((e) => (e.key === key ? { ...e, ...values } : e)));
    setConfirmed(false);
  };
  const split = () => {
    setEntries((old) =>
      old.flatMap((e) =>
        e.title === 'Zootopia 1 e 2'
          ? [
              { ...e, title: 'Zootopia' },
              { ...e, key: Date.now(), title: 'Zootopia 2' },
            ]
          : [e],
      ),
    );
    setConfirmed(false);
  };
  const preview = () => {
    const lines = paste
      .split(/\r?\n/)
      .map((s) => s.replace(/^\s*[-•\d.)]+\s*/, '').trim())
      .filter(Boolean);
    const unique = [...new Set(lines)];
    if (!unique.length) {
      toast.error('Cole pelo menos um título.');
      return;
    }
    if (unique.length > 100) {
      toast.error('Use até 100 títulos por importação.');
      return;
    }
    setEntries(
      unique.map((title, key) => ({
        title,
        originalTitle: title,
        kind,
        category,
        key,
        checked: true,
      })),
    );
    setConfirmed(false);
  };
  const choose = (r: CatalogResult) => {
    if (match !== null) patch(match, { title: r.title, kind: r.kind, tmdbId: r.tmdbId });
    setMatch(null);
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      for (let i = 0; i < selected.length; i += 3) {
        await api(
          '/club/import',
          json('POST', {
            entries: selected
              .slice(i, i + 3)
              .map(({ title, originalTitle, kind, category, tmdbId }) => ({
                title,
                originalTitle,
                kind,
                category,
                ...(tmdbId ? { tmdbId } : {}),
              })),
          }),
        );
        setProgress(Math.min(i + 3, selected.length));
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['lists'] }),
        qc.invalidateQueries({ queryKey: ['media'] }),
      ]);
      toast.success('As histórias do documento chegaram.');
      onClose();
    } catch (e) {
      setError(
        `${errorMessage(e)} Os títulos já importados estão salvos. Você pode tentar novamente sem duplicá-los.`,
      );
      await qc.invalidateQueries({ queryKey: ['media'] });
      await qc.invalidateQueries({ queryKey: ['lists'] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Do documento para cá"
      description="Revise os títulos antes de guardar. Nenhuma nota ou progresso existente será alterado."
      className="import-modal"
    >
      <div className="segmented">
        <button
          className={mode === 'screenshots' ? 'selected' : ''}
          disabled={busy}
          onClick={() => {
            setMode('screenshots');
            setEntries(presetDraft());
            setConfirmed(false);
          }}
        >
          Nossa lista original
        </button>
        <button
          className={mode === 'paste' ? 'selected' : ''}
          disabled={busy}
          onClick={() => setMode('paste')}
        >
          Colar outra lista
        </button>
      </div>
      {mode === 'paste' && (
        <div className="stack paste-form">
          <Field label="Um título por linha">
            <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} />
          </Field>
          <div className="form-row">
            <Field label="Lista de destino">
              <input
                maxLength={60}
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </Field>
            <Field label="Tipo">
              <select value={kind} onChange={(e) => setKind(e.target.value as 'movie' | 'tv')}>
                <option value="movie">Filmes</option>
                <option value="tv">Séries / animes</option>
              </select>
            </Field>
          </div>
          <Button className="secondary" onClick={preview} disabled={busy || !category.trim()}>
            <ClipboardList size={15} />
            Revisar títulos
          </Button>
        </div>
      )}
      {mode === 'screenshots' && (
        <div className="import-note">
          <p>
            O Pecadores repetido já foi reunido. Confira remakes e nomes parecidos. A saga Toy Story
            fica como um título manual até você escolher os filmes.
          </p>
          {entries.some((e) => e.title === 'Zootopia 1 e 2') && (
            <button className="text-button" onClick={split} disabled={busy}>
              <Split size={14} />
              Separar Zootopia 1 e 2
            </button>
          )}
        </div>
      )}
      {mode === 'screenshots' && preset.isPending && (
        <p className="muted-note" role="status">
          Carregando os títulos do documento…
        </p>
      )}
      {mode === 'screenshots' && preset.error && (
        <div className="stack">
          <p className="error-note" role="alert">
            {errorMessage(preset.error)}
          </p>
          <Button className="secondary" onClick={() => preset.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      <div className="import-list">
        {entries.map((entry) => (
          <div className="import-row" key={entry.key}>
            <input
              type="checkbox"
              aria-label={`Importar ${entry.title}`}
              checked={entry.checked}
              disabled={busy}
              onChange={(e) => patch(entry.key, { checked: e.target.checked })}
            />
            <div>
              <input
                aria-label={`Título ${entry.key + 1}`}
                value={entry.title}
                maxLength={200}
                disabled={busy}
                onChange={(e) => patch(entry.key, { title: e.target.value, tmdbId: undefined })}
              />
              <small>
                {entry.category} · {entry.tmdbId ? 'Conectado ao catálogo' : 'Título manual'}
              </small>
            </div>
            {entry.tmdbId ? (
              <Check size={16} className="match-check" />
            ) : (
              catalogAvailable && (
                <button
                  className="icon-button"
                  aria-label={`Buscar correspondência de ${entry.title}`}
                  disabled={busy}
                  onClick={() => setMatch(entry.key)}
                >
                  <Search size={16} />
                </button>
              )
            )}
          </div>
        ))}
      </div>
      <div className="import-bottom">
        <label className="check-label">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Conferi os títulos. Os não vinculados serão guardados manualmente.
        </label>
        {error && (
          <p className="error-note" role="alert">
            {error}
          </p>
        )}
        <Button
          busy={busy}
          disabled={!confirmed || !selected.length || selected.some((e) => !e.title.trim())}
          onClick={submit}
        >
          {busy
            ? `Guardando ${progress} de ${selected.length}…`
            : `Guardar ${selected.length} títulos`}
        </Button>
      </div>
      <Modal
        open={match !== null}
        onClose={() => setMatch(null)}
        title="Qual é a história certa?"
        className="add-modal"
      >
        <CatalogSearch
          key={match}
          initial={active?.title}
          catalogAvailable={catalogAvailable}
          onSelect={choose}
        />
      </Modal>
    </Modal>
  );
}
