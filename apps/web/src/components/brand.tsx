'use client';

import { useState } from 'react';
import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { CarrotLeaves, CarrotRibbon, CenoraLetters } from './brand-artwork';

/** A short ribbon unfurl and leaf flourish, replayed on hover or tap. */
function BrandArtwork({ size, letters = false }: { size: number; letters?: boolean }) {
  const [replay, setReplay] = useState(0);
  const reducedMotion = useReducedMotion();
  const play = () => {
    if (!reducedMotion) setReplay((value) => value + 1);
  };
  return (
    <m.svg
      className={letters ? 'brand-artwork' : 'brand-artwork carrot-mark'}
      width={letters ? Math.round((size * 1520) / 645) : size}
      height={size}
      viewBox={letters ? '280 55 1520 645' : '115 25 660 720'}
      role={letters ? 'img' : undefined}
      aria-label={letters ? 'Cenora' : undefined}
      aria-hidden={letters ? undefined : true}
      onHoverStart={play}
      onTap={play}
    >
      <m.g
        key={`ribbon-${replay}`}
        className="brand-ribbon"
        style={{ originX: 0.5, originY: 0 }}
        initial={reducedMotion ? false : { scaleY: 0.58, rotate: -8 }}
        animate={{ scaleY: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 14, mass: 0.8 }}
      >
        <CarrotRibbon />
      </m.g>
      <m.g
        key={`leaves-${replay}`}
        className="brand-leaves"
        style={{ originX: 0.45, originY: 1 }}
        initial={reducedMotion ? false : { scale: 0.72, rotate: 18 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.12 }}
      >
        <CarrotLeaves />
      </m.g>
      {letters && <CenoraLetters />}
    </m.svg>
  );
}

export function CarrotMark({ size = 30 }: { size?: number }) {
  return <BrandArtwork size={size} />;
}

export function Wordmark({ size = 48 }: { size?: number }) {
  return (
    <span className="wordmark">
      <BrandArtwork size={size} letters />
    </span>
  );
}
