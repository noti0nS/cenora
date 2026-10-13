ALTER TABLE clubs ADD COLUMN ranking_enabled INTEGER NOT NULL DEFAULT 0 CHECK(ranking_enabled IN (0,1));
