import type { Member, ShelfKind } from './index';

export const rankingBadges = {
  debut: { name: 'Sessão de estreia', description: 'Veja seu primeiro filme no clube.' },
  credits: {
    name: 'Créditos finais',
    description: 'Conclua uma temporada com contagem conhecida.',
  },
  critic: {
    name: 'Olhar crítico',
    description: 'Avalie cinco títulos que você já começou a assistir.',
  },
  company: {
    name: 'Em boa companhia',
    description: 'Veja um título que outros dois participantes também viram.',
  },
} as const;
export type RankingBadge = keyof typeof rankingBadges;
export interface RankingEntry extends Member {
  position: number | null;
  count: number;
  rated: number;
  seasons: number;
  badges: RankingBadge[];
  badge: RankingBadge | null;
}
export interface ClubRanking {
  kind: ShelfKind;
  period: 'month' | 'all';
  month: string;
  entries: RankingEntry[];
  clubTitles: number;
  participation: { enabled: boolean; badge: RankingBadge | null; badges: RankingBadge[] };
}
