-- READ ONLY. Run before V445 and save results in the private rollout audit directory.
-- No passwords, tokens, session blobs, phones or provider credentials.
BEGIN READ ONLY;
SELECT id,staff_admin_id,max_staff FROM public.org_organization ORDER BY id;
SELECT id,organization_id,product_id,max_accounts,max_staff,is_deleted,is_chat_sync,expiration_date
FROM public.org_organization_product ORDER BY organization_id,id;
SELECT id,organization_id,is_active,is_admin,deleted_at,expiration_date
FROM public.org_staff ORDER BY organization_id,id;
SELECT id,organization_id,staff_id,flatform_type,is_delete,is_active,is_zalo_server,is_zalo_show_web,zalo_account_id,status
FROM public.auto_accounts ORDER BY organization_id,staff_id,id;
SELECT id,organization_id,auto_account_id,chat_zalo_account_id
FROM public.chat_zalo_account_organization ORDER BY organization_id,id;
COMMIT;
