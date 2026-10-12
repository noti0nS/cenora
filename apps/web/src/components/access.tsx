'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Film, ArrowRight, KeyRound, Copy, Check } from 'lucide-react';
import { displayName, type Member } from '@watchlist/shared';
import { api, json, errorMessage } from '@/lib/api';
import { Button, Field, copyCode } from './ui';
const schema = z.object({
  name: displayName,
  code: z.string().trim().min(12, 'Confira o código.'),
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
      <h2>Seu lugar está guardado.</h2>
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
        Ir para a watchlist
        <ArrowRight size={16} />
      </Button>
    </div>
  );
}
export function Access({
  needsSetup,
  onEnter,
}: {
  needsSetup: boolean;
  onEnter: (member: Member) => void;
}) {
  const [recover, setRecover] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<{
      member: Member;
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
      if (recover && values.recoveryCode.trim().length < 12) {
        setError('Informe seu código de recuperação.');
        return;
      }
      const path = needsSetup ? 'setup' : recover ? 'recover' : 'join';
      const data = await api<{ member: Member; recoveryCode?: string; clubToken?: string }>(
        `/auth/${path}`,
        json(
          'POST',
          needsSetup
            ? { name: values.name, setupCode: values.code }
            : {
                name: values.name,
                token: values.code,
                ...(recover ? { recoveryCode: values.recoveryCode.trim() } : {}),
              },
        ),
      );
      localStorage.setItem('watchlist:name', data.member.name);
      if (data.recoveryCode) setResult(data);
      else onEnter(data.member);
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <main className="access-page">
      <div className="access-decoration" aria-hidden="true">
        <span className="ticket ticket-one">
          mais uma
          <br />
          <em>boa história.</em>
        </span>
        <span className="ticket ticket-two">
          <Film size={48} strokeWidth={1} />
        </span>
        <span className="access-dot" />
      </div>
      <section className="access-card">
        <span className="wordmark">
          <span className="brand-mark">w</span>watchlist
        </span>
        {result ? (
          <Codes {...result} onDone={() => onEnter(result.member)} />
        ) : (
          <>
            <p className="eyebrow">{needsSetup ? 'UM NOVO CLUBE' : 'SÓ ENTRE AMIGOS'}</p>
            <h1>
              {needsSetup ? (
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
              {needsSetup
                ? 'Um pequeno espaço para as histórias que vocês querem compartilhar.'
                : 'Uma lista feita por vocês. Um lugar para guardar o que vem depois.'}
            </p>
            <form onSubmit={submit}>
              <Field label="Como podemos chamar você?">
                <input autoComplete="nickname" placeholder="Seu nome" {...form.register('name')} />
                {form.formState.errors.name && (
                  <span className="field-error">{form.formState.errors.name.message}</span>
                )}
              </Field>
              <Field
                label={needsSetup ? 'Código de configuração' : 'Código do clube'}
                hint={
                  needsSetup
                    ? 'Use o código gerado pelo comando de configuração.'
                    : 'Peça o código a quem criou o clube.'
                }
              >
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
              {recover && (
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
                {needsSetup
                  ? 'Criar nosso clube'
                  : recover
                    ? 'Recuperar meu perfil'
                    : 'Entrar no clube'}
                <ArrowRight size={17} />
              </Button>
            </form>
            {!needsSetup && (
              <button
                className="text-button recovery-link"
                onClick={() => {
                  setRecover(!recover);
                  setError('');
                }}
              >
                <KeyRound size={14} />
                {recover ? 'Quero criar um perfil novo' : 'Já tenho um perfil em outro dispositivo'}
              </button>
            )}
          </>
        )}
        <footer className="access-footer">um filme, uma série, uma boa conversa.</footer>
      </section>
    </main>
  );
}
