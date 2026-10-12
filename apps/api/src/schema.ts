import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  clubId: text('club_id').notNull(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  recoveryHash: text('recovery_hash').notNull(),
  role: text('role').notNull(),
  active: integer('active').notNull(),
});
export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  clubId: text('club_id').notNull(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  color: text('color').notNull(),
  icon: text('icon').notNull(),
  revision: integer('revision').notNull(),
  createdBy: text('created_by').notNull(),
});
