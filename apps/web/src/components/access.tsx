'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  Film,
  ArrowRight,
  KeyRound,
  Copy,
  Check,
  Eye,
  EyeOff,
  Mail,
  RotateCcw,
} from 'lucide-react';
import {
  displayName,
  type Member,
  type Club,
  type ClubOption,
  type SessionState,
  type SessionUser,
} from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { clearInviteParam, extractInviteToken } from '@/lib/invite';
import { Button, Field, copyCode } from './ui';
import { useTurnstile } from '@/lib/turnstile';
import { TurnstileField } from './turnstile-field';
import { Wordmark } from './brand';

const schema = z.object({
  name: displayName,
  code: z.string().trim(),
  recoveryCode: z.string(),
});
type Form = z.infer<typeof schema>;
type DoorMode = 'email' | 'create' | 'join' | 'recover' | 'claim';
type Account = { user: SessionUser; clubs: ClubOption[] };

export function Codes({
  recoveryCode,
  clubToken,
  onDone,
}: {
  recoveryCode?: string;
  clubToken?: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="codes">
      <div className="success-mark">
        <Check size={24} />
      </div>
      <h2>{clubToken ? 'Seu clube está pronto.' : 'Seu lugar está guardado.'}</h2>
      <p>Salve estes códigos antes de continuar. Eles aparecem apenas desta vez.</p>
      {clubToken && (
        <div className="code-block">
          <span>
            Código do clube <small>Compartilhe com seus amigos</small>
          </span>
          <code>{clubToken}</code>
          <Button className="secondary" onClick={() => copyCode(clubToken)}>
            <Copy size={15} />
            Copiar
          </Button>
        </div>
      )}
      {recoveryCode && (
        <div className="code-block">
          <span>
            Seu código de recuperação{' '}
            <small>Guarde só para você. Ele abre seu acesso em qualquer aparelho.</small>
          </span>
          <code>{recoveryCode}</code>
          <Button className="secondary" onClick={() => copyCode(recoveryCode)}>
            <Copy size={15} />
            Copiar
          </Button>
        </div>
      )}
      <label className="check-label">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        Guardei meus códigos em um lugar seguro.
      </label>
      <Button disabled={!saved} onClick={onDone}>
        Ir para a Cenora
        <ArrowRight size={16} />
      </Button>
    </div>
  );
}

