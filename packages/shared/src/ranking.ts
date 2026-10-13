import type { Member, ShelfKind } from './index';

export const rankingBadges = {
  debut: {
    name: 'Repertório de cinema',
    description: 'Filmes diferentes que você viu neste clube.',
    unit: 'filmes vistos',
    targets: [5, 15, 30],
  },
  credits: {
    name: 'Créditos finais',
    description: 'Temporadas concluídas, com contagem conhecida de episódios.',
    unit: 'temporadas concluídas',
    targets: [3, 10, 25],
  },
  critic: {
    name: 'Olhar crítico',
    description: 'Títulos diferentes que você assistiu ou começou e avaliou.',
    unit: 'títulos avaliados',
    targets: [10, 25, 50],
  },
  company: {
    name: 'Em boa companhia',
    description: 'Títulos que você e pelo menos outros dois participantes viram.',
    unit: 'histórias em comum',
    targets: [3, 8, 15],
  },
} as const;
export type RankingBadge = keyof typeof rankingBadges;
export const achievementLevels = ['Bronze', 'Prata', 'Ouro'] as const;
export interface EarnedBadge {
  badge: RankingBadge;
  tier: number;
  earnedAt: number;
}
export interface AchievementProgress {
  badge: RankingBadge;
  count: number;
  tier: number;
  earnedAt: number | null;
  nextTarget: number | null;
}
export interface RankingEntry extends Member {
  position: number | null;
  count: number;
  rated: number;
  seasons: number;
  badges: RankingBadge[];
  badge: RankingBadge | null;
  featuredBadge: EarnedBadge | null;
  achievements: EarnedBadge[];
}
export interface ClubRanking {
  kind: ShelfKind;
  period: 'month' | 'all';
  month: string;
  clubEnabled: boolean;
  entries: RankingEntry[];
  clubTitles: number;
  participation: {
    enabled: boolean;
    badge: RankingBadge | null;
    badges: RankingBadge[];
    achievements: AchievementProgress[];
  };
}
