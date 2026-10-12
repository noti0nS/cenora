'use client';
import { useState } from 'react';
import * as m from 'motion/react-m';

/** A clapperboard whose stick snaps shut on load and on every hover or tap. */
export function ClapperMark({ size = 30, auto = true }: { size?: number; auto?: boolean }) {
  const [clap, setClap] = useState(0);
  return (
    <m.svg
      className="clapper"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      onHoverStart={() => setClap((n) => n + 1)}
      onTap={() => setClap((n) => n + 1)}
      whileTap={{ scale: 0.92 }}
    >
      <rect x="3" y="12" width="26" height="16" rx="3" fill="currentColor" />
      <path d="M3 17h26" stroke="var(--bg)" strokeWidth="1.5" />
      <path
        d="M10 17l-3 11M18 17l-3 11M26 17l-3 11"
        stroke="var(--bg)"
        strokeWidth="1.5"
        opacity=".55"
      />
      <m.g
        key={clap}
        style={{ originX: 0, originY: 1 }}
        initial={{ rotate: auto || clap > 0 ? -24 : 0 }}
        animate={{ rotate: 0 }}
        transition={{ type: 'spring', stiffness: 700, damping: 14, delay: clap === 0 ? 0.25 : 0 }}
      >
        <rect x="3" y="5" width="26" height="7" rx="2" fill="var(--accent)" />
        <path d="M10 5l-3 7M18 5l-3 7M26 5l-3 7" stroke="var(--bg)" strokeWidth="2" />
      </m.g>
    </m.svg>
  );
}
export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="wordmark">
      <ClapperMark size={size} />
      <span className="wordmark-text">cenora</span>
    </span>
  );
}
