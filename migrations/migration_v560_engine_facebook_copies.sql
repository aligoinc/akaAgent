-- V560: chép workflow / block Facebook sang bản riêng cho engine v2 (Q7). SINH TỪ scripts/build-v560-sql.cjs, không sửa tay.
-- Nguồn: scripts/fixtures/engine-v2-facebook/workflows-live-20261116.json (đọc chỉ đọc 2026-11-16T14:15:20.541337+00:00): 14 workflow, 84 block.
-- Chỉ dữ liệu. Bộ cũ không nạp bản "[engine]" (chọn workflow qua auto_campaign_actions.workflow_id, không đổi); engine chọn qua
-- auto_engine_workflows. Code block chép trong DB; preflight kiểm md5 code từng block và đồ thị từng workflow đúng bản đã đọc.
-- Gỡ: rollback_v560_engine_facebook_copies.sql (xoá sổ + danh mục; để nguyên workflow / block "[engine]").
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v560_%') THEN
      RAISE EXCEPTION 'V560 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_workflows') IS NULL THEN
    RAISE EXCEPTION 'V560 cần V556 (bảng sổ chép, danh mục workflow engine)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_copies) OR EXISTS (SELECT 1 FROM public.auto_engine_workflows)
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps) THEN
    RAISE EXCEPTION 'V560: đã có sổ chép / danh mục engine Facebook';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name LIKE '[engine] %') OR EXISTS (SELECT 1 FROM public.auto_workflows WHERE name LIKE '[engine] %') THEN
    RAISE EXCEPTION 'V560: đã có block / workflow "[engine]" (lần gỡ trước để lại?), dọn trước rồi chạy lại';
  END IF;
  -- Code từng block đúng bản đã đọc (bảng chép và danh mục bước dựa trên bản này).
  SELECT string_agg(v.id::text, ', ') INTO v_bad FROM (VALUES (1, 'd41d8cd98f00b204e9800998ecf8427e'), (2, 'd41d8cd98f00b204e9800998ecf8427e'), (4, 'd41d8cd98f00b204e9800998ecf8427e'), (5, 'd4c57e147ff32ee34f078054b8ee2e93'), (20, '8df12ecd2bde4c3d195bb886b3c0df79'), (21, 'edaf9168d99d318d08f48acc3eab0144'), (27, '62b842acb7b45fdf4aad976775db3c56'), (28, 'd6c5e9a59ac466b0ba8101bf3f74d4a2'), (29, '61194e7c1fb6209a292c30694e27efac'), (30, '4389c339487296b488aa010edb3ddcef'), (31, 'eec629d6f10f6d6dcdf0ccd14a0cd1a9'), (32, '351b610c082252c7bce43ec265a631dc'), (33, '44b7afc900086ae9f18a3944f9910b70'), (34, '30126bae87ff755164c80dbffda9d263'), (35, 'e65666791c6edd4dfe9fc6bcecb49ada'), (36, 'a05d68d56972e9192da4c4881e3fee65'), (37, '0a417bced486afa5f7300e2af1536d9d'), (38, 'fb11e928304d044f50f3a11a93821463'), (39, 'e8712f551ee23df11353fca29c15525a'), (612, '53b25536ff2817b75617e345df5ea408'), (2074, 'e7bac83982f82367dbd66c3c1a66b5bd'), (2554, '68fe2e31c508a4657e4de1470eedf01b'), (2599, 'e7e1c871b792dc43cc3abf193e551a61'), (2600, '4447307bc327781dae154ee8f06d96d1'), (2601, 'ddce66dba9f4a21a183c77e6a01baee8'), (2602, '8bba818627fde233ec1b9421c2a7bf7d'), (2603, 'ffb7329bfa391d3e9a747c4562974cc6'), (2604, '20b1a8e8f90d5d83811ba24cae1249ce'), (2605, '683ec3378ed300612211e91a7163b72a'), (2614, '8ecbc8b429a48ae1af25085f4742a7fa'), (2615, '67b3e20da40485d2e73cf517203ae88a'), (2616, '83bcdb4081685f2c858f4e0937348767'), (2620, '104881f824eb3ea0765a1160862a1cfc'), (2624, 'e433ac1a58ac08535c53010fdc5e9ba7'), (2625, 'f140852a8cea1eb236e8e4cd61176a09'), (2626, 'cc85473ba26554663972e4422fc62a41'), (2627, 'ffeb17c8967ab564098da8f641650674'), (2629, '645d1a88189ac8dc6989f9058756eabe'), (2638, '009c8a8073f2a9dce394f3544f0e271f'), (2639, '90f95c262b940285c7f6f252183d934f'), (2669, '21136df214634903530caa9d40c3eefb'), (2670, 'dfc2ad1c4bf6a6831968cedf206807ed'), (2671, 'aaf3d54ca1041881d67073359168647f'), (2672, 'f279e39fa90960d939fe59803e253f33'), (2674, 'f0715301148a3638b583784c2724c3a0'), (2676, 'a3f89671b43fbb8631c01042ad36cab2'), (2678, 'f5aa7e10d3b3161ae25e3e98ff3f112c'), (2679, '86217720edd3c1c04495c7c061d26bea'), (2700, 'b37265faa06b09328f03cf396cada23f'), (2701, '0210577bdd0ad903ec293a4c049cd999'), (2702, '8231de8d27d4a8ef9d2ad5c9441fd2e0'), (2703, '1e24e978e34b08b778d66075ef25fb89'), (2704, '94d7b477f6bd6b49698b44bb0fa650ca'), (2705, '574f7c5c2a81bae0cde37f68a0cad089'), (2706, '9105a60844ad6defe21c828ef004c795'), (2707, '6335a9a666cb67bdd6604cd33c9a8e29'), (2708, 'f20fed2c18410ce56c64eba954f019b5'), (2709, '91a6dcba5d1b6ce801087b0a4406e0cc'), (2710, '183af4001118b2caf939ff3f9e1c0a22'), (2711, '3d274008eed248e013028c1e09e1b243'), (2712, '16887a33d5593b1668af511d36ee5f0a'), (2713, 'e50f1dae914863609917bace6b8bff8e'), (2714, '38175586a1f8651540f7265ed4d3fa2b'), (2715, '71bf21addc966e91845edc89b43dd3d8'), (2716, '0c535c727d632fe545b9790451aa4119'), (2717, '16114084f2b8de479b91b43c946d7a5d'), (2718, 'b001a18aa3c3dbb33cf2490386f5b92f'), (2719, '6acf4fe3889a851e176aee9ceba9f5a4'), (2720, '0d19081ebb3b203827b3469e9b431c68'), (2721, '8d099ee22b98b835feec0d7fc1ffbb4c'), (2722, 'db34c5a1f8223560b4ed5ea6fa970db7'), (2723, '91e809e62911aea2c2391ae14676dc3b'), (2724, 'c78abe7a868cedbd8db485278d109ba7'), (2793, '64c2e8c2337c17a859e8f085ac83f2e2'), (2794, 'ba3dde28271aa8c9cff3528f3591efe0'), (2819, '39ff2a24ff1338afafba00e509d463d5'), (2824, 'ea4f24997390f946082cd12936fe24c9'), (2829, '8c88628c05657002ea0675ae2ff3eedb'), (2830, '1dd3d71d643031445cd720e36b9c6974'), (2831, 'a885ba0a1fa24a31e16c03cd2c4da2a9'), (2832, '110beef02e1f403157659d0bc4b1a321'), (2834, 'fde5a4b592c39cfff6e4b5c22677b771'), (2835, '6e915411019a6b09db768797c406b743'), (2836, 'f5425652ce36b9f43d2126227b16cda0')) v(id, md5)
    LEFT JOIN public.auto_blocks b ON b.id = v.id
   WHERE b.id IS NULL OR md5(b.code) IS DISTINCT FROM v.md5;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V560: code block đã đổi / không còn so với bản đã đọc: %, đọc lại (read-workflows.cjs) và sinh lại', v_bad; END IF;
  -- Đồ thị từng workflow và workflow của từng loại chiến dịch đúng bản đã đọc.
  SELECT string_agg(v.purpose, ', ') INTO v_bad FROM (VALUES
    ('facebook_comment_seeding', 157, '997f6d5af5f35d61fffe8f0a6287b564'),
    ('facebook_comment_seeding_post', 207, '1ee0f7c880e8afa2f205e649d22c2ff9'),
    ('facebook_find_data_group', 206, '0805b2f6a9e5062ac22c9c6b83549329'),
    ('facebook_find_data_search', 239, 'a7159797e8b002fe486af069026850dc'),
    ('facebook_group_invite', 304, '2c0b07f9029d28c0e1c00380a89b85cd'),
    ('facebook_group_post', 1, 'c29504544a7900ae11ccda48f9ae6d73'),
    ('facebook_join_group', 284, '2497dcc12bc7e7e84f63fee8990cc9e4'),
    ('facebook_message_friend', 3, '0699561d8bf0531d7553874634ddebbd'),
    ('facebook_message_uid', 208, 'b579a38dfb165ace89672ddde24485fc'),
    ('facebook_newsfeed_interaction', 238, 'e438fa1760a7cfc70634d9c0461913f3'),
    ('facebook_page_post', 226, '0829b08893c56fcddc99a9b9d6ca23f0'),
    ('facebook_page_to_message', 227, 'aaa7d7b40c3566af360bfe6dfea1d177'),
    ('facebook_timeline_post', 2, '833f37b629c90021a8651abce91c8a30'),
    ('rest_browse', 314, '7c44ad02c50ad13a1746bbf76d75c883')) v(purpose, id, md5)
    LEFT JOIN public.auto_workflows w ON w.id = v.id
   WHERE w.id IS NULL OR md5(w.nodes::text || w.edges::text) IS DISTINCT FROM v.md5
      OR (v.purpose <> 'rest_browse' AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_actions c WHERE c.id = v.purpose AND c.workflow_id = v.id))
      OR (v.purpose = 'rest_browse' AND w.name <> 'fb_campaign_rest_browse');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V560: workflow đã đổi so với bản đã đọc: %, đọc lại và sinh lại', v_bad; END IF;
