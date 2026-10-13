'use client';
import { Award, BadgeCheck, Check, Clapperboard, Flag, Star, Users } from 'lucide-react';
import {
  achievementLevels,
  rankingBadges,
  type AchievementProgress,
  type EarnedBadge,
  type RankingBadge,
} from '@cenora/shared';

const icons = { debut: Clapperboard, credits: Flag, critic: Star, company: Users };
export function MemberBadge({ badge }: { badge: EarnedBadge | null | undefined }) {
  if (!badge) return null;
  const Icon = icons[badge.badge];
  return (
    <span className="ranking-badge" data-tier={badge.tier}>
      <Icon size={13} aria-hidden="true" />
      {rankingBadges[badge.badge].name}
      <span className="badge-level">{achievementLevels[badge.tier - 1]}</span>
    </span>
  );
}

export function AchievementCollection({
  achievements,
  selected,
  busy,
  onChoose,
  headingId,
}: {
  achievements: AchievementProgress[];
  selected: RankingBadge | null;
  busy: boolean;
  onChoose: (badge: RankingBadge | null) => void;
  headingId: string;
}) {
  const earned = achievements.reduce((sum, a) => sum + a.tier, 0);
  return (
    <section className="ranking-achievements" aria-labelledby={headingId}>
      <div className="achievement-intro">
        <div className="achievement-emblem" aria-hidden="true">
          <Award size={28} />
        </div>
        <div>
          <h3 id={headingId}>Seu repertório, suas marcas.</h3>
          <p>Não é uma corrida. Cada conquista conta um pedaço da sua história neste clube.</p>
        </div>
        <strong className="achievement-total">
          {earned}
          <small>de 12 marcos</small>
        </strong>
      </div>
      <p className="achievement-caption">
        Bronze, prata e ouro. Os selos são seus para guardar — escolha qual acompanha seu nome.
      </p>
      <div className="ranking-badge-grid">
        {achievements.map((achievement) => {
          const definition = rankingBadges[achievement.badge];
          const Icon = icons[achievement.badge];
          const unlocked = achievement.tier > 0;
          const equipped = selected === achievement.badge;
          const target = achievement.nextTarget ?? definition.targets[2];
          const fraction = Math.min(achievement.count / target, 1);
          return (
            <article
              key={achievement.badge}
              className={`achievement-card ${unlocked ? 'unlocked' : ''} ${equipped ? 'equipped' : ''}`}
              data-tier={achievement.tier}
            >
              <div className="achievement-card-top">
                <span className="achievement-medal">
                  <Icon size={25} aria-hidden="true" />
                </span>
                <span className="achievement-current-level">
                  {unlocked ? achievementLevels[achievement.tier - 1] : 'Primeiro marco'}
                </span>
              </div>
              <h4>{definition.name}</h4>
              <p>{definition.description}</p>
              <ol className="achievement-levels" aria-label={`Níveis de ${definition.name}`}>
                {definition.targets.map((goal, i) => (
                  <li
                    key={goal}
                    className={achievement.tier > i ? 'earned' : ''}
                    title={`${achievementLevels[i]}: ${goal} ${definition.unit}`}
                  >
                    {achievement.tier > i ? (
                      <BadgeCheck size={15} aria-hidden="true" />
                    ) : (
                      <span aria-hidden="true">{['I', 'II', 'III'][i]}</span>
                    )}
                    <span>
                      {achievementLevels[i]}
                      <strong>{goal}</strong>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="achievement-progress-copy">
                <span>
                  {achievement.count} {definition.unit}
                </span>
                <strong>
                  {achievement.nextTarget ? `Meta: ${achievement.nextTarget}` : 'Coleção completa'}
                </strong>
              </div>
              <div
                className="achievement-meter"
                role="progressbar"
                aria-label={`Progresso de ${definition.name}`}
                aria-valuemin={0}
                aria-valuemax={target}
                aria-valuenow={Math.min(achievement.count, target)}
                aria-valuetext={`${achievement.count} de ${target} ${definition.unit}`}
              >
                <span style={{ width: `${fraction * 100}%` }} />
              </div>
              <div className="achievement-card-footer">
                <small>
                  {achievement.earnedAt
                    ? `Conquistada em ${new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(achievement.earnedAt * 1000))}`
                    : `Faltam ${Math.max(target - achievement.count, 0)} para o bronze`}
                </small>
                <button
                  type="button"
                  aria-label={`${equipped ? 'Remover' : 'Usar'} selo ${definition.name}`}
                  aria-pressed={equipped}
                  disabled={!unlocked || busy}
                  onClick={() => onChoose(equipped ? null : achievement.badge)}
                >
                  {equipped && <Check size={12} aria-hidden="true" />}
                  {equipped ? 'No seu perfil' : unlocked ? 'Usar selo' : 'A conquistar'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
