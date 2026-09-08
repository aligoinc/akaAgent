-- Reopen Page Inbox at the start of a campaign execution, even when its URL already matches.
-- Captured from linked production cgjbsmqtfhqvttudyjzq on 2026-09-08, block 2678.
-- The scheduler sets pageInboxForceNavigate until the first successful open in that execution.
-- Later customers retain the current Inbox; clients without the flag retain existing behavior.
-- Preserve the Page configuration, open delay and return contract; leave send block 2679 unchanged.
BEGIN;

DO $migration$
DECLARE
  v_live_code text;
  v_live_row_md5 text;
  v_target_code text := $block_code$
const pageUid = String(vars.pageInboxPageUid || input.pageInboxPageUid || '').trim()
const pageName = String(vars.pageInboxPageName || input.pageInboxPageName || pageUid).trim()
const inboxBaseUrl = String(vars.pageInboxUrl || input.pageInboxUrl || 'https://business.facebook.com/latest/inbox/all').trim()
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)

if (!pageUid) throw new Error('Thiếu Page ID để mở Business Inbox')

const targetUrl = inboxBaseUrl + '?asset_id=' + encodeURIComponent(pageUid)
const currentUrl = String(page.getURL() || '')
if (vars.pageInboxForceNavigate === true || !currentUrl.includes('business.facebook.com/latest/inbox') || !currentUrl.includes(pageUid)) {
  helpers.log('Đang mở inbox của page' + (pageName ? ': ' + pageName : ''))
  await page.navigate(targetUrl)
  await helpers.sleep(stepMs + 5000, signal)
}

return { ok: true, pageUid, pageName, url: targetUrl }
$block_code$;
BEGIN
  SELECT block.code, md5(row_to_json(block)::text)
  INTO v_live_code, v_live_row_md5
  FROM public.auto_blocks AS block
  WHERE block.id = 2678
    AND block.name = 'fb_page_inbox_open'
    AND block.is_builtin = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected built-in Page Inbox open block 2678 was not found';
  END IF;
  IF md5(v_target_code) IS DISTINCT FROM 'f5aa7e10d3b3161ae25e3e98ff3f112c' THEN
    RAISE EXCEPTION 'Page Inbox open target code checksum mismatch';
  END IF;
  IF v_live_code = v_target_code THEN
    RETURN;
  END IF;
  IF md5(v_live_code) IS DISTINCT FROM '2230f16a7d452f10b1de90e54d62b24f'
     OR v_live_row_md5 IS DISTINCT FROM '35dca71fe95a6744c4c530b2a293e30c' THEN
    RAISE EXCEPTION 'Page Inbox open block changed since capture; inspect live row before applying';
  END IF;

  UPDATE public.auto_blocks
  SET code = v_target_code, updated_at = now()
  WHERE id = 2678;
END;
$migration$;

COMMIT;
