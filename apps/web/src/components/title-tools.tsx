'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MediaDetails } from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Modal, Button, Field } from './ui';

export function ManualEditor({
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
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Editar informações">
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
export function PersonDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['person', id],
    queryFn: () =>
      api<{ name: string; biography: string; photo: string | null }>(`/media/person/${id}`),
    enabled: Boolean(id),
  });
  return (
    <Modal open={Boolean(id)} onClose={onClose} title={query.data?.name || 'Elenco'}>
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
