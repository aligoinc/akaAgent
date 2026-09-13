-- v279: Recognize data:video/ media for the 180-second Facebook publish timeout.
-- Source: live auto_blocks rows from cgjbsmqtfhqvttudyjzq, captured 2026-09-13.
-- Patch only the video detection line; keep all other live code/config intact.
-- Data-only: no workflow/element changes, DDL, RPC changes or schema reload.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $facebook_data_video$
DECLARE
  v_patch constant jsonb := $data_video_patch$
{
  "blocks": [
    {
      "id": 30,
      "name": "fb_click_post_button",
      "checksum": "6b5ba70e85b3a3540ceb39aa4c2f54a9",
      "source_code_md5": "fdf9228ad1898ff90d3202bdbe9a02aa",
      "before": "const publishHasVideo = publishMedia.some(path => /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(String(path || '')))",
      "after": "const publishHasVideo = publishMedia.some(path => /^data:video\\//i.test(String(path || '')) || /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(String(path || '')))",
      "code_md5": "4389c339487296b488aa010edb3ddcef"
    },
    {
      "id": 2624,
      "name": "fb_verify_group_post_form_closed",
      "checksum": "785bdbe52a43db62f351c61b9b549a2a",
      "source_code_md5": "3ab3caa081a67691171036ab237f922d",
      "before": "const publishHasVideo = publishMedia.some(path => /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(String(path || '')))",
      "after": "const publishHasVideo = publishMedia.some(path => /^data:video\\//i.test(String(path || '')) || /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(String(path || '')))",
      "code_md5": "e433ac1a58ac08535c53010fdc5e9ba7"
    },
    {
      "id": 2672,
      "name": "fb_post_current_identity_ui",
      "checksum": "9ae8b237b10cb439169c225f47c089c3",
      "source_code_md5": "239989a1ee6bd5d91b9a22659014094a",
      "before": "const publishHasVideo = images.some(path => /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(path))",
      "after": "const publishHasVideo = images.some(path => /^data:video\\//i.test(String(path || '')) || /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(path))",
      "code_md5": "448a190506a6470a8b36dd8febd2382e"
    }
  ]
}
$data_video_patch$::jsonb;
  v_item jsonb;
  v_row jsonb;
BEGIN
  -- Check every live row before the first write; fail closed on concurrent edits.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'blocks') ORDER BY (value->>'id')::bigint LOOP
    SELECT to_jsonb(b) INTO v_row FROM public.auto_blocks b
    WHERE b.id=(v_item->>'id')::bigint AND b.name=v_item->>'name' FOR UPDATE;
    IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM v_item->>'checksum'
      OR md5(v_row->>'code') IS DISTINCT FROM v_item->>'source_code_md5' THEN
      RAISE EXCEPTION 'v279 live block % changed; recapture live row before patching',v_item->>'name';
    END IF;
    IF cardinality(string_to_array(v_row->>'code',v_item->>'before'))<>2 THEN
      RAISE EXCEPTION 'v279 block % must contain exactly one video detection line',v_item->>'name';
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'blocks') LOOP
    UPDATE public.auto_blocks SET code=replace(code,v_item->>'before',v_item->>'after'),updated_at=now()
    WHERE id=(v_item->>'id')::bigint;
    IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id=(v_item->>'id')::bigint AND md5(code)=v_item->>'code_md5') THEN
      RAISE EXCEPTION 'v279 block % postflight failed',v_item->>'name';
    END IF;
  END LOOP;
END;
$facebook_data_video$;
COMMIT;
