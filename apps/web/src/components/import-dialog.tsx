'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Check, ClipboardList, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  importSchema,
  normalizeName,
  type ImportEntry,
  type CatalogResult,
  type CatalogPage,
} from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { parseImportFile } from '@/lib/import-parsers';
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
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
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
      setMatching(false);
      setMatchProgress(0);
    }
  }, [open]);
  const selected = entries.filter((entry) => entry.checked);
  const unlinked = selected.filter((entry) => !entry.tmdbId && entry.title.trim().length >= 2);
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
    if (file.size > 2_000_000) {
      toast.error('Escolha uma lista de até 2 MB.');
      return;
    }
    try {
      const text = await file.text();
      const { entries: parsed, truncated } = parseImportFile(text, file.name);
      if (!parsed.length) {
        toast.error(
          'Não foi possível ler esta lista. Escolha um arquivo JSON, CSV (Letterboxd/IMDb) ou XML (MyAnimeList) válido.',
        );
        return;
      }
      if (truncated) {
        toast.info('Carregamos os primeiros 100 títulos da lista para revisão.');
      }
      review(parsed);
    } catch {
      toast.error(
        'Não foi possível ler esta lista. Escolha um arquivo JSON, CSV (Letterboxd/IMDb) ou XML (MyAnimeList) válido.',
      );
    }
  };
  const patch = (key: number, values: Partial<Draft>) => {
    setEntries((old) => old.map((entry) => (entry.key === key ? { ...entry, ...values } : entry)));
    setConfirmed(false);
  };
  const choose = (result: CatalogResult) => {
    if (match !== null)
      patch(match, {
        title: result.title,
        kind: result.kind,
        tmdbId: result.tmdbId,
        year: result.year ?? undefined,
      });
    setMatch(null);
  };
  const autoMatch = async () => {
    if (!unlinked.length || busy || matching) return;
    setMatching(true);
    setMatchProgress(0);
    let matchedCount = 0;
    try {
      for (let i = 0; i < unlinked.length; i++) {
        const item = unlinked[i];
        try {
          const page = await api<CatalogPage>(
            `/media/search?q=${encodeURIComponent(item.title.trim())}&page=1`,
          );
          const sameKind = page.results.filter((r) => r.kind === item.kind);
          const candidates = sameKind.length ? sameKind : page.results;
          const targetNorm = normalizeName(item.title);
          const origNorm = item.originalTitle ? normalizeName(item.originalTitle) : targetNorm;
          const best =
            candidates.find(
              (r) =>
                (normalizeName(r.title) === targetNorm || normalizeName(r.title) === origNorm) &&
                (!item.year || !r.year || r.year === item.year),
            ) ??
            candidates.find((r) => item.year && r.year === item.year) ??
            candidates[0];
          if (best) {
            matchedCount++;
            setEntries((old) =>
              old.map((entry) =>
                entry.key === item.key
                  ? {
                      ...entry,
                      title: best.title,
                      kind: best.kind,
                      tmdbId: best.tmdbId,
                      year: best.year ?? entry.year,
                      ...(best.isAnime && entry.kind === 'tv' ? { category: 'Animes' } : {}),
                    }
                  : entry,
              ),
            );
          }
        } catch {
          // Individual lookup failures leave the item as a manual entry for review.
        }
        setMatchProgress(i + 1);
      }
      if (matchedCount > 0) {
        toast.success(
          matchedCount === 1
            ? '1 título vinculado ao catálogo.'
            : `${matchedCount} títulos vinculados ao catálogo.`,
        );
      } else {
        toast.info('Nenhuma correspondência encontrada no catálogo.');
      }
    } finally {
      setMatching(false);
    }
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
              .map(
                ({
                  title,
                  originalTitle,
                  year,
                  kind,
                  category,
                  tmdbId,
                  personalStatus,
                  personalRating,
                  personalSeason,
                  personalEpisode,
                }) => ({
                  title,
                  originalTitle,
                  ...(year != null ? { year } : {}),
                  kind,
                  category,
                  ...(tmdbId ? { tmdbId } : {}),
                  ...(personalStatus ? { personalStatus } : {}),
                  ...(personalRating != null ? { personalRating } : {}),
                  ...(personalSeason != null ? { personalSeason } : {}),
                  ...(personalEpisode != null ? { personalEpisode } : {}),
                }),
              ),
          }),
        );
        setProgress(Math.min(i + 3, selected.length));
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['lists'] }),
        qc.invalidateQueries({ queryKey: ['media'] }),
        qc.invalidateQueries({ queryKey: ['counts'] }),
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
      await qc.invalidateQueries({ queryKey: ['counts'] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={busy || matching ? () => {} : onClose}
      title="Importar títulos"
      description="Traga sua lista e revise antes de guardar. Ela será compartilhada apenas com este clube."
      className="import-modal"
    >
      <div className="segmented">
        <button
          className={mode === 'paste' ? 'selected' : ''}
          disabled={busy || matching}
          onClick={() => setMode('paste')}
        >
          Colar títulos
        </button>
        <button
          className={mode === 'file' ? 'selected' : ''}
          disabled={busy || matching}
          onClick={() => setMode('file')}
        >
          Importar arquivo
        </button>
      </div>
      {mode === 'paste' ? (
        <div className="stack paste-form">
          <Field label="Um título por linha">
            <textarea
              rows={4}
              value={paste}
              disabled={busy || matching}
              onChange={(event) => setPaste(event.target.value)}
            />
          </Field>
          <div className="form-row">
            <Field label="Lista de destino">
              <input
                maxLength={60}
                value={category}
                disabled={busy || matching}
                onChange={(event) => setCategory(event.target.value)}
              />
            </Field>
            <Field label="Tipo">
              <select
                value={kind}
                disabled={busy || matching}
                onChange={(event) => setKind(event.target.value as 'movie' | 'tv')}
              >
                <option value="movie">Filmes</option>
                <option value="tv">Séries / animes</option>
              </select>
            </Field>
          </div>
          <Button
            className="secondary"
            onClick={preview}
            disabled={busy || matching || !category.trim()}
          >
            <ClipboardList size={15} />
            Revisar títulos
          </Button>
        </div>
      ) : (
        <Field
          label="Escolha sua lista"
          hint="Aceita JSON da Cenora, CSV (Letterboxd ou IMDb) e XML (MyAnimeList). O conteúdo só será guardado depois da sua revisão."
        >
          <input
            type="file"
            accept=".json,.csv,.xml,application/json,text/csv,text/xml,application/xml"
            disabled={busy || matching}
            onChange={(event) => readFile(event.target.files?.[0])}
          />
        </Field>
      )}
      {!!entries.length && (
        <>
          <div className="import-review-bar">
            <p className="muted-note">
              Confira nomes parecidos e remakes. Títulos sem correspondência ficam salvos
              manualmente.
            </p>
            {catalogAvailable && unlinked.length > 0 && (
              <Button
                className="secondary"
                busy={matching}
                disabled={busy || matching}
                onClick={() => void autoMatch()}
              >
                <Sparkles size={15} />
                {matching
                  ? `Vinculando ${matchProgress} de ${unlinked.length}…`
                  : 'Vincular automaticamente ao catálogo'}
              </Button>
            )}
          </div>
          <div className="import-list">
            {entries.map((entry) => (
              <div className="import-row" key={entry.key}>
                <input
                  type="checkbox"
                  aria-label={'Importar ' + entry.title}
                  checked={entry.checked}
                  disabled={busy || matching}
                  onChange={(event) => patch(entry.key, { checked: event.target.checked })}
                />
                <div>
                  <input
                    aria-label={'Título ' + (entry.key + 1)}
                    value={entry.title}
                    maxLength={200}
                    disabled={busy || matching}
                    onChange={(event) =>
                      patch(entry.key, { title: event.target.value, tmdbId: undefined })
                    }
                  />
                  <small>
                    {entry.category}
                    {entry.year ? ` · ${entry.year}` : ''} ·{' '}
                    {entry.tmdbId ? 'Conectado ao catálogo' : 'Título manual'}
                    {entry.personalRating ? ` · Nota ${entry.personalRating}` : ''}
                  </small>
                </div>
                {entry.tmdbId ? (
                  <Check size={16} className="match-check" />
                ) : (
                  catalogAvailable && (
                    <button
                      className="icon-button"
                      aria-label={'Buscar correspondência de ' + entry.title}
                      disabled={busy || matching}
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
                disabled={busy || matching}
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
                matching ||
                !confirmed ||
                !selected.length ||
                selected.some((entry) => !entry.title.trim())
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
