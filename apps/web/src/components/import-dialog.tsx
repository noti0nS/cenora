'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Check, Split, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { importSchema, type ImportEntry, type CatalogResult } from '@cenora/shared';
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
  const [entries, setEntries] = useState<Draft[]>([]);
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [paste, setPaste] = useState('');
  const [category, setCategory] = useState('Filmes');
  const [kind, setKind] = useState<'movie' | 'tv'>('movie');
  const [match, setMatch] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setEntries([]);
      setPaste('');
      setMode('paste');
      setConfirmed(false);
      setError('');
      setProgress(0);
    }
  }, [open]);
  const selected = entries.filter((entry) => entry.checked);
  const active = entries.find((entry) => entry.key === match);
  const review = (raw: unknown) => {
    const result = importSchema.safeParse({ entries: raw });
    if (!result.success) {
      toast.error('Confira a lista: use até 100 títulos, com nome, tipo e categoria.');
      return;
    }
    setEntries(
      result.data.entries.map((entry, key) => ({
        ...entry,
        originalTitle: entry.originalTitle || entry.title,
        key,
        checked: true,
      })),
    );
    setConfirmed(false);
  };
  const preview = () => {
    const lines = [
      ...new Set(
        paste
          .split(/\r?\n/)
          .map((line) => line.replace(/^\s*[-•\d.)]+\s*/, '').trim())
          .filter(Boolean),
      ),
    ];
    review(lines.map((title) => ({ title, kind, category })));
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 200000) {
      toast.error('Escolha uma lista de até 200 KB.');
      return;
    }
    try {
      review(JSON.parse(await file.text()));
    } catch {
      toast.error('Não foi possível ler esta lista. Escolha um arquivo JSON válido.');
    }
  };
  const patch = (key: number, values: Partial<Draft>) => {
    setEntries((old) => old.map((entry) => (entry.key === key ? { ...entry, ...values } : entry)));
    setConfirmed(false);
  };
  const split = () => {
    setEntries((old) =>
      old.flatMap((entry) =>
        entry.title === 'Zootopia 1 e 2'
          ? [
              { ...entry, title: 'Zootopia' },
              { ...entry, key: Date.now(), title: 'Zootopia 2' },
            ]
          : [entry],
      ),
    );
    setConfirmed(false);
  };
  const choose = (result: CatalogResult) => {
    if (match !== null)
      patch(match, { title: result.title, kind: result.kind, tmdbId: result.tmdbId });
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
      toast.success('As histórias chegaram ao seu clube.');
      onClose();
    } catch (error) {
      setError(
        errorMessage(error) +
          ' Os títulos já importados estão salvos. Você pode tentar novamente sem duplicá-los.',
      );
      await qc.invalidateQueries({ queryKey: ['lists'] });
      await qc.invalidateQueries({ queryKey: ['media'] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Do documento para cá"
      description="Traga sua lista e revise antes de guardar. Ela será compartilhada apenas com este clube."
      className="import-modal"
    >
      <div className="segmented">
        <button
          className={mode === 'paste' ? 'selected' : ''}
          disabled={busy}
          onClick={() => setMode('paste')}
        >
          Colar títulos
        </button>
        <button
          className={mode === 'file' ? 'selected' : ''}
          disabled={busy}
          onClick={() => setMode('file')}
        >
          Importar arquivo
        </button>
      </div>
      {mode === 'paste' ? (
        <div className="stack paste-form">
          <Field label="Um título por linha">
            <textarea rows={4} value={paste} onChange={(event) => setPaste(event.target.value)} />
          </Field>
          <div className="form-row">
            <Field label="Lista de destino">
              <input
                maxLength={60}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
            </Field>
            <Field label="Tipo">
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as 'movie' | 'tv')}
              >
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
      ) : (
        <Field
          label="Escolha sua lista"
          hint="Arquivo JSON. O conteúdo só será guardado depois da sua revisão."
        >
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => readFile(event.target.files?.[0])}
          />
        </Field>
      )}
      {entries.some((entry) => entry.title === 'Zootopia 1 e 2') && (
        <button className="text-button" onClick={split} disabled={busy}>
          <Split size={14} />
          Separar Zootopia 1 e 2
        </button>
      )}
      {!!entries.length && (
        <>
          <p className="muted-note">
            Confira nomes parecidos e remakes. Títulos sem correspondência ficam salvos manualmente.
          </p>
          <div className="import-list">
            {entries.map((entry) => (
              <div className="import-row" key={entry.key}>
                <input
                  type="checkbox"
                  aria-label={'Importar ' + entry.title}
                  checked={entry.checked}
                  disabled={busy}
                  onChange={(event) => patch(entry.key, { checked: event.target.checked })}
                />
                <div>
                  <input
                    aria-label={'Título ' + (entry.key + 1)}
                    value={entry.title}
                    maxLength={200}
                    disabled={busy}
                    onChange={(event) =>
                      patch(entry.key, { title: event.target.value, tmdbId: undefined })
                    }
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
                      aria-label={'Buscar correspondência de ' + entry.title}
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
                onChange={(event) => setConfirmed(event.target.checked)}
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
              disabled={
                !confirmed || !selected.length || selected.some((entry) => !entry.title.trim())
              }
              onClick={submit}
            >
              {busy
                ? 'Guardando ' + progress + ' de ' + selected.length + '…'
                : 'Guardar ' + selected.length + ' títulos'}
            </Button>
          </div>
        </>
      )}
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
