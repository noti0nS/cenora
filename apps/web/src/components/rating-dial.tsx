'use client';
import { useRef, useState } from 'react';
import * as m from 'motion/react-m';
import { score } from '@/lib/api';

const STEPS = 20;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function mood(value: number) {
  if (value >= 9.5) return 'Obra-prima';
  if (value >= 8.5) return 'Imperdível';
  if (value >= 7.5) return 'Muito bom';
  if (value >= 6.5) return 'Bom';
  if (value >= 5) return 'Mais ou menos';
  if (value >= 3) return 'Fraco';
  return 'Evite';
}
function Burst() {
  return (
    <span className="dial-burst" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2;
        const distance = 54 + (i % 3) * 16;
        return (
          <m.span
            key={i}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{
              x: Math.cos(angle) * distance,
              y: Math.sin(angle) * distance,
              scale: 0,
              opacity: 0,
            }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        );
      })}
    </span>
  );
}
export function RatingDial({
  value,
  onChange,
  label = 'Minha nota',
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [burst, setBurst] = useState(0);
  const fromPointer = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return null;
    const t = clamp((clientX - box.left) / box.width, 0, 1);
    return clamp(Math.round(t * STEPS) / 2, 0.5, 10);
  };
  const set = (next: number | null) => {
    if (next === value) return;
    onChange(next);
    if (next !== null && typeof navigator.vibrate === 'function') navigator.vibrate(4);
  };
  const filled = value === null ? 0 : value * 2;
  return (
    <div className={`dial ${dragging ? 'is-dragging' : ''}`}>
      <div className="dial-readout" aria-hidden="true">
        <span className="dial-number">
          {value === null ? (
            <span className="dial-empty">—</span>
          ) : (
            <m.span
              key={value}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 28 }}
            >
              {score(value)}
            </m.span>
          )}
          <small>/10</small>
        </span>
        <span className="dial-mood">
          {value === null ? 'Arraste para dar sua nota' : mood(value)}
        </span>
        {burst > 0 && <Burst key={burst} />}
      </div>
      <div
        ref={track}
        className="dial-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0.5}
        aria-valuemax={10}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? 'Sem nota' : `${score(value)} de 10, ${mood(value)}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          set(fromPointer(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragging) set(fromPointer(e.clientX));
        }}
        onPointerUp={() => {
          setDragging(false);
          if (value !== null && value >= 9) setBurst((n) => n + 1);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          const current = value ?? 6.5;
          const steps: Record<string, number> = {
            ArrowRight: 0.5,
            ArrowUp: 0.5,
            ArrowLeft: -0.5,
            ArrowDown: -0.5,
            PageUp: 1,
            PageDown: -1,
          };
          if (e.key in steps) {
            e.preventDefault();
            set(clamp(value === null ? current : current + steps[e.key], 0.5, 10));
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            set(e.key === 'Home' ? 0.5 : 10);
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            set(null);
          }
        }}
      >
        {Array.from({ length: STEPS }, (_, i) => {
          const on = i < filled;
          const near = Math.max(0, 1 - Math.abs(i + 1 - filled) / 4);
          return (
            <m.span
              key={i}
              className={on ? 'tick on' : 'tick'}
              animate={{ scaleY: on ? 1 + near * (dragging ? 1.1 : 0.6) : 0.45 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
            />
          );
        })}
      </div>
      <div className="dial-scale" aria-hidden="true">
        <span>0</span>
        <span>5</span>
        <span>10</span>
      </div>
      {value !== null && (
        <button type="button" className="text-button dial-clear" onClick={() => set(null)}>
          Limpar nota
        </button>
      )}
    </div>
  );
}
export function FriendsScale({
  ratings,
  average,
}: {
  ratings: { memberId: string; name: string; rating: number }[];
  average: number | null;
}) {
  if (!ratings.length) {
    return (
      <p className="muted-note friends-empty">Ninguém deu nota ainda. Seja a primeira pessoa.</p>
    );
  }
  const seen = new Map<number, number>();
  return (
    <div className="friends-scale">
      <div className="friends-line">
        {average !== null && (
          <m.span
            className="friends-average"
            style={{ left: `${(average / 10) * 100}%`, x: '-50%', rotate: 45 }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.2 }}
            title={`Média do grupo: ${score(average)}`}
          />
        )}
        {ratings.map((r, i) => {
          const row = seen.get(r.rating) ?? 0;
          seen.set(r.rating, row + 1);
          return (
            <m.span
              key={r.memberId}
              className="friends-dot"
              style={{ left: `${(r.rating / 10) * 100}%`, bottom: 14 + row * 30, x: '-50%' }}
              initial={{ scale: 0, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.1 + i * 0.06 }}
              title={`${r.name}: ${score(r.rating)}`}
            >
              {r.name.charAt(0).toLocaleUpperCase('pt-BR')}
              <small>{score(r.rating)}</small>
            </m.span>
          );
        })}
      </div>
      <div className="dial-scale" aria-hidden="true">
        <span>0</span>
        <span>5</span>
        <span>10</span>
      </div>
      <ul className="sr-only">
        {ratings.map((r) => (
          <li key={r.memberId}>
            {r.name}: {score(r.rating)}
          </li>
        ))}
      </ul>
    </div>
  );
}