END $pre$;

-- 1. Block: "[engine] <tên>", giữ nguyên code / cấu hình; sổ cặp kèm md5 lúc chép.
WITH src AS (SELECT * FROM public.auto_blocks WHERE id = ANY (ARRAY[1, 2, 4, 5, 20, 21, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 612, 2074, 2554, 2599, 2600, 2601, 2602, 2603, 2604, 2605, 2614, 2615, 2616, 2620, 2624, 2625, 2626, 2627, 2629, 2638, 2639, 2669, 2670, 2671, 2672, 2674, 2676, 2678, 2679, 2700, 2701, 2702, 2703, 2704, 2705, 2706, 2707, 2708, 2709, 2710, 2711, 2712, 2713, 2714, 2715, 2716, 2717, 2718, 2719, 2720, 2721, 2722, 2723, 2724, 2793, 2794, 2819, 2824, 2829, 2830, 2831, 2832, 2834, 2835, 2836]::bigint[])),
ins AS (
  INSERT INTO public.auto_blocks (name, description, icon, category, kind, system_type, code, config_schema, output_schema, default_config, is_builtin,
    staff_id, organization_id)
  SELECT '[engine] ' || s.name, s.description, s.icon, s.category, s.kind, s.system_type, s.code, s.config_schema, s.output_schema, s.default_config,
         s.is_builtin, s.staff_id, s.organization_id
    FROM src s ORDER BY s.id
  RETURNING id, name, code)
INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy, copied_at)
SELECT i.id, s.id, md5(s.code), md5(i.code), now() FROM ins i JOIN src s ON i.name = '[engine] ' || s.name;

-- 2. Workflow: "[engine] <tên>", node giữ id và tên block, blockId trỏ sang bản engine (giữ kiểu số / chuỗi của JSON gốc).
WITH src AS (
  SELECT v.purpose, w.* FROM (VALUES ('facebook_comment_seeding', 157), ('facebook_comment_seeding_post', 207), ('facebook_find_data_group', 206), ('facebook_find_data_search', 239), ('facebook_group_invite', 304), ('facebook_group_post', 1), ('facebook_join_group', 284), ('facebook_message_friend', 3), ('facebook_message_uid', 208), ('facebook_newsfeed_interaction', 238), ('facebook_page_post', 226), ('facebook_page_to_message', 227), ('facebook_timeline_post', 2), ('rest_browse', 314)) v(purpose, id)
  JOIN public.auto_workflows w ON w.id = v.id),
remapped AS (
  SELECT s.purpose, s.id AS source_id, s.name, s.description, s.edges, s.variables_schema, s.default_variables, s.is_builtin, s.staff_id, s.organization_id,
         md5(s.nodes::text || s.edges::text) AS source_md5,
         (SELECT coalesce(jsonb_agg(CASE WHEN c.engine_block_id IS NULL THEN n.value
                   WHEN jsonb_typeof(n.value->'blockId') = 'string' THEN jsonb_set(n.value, '{blockId}', to_jsonb(c.engine_block_id::text))
                   ELSE jsonb_set(n.value, '{blockId}', to_jsonb(c.engine_block_id)) END ORDER BY n.ordinality), '[]'::jsonb)
            FROM jsonb_array_elements(s.nodes) WITH ORDINALITY n
            LEFT JOIN public.auto_engine_block_copies c
              ON (n.value->>'blockId') ~ '^[0-9]+$' AND c.source_block_id = (n.value->>'blockId')::bigint) AS nodes
    FROM src s),
