'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { avatarPresets, type Member } from '@cenora/shared';
import { api, json, RequestError } from '@/lib/api';
import { avatarAccept, prepareAvatar } from '@/lib/avatar';
import { Avatar } from './avatar';
import { Button } from './ui';

export function AvatarPicker({
  member,
  busy,
  run,
  onProfile,
}: {
  member: Member;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onProfile: (member: Member) => void;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [draft, setDraft] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!draft) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(draft);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);
  const save = (options: RequestInit) =>
    run(async () => {
      try {
        const updated = await api<Member>('/auth/profile/avatar', options);
        onProfile(updated);
        setDraft(null);
        void qc.invalidateQueries({ queryKey: ['members'] });
        toast.success('Sua foto foi atualizada.');
      } catch (error) {
        if (error instanceof RequestError && error.code === 'CONFLICT')
          void qc.invalidateQueries({ queryKey: ['session'] });
        throw error;
      }
    });
  return (
    <section className="avatar-picker" aria-labelledby={`${inputId}-heading`}>
      <div className="avatar-picker-heading">
        <Avatar
          member={{ ...member, avatarUrl: preview || member.avatarUrl }}
          className="avatar-preview"
        />
        <div>
          <h4 id={`${inputId}-heading`}>Sua foto</h4>
          <p className="muted-note">Uma imagem só sua, neste clube.</p>
        </div>
      </div>
      <input
        ref={input}
        id={inputId}
        className="avatar-file-input"
        type="file"
        tabIndex={-1}
        aria-label="Escolha sua foto"
        accept={avatarAccept}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void run(async () => setDraft(await prepareAvatar(file)));
        }}
      />
      <div className="avatar-picker-actions">
        <Button className="secondary" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={15} />
          Enviar imagem
        </Button>
        {member.avatarUrl && !draft && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void save(json('PATCH', { preset: null, revision: member.avatarRevision ?? 0 }))
            }
          >
            Usar minha inicial
          </button>
        )}
      </div>
      <p className="muted-note">
        PNG, JPEG, WebP, GIF, AVIF, BMP ou ICO · até 10 MB. Recorte central quadrado; imagens
        animadas viram uma foto.
      </p>
      {draft && (
        <div className="avatar-picker-actions">
          <Button
            busy={busy}
            onClick={() =>
              void save({
                method: 'PUT',
                body: draft,
                headers: {
                  'Content-Type': 'image/webp',
                  'If-Match': String(member.avatarRevision ?? 0),
                },
              })
            }
          >
            Salvar foto
          </Button>
          <button className="text-button" disabled={busy} onClick={() => setDraft(null)}>
            Cancelar imagem
          </button>
        </div>
      )}
      <h4>Ou escolha da coleção</h4>
      <div className="avatar-presets" role="group" aria-label="Coleção de avatares">
        {avatarPresets.map((preset) => {
          const url = `/avatars/${preset.id}.svg`;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={busy}
              aria-label={`Usar avatar ${preset.name}`}
              aria-pressed={!draft && member.avatarUrl === url}
              onClick={() =>
                void save(
                  json('PATCH', { preset: preset.id, revision: member.avatarRevision ?? 0 }),
                )
              }
            >
              <img src={url} alt="" width="64" height="64" />
              <span>{preset.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
