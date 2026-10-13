import { z } from 'zod';

export const avatarPresets = [
  { id: 'pipoca', name: 'Pipoca' },
  { id: 'gato', name: 'Gato' },
  { id: 'robo', name: 'Robô' },
  { id: 'fantasma', name: 'Fantasma' },
  { id: 'alien', name: 'Alien' },
  { id: 'raposa', name: 'Raposa' },
  { id: 'lua', name: 'Lua' },
  { id: 'oculos', name: 'Óculos 3D' },
] as const;
export const avatarPresetSchema = z.enum([
  'pipoca',
  'gato',
  'robo',
  'fantasma',
  'alien',
  'raposa',
  'lua',
  'oculos',
]);
export const avatarSelectionSchema = z.object({
  preset: avatarPresetSchema.nullable(),
  revision: z.number().int().nonnegative(),
});
export const AVATAR_UPLOAD_BYTES = 512 * 1024;
export const AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
export const AVATAR_SIZE = 512;