ins AS (
  INSERT INTO public.auto_workflows (name, description, nodes, edges, variables_schema, default_variables, is_builtin, staff_id, organization_id)
  SELECT '[engine] ' || r.name, r.description, r.nodes, r.edges, r.variables_schema, r.default_variables, r.is_builtin, r.staff_id, r.organization_id
    FROM remapped r
  RETURNING id, name, nodes, edges)
INSERT INTO public.auto_engine_workflows (purpose, workflow_id, source_workflow_id, source_md5, engine_md5, copied_at, is_active)
SELECT r.purpose, i.id, r.source_id, r.source_md5, md5(i.nodes::text || i.edges::text), now(), true
  FROM ins i JOIN remapped r ON i.name = '[engine] ' || r.name;

-- 3. Danh mục bước cho bản engine (phương án mục 3.5).
INSERT INTO public.auto_engine_block_steps (block_id, workflow_id, node_id, action_code, step_kind, commit_level, send_ops, reviewed_code_md5, note)
SELECT c.engine_block_id, ew.workflow_id, NULL, v.action, v.kind, v.level, v.ops, c.engine_md5_at_copy, 'V560: ' || v.note
  FROM (VALUES
    (27, NULL, 'result', NULL, 1, '[]'::jsonb, 'Mở hộp đăng bài: block trả FB35 / FB40 khi không mở được (not_committed).'),
    (30, 'facebook_group_post', 'delivery', 'fb_post_group', 2, '["click:fb_post_button"]'::jsonb, 'Bấm Đăng (cú gửi cuối: click fb_post_button).'),
    (30, 'facebook_timeline_post', 'delivery', 'fb_post_my_profile', 2, '["click:fb_post_button"]'::jsonb, 'Bấm Đăng (cú gửi cuối: click fb_post_button).'),
    (2624, NULL, 'result', NULL, 1, '[]'::jsonb, 'Chờ form đăng bài đóng sau cú bấm Đăng.'),
    (2836, NULL, 'delivery', 'fb_post_group', 1, '[]'::jsonb, 'Chia sẻ nguyên bài vào nhóm: bấm trong page.evaluate.'),
    (34, NULL, 'delivery', 'fb_comment', 2, '["press:Enter"]'::jsonb, 'Comment theo vị trí: gửi bằng Enter.'),
    (2074, NULL, 'delivery', 'fb_like_post', 1, '[]'::jsonb, 'Thích bài: bấm trong page.evaluate; bấm lại là bỏ thích.'),
    (2616, NULL, 'delivery', 'fb_comment', 2, '["press:Enter"]'::jsonb, 'Comment bài hiện tại (V472): gửi bằng Enter.'),
    (2615, NULL, 'delivery', 'fb_like_post', 1, '[]'::jsonb, 'Thích bài hiện tại: bấm trong page.evaluate.'),
    (2793, NULL, 'idempotent', 'fb_join_group', 1, '[]'::jsonb, 'Tham gia nhóm: làm lại vô hại.'),
    (33, NULL, 'idempotent', 'fb_join_group', 1, '[]'::jsonb, 'Tự tham gia nhóm khi chưa là thành viên.'),
    (32, NULL, 'idempotent', NULL, 1, '[]'::jsonb, 'Rời nhóm khi đang chờ duyệt (không tính lượt).'),
    (37, NULL, 'delivery', 'fb_post_my_profile', 2, '["click:fb_reels_publish_button"]'::jsonb, 'Đăng reels (cú gửi cuối: click fb_reels_publish_button).'),
    (36, NULL, 'delivery', 'fb_post_my_profile', 1, '[]'::jsonb, 'Chia sẻ bài lên trang cá nhân: "Chia sẻ ngay" có thể đăng luôn nên mức 1.'),
    (38, 'facebook_message_friend', 'delivery', 'fb_message_friend', 2, '["press:Enter"]'::jsonb, 'Gửi tin nhắn bạn bè: gửi bằng Enter.'),
    (38, 'facebook_message_uid', 'delivery', 'fb_message_stranger', 2, '["press:Enter"]'::jsonb, 'Gửi tin nhắn theo UID: gửi bằng Enter.'),
    (39, NULL, 'delivery', 'fb_add_friend', 1, '[]'::jsonb, 'Kết bạn: nhiều nhánh bấm (thêm bạn / chấp nhận) nên mức 1.'),
    (2669, NULL, 'delivery', 'fb_post_page', 1, '[]'::jsonb, 'Đăng Page qua Graph API.'),
    (2672, NULL, 'delivery', 'fb_post_page', 1, '[]'::jsonb, 'Đăng Page bằng giao diện: bấm trong page.evaluate.'),
    (2679, NULL, 'delivery', 'fb_message_page_inbox_customer', 1, '[]'::jsonb, 'Gửi tin hộp thư Page: bấm trong page.evaluate.'),
    (2705, NULL, 'delivery', 'fb_like_post', 1, '[]'::jsonb, 'Newsfeed: thích (page.evaluate).'),
    (2710, NULL, 'delivery', 'fb_comment', 2, '["press:Enter"]'::jsonb, 'Newsfeed: gửi comment bằng Enter.'),
    (2819, NULL, 'delivery', 'fb_group_invite', 1, '[]'::jsonb, 'Mời bạn vào nhóm theo lô (page.evaluate).'),
    (2671, NULL, 'session', NULL, 1, '[]'::jsonb, 'Đổi danh tính Page (phải khôi phục, phương án mục 7.6).')
  ) v(source_block_id, purpose, kind, action, level, ops, note)
  JOIN public.auto_engine_block_copies c ON c.source_block_id = v.source_block_id
  LEFT JOIN public.auto_engine_workflows ew ON ew.purpose = v.purpose;

