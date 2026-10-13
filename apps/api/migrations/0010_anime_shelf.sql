ALTER TABLE media ADD COLUMN is_anime INTEGER NOT NULL DEFAULT 0 CHECK(is_anime IN (0,1) AND (kind='tv' OR is_anime=0));

UPDATE media SET is_anime=1 WHERE kind='tv' AND EXISTS (
  SELECT 1 FROM list_items li JOIN lists l ON l.id=li.list_id
  WHERE li.media_id=media.id AND l.club_id=media.club_id AND l.normalized_name IN ('anime','animes')
);

UPDATE media SET is_anime=1 WHERE kind='tv' AND EXISTS (
  SELECT 1 FROM provider_cache pc
  WHERE pc.key='details:tv:' || media.tmdb_id AND json_valid(pc.payload)
    AND EXISTS (SELECT 1 FROM json_each(pc.payload,'$.genres') WHERE json_extract(value,'$.id')=16)
    AND EXISTS (SELECT 1 FROM json_each(pc.payload,'$.origin_country') WHERE value='JP')
);
