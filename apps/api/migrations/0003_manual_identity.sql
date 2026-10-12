CREATE UNIQUE INDEX media_manual_identity ON media(normalized_title, kind, COALESCE(year, 0)) WHERE tmdb_id IS NULL;
