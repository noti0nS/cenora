'use client';
import type { useTurnstile } from '@/lib/turnstile';

export function TurnstileField({ turnstile }: { turnstile: ReturnType<typeof useTurnstile> }) {
  return (
    <>
      <div className="turnstile-slot" ref={turnstile.container} />
      {turnstile.active && turnstile.status === 'loading' && (
        <p role="status" className="turnstile-status">
          Aguardando a verificação de segurança…
        </p>
      )}
      {turnstile.active && turnstile.status === 'error' && (
        <div>
          <p role="alert" className="error-note">
            Não foi possível concluir a verificação de segurança. Confira sua conexão e se o
            navegador ou alguma extensão está bloqueando o Cloudflare.
          </p>
          <button type="button" className="text-button" onClick={turnstile.reset}>
            Tentar verificação novamente
          </button>
        </div>
      )}
    </>
  );
}
