'use client';
import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

export function useTurnstile(enabled: boolean) {
  const container = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !turnstileSiteKey || !container.current) return;
    let cancelled = false;
    setToken('');
    setStatus('loading');
    const fail = () => {
      if (cancelled) return;
      setToken('');
      setStatus('error');
      clearTimeout(timer);
    };
    const timer = setTimeout(fail, 30000);
    const render = () => {
      if (cancelled || !container.current || !window.turnstile || widget.current) return;
      try {
        widget.current = window.turnstile.render(container.current, {
          sitekey: turnstileSiteKey,
          appearance: 'interaction-only',
          size: 'flexible',
          callback: (value: string) => {
            if (cancelled) return;
            clearTimeout(timer);
            setToken(value);
            setStatus('ready');
          },
          'before-interactive-callback': () => clearTimeout(timer),
          'expired-callback': fail,
          'timeout-callback': fail,
          'error-callback': fail,
        });
      } catch {
        fail();
      }
    };
    let script: HTMLScriptElement | null = null;
    const scriptError = () => {
      if (script) script.dataset.cenoraTurnstileFailed = 'true';
      fail();
    };
    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-cenora-turnstile]');
      if (existing?.dataset.cenoraTurnstileFailed) existing.remove();
      script =
        existing && !existing.dataset.cenoraTurnstileFailed
          ? existing
          : document.createElement('script');
      script.addEventListener('load', render, { once: true });
      script.addEventListener('error', scriptError, { once: true });
      if (!script.isConnected) {
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.cenoraTurnstile = 'true';
        document.head.append(script);
      }
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
      script?.removeEventListener('load', render);
      script?.removeEventListener('error', scriptError);
      // Uma carga interrompida também deve poder ser tentada novamente.
      if (script && !window.turnstile) script.dataset.cenoraTurnstileFailed = 'true';
      if (widget.current && window.turnstile) {
        window.turnstile.remove(widget.current);
        widget.current = null;
      }
    };
  }, [enabled, attempt]);
  const reset = () => {
    setToken('');
    setStatus('loading');
    setAttempt((value) => value + 1);
  };
  return { container, token, reset, status, active: enabled && Boolean(turnstileSiteKey) };
}
