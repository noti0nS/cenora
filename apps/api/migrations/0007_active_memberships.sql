DROP INDEX members_user_club;
CREATE UNIQUE INDEX members_user_club ON members(user_id, club_id) WHERE user_id IS NOT NULL AND active=1;
