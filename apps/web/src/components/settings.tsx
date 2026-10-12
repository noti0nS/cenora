'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, RefreshCw, Shield, Copy, Check, Mail, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Club, ClubOption, Member, SessionState } from '@cenora/shared';
import { api, json, errorMessage, RequestError } from '@/lib/api';
import { Modal, Button, Field, copyCode, Segmented } from './ui';
import { useTurnstile } from '@/lib/turnstile';

function AttachEmail({ onLinked }: { onLinked: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mergeOffer, setMergeOffer] = useState(false);
  const turnstile = useTurnstile(step === 'email');
  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMergeOffer(false);
    try {
      await api(
        '/auth/email/start',
        json('POST', {
          email,
          mode: 'attach',
          turnstileToken: turnstile.token || undefined,
        }),
      );
      turnstile.reset();
      setStep('code');
    } catch (e) {
      setError(errorMessage(e));
      turnstile.reset();
    } finally {
      setBusy(false);
    }
  };
  const verify = async (merge: boolean) => {
    setBusy(true);
    setError('');
    try {
      await api(
        '/auth/email/verify',
        json('POST', { email, code: code.trim(), mode: 'attach', merge }),
      );
      toast.success(merge ? 'Seus clubes vieram para esta conta.' : 'E-mail vinculado.');
      onLinked();
    } catch (e) {
      if (e instanceof RequestError && e.code === 'EMAIL_TAKEN') setMergeOffer(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return step === 'email' ? (
    <form className="stack" onSubmit={start}>
      <Field label="Seu e-mail" hint="Enviamos um código para confirmar que é você.">
        <input
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="voce@exemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <div className="turnstile-slot" ref={turnstile.container} />
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <Button type="submit" className="secondary" busy={busy} disabled={!email.includes('@')}>
        <Mail size={15} />
        Enviar código
      </Button>
    </form>
  ) : (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void verify(false);
      }}
    >
      <Field label="Código de 6 dígitos">
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </Field>
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <Button type="submit" className="secondary" busy={busy} disabled={code.length !== 6}>
        Vincular e-mail
      </Button>
      {mergeOffer && (
        <div className="confirm-box">
          <p>
            Esse e-mail já tem uma conta. Quer trazer os clubes deste aparelho para ela? Nada é
            apagado: os perfis repetidos em um mesmo clube pedem uma conversa com o dono.
          </p>
          <Button busy={busy} onClick={() => void verify(true)}>
            Trazer meus clubes
          </Button>
          <button className="text-button" disabled={busy} onClick={() => setMergeOffer(false)}>
            Agora não
          </button>
        </div>
      )}
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => {
          setStep('email');
          setCode('');
          setError('');
          setMergeOffer(false);
        }}
      >
        Trocar e-mail
      </button>
    </form>
  );
}

