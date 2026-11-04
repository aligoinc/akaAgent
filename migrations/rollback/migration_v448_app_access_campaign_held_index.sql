-- Run the exact-definition/validity postcheck immediately before this statement.
-- Also compare the OID to the recorded deployment receipt. Abort on any drift.
-- A standalone statement, outside a transaction. Removes only the new index;
-- never disable V447 or restore earlier RPC/ACL/RLS as part of this rollback.
DROP INDEX CONCURRENTLY public.idx_auto_campaigns_app_access_held_account;
