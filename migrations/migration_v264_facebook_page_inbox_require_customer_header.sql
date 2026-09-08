-- Require a readable, matching customer header before any Page Inbox message input/send.
-- Captured from linked production cgjbsmqtfhqvttudyjzq on 2026-09-08, block 2679.
-- Preserve v263 search recovery, selectors, AI/media delivery and composer settle delay.
-- Missing/empty and mismatched headers receive the existing single recheck delay.
BEGIN;

DO $migration$
DECLARE
  v_code text;
  v_row_md5 text;
  v_target_code text;
  v_old_header text := $old_header$  const headerName = await dom('readText', { selector: headerNameXpath })
  if (headerName && headerName.text && !isSameInboxName(headerName.text, customerName)) {
    await helpers.sleep(stepMs + 1000, signal)
    const recheckedHeaderName = await dom('readText', { selector: headerNameXpath })
    if (recheckedHeaderName && recheckedHeaderName.text && !isSameInboxName(recheckedHeaderName.text, customerName)) {
      return {
        error: 'Không tìm thấy đúng khách hàng trong inbox page',
        reason: 'wrong_conversation',
        customerName,
        customerPsid,
        openedName: recheckedHeaderName.text
      }
    }
  }$old_header$;
  v_new_header text := $new_header$  const headerMatchesCustomer = header => !!(
    header && header.ok === true && normalizeInboxName(header.text) &&
    isSameInboxName(header.text, customerName)
  )
  let headerName = await dom('readText', { selector: headerNameXpath })
  if (!headerMatchesCustomer(headerName)) {
    await helpers.sleep(stepMs + 1000, signal)
    headerName = await dom('readText', { selector: headerNameXpath })
  }
  if (!headerMatchesCustomer(headerName)) {
    const openedName = normalizeInboxName(headerName && headerName.text)
    if (!headerName || headerName.ok !== true || !openedName) {
      throw new Error('Không đọc được tên khách trong inbox page để xác minh người nhận')
    }
    return {
      error: 'Không tìm thấy đúng khách hàng trong inbox page',
      reason: 'wrong_conversation',
      customerName,
      customerPsid,
      openedName
    }
  }$new_header$;
BEGIN
  SELECT block.code, md5(row_to_json(block)::text)
  INTO v_code, v_row_md5
  FROM public.auto_blocks AS block
  WHERE block.id = 2679
    AND block.name = 'fb_send_page_inbox_message'
    AND block.is_builtin = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected built-in Page Inbox send block 2679 was not found';
  END IF;
  IF md5(v_code) = '0188b50b40325ed10d15ff00e76b4461' THEN
    RETURN;
  END IF;
  IF md5(v_code) <> '309936df4519c0a86065a363c7105566'
     OR v_row_md5 <> '76050541c93807f7cf9b26564b41640c' THEN
    RAISE EXCEPTION 'Page Inbox block changed since header-guard capture; inspect live row before applying';
  END IF;
  IF strpos(v_code, v_old_header) = 0 OR
     strpos(substr(v_code, strpos(v_code, v_old_header) + length(v_old_header)), v_old_header) > 0 THEN
    RAISE EXCEPTION 'Expected exactly one captured Page Inbox header guard';
  END IF;
  v_target_code := replace(v_code, v_old_header, v_new_header);
  IF md5(v_target_code) <> '0188b50b40325ed10d15ff00e76b4461' THEN
    RAISE EXCEPTION 'Page Inbox header-guard target checksum mismatch';
  END IF;

  UPDATE public.auto_blocks
  SET code = v_target_code, updated_at = now()
  WHERE id = 2679;
END;
$migration$;

COMMIT;
