'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Film, ArrowRight, KeyRound, Copy, Check } from 'lucide-react';
import { displayName, type Member, type Club } from '@cenora/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Button, Field, copyCode } from './ui';
import { Wordmark } from './brand';
const schema = z.object({
  name: displayName,
  code: z.string().trim(),
  recoveryCode: z.string(),
});
type Form = z.infer<typeof schema>;
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
            <small>Guarde só para você. Ele abre seu perfil em outro dispositivo.</small>
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
export function Access({ onEnter }: { onEnter: (member: Member, club: Club) => void }) {
  const [mode, setMode] = useState<'create' | 'join' | 'recover'>('create'),
    [error, setError] = useState(''),
    [result, setResult] = useState<{
      member: Member;
      club: Club;
      recoveryCode?: string;
      clubToken?: string;
    } | null>(null);
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', code: '', recoveryCode: '' },
  });
  useEffect(() => {
    form.setValue('name', localStorage.getItem('watchlist:name') || '');
  }, [form]);
  const submit = form.handleSubmit(async (values) => {
    setError('');
    try {
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
                token: values.code,
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
                : 'Uma lista feita por vocês. Um lugar para guardar o que vem depois.'}
            </p>
            <form onSubmit={submit}>
              <Field label="Como podemos chamar você?">
                <input autoComplete="nickname" placeholder="Seu nome" {...form.register('name')} />
                {form.formState.errors.name && (
                  <span className="field-error">{form.formState.errors.name.message}</span>
                )}
              </Field>
              {mode !== 'create' && (
                <Field label="Código do clube" hint="Peça o código a quem criou o clube.">
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="Cole o código aqui"
                    {...form.register('code')}
                  />
                  {form.formState.errors.code && (
                    <span className="field-error">{form.formState.errors.code.message}</span>
                  )}
                </Field>
              )}
              {mode === 'recover' && (
                <Field label="Seu código de recuperação">
                  <input type="password" autoComplete="off" {...form.register('recoveryCode')} />
                </Field>
              )}
              {error && (
                <p role="alert" className="error-note">
                  {error}
                </p>
              )}
              <Button type="submit" busy={form.formState.isSubmitting}>
                {mode === 'create'
                  ? 'Criar meu clube'
                  : mode === 'recover'
                    ? 'Recuperar meu perfil'
                    : 'Entrar no clube'}
                <ArrowRight size={17} />
              </Button>
            </form>
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
          </>
        )}
        <footer className="access-footer">um filme, uma série, uma boa conversa.</footer>
      </section>
    </main>
  );
}
