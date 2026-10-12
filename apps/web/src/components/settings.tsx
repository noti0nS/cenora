'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, RefreshCw, Shield, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { Member } from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Modal, Button, Field, copyCode } from './ui';

export function SettingsDialog({
  open,
  onClose,
  member,
  onProfile,
}: {
  open: boolean;
  onClose: () => void;
  member: Member;
  onProfile: (member: Member) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(member.name),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{ label: string; run: () => Promise<void> } | null>(null),
    [code, setCode] = useState<{ label: string; value: string } | null>(null),
    [saved, setSaved] = useState(false);
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api<(Member & { active: number })[]>('/club/members'),
    enabled: open && member.role === 'owner',
  });
  useEffect(() => {
    if (open) {
      setName(member.name);
      setConfirm(null);
      setCode(null);
      setSaved(false);
    }
  }, [open, member.name]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setConfirm(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const profile = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(async () => {
      const updated = await api<Member>('/auth/profile', json('PATCH', { name }));
      localStorage.setItem('watchlist:name', updated.name);
      onProfile(updated);
      void qc.invalidateQueries({ queryKey: ['members'] });
      toast.success('Seu nome foi atualizado.');
    });
  };
  const showCode = (label: string, value: string) => {
    setCode({ label, value });
    setSaved(false);
  };
  const recovery = () =>
    setConfirm({
      label:
        'Gerar um novo código de recuperação? O anterior deixa de funcionar e seus outros dispositivos precisarão entrar novamente.',
      run: async () => {
        const r = await api<{ recoveryCode: string }>('/auth/recovery-code', json('POST'));
        showCode('Seu código de recuperação', r.recoveryCode);
      },
    });
  const rotate = () =>
    setConfirm({
      label:
        'Mudar o código do clube? Seus amigos precisarão do novo código e dos códigos pessoais para entrar novamente.',
      run: async () => {
        const r = await api<{ clubToken: string }>('/club/token', json('POST'));
        showCode('Novo código do clube · compartilhe com seus amigos', r.clubToken);
      },
    });
  const exportData = async () => {
    await run(async () => {
      const data = await api('/club/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `cenora-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Cópia exportada.');
    });
  };
  return (
    <Modal
      open={open}
      onClose={busy || (code && !saved) ? () => {} : onClose}
      title="Seu pequeno espaço"
      description="Um perfil simples, para histórias compartilhadas."
    >
      {code ? (
        <div className="stack code-result">
          <div className="success-mark">
            <KeyRound size={22} />
          </div>
          <h3>{code.label}</h3>
          <p className="muted-note">Guarde agora. O código aparece apenas desta vez.</p>
          <code>{code.value}</code>
          <Button className="secondary" onClick={() => copyCode(code.value)}>
            <Copy size={15} />
            Copiar código
          </Button>
          <label className="check-label">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            Guardei o código.
          </label>
          <Button disabled={!saved} onClick={() => setCode(null)}>
            Tudo certo
            <Check size={15} />
          </Button>
        </div>
      ) : (
        <>
          <form className="stack" onSubmit={profile}>
            <Field label="Seu nome">
              <input
                required
                minLength={2}
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Button type="submit" className="secondary" busy={busy} disabled={name === member.name}>
              Salvar nome
            </Button>
          </form>
          <button className="text-button settings-link" disabled={busy} onClick={recovery}>
            <KeyRound size={15} />
            Gerar novo código pessoal
          </button>
          {member.role === 'owner' && (
            <details className="disclosure owner-settings">
              <summary>Configurações do clube</summary>
              <div className="stack">
                <button className="settings-action" disabled={busy} onClick={rotate}>
                  <RefreshCw size={16} />
                  Mudar o código de acesso
                </button>
                <button className="settings-action" disabled={busy} onClick={exportData}>
                  <Download size={16} />
                  Exportar uma cópia em JSON
                </button>
                <h4>Quem faz parte</h4>
                {members.isPending ? (
                  <p className="muted-note">Carregando perfis…</p>
                ) : members.error ? (
                  <p role="alert" className="error-note">
                    {errorMessage(members.error)}
                  </p>
                ) : (
                  members.data
                    ?.filter((m) => m.active)
                    .map((m) => (
                      <div className="member-setting" key={m.id}>
                        <span className="small-avatar">{m.name.charAt(0)}</span>
                        <span>
                          {m.name}
                          {m.role === 'owner' && <small>Responsável</small>}
                        </span>
                        {m.id !== member.id && (
                          <div>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                setConfirm({
                                  label: `Substituir o código pessoal de ${m.name}? Seus outros dispositivos precisarão entrar novamente.`,
                                  run: async () => {
                                    const r = await api<{ recoveryCode: string }>(
                                      `/club/members/${m.id}/recovery`,
                                      json('POST'),
                                    );
                                    showCode(`Código de recuperação de ${m.name}`, r.recoveryCode);
                                  },
                                })
                              }
                            >
                              Recuperar
                            </button>
                            <button
                              className="text-button danger"
                              disabled={busy}
                              onClick={() =>
                                setConfirm({
                                  label: `Remover ${m.name} do clube? O perfil não poderá entrar novamente.`,
                                  run: async () => {
                                    await api(`/club/members/${m.id}`, json('DELETE'));
                                    await qc.invalidateQueries({ queryKey: ['members'] });
                                    await qc.invalidateQueries({ queryKey: ['media'] });
                                    toast.success('Perfil removido.');
                                  },
                                })
                              }
                            >
                              Remover
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                )}
              </div>
            </details>
          )}
          {confirm && (
            <div className="confirm-box">
              <p>{confirm.label}</p>
              <Button busy={busy} onClick={() => run(confirm.run)}>
                Confirmar
              </Button>
              <button className="text-button" disabled={busy} onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          )}
          <details className="disclosure about-section">
            <summary>Sobre a Cenora</summary>
            <div className="stack">
              <p>
                Um pequeno espaço para as histórias que vocês querem compartilhar. Feito para
                guardar títulos, acompanhar capítulos e trocar notas.
              </p>
              <a
                href="https://www.themoviedb.org"
                target="_blank"
                rel="noopener noreferrer"
                className="tmdb-credit"
                aria-label="The Movie Database"
              >
                <img src="/tmdb.svg" alt="The Movie Database" width="130" height="17" />
              </a>
              <p className="attribution">
                This product uses the TMDB API but is not endorsed or certified by TMDB.
              </p>
              <p className="attribution">
                Disponibilidade de streaming por JustWatch. Notas IMDb, quando disponíveis, via
                OMDb.
              </p>
              <a
                className="text-button"
                href="https://www.justwatch.com/br"
                target="_blank"
                rel="noopener noreferrer"
              >
                JustWatch Brasil
              </a>
            </div>
          </details>
        </>
      )}
    </Modal>
  );
}
