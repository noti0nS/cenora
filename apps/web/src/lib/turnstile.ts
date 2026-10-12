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
  useEffect(() => {
    if (!enabled || !turnstileSiteKey || !container.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !container.current || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(container.current, {
        sitekey: turnstileSiteKey,
        appearance: 'interaction-only',
        callback: (value: string) => setToken(value),
        'expired-callback': () => setToken(''),
        'error-callback': () => setToken(''),
      });
    };
    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-cenora-turnstile]');
      if (existing) existing.addEventListener('load', render, { once: true });
      else {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.cenoraTurnstile = 'true';
        script.addEventListener('load', render, { once: true });
        document.head.append(script);
      }
    }
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) {
        window.turnstile.remove(widget.current);
        widget.current = null;
      }
    };
  }, [enabled]);
  const reset = () => {
    setToken('');
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  };
  return { container, token, reset, active: Boolean(turnstileSiteKey) };
}
