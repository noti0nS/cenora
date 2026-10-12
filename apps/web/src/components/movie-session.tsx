'use client';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Ticket, Users } from 'lucide-react';
import type { GroupStatus, MediaDetails, PersonalStatus } from '@cenora/shared';
import { Segmented } from './ui';
import { RatingDial, FriendsScale } from './rating-dial';
import type { TitleTracking } from './use-title-tracking';

const personalOptions: { value: PersonalStatus; label: string }[] = [
  { value: 'want', label: 'Quero ver' },
  { value: 'watching', label: 'Assistindo' },
  { value: 'watched', label: 'Já vi' },
  { value: 'dropped', label: 'Abandonei' },
];
const groupOptions: { value: GroupStatus; label: string }[] = [
  { value: 'planned', label: 'Vamos ver' },
  { value: 'watching', label: 'Rolando' },
  { value: 'watched', label: 'Vimos juntos' },
];
/** A movie is one sitting: say where you are, then give it a grade. */
export function MovieSession({ data, tracking }: { data: MediaDetails; tracking: TitleTracking }) {
  const { personal, group } = tracking;
  const watched = personal.draft.status === 'watched';
  return (
    <div className="session">
      <section className="ticket-card" aria-label="Sua sessão">
        <header className="card-eyebrow">
          <Ticket size={14} />
          Sua sessão
        </header>
        <Segmented
          label="Seu progresso"
          value={personal.draft.status}
          options={personalOptions}
          onChange={(status) => personal.update({ status })}
        />
        <AnimatePresence initial={false}>
          {(watched || personal.draft.rating !== null) && (
            <m.div
              key="dial"
              className="reveal"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            >
              <RatingDial
                value={personal.draft.rating}
                onChange={(rating) =>
                  personal.update({
                    rating,
                    ...(rating !== null && personal.draft.status !== 'dropped'
                      ? { status: 'watched' as const }
                      : {}),
                  })
                }
              />
            </m.div>
          )}
        </AnimatePresence>
        {!watched && personal.draft.rating === null && (
          <p className="ticket-hint">Marque como visto para abrir a sua nota.</p>
        )}
      </section>
      <section className="group-card" aria-label="Sessão do grupo">
        <header className="card-eyebrow">
          <Users size={14} />
          Sessão do grupo
        </header>
        <Segmented
          label="Progresso do grupo"
          value={group.draft.status}
          options={groupOptions}
          onChange={(status) => group.update({ status })}
        />
        <FriendsScale ratings={data.ratings} average={data.average} />
      </section>
    </div>
  );
}