export function SettingsDialog({
  open,
  onClose,
  member,
  onProfile,
  session,
}: {
  open: boolean;
  onClose: () => void;
  member: Member;
  onProfile: (member: Member) => void;
  session: SessionState | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(member.name),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{ label: string; run: () => Promise<void> } | null>(null),
    [code, setCode] = useState<{ label: string; value: string } | null>(null),
    [saved, setSaved] = useState(false),
    [linkMode, setLinkMode] = useState<'profile' | 'access'>('profile'),
    [linkName, setLinkName] = useState(''),
    [linkToken, setLinkToken] = useState(''),
    [linkCode, setLinkCode] = useState(''),
    [joinName, setJoinName] = useState(''),
    [joinToken, setJoinToken] = useState(''),
    [createName, setCreateName] = useState(''),
    [attaching, setAttaching] = useState(false);
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api<(Member & { active: number; linked: number })[]>('/club/members'),
    enabled: open && member.role === 'owner',
  });
  useEffect(() => {
    if (open) {
      setName(member.name);
      setConfirm(null);
      setCode(null);
      setSaved(false);
      setAttaching(false);
      setLinkCode('');
    }
  }, [open, member.name]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['session'] });
    void qc.invalidateQueries({ queryKey: ['members'] });
    void qc.invalidateQueries({ queryKey: ['lists'] });
    void qc.invalidateQueries({ queryKey: ['media'] });
  };
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
  const user = session?.user ?? null;
  const scoped = Boolean(session?.scoped);
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
  const logoutAll = () =>
    setConfirm({
      label:
        'Sair de todos os dispositivos? Você precisará do e-mail ou do código para entrar de novo.',
      run: async () => {
        await api('/auth/logout-all', json('POST'));
        refresh();
        onClose();
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
  const switchClub = (target: ClubOption) =>
    run(async () => {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/club',
        json('POST', { memberId: target.memberId }),
      );
      qc.setQueryData<SessionState>(['session'], (old) =>
        old ? { ...old, member: data.member, club: data.club } : old,
      );
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      void qc.invalidateQueries({ queryKey: ['session'] });
      toast.success(`Agora você está em ${data.club.name}.`);
      onClose();
    });
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(async () => {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/join',
        json('POST', { name: joinName, token: joinToken.trim() }),
      );
      localStorage.setItem('watchlist:name', data.member.name);
      refresh();
      toast.success(`Você entrou em ${data.club.name}.`);
      setJoinName('');
      setJoinToken('');
    });
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(async () => {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/create',
        json('POST', { name: createName }),
      );
      localStorage.setItem('watchlist:name', data.member.name);
      refresh();
      toast.success(`${data.club.name} foi criado.`);
      setCreateName('');
    });
  };
  const link = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(async () => {
      const payload =
        linkMode === 'profile'
          ? { name: linkName, token: linkToken.trim(), recoveryCode: linkCode.trim() }
          : { recoveryCode: linkCode.trim() };
      await api('/auth/link', json('POST', payload));
      refresh();
      toast.success(linkMode === 'profile' ? 'Perfil vinculado.' : 'Clubes trazidos.');
      setLinkName('');
      setLinkToken('');
      setLinkCode('');
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
          <div className="settings-block">
            <h4>Acesso</h4>
            {user ? (
              <p className="muted-note">
                {user.email
                  ? `Conta: ${user.email}`
                  : 'Você entra sem e-mail neste aparelho. Vincule um e-mail para não depender dele nem do código.'}
              </p>
            ) : (
              <p className="muted-note">
                Você entra com seu código pessoal. Este aparelho fica conectado; guarde o código
                para voltar em outro.
              </p>
            )}
            {scoped && (
              <p role="status" className="muted-note">
                <Shield size={14} /> Este acesso vale só para este clube. Vincule um e-mail ou gere
                um código de recuperação para liberar os outros.
              </p>
            )}
            {user && !user.email && !attaching && (
              <button
                className="settings-action"
                disabled={busy || scoped}
                onClick={() => setAttaching(true)}
              >
                <Mail size={16} />
                Vincular um e-mail
              </button>
            )}
            {user && !user.email && attaching && (
              <AttachEmail
                onLinked={() => {
                  setAttaching(false);
                  refresh();
                }}
              />
            )}
            {!scoped && (
              <button className="text-button settings-link" disabled={busy} onClick={recovery}>
                <KeyRound size={15} />
                Gerar novo código de recuperação
              </button>
            )}
            {user && !scoped && (
              <button className="text-button settings-link" disabled={busy} onClick={logoutAll}>
                Sair de todos os dispositivos
              </button>
            )}
          </div>
          {user && (
            <details className="disclosure">
              <summary>Meus clubes</summary>
              <div className="stack">
                {session?.clubs.map((option) => (
                  <div className="member-setting" key={option.memberId}>
                    <span className="small-avatar">{option.name.charAt(0)}</span>
                    <span>
                      {option.name}
                      {option.role === 'owner' && <small>Responsável</small>}
                    </span>
                    {option.memberId !== member.id && (
                      <button
                        className="text-button"
                        disabled={busy || scoped}
                        onClick={() => switchClub(option)}
                      >
                        Ir para este clube
                      </button>
                    )}
                  </div>
                ))}
                <form className="stack" onSubmit={join}>
                  <Field label="Entrar com código de convite">
                    <input
                      placeholder="Código do clube"
                      autoComplete="off"
                      spellCheck={false}
                      value={joinToken}
                      onChange={(e) => setJoinToken(e.target.value)}
                    />
                    <input
                      placeholder="Seu nome neste clube"
                      autoComplete="nickname"
                      value={joinName}
                      onChange={(e) => setJoinName(e.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    className="secondary"
                    busy={busy}
                    disabled={joinToken.trim().length < 12 || joinName.trim().length < 2}
                  >
                    Entrar no clube
                  </Button>
                </form>
                <form className="stack" onSubmit={create}>
                  <Field label="Criar um clube novo">
                    <input
                      placeholder="Seu nome no novo clube"
                      autoComplete="nickname"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    className="secondary"
                    busy={busy}
                    disabled={createName.trim().length < 2}
                  >
                    Criar clube
                  </Button>
                </form>
              </div>
            </details>
          )}
          {user && (
            <details className="disclosure">
              <summary>Trazer um perfil ou acesso antigo</summary>
              <div className="stack">
                <Segmented
                  value={linkMode}
                  onChange={setLinkMode}
                  label="O que você quer trazer"
                  options={[
                    { value: 'profile', label: 'Um perfil antigo' },
                    { value: 'access', label: 'Outro acesso sem conta' },
                  ]}
                />
                <form className="stack" onSubmit={link}>
                  {linkMode === 'profile' && (
                    <>
                      <Field label="Nome no clube">
                        <input
                          autoComplete="nickname"
                          value={linkName}
                          onChange={(e) => setLinkName(e.target.value)}
                        />
                      </Field>
                      <Field label="Código do clube">
                        <input
                          autoComplete="off"
                          spellCheck={false}
                          value={linkToken}
                          onChange={(e) => setLinkToken(e.target.value)}
                        />
                      </Field>
                    </>
                  )}
                  <Field
                    label="Código de recuperação"
                    hint={
                      linkMode === 'profile'
                        ? 'O código pessoal daquele perfil.'
                        : 'O código do outro aparelho. Trazendo os clubes dele para esta conta.'
                    }
                  >
                    <input
                      autoComplete="off"
                      spellCheck={false}
                      value={linkCode}
                      onChange={(e) => setLinkCode(e.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    className="secondary"
                    busy={busy}
                    disabled={
                      linkCode.trim().length < 12 ||
                      (linkMode === 'profile' &&
                        (linkName.trim().length < 2 || linkToken.trim().length < 12))
                    }
                  >
                    <Link2 size={15} />
                    Trazer para esta conta
                  </Button>
                </form>
              </div>
            </details>
          )}
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
                          {Boolean(m.linked) && <small>Com acesso próprio</small>}
                        </span>
                        {m.id !== member.id && (
                          <div>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                setConfirm(
                                  m.linked
                                    ? {
                                        label: `Gerar um código de reacesso para ${m.name}? Ele abre só este clube, por 7 dias, uma vez.`,
                                        run: async () => {
                                          const r = await api<{ claimCode: string }>(
                                            `/club/members/${m.id}/claim`,
                                            json('POST'),
                                          );
                                          showCode(
                                            `Reacesso de ${m.name} · envie para a pessoa`,
                                            r.claimCode,
                                          );
                                        },
                                      }
                                    : {
                                        label: `Substituir o código pessoal de ${m.name}? Os outros dispositivos precisarão entrar novamente.`,
                                        run: async () => {
                                          const r = await api<{ recoveryCode: string }>(
                                            `/club/members/${m.id}/recovery`,
                                            json('POST'),
                                          );
                                          showCode(
                                            `Código de recuperação de ${m.name}`,
                                            r.recoveryCode,
                                          );
                                        },
                                      },
                                )
                              }
                            >
                              {m.linked ? 'Reacesso' : 'Recuperar'}
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
