'use client';
import { Check, Clapperboard, Flag, Star, Users } from 'lucide-react';
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
      <div className="achievement-header">
        <div>
          <h3 id={headingId}>Selos e marcos</h3>
          <p>Conquistas são permanentes. Escolha qual selo acompanha seu nome no clube.</p>
        </div>
        <span className="achievement-counter">
          <strong>{earned}</strong> de 12 marcos
        </span>
      </div>
      <div className="ranking-badge-grid">
        {achievements.map((achievement) => {
          const definition = rankingBadges[achievement.badge];
          const Icon = icons[achievement.badge];
          const unlocked = achievement.tier > 0;
          const equipped = selected === achievement.badge;
          const target = achievement.nextTarget ?? definition.targets[2];
          const fraction = Math.min(achievement.count / target, 1);
          const remaining = Math.max(target - achievement.count, 0);
          return (
            <article
              key={achievement.badge}
              className={`achievement-card ${unlocked ? 'unlocked' : ''} ${equipped ? 'equipped' : ''}`}
              data-tier={achievement.tier}
            >
              <div className="achievement-row-main">
                <span className="achievement-medal" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <div className="achievement-body">
                  <div className="achievement-card-top">
                    <div className="achievement-title-group">
                      <h4>{definition.name}</h4>
                      {unlocked && (
                        <span className="achievement-current-level">
                          {achievementLevels[achievement.tier - 1]}
                        </span>
                      )}
                    </div>
                    {unlocked ? (
                      <button
                        type="button"
                        className="achievement-equip-button"
                        aria-label={`${equipped ? 'Remover' : 'Usar'} selo ${definition.name}`}
                        aria-pressed={equipped}
                        disabled={busy}
                        onClick={() => onChoose(equipped ? null : achievement.badge)}
                      >
                        {equipped && <Check size={12} aria-hidden="true" />}
                        {equipped ? 'No seu perfil' : 'Usar selo'}
                      </button>
                    ) : (
                      <span className="achievement-lock-hint">
                        {remaining === 1
                          ? 'Falta 1 para o bronze'
                          : `Faltam ${remaining} para o bronze`}
                      </span>
                    )}
                  </div>
                  <p className="achievement-description">{definition.description}</p>
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
                  <div className="achievement-meta">
                    <span>
                      <strong>{achievement.count}</strong>
                      {achievement.nextTarget ? ` de ${achievement.nextTarget}` : ''}{' '}
                      {definition.unit}
                      {achievement.earnedAt && (
                        <>
                          {' · '}
                          {new Intl.DateTimeFormat('pt-BR', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'America/Sao_Paulo',
                          }).format(new Date(achievement.earnedAt * 1000))}
                        </>
                      )}
                    </span>
                    <ol className="achievement-levels" aria-label={`Níveis de ${definition.name}`}>
                      {definition.targets.map((goal, i) => (
                        <li
                          key={goal}
                          className={achievement.tier > i ? 'earned' : ''}
                          title={`${achievementLevels[i]}: ${goal} ${definition.unit}`}
                        >
                          <span>{achievementLevels[i]}</span>
                          <strong>{goal}</strong>
                          {achievement.tier > i && <Check size={11} aria-hidden="true" />}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
