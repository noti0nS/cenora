import { z } from 'zod';
export * from './avatars';

export const personalStatuses = ['want', 'watching', 'watched', 'dropped'] as const;
export const groupStatuses = ['planned', 'watching', 'watched'] as const;
export type PersonalStatus = (typeof personalStatuses)[number];
export type GroupStatus = (typeof groupStatuses)[number];
export type ShelfKind = 'movie' | 'tv' | 'anime';
export const personalLabels: Record<PersonalStatus, string> = {
  want: 'Quero assistir',
  watching: 'Assistindo',
  watched: 'Assistido',
  dropped: 'Abandonei',
};
export const groupLabels: Record<GroupStatus, string> = {
  planned: 'Planejado',
  watching: 'Assistindo',
  watched: 'Assistido',
};
export const displayName = z.string().trim().min(2, 'Use pelo menos 2 caracteres.').max(40);
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Confira o e-mail.')
  .pipe(z.email('Confira o e-mail.'));
export const emailCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Digite os 6 números do código.');
export const emailStartSchema = z.object({
  email: emailSchema,
  mode: z.enum(['login', 'attach']).default('login'),
  turnstileToken: z.string().trim().max(4096).optional(),
});
export const emailVerifySchema = z.object({
  email: emailSchema,
  code: emailCodeSchema,
  mode: z.enum(['login', 'attach']).default('login'),
  merge: z.boolean().default(false),
});
export const claimSchema = z.object({
  code: z.string().trim().min(12).max(128),
});
export const linkSchema = z.object({
  recoveryCode: z.string().trim().min(12).max(128),
  name: displayName.optional(),
  token: z.string().trim().min(12).max(128).optional(),
});
export const identitySchema = z.object({
  name: displayName,
  token: z.string().trim().min(12).max(128),
});
export const inviteJoinSchema = z.object({
  name: displayName,
  token: z.string().trim().min(12).max(128),
  password: z.string().trim().max(128).optional(),
});
export const invitePasswordSchema = z.object({
  password: z
    .string()
    .trim()
    .min(4, 'Use pelo menos 4 caracteres.')
    .max(128, 'A senha é longa demais.')
    .nullable(),
});
export const recoverySchema = z.object({
  name: displayName.optional(),
  token: z.string().trim().min(12).max(128),
  recoveryCode: z.string().trim().min(12).max(128),
});
export const createClubSchema = z.object({
  name: displayName,
});
export const listSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.enum(['lavender', 'coral', 'sage', 'blue', 'gold']).default('lavender'),
  icon: z.enum(['film', 'sparkles', 'tv', 'heart', 'moon']).default('film'),
});
export const manualMediaSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['movie', 'tv']),
  isAnime: z.boolean().optional(),
  year: z.number().int().min(1888).max(2100).nullable().optional(),
  synopsis: z.string().max(4000).default(''),
  posterUrl: z
    .string()
    .url()
    .refine((s) => s.startsWith('https://'), 'Use uma URL HTTPS.')
    .nullable()
    .optional(),
  listId: z.string().min(1).max(100),
});
const checkpoint = {
  season: z.number().int().min(1).max(999).nullable().default(null),
  episode: z.number().int().min(1).max(9999).nullable().default(null),
};
export const personalSchema = z.object({
  status: z.enum(personalStatuses),
  rating: z.number().min(0.5).max(10).multipleOf(0.5).nullable(),
  ...checkpoint,
  revision: z.number().int().nonnegative(),
});
export const groupSchema = z.object({
  status: z.enum(groupStatuses),
  ...checkpoint,
  revision: z.number().int().nonnegative(),
});
export const catalogSchema = z.object({
  tmdbId: z.number().int().positive(),
  kind: z.enum(['movie', 'tv']),
  isAnime: z.boolean().optional(),
  listId: z.string().min(1).max(100),
});
export interface Member {
  id: string;
  name: string;
  role: 'owner' | 'member';
  avatarUrl?: string | null;
  avatarRevision?: number;
}
export interface Club {
  id: string;
  name: string;
}
export interface ClubInvite {
  token: string;
  passwordProtected: boolean;
  createdAt: number;
}
export interface Watchlist {
  id: string;
  name: string;
  color: string;
  icon: string;
  revision: number;
  count: number;
}
export interface Personal {
  status: PersonalStatus;
  rating: number | null;
  season: number | null;
  episode: number | null;
  revision: number;
}
export interface Media {
  id: string;
  title: string;
  kind: 'movie' | 'tv';
  isAnime: boolean;
  year: number | null;
  synopsis: string;
  posterUrl: string | null;
  tmdbId: number | null;
  tmdbRating: number | null;
  groupStatus: GroupStatus;
  groupSeason: number | null;
  groupEpisode: number | null;
  revision: number;
  average: number | null;
  ratingCount: number;
  personal: Personal | null;
}
export interface Person {
  id: number;
  name: string;
  character: string;
  photo: string | null;
}
export interface Provider {
  id: number;
  name: string;
  logo: string | null;
}
export interface Season {
  number: number;
  name: string;
  episodes: number;
}
export interface MediaDetails extends Media {
  runtime: number | null;
  seasons: Season[];
  genres: string[];
  cast: Person[];
  imdbId: string | null;
  imdbRating: number | null;
  availability: {
    subscription: Provider[];
    rent: Provider[];
    buy: Provider[];
    link: string | null;
    updatedAt: string | null;
  };
  ratings: { memberId: string; name: string; rating: number }[];
  lists: string[];
  stale: boolean;
}
export interface CatalogResult {
  tmdbId: number;
  title: string;
  kind: 'movie' | 'tv';
  isAnime: boolean;
  year: number | null;
  posterUrl: string | null;
  synopsis: string;
  existingId: string | null;
}
export interface CatalogPage {
  results: CatalogResult[];
  page: number;
  totalPages: number;
  available: boolean;
}
export interface SessionUser {
  id: string;
  email: string | null;
}
export interface ClubOption {
  memberId: string;
  clubId: string;
  name: string;
  role: 'owner' | 'member';
  memberCount: number;
}
export interface SessionState {
  user: SessionUser | null;
  member: Member | null;
  club: Club | null;
  clubs: ClubOption[];
  scoped: boolean;
  catalogAvailable: boolean;
}
export interface ImportEntry {
  title: string;
  originalTitle?: string;
  kind: 'movie' | 'tv';
  category: string;
  tmdbId?: number;
}
export const importSchema = z.object({
  entries: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        originalTitle: z.string().trim().min(1).max(200).optional(),
        kind: z.enum(['movie', 'tv']),
        category: z.string().trim().min(1).max(60),
        tmdbId: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(100),
});
export function normalizeName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}