DO $post$
DECLARE v_n integer; v_bad text;
BEGIN
  SELECT count(*) INTO v_n FROM public.auto_engine_block_copies;
  IF v_n <> 84 THEN RAISE EXCEPTION 'V560 postflight: % block chép, cần 84', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_workflows WHERE is_active;
  IF v_n <> 14 THEN RAISE EXCEPTION 'V560 postflight: % workflow engine, cần 14', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE is_active;
  IF v_n <> 24 THEN RAISE EXCEPTION 'V560 postflight: % dòng danh mục bước, cần 24', v_n; END IF;
  -- Workflow engine không trỏ tới block bản cũ nào.
  SELECT string_agg(DISTINCT ew.purpose || ':' || (n.value->>'blockId'), ', ') INTO v_bad
    FROM public.auto_engine_workflows ew JOIN public.auto_workflows w ON w.id = ew.workflow_id
    CROSS JOIN LATERAL jsonb_array_elements(w.nodes) n
   WHERE (n.value->>'blockId') ~ '^[0-9]+$' AND (n.value->>'blockId')::bigint > 0
     AND NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies c WHERE c.engine_block_id = (n.value->>'blockId')::bigint);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V560 postflight: workflow engine trỏ tới block không phải bản engine: %', v_bad; END IF;
  -- Không lệch ngay sau khi chép; loại chiến dịch nào cũng có workflow engine.
  IF EXISTS (SELECT 1 FROM public.aka_agent_engine_block_copy_drift) THEN RAISE EXCEPTION 'V560 postflight: view lệch có dòng ngay sau khi chép'; END IF;
  SELECT string_agg(c.id, ', ') INTO v_bad FROM public.auto_campaign_actions c
   WHERE c.flatform_type = 'facebook' AND c.is_active AND NOT c.is_delete AND c.workflow_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.auto_engine_workflows ew WHERE ew.purpose = c.id AND ew.is_active);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V560 postflight: loại chiến dịch chưa có workflow engine: %', v_bad; END IF;
  -- Bộ cũ không đổi: workflow của từng loại chiến dịch vẫn là bản cũ.
  IF EXISTS (SELECT 1 FROM public.auto_campaign_actions c JOIN public.auto_workflows w ON w.id = c.workflow_id WHERE w.name LIKE '[engine] %') THEN
    RAISE EXCEPTION 'V560 postflight: auto_campaign_actions trỏ tới workflow "[engine]"';
  END IF;
END $post$;

COMMIT;