// Entrada por link de convite (`?convite=<token>`). Vale para quem já tem conta e para
// quem chega novo: o servidor decide se reaproveita a identidade ou cria uma.
function InviteGate({
  token,
  onEnter,
  onCancel,
}: {
  token: string;
  onEnter: (member: Member, club: Club) => void;
  onCancel: () => void;
}) {
  const [meta, setMeta] = useState<{ clubName: string; passwordRequired: boolean } | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    member: Member;
    club: Club;
    recoveryCode?: string;
  } | null>(null);
  useEffect(() => {
    setName(localStorage.getItem('watchlist:name') || '');
  }, []);
  useEffect(() => {
    let live = true;
    api<{ clubName: string; passwordRequired: boolean }>(
      `/auth/invite/${encodeURIComponent(token)}`,
    )
      .then((data) => {
        if (live) setMeta(data);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [token]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await api<{ member: Member; club: Club; recoveryCode?: string }>(
        '/auth/invite',
        json('POST', { name, token, ...(password ? { password } : {}) }),
      );
      localStorage.setItem('watchlist:name', data.member.name);
      clearInviteParam();
      if (data.recoveryCode) setResult(data);
      else onEnter(data.member, data.club);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (result)
    return (
      <Codes
        recoveryCode={result.recoveryCode}
        onDone={() => onEnter(result.member, result.club)}
      />
    );
  if (!meta)
    return (
      <>
        <p className="eyebrow">CONVITE</p>
        <h1>{error ? 'Convite indisponível.' : 'Um instante…'}</h1>
        {error ? (
          <p role="alert" className="error-note">
            {error}
          </p>
        ) : (
          <p className="access-intro">Abrindo o convite.</p>
        )}
        <div className="access-actions">
          <button className="text-button recovery-link" disabled={busy} onClick={onCancel}>
            Voltar para a entrada
          </button>
        </div>
      </>
    );
  return (
    <>
      <p className="eyebrow">CONVITE</p>
      <h1>
        Você foi convidado
        <br />
        para <em>{meta.clubName}.</em>
      </h1>
      <p className="access-intro">
        Escolha como quer ser chamado{meta.passwordRequired ? ' e informe a senha do convite' : ''}.
      </p>
      <form onSubmit={submit}>
        <Field label="Como podemos chamar você?">
          <input
            autoComplete="nickname"
            placeholder="Seu nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {meta.passwordRequired && (
          <Field label="Senha do convite">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="error-note">
            {error}
          </p>
        )}
        <Button
          type="submit"
          busy={busy}
          disabled={name.trim().length < 2 || (meta.passwordRequired && !password.trim())}
        >
          Entrar no clube
          <ArrowRight size={17} />
        </Button>
      </form>
      <div className="access-actions">
        <button className="text-button recovery-link" disabled={busy} onClick={onCancel}>
          Voltar para a entrada
        </button>
      </div>
    </>
  );
}

export function Access({
  onEnter,
  session,
  onInviteDismissed,
}: {
  onEnter: (member: Member, club: Club) => void;
  session?: SessionState | null;
  onInviteDismissed?: () => void;
}) {
  const qc = useQueryClient();
  const fromSession = useMemo<Account | null>(
    () => (session?.user ? { user: session.user, clubs: session.clubs ?? [] } : null),
    [session],
  );
  const [account, setAccount] = useState<Account | null>(null);
  const active = account ?? fromSession;
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  useEffect(() => {
    const token = new URL(window.location.href).searchParams.get('convite');
    if (token) setInviteToken(token);
  }, []);
  const signOut = async () => {
    try {
      await api('/auth/logout', json('POST'));
    } catch {
      // Sair é melhor esforço: mesmo falhando, a tela volta para a porta de entrada.
    }
    setAccount(null);
    void qc.invalidateQueries({ queryKey: ['session'] });
  };
  if (inviteToken)
    return (
      <main className="access-page">
        <div className="access-decoration" aria-hidden="true">
          <span className="ticket ticket-two">
            <Film size={48} strokeWidth={1} />
          </span>
          <span className="access-dot" />
        </div>
        <section className="access-card">
          <Wordmark />
          <InviteGate
            token={inviteToken}
            onEnter={onEnter}
            onCancel={() => {
              clearInviteParam();
              setInviteToken(null);
              onInviteDismissed?.();
            }}
          />
          <footer className="access-footer">um filme, uma série, uma boa conversa.</footer>
        </section>
      </main>
    );
  if (active)
    return (
      <main className="access-page">
        <div className="access-decoration" aria-hidden="true">
          <span className="ticket ticket-two">
            <Film size={48} strokeWidth={1} />
          </span>
          <span className="access-dot" />
        </div>
        <section className="access-card">
          <Wordmark />
          <ClubGate
            account={active}
            onEnter={onEnter}
            onSignOut={signOut}
            onInvite={setInviteToken}
          />
          <footer className="access-footer">um filme, uma série, uma boa conversa.</footer>
        </section>
      </main>
    );
  return <Door onEnter={onEnter} onAccount={setAccount} onInvite={setInviteToken} />;
}

function ClubGate({
  account,
  onEnter,
  onSignOut,
  onInvite,
}: {
  account: Account;
  onEnter: (member: Member, club: Club) => void;
  onSignOut: () => Promise<void>;
  onInvite: (token: string) => void;
}) {
  const [view, setView] = useState<'list' | 'new' | 'join'>('list');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enterClub = async (memberId: string) => {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/club',
        json('POST', { memberId }),
      );
      onEnter(data.member, data.club);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/create',
        json('POST', { name }),
      );
      onEnter(data.member, data.club);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const join = async (event: React.FormEvent) => {
    event.preventDefault();
    const linked = extractInviteToken(token);
    if (linked) {
      onInvite(linked);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/join',
        json('POST', { name, token: token.trim() }),
      );
      onEnter(data.member, data.club);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (view === 'new')
    return (
      <>
        <p className="eyebrow">UM NOVO CLUBE</p>
        <h1>
          Boas histórias.
          <br />
          Boa companhia.
        </h1>
        <p className="access-intro">Crie seu clube e receba um código privado para convidar.</p>
        <form onSubmit={create}>
          <Field label="Como podemos chamar você?">
            <input
              autoComplete="nickname"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="error-note">
              {error}
            </p>
          )}
          <Button type="submit" busy={busy}>
            Criar meu clube
            <ArrowRight size={17} />
          </Button>
        </form>
        <div className="access-actions">
          <button className="text-button recovery-link" onClick={() => setView('list')}>
            Voltar
          </button>
        </div>
      </>
    );
  if (view === 'join')
    return (
      <>
        <p className="eyebrow">SÓ ENTRE AMIGOS</p>
        <h1>
          Seu próximo
          <br />
          <em>“vamos assistir?”</em>
        </h1>
        <p className="access-intro">
          Entre com o código que alguém do clube compartilhou com você.
        </p>
        <form onSubmit={join}>
          <Field label="Como podemos chamar você?">
            <input
              autoComplete="nickname"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label="Código do clube"
            hint="Peça o código a quem criou o clube, ou cole o link do convite."
          >
            <input
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Cole o código aqui"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="error-note">
              {error}
            </p>
          )}
          <Button type="submit" busy={busy}>
            Entrar no clube
            <ArrowRight size={17} />
          </Button>
        </form>
        <div className="access-actions">
          <button className="text-button recovery-link" onClick={() => setView('list')}>
            Voltar
          </button>
        </div>
      </>
    );
  return (
    <>
      <p className="eyebrow">{account.clubs.length ? 'SEUS CLUBES' : 'QUASE LÁ'}</p>
      <h1>
        {account.clubs.length ? (
          <>
            Onde vamos
            <br />
            <em>assistir hoje?</em>
          </>
        ) : (
          <>
            Falta escolher
            <br />
            <em>o seu clube.</em>
          </>
        )}
      </h1>
      <p className="access-intro">
        {account.user.email
          ? `Você entrou como ${account.user.email}.`
          : 'Você entra sem e-mail neste aparelho — seus clubes ficam guardados com você.'}
      </p>
      {account.clubs.length > 0 && (
        <div className="club-options">
          {account.clubs.map((option) => (
            <button
              key={option.memberId}
              className="club-option"
              disabled={busy}
              onClick={() => enterClub(option.memberId)}
            >
              <span>{option.name}</span>
              {option.role === 'owner' && <small>Responsável</small>}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <div className="access-actions">
        <button
          className="text-button recovery-link"
          disabled={busy}
          onClick={() => setView('new')}
        >
          Criar um clube novo
        </button>
        <button
          className="text-button recovery-link"
          disabled={busy}
          onClick={() => setView('join')}
        >
          Tenho um código de convite
        </button>
        <button
          className="text-button recovery-link"
          disabled={busy}
          onClick={() => void onSignOut()}
        >
          Entrar com outro e-mail
        </button>
      </div>
    </>
  );
}

function Door({
  onEnter,
  onAccount,
  onInvite,
}: {
  onEnter: (member: Member, club: Club) => void;
  onAccount: (account: Account) => void;
  onInvite: (token: string) => void;
}) {
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', code: '', recoveryCode: '' },
  });
  const [mode, setMode] = useState<DoorMode>('email');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [result, setResult] = useState<{
    member: Member;
    club: Club;
    recoveryCode?: string;
    clubToken?: string;
  } | null>(null);
  const [showClubCode, setShowClubCode] = useState(false);
  const [showRecoveryCode, setShowRecoveryCode] = useState(false);
  const turnstile = useTurnstile(mode === 'email');
  const [tokenSpent, setTokenSpent] = useState(false);
  const resetTurnstile = turnstile.reset;
  useEffect(() => {
    if (!tokenSpent || (step === 'code' && resendIn > 0)) return;
    setTokenSpent(false);
    resetTurnstile();
  }, [tokenSpent, step, resendIn, resetTurnstile]);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);
  useEffect(() => {
    setShowClubCode(false);
    setShowRecoveryCode(false);
  }, [mode]);
  useEffect(() => {
    form.setValue('name', localStorage.getItem('watchlist:name') || '');
  }, [form]);
  const sendCode = useCallback(async () => {
    if (busy || (turnstile.active && !turnstile.token)) return;
    setBusy(true);
    setError('');
    try {
      await api(
        '/auth/email/start',
        json('POST', { email, turnstileToken: turnstile.token || undefined }),
      );
      // O token é de uso único; o próximo só é necessário ao reenviar ou trocar o e-mail.
      setTokenSpent(true);
      setStep('code');
      setResendIn(60);
    } catch (e) {
      setError(errorMessage(e));
      turnstile.reset();
    } finally {
      setBusy(false);
    }
  }, [busy, email, turnstile]);
  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{
        user: SessionUser;
        member: Member | null;
        club: Club | null;
        clubs: ClubOption[];
      }>('/auth/email/verify', json('POST', { email, code: code.trim() }));
      if (data.member && data.club) onEnter(data.member, data.club);
      else onAccount({ user: data.user, clubs: data.clubs ?? [] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const submitClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ member: Member; club: Club }>(
        '/auth/claim',
        json('POST', { code: claimCode.trim() }),
      );
      onEnter(data.member, data.club);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const submitLegacy = form.handleSubmit(async (values) => {
    setError('');
    try {
      const linked = mode === 'join' ? extractInviteToken(values.code) : null;
      if (linked) {
        onInvite(linked);
        return;
      }
      if (mode !== 'create' && values.code.length < 12) {
        form.setError('code', { message: 'Confira o código de convite.' });
        return;
      }
      if (mode === 'recover' && values.recoveryCode.trim().length < 12) {
        setError('Informe seu código de recuperação.');
        return;
      }
      const data = await api<{
        member: Member;
        club: Club;
        recoveryCode?: string;
        clubToken?: string;
      }>(
        `/auth/${mode}`,
        json(
          'POST',
          mode === 'create'
            ? { name: values.name }
            : {
                name: values.name,
                token: values.code.trim(),
                ...(mode === 'recover' ? { recoveryCode: values.recoveryCode.trim() } : {}),
              },
        ),
      );
      localStorage.setItem('watchlist:name', data.member.name);
      if (data.recoveryCode) setResult(data);
      else onEnter(data.member, data.club);
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <main className="access-page">
      <div className="access-decoration" aria-hidden="true">
        <span className="ticket ticket-one">
          hoje tem
          <br />
          <em>sessão.</em>
        </span>
        <span className="ticket ticket-two">
          <Film size={48} strokeWidth={1} />
        </span>
        <span className="access-dot" />
      </div>
      <section className="access-card">
        <Wordmark />
        {result ? (
          <Codes {...result} onDone={() => onEnter(result.member, result.club)} />
        ) : mode === 'email' ? (
          <>
            <p className="eyebrow">SUA ESTANTE DE SEMPRE</p>
            <h1>
              Boas histórias.
              <br />
              Boa companhia.
            </h1>
            <p className="access-intro">
              {step === 'email'
                ? 'Entre com seu e-mail e receba um código. Sem senha, sem complicação.'
                : `Enviamos um código para ${email}.`}
            </p>
            <TurnstileField turnstile={turnstile} />
            {step === 'email' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendCode();
                }}
              >
                <Field label="Seu e-mail">
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="voce@exemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                {error && (
                  <p role="alert" className="error-note">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  busy={busy}
                  disabled={!email.includes('@') || (turnstile.active && !turnstile.token)}
                >
                  Enviar código
                  <Mail size={16} />
                </Button>
              </form>
            ) : (
              <form onSubmit={verify}>
                <Field label="Código de 6 dígitos">
                  <input
                    name="code"
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
                <Button type="submit" busy={busy} disabled={code.length !== 6}>
                  Entrar
                  <ArrowRight size={17} />
                </Button>
                <div className="access-actions">
                  <button
                    type="button"
                    className="text-button recovery-link"
                    disabled={busy || resendIn > 0 || (turnstile.active && !turnstile.token)}
                    onClick={() => void sendCode()}
                  >
                    <RotateCcw size={14} />
                    {resendIn > 0 ? `Reenviar em ${resendIn}s` : 'Reenviar código'}
                  </button>
                  <button
                    type="button"
                    className="text-button recovery-link"
                    disabled={busy}
                    onClick={() => {
                      setStep('email');
                      setCode('');
                      setError('');
                    }}
                  >
                    Trocar e-mail
                  </button>
                </div>
              </form>
            )}
            <div className="access-actions">
              <button
                className="text-button recovery-link"
                onClick={() => {
                  setMode('create');
                  setError('');
                }}
              >
                Criar meu clube
              </button>
              <button
                className="text-button recovery-link"
                onClick={() => {
                  setMode('join');
                  setError('');
                }}
              >
                Tenho um código de convite
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">{mode === 'create' ? 'UM NOVO CLUBE' : 'SÓ ENTRE AMIGOS'}</p>
            <h1>
              {mode === 'create' ? (
                <>
                  Boas histórias.
                  <br />
                  Boa companhia.
                </>
              ) : (
                <>
                  Seu próximo
                  <br />
                  <em>“vamos assistir?”</em>
                </>
              )}
            </h1>
            <p className="access-intro">
              {mode === 'create'
                ? 'Crie seu clube e receba um código privado para convidar seus amigos.'
                : mode === 'claim'
                  ? 'Use o código de reacesso que alguém do clube gerou para você. Ele abre só este clube.'
                  : 'Uma lista feita por vocês. Um lugar para guardar o que vem depois.'}
            </p>
            <form onSubmit={mode === 'claim' ? submitClaim : submitLegacy}>
              {mode === 'claim' ? (
                <Field label="Código de reacesso">
                  <input
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Cole o código aqui"
                    value={claimCode}
                    onChange={(e) => setClaimCode(e.target.value)}
                  />
                </Field>
              ) : (
                <Field label="Como podemos chamar você?">
                  <input
                    autoComplete="nickname"
                    placeholder="Seu nome"
                    {...form.register('name')}
                  />
                  {form.formState.errors.name && (
                    <span className="field-error">{form.formState.errors.name.message}</span>
                  )}
                </Field>
              )}
              {mode !== 'create' && mode !== 'claim' && (
                <Field
                  label="Código do clube"
                  hint="Peça o código a quem criou o clube, ou cole o link do convite."
                >
                  <div className="private-code-input">
                    <input
                      type={showClubCode ? 'text' : 'password'}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="Cole o código aqui"
                      {...form.register('code')}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={
                        showClubCode ? 'Ocultar código do clube' : 'Mostrar código do clube'
                      }
                      aria-pressed={showClubCode}
                      onClick={() => setShowClubCode(!showClubCode)}
                    >
                      {showClubCode ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {form.formState.errors.code && (
                    <span className="field-error">{form.formState.errors.code.message}</span>
                  )}
                </Field>
              )}
              {mode === 'recover' && (
                <Field label="Seu código de recuperação">
                  <div className="private-code-input">
                    <input
                      type={showRecoveryCode ? 'text' : 'password'}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      {...form.register('recoveryCode')}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={
                        showRecoveryCode
                          ? 'Ocultar código de recuperação'
                          : 'Mostrar código de recuperação'
                      }
                      aria-pressed={showRecoveryCode}
                      onClick={() => setShowRecoveryCode(!showRecoveryCode)}
                    >
                      {showRecoveryCode ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
              )}
              {error && (
                <p role="alert" className="error-note">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                busy={mode === 'claim' ? busy : form.formState.isSubmitting}
                disabled={mode === 'claim' && claimCode.trim().length < 12}
              >
                {mode === 'create'
                  ? 'Criar meu clube'
                  : mode === 'claim'
                    ? 'Abrir meu acesso'
                    : mode === 'recover'
                      ? 'Recuperar meu perfil'
                      : 'Entrar no clube'}
                <ArrowRight size={17} />
              </Button>
            </form>
            <div className="access-actions">
              <button
                className="text-button recovery-link"
                onClick={() => {
                  setMode(mode === 'create' ? 'join' : 'create');
                  setError('');
                  form.clearErrors();
                }}
              >
                {mode === 'create' ? 'Tenho um código de convite' : 'Quero criar um clube'}
              </button>
              {mode !== 'create' && (
                <button
                  className="text-button recovery-link"
                  onClick={() => {
                    setMode(mode === 'recover' ? 'join' : 'recover');
                    setError('');
                    form.clearErrors();
                  }}
                >
                  <KeyRound size={14} />
                  {mode === 'recover'
                    ? 'Quero criar um perfil novo'
                    : 'Já tenho um perfil em outro dispositivo'}
                </button>
              )}
              {mode === 'join' && (
                <button
                  className="text-button recovery-link"
                  onClick={() => {
                    setMode('claim');
                    setError('');
                    form.clearErrors();
                  }}
                >
                  Tenho um código de reacesso
                </button>
              )}
              <button
                className="text-button recovery-link"
                onClick={() => {
                  setMode('email');
                  setStep('email');
                  setError('');
                  form.clearErrors();
                }}
              >
                Voltar para o acesso por e-mail
              </button>
            </div>
          </>
        )}
        <footer className="access-footer">um filme, uma série, uma boa conversa.</footer>
      </section>
    </main>
  );
}
