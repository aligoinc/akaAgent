-- Rollback V470. Run ALONE (not inside a transaction).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_zalo_users_friends_account_created;
