-- Manual data migration for the app version that uses contact_type='person'.
--
-- Run this only when all users have updated to the app version that reads
-- Facebook people as contact_type='person'. Running it earlier will make old
-- app versions stop seeing their friend-list contacts.

BEGIN;

UPDATE public.auto_account_contacts
SET is_friend = true,
    updated_at = now()
WHERE contact_type = 'friend';

UPDATE public.auto_account_contacts
SET contact_type = 'person',
    updated_at = now()
WHERE contact_type = 'friend';

COMMIT;
