'use client';
import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Check, Minus, Plus, Play, Ban, Users, User } from 'lucide-react';
import type { MediaDetails, Season } from '@cenora/shared';
import {
  isFinished,
  nextEpisode,
  seasonProgress,
  totalEpisodes,
  watchedCount,
  type Checkpoint,
} from '@/lib/tracking';
import { Segmented } from './ui';
import { RatingDial, FriendsScale } from './rating-dial';
import type { TitleTracking } from './use-title-tracking';

type Scope = 'personal' | 'group';
function Ring({ fraction, label, caption }: { fraction: number; label: string; caption: string }) {
  return (
    <div className="progress-ring" role="img" aria-label={`${label}. ${caption}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44" className="progress-ring-track" />
        <m.circle
          cx="50"
          cy="50"
          r="44"
          className="progress-ring-fill"
          transform="rotate(-90 50 50)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: fraction, opacity: fraction > 0 ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 90, damping: 20 }}
        />
      </svg>
      <div className="progress-ring-center" aria-hidden="true">
        <m.strong
          key={label}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        >
          {label}
        </m.strong>
        <small>{caption}</small>
      </div>
    </div>
  );
}
function previousEpisode(seasons: Season[], season: number, episode: number): Checkpoint {
  if (episode > 1) return { season, episode: episode - 1 };
  const before = [...seasons].reverse().find((s) => s.number < season);
  return before
    ? { season: before.number, episode: before.episodes }
    : { season: null, episode: null };
}
const stamp = (cp: Checkpoint) =>
  cp.season && cp.episode ? `T${cp.season} · E${cp.episode}` : 'Não começou';
/** A show is many sittings: a ring, a season rail and tappable episodes. */
export function ShowTracker({ data, tracking }: { data: MediaDetails; tracking: TitleTracking }) {
  const seasons = data.seasons;
  const { personal, group } = tracking;
  const [scope, setScope] = useState<Scope>('personal');
  const cp: Checkpoint = scope === 'personal' ? personal.draft : group.draft;
  const [active, setActive] = useState(personal.draft.season ?? seasons[0]?.number ?? 1);
  const [direction, setDirection] = useState(1);
  const [tapped, setTapped] = useState(0);
  const total = totalEpisodes(seasons);
  const done = watchedCount(seasons, cp);
  const finished = isFinished(seasons, cp);
  const apply = (season: number | null, episode: number | null) => {
    const none = season === null || episode === null;
    const complete = !none && isFinished(seasons, { season, episode });
    if (scope === 'personal') {
      personal.update({
        season,
        episode,
        status: none ? 'want' : complete ? 'watched' : 'watching',
      });
    } else {
      group.update({
        season,
        episode,
        status: none ? 'planned' : complete ? 'watched' : 'watching',
      });
    }
  };
  const choose = (season: number, episode: number) => {
    setTapped(episode);
    if (cp.season === season && cp.episode === episode) {
      const before = previousEpisode(seasons, season, episode);
      apply(before.season, before.episode);
    } else apply(season, episode);
  };
  const selectSeason = (number: number) => {
    setDirection(number >= active ? 1 : -1);
    setActive(number);
  };
  const advance = () => {
    const next = nextEpisode(seasons, cp);
    if (!next) return;
    setTapped(next.episode);
    if (seasons.length) selectSeason(next.season);
    apply(next.season, next.episode);
  };
  const next = nextEpisode(seasons, cp);
  const season = seasons.find((s) => s.number === active) ?? seasons[0];
  const dropped = scope === 'personal' && personal.draft.status === 'dropped';
  const showDial =
    scope === 'personal' &&
    (done > 0 || Boolean(cp.season) || personal.draft.rating !== null || dropped);
  const verb = scope === 'personal' ? 'Vi' : 'Vimos';
  return (
    <div className="tracker">
      <Segmented
        label="Quem está acompanhando"
        value={scope}
        options={[
          { value: 'personal', label: 'Você' },
          { value: 'group', label: 'O grupo' },
        ]}
        onChange={setScope}
        className="scope-switch"
      />
      <section className="progress-card" aria-label="Progresso">
        <header className="card-eyebrow">
          {scope === 'personal' ? <User size={14} /> : <Users size={14} />}
          {scope === 'personal' ? 'Seu ponto na série' : 'Onde o grupo parou'}
        </header>
        <div className="progress-body">
          <Ring
            fraction={total ? done / total : cp.season ? 1 : 0}
            label={stamp(cp)}
            caption={total ? `${done} de ${total} episódios` : 'Contagem manual'}
          />
          <div className="progress-actions">
            {seasons.length > 0 ? (
              next ? (
                <button type="button" className="primary-action" onClick={advance}>
                  <Play size={16} fill="currentColor" />
                  {verb} o T{next.season} · E{next.episode}
                </button>
              ) : (
                <p className="finished-note">
                  <Check size={16} />
                  Série concluída
                </p>
              )
            ) : (
              <ManualCounter cp={cp} apply={apply} verb={verb} />
            )}
            {scope === 'personal' && (
              <button
                type="button"
                className={`chip ${dropped ? 'on' : ''}`}
                aria-pressed={dropped}
                onClick={() =>
                  personal.update({
                    status: dropped
                      ? cp.season
                        ? finished
                          ? 'watched'
                          : 'watching'
                        : 'want'
                      : 'dropped',
                  })
                }
              >
                <Ban size={13} />
                Abandonei
              </button>
            )}
            {seasons.length === 0 && scope === 'personal' && (
              <button
                type="button"
                className={`chip ${personal.draft.status === 'watched' ? 'on' : ''}`}
                aria-pressed={personal.draft.status === 'watched'}
                onClick={() =>
                  personal.update({
                    status: personal.draft.status === 'watched' ? 'watching' : 'watched',
                  })
                }
              >
                <Check size={13} />
                Terminei a série
              </button>
            )}
          </div>
        </div>
        {season && (
          <>
            <div className="season-rail" role="group" aria-label="Temporadas">
              {seasons.map((s) => {
                const progress = seasonProgress(s, cp);
                return (
                  <button
                    key={s.number}
                    type="button"
                    aria-pressed={s.number === active}
                    aria-label={`Temporada ${s.number}`}
                    className={`season-pill ${s.number === active ? 'selected' : ''}`}
                    onClick={() => selectSeason(s.number)}
                  >
                    {s.number === active && (
                      <m.span
                        layoutId="season-thumb"
                        className="season-thumb"
                        transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                      />
                    )}
                    <span className="season-label">T{s.number}</span>
                    <span className="season-meter">
                      <span style={{ width: `${(progress / s.episodes) * 100}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <m.div
                key={season.number}
                className="episode-grid"
                custom={direction}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: 28 * d }),
                  center: { opacity: 1, x: 0 },
                  exit: (d: number) => ({ opacity: 0, x: -28 * d }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18 }}
              >
                {Array.from({ length: season.episodes }, (_, i) => {
                  const number = i + 1;
                  const progress = seasonProgress(season, cp);
                  const state =
                    number < progress
                      ? 'seen'
                      : number === progress
                        ? 'current'
                        : number === progress + 1 && cp.season === season.number
                          ? 'next'
                          : '';
                  return (
                    <m.button
                      key={number}
                      type="button"
                      className={`episode ${state}`}
                      style={
                        { '--delay': `${Math.abs(number - tapped) * 14}ms` } as React.CSSProperties
                      }
                      aria-label={`Episódio ${number}`}
                      aria-pressed={state === 'seen' || state === 'current'}
                      whileTap={{ scale: 0.86 }}
                      whileHover={{ y: -2 }}
                      onClick={() => choose(season.number, number)}
                    >
                      {state === 'seen' || state === 'current' ? <Check size={13} /> : number}
                    </m.button>
                  );
                })}
              </m.div>
            </AnimatePresence>
            <p className="episode-hint">
              Toque em um episódio para marcar até ele. Toque de novo para desfazer.
            </p>
          </>
        )}
      </section>
      <AnimatePresence initial={false}>
        {showDial && (
          <m.section
            key="dial"
            className="ticket-card reveal"
            aria-label="Sua nota"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            <header className="card-eyebrow">Sua nota para a série</header>
            <RatingDial
              label="Nota da série"
              value={personal.draft.rating}
              onChange={(rating) => personal.update({ rating })}
            />
          </m.section>
        )}
      </AnimatePresence>
      <section className="group-card" aria-label="Notas do grupo">
        <header className="card-eyebrow">
          <Users size={14} />O que o grupo achou
        </header>
        <FriendsScale ratings={data.ratings} average={data.average} />
      </section>
    </div>
  );
}
function ManualCounter({
  cp,
  apply,
  verb,
}: {
  cp: Checkpoint;
  apply: (season: number | null, episode: number | null) => void;
  verb: string;
}) {
  const season = cp.season ?? 1;
  const episode = cp.episode ?? 0;
  const step = (kind: 'season' | 'episode', delta: number) => {
    if (kind === 'season') {
      const value = Math.max(1, Math.min(999, season + delta));
      apply(value, Math.max(1, episode));
    } else {
      const value = episode + delta;
      if (value < 1) apply(null, null);
      else apply(season, Math.min(9999, value));
    }
  };
  return (
    <div className="manual-counter">
      {(
        [
          ['season', 'Temporada', cp.season],
          ['episode', 'Episódio', cp.episode],
        ] as const
      ).map(([kind, label, value]) => (
        <div className="stepper" key={kind}>
          <span>{label}</span>
          <div>
            <button
              type="button"
              aria-label={`Menos ${label.toLowerCase()}`}
              onClick={() => step(kind, -1)}
            >
              <Minus size={14} />
            </button>
            <output aria-label={label}>{value ?? '—'}</output>
            <button
              type="button"
              aria-label={`Mais ${label.toLowerCase()}`}
              onClick={() => step(kind, 1)}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="primary-action" onClick={() => step('episode', 1)}>
        <Play size={16} fill="currentColor" />
        {verb} mais um episódio
      </button>
    </div>
  );
}
