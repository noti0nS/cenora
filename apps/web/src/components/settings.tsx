'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Shield, Mail } from 'lucide-react';
import { toast } from 'sonner';
import type { Member, SessionState } from '@cenora/shared';
import { api, json, errorMessage, RequestError } from '@/lib/api';
import { Modal, Button, Field, CodeReveal } from './ui';
import { useTurnstile } from '@/lib/turnstile';
import { TurnstileField } from './turnstile-field';
import { AvatarPicker } from './avatar-picker';

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
    if (busy || (turnstile.active && !turnstile.token)) return;
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
      <TurnstileField turnstile={turnstile} />
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="secondary"
        busy={busy}
        disabled={!email.includes('@') || (turnstile.active && !turnstile.token)}
      >
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
    [attaching, setAttaching] = useState(false);
  useEffect(() => {
    if (open) {
      setName(member.name);
      setConfirm(null);
      setCode(null);
      setAttaching(false);
    }
  }, [open, member.name]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['session'] });
    void qc.invalidateQueries({ queryKey: ['members'] });
    void qc.invalidateQueries({ queryKey: ['lists'] });
    void qc.invalidateQueries({ queryKey: ['media'] });
    void qc.invalidateQueries({ queryKey: ['counts'] });
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
  return (
    <Modal
      open={open}
      onClose={busy || code ? () => {} : onClose}
      title="Seu pequeno espaço"
      description="Um perfil simples, para histórias compartilhadas."
    >
      {code ? (
        <CodeReveal label={code.label} value={code.value} onDone={() => setCode(null)} />
      ) : (
        <>
          <AvatarPicker
            key={`${member.id}:${open}`}
            member={member}
            busy={busy}
            run={run}
            onProfile={onProfile}
          />
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
                <Shield size={14} /> Este acesso vale só para este clube. Entre com o e-mail já
                vinculado ou com seu código de recuperação da identidade para liberar os outros.
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
