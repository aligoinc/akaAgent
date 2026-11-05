-- V466: partial index for the nightly data report (V465) friend counts.
--
-- The snapshot counts friends per Zalo account (total, growth, 13-week line). Without this index each night
-- reads every zalo_users row of every active staff (~4 million heap rows); with it only the ~0.42 million
-- friend rows are read, mostly from the index. Rows with is_fr = 1 only, two columns.
--
-- Run ALONE (not inside a transaction: CREATE INDEX CONCURRENTLY), off-peak. It does not block writes.
-- Rollback: migrations/rollback_v466_zalo_users_friend_index.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_zalo_users_friends_account_created
  ON public.zalo_users (account_id, created_at)
  WHERE is_fr = 1;
