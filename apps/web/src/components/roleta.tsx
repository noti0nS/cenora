'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { Dices, Star } from 'lucide-react';
import type { Media, ShelfKind } from '@cenora/shared';
import { api, errorMessage, score } from '@/lib/api';
import { Modal, Button } from './ui';
import { Poster } from './poster';

type Phase = 'loading' | 'spinning' | 'done' | 'empty' | 'error';
const randomIndex = (length: number) => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % length;
};
/** Deceleration curve: quick flips first, then a slow landing on the winner. */
const delays = Array.from({ length: 18 }, (_, i) => 55 + i * i * 1.3);

function RoletaBody({
  kind,
  mine,
  onPick,
}: {
  kind: ShelfKind;
  mine: boolean;
  onPick: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('loading');
  const [current, setCurrent] = useState<Media | null>(null);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const spin = useCallback(async () => {
    clearTimeout(timer.current);
    setPhase('loading');
    try {
      const { items } = await api<{ items: Media[] }>(
        `/media/spin?kind=${kind}${mine ? '&mine=true' : ''}`,
      );
      if (!items.length) {
        setCurrent(null);
        setPhase('empty');
        return;
      }
      const winner = items[randomIndex(items.length)];
      if (reduced || items.length === 1) {
        setCurrent(winner);
        setPhase('done');
        return;
      }
      setPhase('spinning');
      let step = 0;
      const tick = () => {
        const last = step === delays.length;
        setCurrent(last ? winner : items[(step + randomIndex(items.length)) % items.length]);
        if (last) {
          setPhase('done');
          return;
        }
        timer.current = setTimeout(tick, delays[step++]);
      };
      tick();
    } catch (e) {
      setMessage(errorMessage(e));
      setPhase('error');
    }
  }, [kind, mine, reduced]);
  useEffect(() => {
    void spin();
    return () => clearTimeout(timer.current);
  }, [spin]);
  const shown = phase === 'done' ? current : null;
  return (
    <div className="roleta" data-phase={phase}>
      {current ? (
        <m.div
          key={current.id}
          className="roleta-pick"
          initial={reduced ? false : { opacity: 0.4, y: phase === 'done' ? 18 : 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: phase === 'done' ? 1.02 : 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: phase === 'done' ? 16 : 30 }}
        >
          <Poster media={current} className="roleta-poster" />
          <div className="roleta-info" aria-live="polite">
            <strong>{current.title}</strong>
            <span>
              {current.year ?? ''}
              {current.average != null && (
                <>
                  {current.year ? ' · ' : ''}
                  <Star size={11} fill="currentColor" />
                  {score(current.average)}
                </>
              )}
            </span>
          </div>
        </m.div>
      ) : phase === 'empty' ? (
        <p className="muted-note roleta-note">
          {mine
            ? 'Nada na sua fila por aqui. Desligue “Só os meus” ou adicione mais títulos.'
            : kind === 'tv'
              ? 'Nenhuma série esperando por vocês. Adicione uma nova.'
              : 'Nenhum filme esperando por vocês. Adicione um novo.'}
        </p>
      ) : phase === 'error' ? (
        <p role="alert" className="error-note roleta-note">
          {message}
        </p>
      ) : (
        <div className="poster skeleton roleta-poster" aria-label="Girando a roleta" />
      )}
      <div className="roleta-actions">
        <Button
          className="secondary"
          onClick={() => void spin()}
          disabled={phase === 'loading' || phase === 'spinning'}
        >
          <Dices size={16} />
          {phase === 'done' ? 'Girar de novo' : 'Girar'}
        </Button>
        {shown && <Button onClick={() => onPick(shown.id)}>Abrir título</Button>}
      </div>
    </div>
  );
}
export function Roleta({
  open,
  onClose,
  kind,
  mine,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  kind: ShelfKind;
  mine: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Roleta"
      description={
        mine
          ? `Sorteia ${kind === 'anime' ? 'um anime' : kind === 'tv' ? 'uma série' : 'um filme'} da sua fila.`
          : `Sorteia ${kind === 'anime' ? 'um anime' : kind === 'tv' ? 'uma série' : 'um filme'} que o grupo ainda não terminou.`
      }
      className="roleta-modal"
    >
      <RoletaBody kind={kind} mine={mine} onPick={onPick} />
    </Modal>
  );
}
