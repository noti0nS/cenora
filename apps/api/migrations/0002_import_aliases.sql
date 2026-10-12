CREATE TABLE import_aliases (source_key TEXT NOT NULL, variant_key TEXT NOT NULL, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE, PRIMARY KEY(source_key, variant_key));
CREATE INDEX import_aliases_media ON import_aliases(media_id);
