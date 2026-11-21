#!/usr/bin/env node
// V618: quét data từ website (nhatot, batdongsan, Trang Vàng) chạy bằng engine v2 trên Desktop. Phương án: docs/WEB_DATA_SCAN_PLAN.md mục 7
// (anh duyệt giao diện + kế hoạch code 21/11/2026; anh chốt: mỗi lần hiện SĐT / mở trang ghi một dòng Lịch sử hành động, tin đã hiện số trong
// cùng tổ chức 30 ngày thì dùng lại số; giới hạn chung mặc định 100 / ngày, trần 500, nghỉ 15 giây, thấp nhất 10).
//
// Ba phần, apply đúng thứ tự, mỗi phần một giao dịch:
//   p1 (DDL ngắn): bảng private.auto_web_scan_seen (tin đã quét theo chiến dịch) + private.auto_web_scan_listings (số đã hiện theo tổ chức).
//   p2 (hàm): hàm mới (công tắc tổ chức, RPC Desktop đọc / ghi tin đã quét, dọn) + vá thân production của claim / report / hạn mức / kết thúc
//       lượt / snapshot tài khoản Desktop / gói quyền dùng app (kiểm md5 pg_get_functiondef trước / sau, giữ chủ sở hữu + quyền).
//   p3 (dữ liệu): công tắc web_scan.campaigns (tổ chức 1), 3 mã thao tác, 3 loại chiến dịch (is_active = false: Desktop đang phát hành coi
//       nền tảng lạ là Facebook nên dòng bật sẵn sẽ hiện cho mọi tổ chức có gói Facebook), block + element, mã lỗi WB01–WB04 + chính sách.
//
// Thân hàm production đọc chỉ đọc 21/11/2026 ở scripts/fixtures/web-scan/live-20261121/ (md5 khớp production lúc đọc).
// Code block ở scripts/web-scan/blocks/*.js (block: *.block.js; script chạy trong trang: page-common.js + *.page.js).
// Chạy: node scripts/build-v618-sql.cjs (ghi 3 migration + 3 bản gỡ). Không sửa tay các file sinh ra.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE_DIR = path.join(ROOT, 'scripts/fixtures/web-scan/live-20261121')
const BLOCK_DIR = path.join(ROOT, 'scripts/web-scan/blocks')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v618'
const V = VERSION.toUpperCase()
const NAMES = {
  p1: `migration_${VERSION}_web_data_scan_p1`,
  p2: `migration_${VERSION}_web_data_scan_p2`,
  p3: `migration_${VERSION}_web_data_scan_p3`,
  r1: `rollback_${VERSION}_web_data_scan_p1`,
  r2: `rollback_${VERSION}_web_data_scan_p2`,
  r3: `rollback_${VERSION}_web_data_scan_p3`
}

const SITES = ['nhatot', 'batdongsan', 'yellowpages']
const ACTION_IDS = { nhatot: 'web_find_data_nhatot', batdongsan: 'web_find_data_batdongsan', yellowpages: 'web_find_data_yellowpages' }
const ACTION_CODES = { nhatot: 'web_nhatot_phone', batdongsan: 'web_batdongsan_phone', yellowpages: 'web_yellowpages_page' }
// Tên thao tác / loại chiến dịch / câu mã lỗi: anh duyệt 21/11/2026 qua hộp chọn.
const ACTION_NAMES = { nhatot: 'Hiện SĐT Nhà Tốt', batdongsan: 'Hiện SĐT Batdongsan', yellowpages: 'Mở trang Trang Vàng' }
const CAMPAIGN_NAMES = {
  nhatot: 'Tìm data Nhà Tốt',
  batdongsan: 'Tìm data Batdongsan',
  yellowpages: 'Tìm data Trang Vàng'
}
const SETTING_KEY = 'web_scan.campaigns'
const SETTING_VALUE = JSON.stringify({
  organizationIds: [1],
  limits: { defaultDaily: 100, maxDaily: 500, defaultSleepSeconds: 15, minSleepSeconds: 10 },
  batdongsanLoginCookies: []
})

// ---------------------------------------------------------------------------------------------------------------------------------------
// Thân hàm production

/** Chữ ký → [tệp, md5 pg_get_functiondef production 21/11/2026]. */
const LIVE = {
  claim: { sig: 'public.aka_agent_engine_claim_target_v1(jsonb)', file: 'aka_agent_engine_claim_target_v1.sql', md5: '1ea2f16387985542b48dfbda6965c790' },
  report: { sig: 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)', file: 'aka_agent_engine_report_v1.sql', md5: '09fe52a53d9f419207506f1033bdb800' },
  limit: { sig: 'public.aka_agent_engine_action_limit(bigint,bigint,text)', file: 'aka_agent_engine_action_limit.sql', md5: '5c7e8c79040723a3c6f21f7565d58d81' },
  finish: { sig: 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)', file: 'aka_agent_engine_finish_campaign_v2.sql', md5: '92c119f20d47ea5eee0770b5e6498d41' },
  snapshot: { sig: 'public.aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)', file: 'aka_agent_desktop_account_snapshot.sql', md5: 'e4dbe2f2dba71e96c0b669ef1a79179b' },
  packages: { sig: 'private.app_access_packages(bigint,text,text)', file: 'app_access_packages.sql', md5: '4f2251c2a5848ae174481a97fe02fe72' },
  drafts: { sig: 'public.aka_agent_campaign_drafts(bigint,bigint,text,text,text,uuid,jsonb)', file: 'aka_agent_campaign_drafts.sql', md5: 'a943ffce5b3bb36020a3cf5c7f548b85' },
  closeRun: { sig: 'public.aka_agent_engine_close_run_v1(bigint,text)', file: 'aka_agent_engine_close_run_v1.sql', md5: '72b8c9698e7176640b0e1911c8c5c49f' }
}

function readLive(key) {
  const item = LIVE[key]
  const text = fs.readFileSync(path.join(LIVE_DIR, item.file), 'utf8')
  if (md5(text) !== item.md5) throw new Error(`${item.file}: md5 ${md5(text)} khác bản production đã đọc (${item.md5})`)
  return text
}

function patch(text, from, to, label) {
  const n = text.split(from).length - 1
  if (n !== 1) throw new Error(`${label}: cần đúng 1 chỗ, thấy ${n}`)
  return text.replace(from, () => to)
}

// claim: cổng nền tảng web + số lượt còn lại của mã thao tác web.
const CLAIM_FB_GATE = `  v_is_facebook := lower(btrim(coalesce(a.flatform_type, ''))) = 'facebook';
  IF v_is_facebook THEN
    IF v_runtime <> 'desktop' THEN RETURN jsonb_build_object('status', 'runtime_not_owner'); END IF;
    IF NOT public.aka_agent_engine_facebook_org_enabled(coalesce(c.organization_id, a.organization_id)) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
  END IF;
`
const CLAIM_WEB_GATE = CLAIM_FB_GATE + `  -- Quét data website (tài khoản "Website"): chỉ Desktop, chỉ tổ chức bật web_scan.campaigns. Kiểm mỗi lần nhận lượt; tắt có hiệu lực ở lần
  -- nhận kế tiếp. Tài khoản web không cần gói (anh chốt: mở theo tổ chức, lúc đầu chỉ tổ chức 1).
  IF lower(btrim(coalesce(a.flatform_type, ''))) = 'web' THEN
    IF v_runtime <> 'desktop' THEN RETURN jsonb_build_object('status', 'runtime_not_owner'); END IF;
    IF NOT public.aka_agent_web_scan_org_enabled(coalesce(c.organization_id, a.organization_id)) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
  END IF;
`
const CLAIM_DECLARE = `  v_is_facebook boolean;
`
const CLAIM_DECLARE_NEW = CLAIM_DECLARE + `  -- Quét data website: số lượt đã dùng trong ngày / trong khung giờ của mã thao tác web (để trả số lượt còn lại).
  v_web_day numeric;
  v_web_window numeric;
`
const CLAIM_REMAINING_ANCHOR = `    -- V571: người nhận đã biết hỏng: bước tìm SĐT bỏ qua kể cả khi đang khoá / hết lượt`
const CLAIM_REMAINING = `    -- Quét data website: một data (từ khoá) tốn nhiều lượt (mỗi lần hiện SĐT / mở trang một lượt), nên trả số lượt còn lại trong ngày và
    -- trong khung giờ để block dừng đúng lúc; hết lượt giữa từ khoá thì từ khoá về hàng đợi, lần nhận sau chờ theo hạn mức như mọi thao tác.
    IF v_code LIKE 'web\\_%' AND v_decision->>'decision' = 'allow' AND v_limit IS NOT NULL THEN
      v_web_day := NULL; v_web_window := NULL;
      SELECT CASE WHEN s.count_date = v_vn THEN s.count_action_in_day ELSE 0 END INTO v_web_day
        FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
      SELECT count(*) INTO v_web_window FROM public.auto_campaign_details d
       WHERE d.account_id = v_account_id AND d.action_code = v_code
         AND d.created_at >= v_now - make_interval(secs => ((v_limit->>'windowMinutes')::numeric * 60)::double precision)
         AND (d.counts_toward_limit IS TRUE OR (d.counts_toward_limit IS NULL AND d.status IN ('thành công', 'thất bại')));
      v_decision := v_decision || jsonb_build_object(
        'remainingDaily', greatest((v_limit->>'daily')::numeric - coalesce(v_web_day, 0), 0),
        'remainingWindow', greatest((v_limit->>'windowCount')::numeric - coalesce(v_web_window, 0), 0));
    END IF;

`

// report: dòng "Tìm data" (không mã thao tác) nhận cả chiến dịch web.
const REPORT_FROM = `            WHERE xc.id = r.campaign_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook') THEN`
const REPORT_TO = `            WHERE xc.id = r.campaign_id AND lower(btrim(coalesce(xa.flatform_type, ''))) IN ('facebook', 'web')) THEN`

// hạn mức: mã web theo web_scan.campaigns.limits.
const LIMIT_DECLARE = `  v_rows integer;
BEGIN`
const LIMIT_DECLARE_NEW = `  v_rows integer;
  v_web jsonb;
  v_web_default numeric;
  v_web_max numeric;
BEGIN`
const LIMIT_RETURN = `  RETURN jsonb_build_object(
    'daily', CASE WHEN v_daily > 0 THEN v_daily ELSE 30 END,`
const LIMIT_WEB = `  -- Quét data website: mặc định / trần theo web_scan.campaigns.limits (anh chốt 21/11/2026: 100 / ngày, trần 500; không theo gói). Giới hạn
  -- trong giờ không đặt thì bằng giới hạn ngày (không chặn thêm theo giờ), khung 60 phút.
  IF p_action_code LIKE 'web\\_%' THEN
    SELECT CASE WHEN pg_input_is_valid(s.value, 'jsonb') THEN s.value::jsonb->'limits' END INTO v_web
      FROM public.auto_system_settings s WHERE s.key = '${SETTING_KEY}' AND s.is_active LIMIT 1;
    v_web_default := coalesce(public.aka_agent_engine_positive(v_web->'defaultDaily'), 100);
    v_web_max := coalesce(public.aka_agent_engine_positive(v_web->'maxDaily'), 500);
    v_daily := least(CASE WHEN v_daily > 0 THEN v_daily ELSE v_web_default END, v_web_max);
    v_count := least(CASE WHEN v_count > 0 THEN v_count ELSE v_daily END, v_web_max);
    v_minutes := CASE WHEN v_minutes > 0 THEN v_minutes ELSE 60 END;
  END IF;

` + LIMIT_RETURN

// kết thúc lượt: "Chạy lại sau mỗi N giờ" của Tìm data nhận ba loại web.
const FINISH_FROM = `     AND c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction')`
const FINISH_TO = `     AND c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction',
                         '${ACTION_IDS.nhatot}', '${ACTION_IDS.batdongsan}', '${ACTION_IDS.yellowpages}')`

// snapshot tài khoản Desktop: tài khoản web đọc khoá webScan (khoá "web" của p_access là Zalo Web).
const SNAPSHOT_FROM = `CASE WHEN a.flatform_type='facebook' THEN 'facebookCore' ELSE a.flatform_type END`
const SNAPSHOT_TO = `CASE WHEN a.flatform_type='facebook' THEN 'facebookCore' WHEN a.flatform_type='web' THEN 'webScan' ELSE a.flatform_type END`

// gói quyền dùng app (tổ chức tách quyền app): tài khoản web cần một gói akaAgent bất kỳ còn hạn.
const PACKAGES_FROM = `WHEN 'sms' THEN p.product_id=17 WHEN NULL THEN false`
const PACKAGES_TO = `WHEN 'sms' THEN p.product_id=17 WHEN 'web' THEN p.product_id IN (3,10,13,16,17,18) WHEN NULL THEN false`

// nháp chiến dịch: ba loại web chèn is_active = false (xem p3), nháp của chúng vẫn lưu được khi tổ chức bật web_scan.campaigns.
const DRAFTS_FROM = `IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_actions WHERE id = v_form->>'actionId' AND is_active = true AND NOT coalesce(is_delete, false)) THEN`
const DRAFTS_TO = `IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_actions WHERE id = v_form->>'actionId' AND NOT coalesce(is_delete, false)
        AND (is_active = true OR (flatform_type = 'web' AND public.aka_agent_web_scan_org_enabled(p_organization_id)))) THEN`
// dọn lượt bỏ dở (app chết ngang / máy ngủ, khi đăng nhập lại hoặc job đóng lượt): lượt quét web chưa xong thì từ khoá về hàng đợi, kể cả khi lượt
// đã có kết quả (các lần mở trang / hiện số đã ghi). Quét chỉ đọc nên chạy lại an toàn: tin đã quét bị bỏ qua, số đã hiện được dùng lại. Lượt
// web không ghi dấu "sắp gửi" nên không đi nhánh "đã gửi". Loại chiến dịch khác giữ nguyên (anh chốt 21/11/2026 "Sửa luôn" sau giả lập).
const CLOSE_RUN_FROM = `  ELSIF v_unsent = 'requeue'
     OR (v_unsent = 'requeue_unstarted' AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id)) THEN`
const CLOSE_RUN_TO = `  ELSIF v_unsent = 'requeue'
     OR (v_unsent = 'requeue_unstarted' AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id))
     -- Quét data website: từ khoá dở về hàng đợi (chạy lại bỏ tin đã quét), kể cả khi lượt đã có kết quả.
     OR EXISTS (SELECT 1 FROM public.auto_campaigns xc JOIN public.auto_campaign_actions xa ON xa.id = xc.action_id
                 WHERE xc.id = rr.campaign_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'web') THEN`
const live = Object.fromEntries(Object.keys(LIVE).map(key => [key, readLive(key)]))
const next = {
  claim: patch(patch(patch(live.claim, CLAIM_DECLARE, CLAIM_DECLARE_NEW, 'claim: khai báo'), CLAIM_FB_GATE, CLAIM_WEB_GATE, 'claim: cổng web'),
    CLAIM_REMAINING_ANCHOR, CLAIM_REMAINING + CLAIM_REMAINING_ANCHOR, 'claim: lượt còn lại'),
  report: patch(live.report, REPORT_FROM, REPORT_TO, 'report: dòng Tìm data'),
  limit: patch(patch(live.limit, LIMIT_DECLARE, LIMIT_DECLARE_NEW, 'limit: khai báo'), LIMIT_RETURN, LIMIT_WEB, 'limit: mã web'),
  finish: patch(live.finish, FINISH_FROM, FINISH_TO, 'finish: chạy lại sau N giờ'),
  snapshot: patch(live.snapshot, SNAPSHOT_FROM, SNAPSHOT_TO, 'snapshot: khoá webScan'),
  packages: patch(live.packages, PACKAGES_FROM, PACKAGES_TO, 'packages: nền tảng web'),
  drafts: patch(live.drafts, DRAFTS_FROM, DRAFTS_TO, 'drafts: loại chiến dịch web'),
  closeRun: patch(live.closeRun, CLOSE_RUN_FROM, CLOSE_RUN_TO, 'closeRun: lượt web về hàng đợi')
}
const NEXT_MD5 = Object.fromEntries(Object.entries(next).map(([key, text]) => [key, md5(text)]))

// ---------------------------------------------------------------------------------------------------------------------------------------
// Block + element

const stripComments = text => text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n')
const COMMON = stripComments(fs.readFileSync(path.join(BLOCK_DIR, 'page-common.js'), 'utf8'))
const pageScript = name => JSON.stringify(COMMON + '\n' + stripComments(fs.readFileSync(path.join(BLOCK_DIR, `${name}.page.js`), 'utf8')))
const BLOCK_COMMON = stripComments(fs.readFileSync(path.join(BLOCK_DIR, 'block-common.js'), 'utf8'))

const BLOCKS = [
  { name: '[engine] web_nhatot_list', file: 'nhatot-list', page: 'nhatot-list', icon: 'List',
    description: 'Mở một trang kết quả tìm kiếm của nhatot theo từ khoá (mua bán / cho thuê) và đọc 20 tin từ dữ liệu nhúng của trang.' },
  { name: '[engine] web_nhatot_reveal', file: 'nhatot-reveal', page: 'nhatot-reveal', icon: 'Phone',
    description: 'Mở trang một tin nhatot, đọc thêm thông tin và bấm "Hiện SĐT" (một lượt "Hiện SĐT Nhà Tốt").' },
  { name: '[engine] web_batdongsan_search', file: 'batdongsan-search', page: 'batdongsan-search', ready: 'batdongsan-ready', type: 'batdongsan-type', icon: 'Search',
    description: 'Gõ từ khoá vào ô tìm của batdongsan (mục bán hoặc cho thuê), bấm Tìm kiếm, ghi trang kết quả trang chọn.' },
  { name: '[engine] web_batdongsan_list', file: 'batdongsan-list', page: 'batdongsan-list', icon: 'List',
    description: 'Mở một trang danh sách batdongsan và đọc các thẻ tin.' },
  { name: '[engine] web_batdongsan_reveal', file: 'batdongsan-reveal', page: 'batdongsan-reveal', icon: 'Phone',
    description: 'Bấm "Hiện số" trên một thẻ tin batdongsan (cần đăng nhập batdongsan; một lượt "Hiện SĐT Batdongsan").' },
  { name: '[engine] web_batdongsan_detail', file: 'batdongsan-detail', page: 'batdongsan-detail', icon: 'FileText',
    description: 'Mở trang một tin batdongsan để lấy địa chỉ đầy đủ và đặc điểm.' },
  { name: '[engine] web_yellowpages_list', file: 'yellowpages-list', page: 'yellowpages-list', icon: 'List',
    description: 'Mở một trang danh sách Trang Vàng và đọc các thẻ doanh nghiệp (một lượt "Mở trang Trang Vàng").' },
  { name: '[engine] web_yellowpages_detail', file: 'yellowpages-detail', page: 'yellowpages-detail', icon: 'FileText',
    description: 'Mở trang hồ sơ một doanh nghiệp Trang Vàng để lấy mã số thuế, loại hình… (một lượt "Mở trang Trang Vàng").' }
]
for (const block of BLOCKS) {
  let code = fs.readFileSync(path.join(BLOCK_DIR, `${block.file}.block.js`), 'utf8')
  code = `// Sinh từ scripts/web-scan/blocks/${block.file}.block.js (+ block-common.js, ${block.page}.page.js), không sửa tay trong DB.\n` + BLOCK_COMMON + '\n' + code
  code = code.split('__PAGE_SCRIPT__').join(pageScript(block.page))
  if (block.ready) code = code.split('__PAGE_READY__').join(pageScript(block.ready))
  if (block.type) code = code.split('__PAGE_TYPE__').join(pageScript(block.type))
  if (/__PAGE_[A-Z]+__/.test(code)) throw new Error(`${block.name}: còn chỗ giữ chỗ script trang`)
  if (code.includes('$wsblock$')) throw new Error(`${block.name}: code chứa thẻ dollar-quote`)
  block.code = code
  block.md5 = md5(code)
}

const ELEMENTS = [
  { name: 'web_nhatot_phone_button', xpath: `//a[normalize-space(.)='Hiện SĐT'] | //button[starts-with(normalize-space(.),'Hiện số')]`,
    description: 'nhatot: nút hiện số điện thoại trên trang tin' },
  { name: 'web_nhatot_phone_value', xpath: `//*[contains(@class,'InlineShowPhoneButton_wrapper')]`,
    description: 'nhatot: chỗ hiện số điện thoại sau khi bấm nút' },
  { name: 'web_bds_card', xpath: `//div[contains(concat(' ',normalize-space(@class),' '),' js__card-listing ')]`,
    description: 'batdongsan: thẻ tin ở trang danh sách' },
  { name: 'web_bds_phone_button', xpath: `.//*[contains(concat(' ',normalize-space(@class),' '),' js__card-phone-btn ')]`,
    description: 'batdongsan: nút "Hiện số" trong thẻ tin (tìm trong thẻ)' },
  { name: 'web_bds_login_gate', xpath: `//*[contains(@class,'kyc-ui--login-gate') or contains(@class,'re__login-gate-kyc')]`,
    description: 'batdongsan: hộp đăng nhập hiện ra khi chưa đăng nhập mà bấm hiện số' },
  { name: 'web_bds_search_input', xpath: `//input[@id='SuggestionSearch']`, description: 'batdongsan: ô tìm kiếm' },
  { name: 'web_bds_search_button', xpath: `//form[contains(@class,'re__listing-search-box')]//button[contains(normalize-space(.),'Tìm kiếm')]`,
    description: 'batdongsan: nút Tìm kiếm' },
  { name: 'web_yp_card', xpath: `//div[contains(concat(' ',normalize-space(@class),' '),' ypx-card ')]`,
    description: 'Trang Vàng: thẻ doanh nghiệp ở trang danh sách' }
]

// ---------------------------------------------------------------------------------------------------------------------------------------
// Mã lỗi + chính sách (câu cho khách là bản nháp, anh duyệt từng câu lúc thử thật)

const ERRORS = [
  { code: 'err_web_scan_challenge', public: 'WB01', name: 'Trang web yêu cầu xác minh truy cập',
    title: 'Trang web đang yêu cầu xác minh truy cập', help: 'Mở tab Website ở trang Trình duyệt, xác minh trên trang rồi bấm Tiếp tục chiến dịch',
    policy: { detail_mode: 'suppress', quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'requeue', remaining_steps: 'skip',
      run_effect: 'end_unit', pace_mode: 'none', campaign_effect: 'pause' },
    description: 'Trang (Cloudflare) đòi xác minh: tạm dừng chiến dịch, từ khoá về hàng đợi, không tính lượt.' },
  { code: 'err_web_scan_batdongsan_login', public: 'WB02', name: 'Chưa đăng nhập batdongsan',
    title: 'Chưa đăng nhập trang batdongsan.com.vn', help: null,
    policy: { detail_mode: 'suppress', quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'requeue', remaining_steps: 'skip',
      run_effect: 'end_unit', pace_mode: 'none', campaign_effect: 'none', lock: [ACTION_CODES.batdongsan], lock_mode: 'fixed_minutes', lock_minutes: 30 },
    description: 'Bấm hiện số mà batdongsan hiện hộp đăng nhập: khoá riêng "Hiện SĐT Batdongsan" của tài khoản 30 phút rồi thử lại (anh chốt 21/11/2026: chiến dịch chờ, tự chạy khi đăng nhập; app chưa biết cookie nào báo đã đăng nhập nên thử lại theo giờ).' },
  { code: 'err_web_scan_quota_reached', public: 'WB03', name: 'Hết lượt trong hạn mức giữa một từ khoá',
    title: 'Đã đủ số lượt trong hạn mức, từ khoá này quét tiếp ở lượt sau', help: null,
    policy: { detail_mode: 'suppress', quota_effect: 'no_count', target_streak_effect: 'ignore', target_effect: 'requeue', remaining_steps: 'skip',
      run_effect: 'end_unit', pace_mode: 'none', campaign_effect: 'none' },
    description: 'Hết lượt hiện số / mở trang giữa một từ khoá: từ khoá về hàng đợi (lượt sau bỏ tin đã quét), lần nhận sau chờ theo hạn mức.' },
  { code: 'err_web_scan_layout_changed', public: 'WB04', name: 'Không đọc được danh sách trên trang',
    title: 'Không đọc được danh sách trên trang', help: null, detailStatus: 'thất bại',
    policy: { detail_mode: 'write', quota_effect: 'no_count', target_streak_effect: 'increment', streak_threshold: 3, target_effect: 'complete',
      remaining_steps: 'skip', run_effect: 'continue', pace_mode: 'full', campaign_effect: 'pause' },
    description: 'Trang danh sách không còn thẻ tin / dữ liệu như trước (thường là trang đổi giao diện): ghi lỗi, 3 từ khoá liền thì tạm dừng chiến dịch.' }
]

// ---------------------------------------------------------------------------------------------------------------------------------------
// SQL

const q = value => value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`
const ledgerGuard = part => `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${NAMES[part]}') THEN
      RAISE EXCEPTION '${V} ${part} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;`
const header = (title, lines) => `-- ${V} ${title}. SINH TỪ scripts/build-${VERSION}-sql.cjs, không sửa tay.
${lines.map(line => `-- ${line}`).join('\n')}
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
`

// ----- p1
const P1 = header('p1: bảng tin đã quét / số đã hiện của quét data website', [
  'Chỉ tạo bảng mới trong schema private (PostgREST không thấy, không nạp lại schema API). Gỡ: ' + NAMES.r1 + '.sql (chỉ khi chưa apply p2).'
]) + `
DO $pre$
BEGIN
${ledgerGuard('p1')}
  IF to_regclass('private.auto_web_scan_seen') IS NOT NULL OR to_regclass('private.auto_web_scan_listings') IS NOT NULL THEN
    RAISE EXCEPTION '${V} p1: đã có bảng quét data website (lần chạy trước để lại?)';
  END IF;
END $pre$;

-- Tin đã quét theo chiến dịch ("Bỏ qua tin đã quét ở lượt trước"). Mã tin theo trang (nhatot list_id, batdongsan prid, Trang Vàng mã hồ sơ).
CREATE TABLE private.auto_web_scan_seen (
  campaign_id bigint NOT NULL,
  site text NOT NULL CHECK (site IN ('nhatot', 'batdongsan', 'yellowpages')),
  listing_key text NOT NULL CHECK (length(listing_key) BETWEEN 1 AND 200),
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (campaign_id, site, listing_key)
);
CREATE INDEX idx_auto_web_scan_seen_seen_at ON private.auto_web_scan_seen (seen_at);

-- Số đã hiện theo tổ chức (anh chốt 21/11/2026: tin đã có số do chiến dịch khác cùng tổ chức hiện trong 30 ngày thì dùng lại, không bấm lại).
CREATE TABLE private.auto_web_scan_listings (
  organization_id bigint NOT NULL,
  site text NOT NULL CHECK (site IN ('nhatot', 'batdongsan', 'yellowpages')),
  listing_key text NOT NULL CHECK (length(listing_key) BETWEEN 1 AND 200),
  phone text NOT NULL CHECK (phone ~ '^0[0-9]{9,10}$'),
  name text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revealed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, site, listing_key)
);
CREATE INDEX idx_auto_web_scan_listings_revealed_at ON private.auto_web_scan_listings (revealed_at);

ALTER TABLE private.auto_web_scan_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auto_web_scan_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auto_web_scan_seen, private.auto_web_scan_listings FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE private.auto_web_scan_seen, private.auto_web_scan_listings FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

COMMIT;
`
const R1 = `-- Gỡ ${V} p1: xoá hai bảng quét data website. SINH TỪ scripts/build-${VERSION}-sql.cjs. Chỉ chạy sau khi đã gỡ p2.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
BEGIN
  IF to_regprocedure('public.aka_agent_web_scan_seen_v1(bigint,text,text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Gỡ ${V} p1: còn hàm của p2, gỡ p2 trước';
  END IF;
END $pre$;
DROP TABLE IF EXISTS private.auto_web_scan_seen;
DROP TABLE IF EXISTS private.auto_web_scan_listings;
COMMIT;
`

// ----- p2
const NEW_FUNCTIONS = `-- Tổ chức có bật quét data website không (web_scan.campaigns: {"mode": "all"} hoặc {"organizationIds": [...]}).
CREATE FUNCTION public.aka_agent_web_scan_org_enabled(p_organization_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  IF p_organization_id IS NULL THEN RETURN false; END IF;
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = '${SETTING_KEY}' AND s.is_active LIMIT 1;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN RETURN false; END IF;
  v := v_raw::jsonb;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF v->>'mode' = 'all' THEN RETURN true; END IF;
  IF jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v->'organizationIds') e
                    WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') = p_organization_id::text);
  END IF;
  RETURN false;
END $function$;

-- Desktop: trong các mã tin vừa đọc, tin nào chiến dịch đã quét ở lượt trước, tin nào đã có số do chiến dịch cùng tổ chức hiện trong 30 ngày.
CREATE FUNCTION public.aka_agent_web_scan_seen_v1(p_campaign_id bigint, p_site text, p_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  c record;
  v_keys text[];
BEGIN
  IF p_site IS NULL OR p_site NOT IN ('nhatot', 'batdongsan', 'yellowpages') THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_site'); END IF;
  SELECT x.id, x.staff_id, x.organization_id INTO c FROM public.auto_campaigns x WHERE x.id = p_campaign_id AND NOT coalesce(x.is_delete, false);
  IF NOT FOUND OR NOT public.aka_agent_engine_scope_ok(c.staff_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT public.aka_agent_web_scan_org_enabled(c.organization_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_enabled'); END IF;
  SELECT coalesce(array_agg(DISTINCT k), '{}') INTO v_keys FROM unnest(coalesce(p_keys, '{}'::text[])) k WHERE k IS NOT NULL AND length(k) BETWEEN 1 AND 200;
  IF cardinality(v_keys) > 500 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_keys'); END IF;
  RETURN jsonb_build_object('ok', true,
    'seen', coalesce((SELECT jsonb_agg(s.listing_key ORDER BY s.listing_key) FROM private.auto_web_scan_seen s
                       WHERE s.campaign_id = p_campaign_id AND s.site = p_site AND s.listing_key = ANY (v_keys)), '[]'::jsonb),
    'cached', coalesce((SELECT jsonb_object_agg(l.listing_key, jsonb_build_object('phone', l.phone, 'name', l.name, 'data', l.data))
                         FROM private.auto_web_scan_listings l
                        WHERE l.organization_id = c.organization_id AND l.site = p_site AND l.listing_key = ANY (v_keys)
                          AND l.revealed_at > clock_timestamp() - interval '30 days'), '{}'::jsonb));
END $function$;

-- Desktop: ghi tin vừa quét của chiến dịch (và số vừa hiện, dùng lại trong tổ chức 30 ngày). p_items: [{ key, phone?, name?, data? }], tối đa 200.
CREATE FUNCTION public.aka_agent_web_scan_record_v1(p_campaign_id bigint, p_site text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  c record;
  v_seen integer := 0;
  v_cached integer := 0;
BEGIN
  IF p_site IS NULL OR p_site NOT IN ('nhatot', 'batdongsan', 'yellowpages') THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_site'); END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 200 THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid_items'); END IF;
  SELECT x.id, x.staff_id, x.organization_id INTO c FROM public.auto_campaigns x WHERE x.id = p_campaign_id AND NOT coalesce(x.is_delete, false);
  IF NOT FOUND OR NOT public.aka_agent_engine_scope_ok(c.staff_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT public.aka_agent_web_scan_org_enabled(c.organization_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_enabled'); END IF;
  WITH items AS (
    SELECT DISTINCT ON (btrim(e->>'key')) btrim(e->>'key') AS k, nullif(btrim(e->>'phone'), '') AS phone, left(nullif(btrim(e->>'name'), ''), 200) AS name,
           CASE WHEN jsonb_typeof(e->'data') = 'object' AND length((e->'data')::text) <= 8000 THEN e->'data' ELSE '{}'::jsonb END AS data
      FROM jsonb_array_elements(p_items) e
     WHERE jsonb_typeof(e) = 'object' AND length(btrim(coalesce(e->>'key', ''))) BETWEEN 1 AND 200
  ), seen AS (
    INSERT INTO private.auto_web_scan_seen AS s (campaign_id, site, listing_key)
    SELECT p_campaign_id, p_site, i.k FROM items i
    ON CONFLICT (campaign_id, site, listing_key) DO NOTHING
    RETURNING 1
  ), cached AS (
    INSERT INTO private.auto_web_scan_listings AS l (organization_id, site, listing_key, phone, name, data, revealed_at)
    SELECT c.organization_id, p_site, i.k, i.phone, i.name, i.data, clock_timestamp() FROM items i WHERE i.phone ~ '^0[0-9]{9,10}$'
    ON CONFLICT (organization_id, site, listing_key) DO UPDATE SET phone = EXCLUDED.phone, name = coalesce(EXCLUDED.name, l.name),
      data = EXCLUDED.data, revealed_at = EXCLUDED.revealed_at
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM seen), (SELECT count(*) FROM cached) INTO v_seen, v_cached;
  RETURN jsonb_build_object('ok', true, 'seen', v_seen, 'cached', v_cached);
END $function$;

-- Dọn: tin đã quét quá 180 ngày, số đã hiện quá 30 ngày (mỗi lượt tối đa 20.000 dòng mỗi bảng).
CREATE FUNCTION public.aka_agent_web_scan_retention_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_seen integer;
  v_listings integer;
BEGIN
  DELETE FROM private.auto_web_scan_seen s WHERE (s.campaign_id, s.site, s.listing_key) IN (
    SELECT x.campaign_id, x.site, x.listing_key FROM private.auto_web_scan_seen x WHERE x.seen_at < clock_timestamp() - interval '180 days' LIMIT 20000);
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  DELETE FROM private.auto_web_scan_listings l WHERE (l.organization_id, l.site, l.listing_key) IN (
    SELECT x.organization_id, x.site, x.listing_key FROM private.auto_web_scan_listings x WHERE x.revealed_at < clock_timestamp() - interval '30 days' LIMIT 20000);
  GET DIAGNOSTICS v_listings = ROW_COUNT;
  RETURN jsonb_build_object('seen', v_seen, 'listings', v_listings);
END $function$;
`

const NEW_SIGS = [
  'public.aka_agent_web_scan_org_enabled(bigint)',
  'public.aka_agent_web_scan_seen_v1(bigint,text,text[])',
  'public.aka_agent_web_scan_record_v1(bigint,text,jsonb)',
  'public.aka_agent_web_scan_retention_v1()'
]
const PATCH_ORDER = ['claim', 'report', 'limit', 'finish', 'snapshot', 'packages', 'drafts', 'closeRun']

const preflightPatched = (from, labelPrefix) => PATCH_ORDER.map(key => `  v_oid := to_regprocedure('${LIVE[key].sig}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${labelPrefix}: không có ${LIVE[key].sig}'; END IF;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${from[key]}' THEN
    RAISE EXCEPTION '${labelPrefix}: ${key} khác bản đã đọc (%)', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.${VERSION}_acl_${key}', v_acl, true);`).join('\n')
const postflightPatched = (to, labelPrefix) => PATCH_ORDER.map(key => `  v_oid := '${LIVE[key].sig}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${to[key]}' THEN
    RAISE EXCEPTION '${labelPrefix} postflight: ${key} %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.${VERSION}_acl_${key}', true) THEN RAISE EXCEPTION '${labelPrefix} postflight: quyền / chủ sở hữu ${key} bị đổi'; END IF;`).join('\n')

const LIVE_MD5 = Object.fromEntries(PATCH_ORDER.map(key => [key, LIVE[key].md5]))

const P2 = header('p2: hàm quét data website + vá claim / report / hạn mức / kết thúc lượt / snapshot tài khoản / gói quyền / nháp / dọn lượt bỏ dở', [
  'Nguồn = pg_get_functiondef production 21/11/2026 (md5 trước → sau):',
  ...PATCH_ORDER.map(key => `  ${key}: ${LIVE_MD5[key]} → ${NEXT_MD5[key]}`),
  'Đổi thân claim / report nên PostgREST nạp lại schema: apply buổi tối. Gỡ: ' + NAMES.r2 + '.sql.'
]) + `
DO $pre$
DECLARE v_oid oid; v_acl text;
BEGIN
${ledgerGuard('p2')}
  IF to_regclass('private.auto_web_scan_seen') IS NULL OR to_regclass('private.auto_web_scan_listings') IS NULL THEN
    RAISE EXCEPTION '${V} p2: chưa apply p1';
  END IF;
  IF to_regprocedure('public.aka_agent_web_scan_org_enabled(bigint)') IS NOT NULL THEN RAISE EXCEPTION '${V} p2 đã chạy'; END IF;
${preflightPatched(LIVE_MD5, `${V} p2`)}
END $pre$;

${NEW_FUNCTIONS}
${PATCH_ORDER.map(key => next[key] + ';').join('\n\n')}

REVOKE ALL ON FUNCTION ${NEW_SIGS.join(', ')} FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION ${NEW_SIGS.join(', ')} FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_web_scan_seen_v1(bigint,text,text[]), public.aka_agent_web_scan_record_v1(bigint,text,jsonb) TO aka_agent_desktop;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_web_scan_seen_v1(bigint,text,text[]), public.aka_agent_web_scan_record_v1(bigint,text,jsonb) TO service_role;
  END IF;
  -- Dọn mỗi ngày 02:41 giờ VN (19:41 UTC), ngoài giờ cao điểm.
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.schedule('aka-agent-web-scan-retention', '41 19 * * *', 'SELECT public.aka_agent_web_scan_retention_v1()');
  END IF;
END $grants$;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${postflightPatched(NEXT_MD5, `${V} p2`)}
END $post$;

COMMIT;
`
const R2 = `-- Gỡ ${V} p2: trả claim / report / hạn mức / kết thúc lượt / snapshot / gói quyền về bản production 21/11/2026 và xoá hàm quét data website.
-- SINH TỪ scripts/build-${VERSION}-sql.cjs. Gỡ p3 trước (mã thao tác / loại chiến dịch web còn thì Desktop vẫn gọi các hàm này).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $pre$
DECLARE v_oid oid; v_acl text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_campaign_actions WHERE id IN ('${ACTION_IDS.nhatot}', '${ACTION_IDS.batdongsan}', '${ACTION_IDS.yellowpages}')) THEN
    RAISE EXCEPTION 'Gỡ ${V} p2: còn loại chiến dịch web, gỡ p3 trước';
  END IF;
${preflightPatched(NEXT_MD5, `Gỡ ${V} p2`)}
END $pre$;

${PATCH_ORDER.map(key => live[key] + ';').join('\n\n')}

DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-web-scan-retention') THEN
      PERFORM cron.unschedule('aka-agent-web-scan-retention');
    END IF;
  END IF;
END $cron$;
DROP FUNCTION public.aka_agent_web_scan_retention_v1();
DROP FUNCTION public.aka_agent_web_scan_record_v1(bigint,text,jsonb);
DROP FUNCTION public.aka_agent_web_scan_seen_v1(bigint,text,text[]);
DROP FUNCTION public.aka_agent_web_scan_org_enabled(bigint);

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${postflightPatched(LIVE_MD5, `Gỡ ${V} p2`)}
END $post$;

COMMIT;
`

// ----- p3
const errorRows = ERRORS.map(e => `  (${q('engine')}, ${q(e.name)}, ${q(`${V}: ${e.description}`)}, ${q(e.code)}, ${q(e.title)}, ${q(e.title)}, ${q(e.public)}, ${q(e.title)}, ${q(e.help)}, ${q(e.detailStatus || null)}, false, false)`).join(',\n')
const policyRows = ERRORS.map(e => {
  const p = e.policy
  const note = e.help ? `${e.title} (${e.public}). ${e.help}` : `${e.title} (${e.public}).`
  return `  (${q(e.code)}, ${p.detail_mode === 'write' ? `(SELECT id FROM public.auto_status WHERE code = 'campaign_detail_failed' AND component_type = 'campaign_detail' ORDER BY id LIMIT 1)` : 'NULL'}, ${q(p.detail_mode)}, ${q(e.title)}, ${q(note)}, ${q(p.quota_effect)}, ${q(p.target_streak_effect)}, ${p.streak_threshold ?? 'NULL'}, ${q(p.target_effect)}, ${q(p.remaining_steps)}, ${p.lock ? `ARRAY[${p.lock.map(q).join(', ')}]::text[]` : `'{}'::text[]`}, ${q(p.lock_mode || 'fixed_minutes')}, ${p.lock_minutes ?? 'NULL'}, ${q(p.run_effect)}, ${q(p.pace_mode)}, ${q(p.campaign_effect)}, 'none', 'none', ${q(`[${V}] ${e.description}`)}, '${VERSION}')`
}).join(',\n')
const guardRows = SITES.map(site => `  (${q(ACTION_CODES[site])}, 'count', 'ignore', 'continue', 'continue', 'none', ${q(`[${V}] Mỗi lần ${ACTION_NAMES[site].toLowerCase()} thành công tính một lượt hạn mức; không đổi chuỗi data lỗi, không nghỉ giữa các lần (nghỉ do block).`)}, '${VERSION}')`).join(',\n')

const P3 = header('p3: dữ liệu quét data website (công tắc, mã thao tác, loại chiến dịch, block, element, mã lỗi, chính sách)', [
  'Chỉ dữ liệu, không DDL. Loại chiến dịch chèn is_active = false (Desktop đang phát hành coi nền tảng lạ là Facebook); Desktop mới đọc riêng',
  'ba loại này khi tổ chức bật web_scan.campaigns. Câu cho khách của WB01–WB04 là bản nháp, anh duyệt lúc thử thật. Gỡ: ' + NAMES.r3 + '.sql.'
]) + `
DO $pre$
BEGIN
${ledgerGuard('p3')}
  IF to_regprocedure('public.aka_agent_web_scan_org_enabled(bigint)') IS NULL THEN RAISE EXCEPTION '${V} p3: chưa apply p2'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = '${SETTING_KEY}')
     OR EXISTS (SELECT 1 FROM public.auto_campaign_actions WHERE id LIKE 'web\\_find\\_data\\_%')
     OR EXISTS (SELECT 1 FROM public.auto_account_actions WHERE code LIKE 'web\\_%')
     OR EXISTS (SELECT 1 FROM public.auto_blocks WHERE name LIKE '[engine] web\\_%')
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name LIKE 'web\\_%')
     OR EXISTS (SELECT 1 FROM public.auto_error WHERE error_code LIKE 'err\\_web\\_scan\\_%' OR public_code LIKE 'WB%') THEN
    RAISE EXCEPTION '${V} p3: đã có dữ liệu quét data website (lần chạy trước để lại?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_status WHERE code = 'campaign_detail_failed' AND component_type = 'campaign_detail') THEN
    RAISE EXCEPTION '${V} p3: không thấy trạng thái campaign_detail_failed';
  END IF;
END $pre$;

-- 1. Công tắc (anh chốt 21/11/2026: chỉ tổ chức 1 thấy lúc đầu; giới hạn chung 100 / ngày, trần 500, nghỉ 15 giây, thấp nhất 10).
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('${SETTING_KEY}', ${q(SETTING_VALUE)},
  'Quét data website (nhatot, batdongsan, Trang Vàng): organizationIds = tổ chức thấy tài khoản Website + 3 loại chiến dịch Tìm data (hoặc "mode": "all"); limits = mặc định / trần giới hạn ngày và thời gian nghỉ; batdongsanLoginCookies = tên cookie báo đã đăng nhập batdongsan (điền sau khi thử thật).',
  false, true);

-- 2. Mã thao tác (loại read: không phải gửi tin, không có dấu "sắp gửi").
INSERT INTO public.auto_account_actions (flatform_type, name, code, is_active, is_delete, operation_class) VALUES
${SITES.map(site => `  ('web', ${q(ACTION_NAMES[site])}, ${q(ACTION_CODES[site])}, true, false, 'read')`).join(',\n')};

-- 3. Loại chiến dịch (tắt sẵn, xem đầu file).
INSERT INTO public.auto_campaign_actions (id, name, flatform_type, is_active, is_delete, workflow_id, limit_check_action_codes, allow_multiple_accounts,
  allow_secondary_account, show_staff_delivery_cooldown) VALUES
${SITES.map(site => `  (${q(ACTION_IDS[site])}, ${q(CAMPAIGN_NAMES[site])}, 'web', false, false, NULL, ARRAY[${q(ACTION_CODES[site])}]::text[], true, false, false)`).join(',\n')};

-- 4. Block (code ở scripts/web-scan/blocks; sửa khi trang đổi giao diện thì sửa ở đó rồi viết migration mới).
${BLOCKS.map(block => `INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES (${q(block.name)}, ${q(block.description)}, ${q(block.icon)}, 'web', 'js', $wsblock$${block.code}$wsblock$, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true);`).join('\n')}

-- 5. Element (chỗ tìm phần tử; sửa ở màn Element khi trang đổi giao diện).
INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin) VALUES
${ELEMENTS.map(e => `  (${q(e.name)}, ${q(e.xpath)}, ${q(e.description)}, 'web', true)`).join(',\n')};

-- 6. Mã lỗi (câu cho khách: bản nháp).
INSERT INTO public.auto_error (error_type, error_name, error_desc, error_code, noti_running_process, noti_campaign, public_code, customer_title, customer_help,
  detail_status, counts_toward_limit, counts_toward_bad_target) VALUES
${errorRows};

-- 7. Chính sách theo mã lỗi (mọi nơi chạy; mã chỉ do bộ quét web phát).
INSERT INTO public.auto_outcome_policies (error_code, detail_status_id, detail_mode, log_template, campaign_note_template, quota_effect, target_streak_effect,
  streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, lock_minutes, run_effect, pace_mode, campaign_effect, account_effect, login_effect,
  description, source) VALUES
${policyRows};

-- 8. Chặn theo thao tác: mỗi lần hiện SĐT / mở trang thành công tính một lượt, không đổi chuỗi data lỗi, không nghỉ sau từng lần.
INSERT INTO public.auto_outcome_policies (action_code, quota_effect, target_streak_effect, remaining_steps, run_effect, pace_mode, description, source) VALUES
${guardRows};

-- 9. Đẩy SĐT tìm được sang chiến dịch "Nhắn tin theo SĐT" (đường đẩy V608 aka_agent_find_data_push_v1, như Tìm data Facebook): bật bằng
--    extra_settings.isFindPhone, chiến dịch đích ở extra_settings.findPhoneZaloMessagePhoneTargetCampaignIds. DB chưa có V608 thì bỏ qua.
DO $rules$
BEGIN
  IF to_regclass('public.auto_campaign_data_link_rules') IS NOT NULL THEN
    INSERT INTO public.auto_campaign_data_link_rules
      (source_action_id, output_kind, source_flag, link_field, target_action_id, data_type_category_item_id, value_column, label)
    SELECT r.source_action_id, 'phone', 'isFindPhone', 'findPhoneZaloMessagePhoneTargetCampaignIds', 'zalo_message_phone', ci.id, 'phone', 'SĐT'
      FROM (VALUES ${SITES.map(site => `(${q(ACTION_IDS[site])})`).join(', ')}) AS r(source_action_id)
      JOIN public.category_type AS ct ON ct.code = 'data_type'
      JOIN public.category_item AS ci ON ci.category_type_id = ct.id AND ci.code = 'phone';
    IF (SELECT count(*) FROM public.auto_campaign_data_link_rules WHERE source_action_id LIKE 'web\\_find\\_data\\_%') <> ${SITES.length} THEN
      RAISE EXCEPTION '${V} p3: quy tắc đẩy SĐT';
    END IF;
  END IF;
END $rules$;

DO $post$
BEGIN
  IF (SELECT count(*) FROM public.auto_blocks WHERE name LIKE '[engine] web\\_%') <> ${BLOCKS.length} THEN RAISE EXCEPTION '${V} p3 postflight: block'; END IF;
  IF (SELECT count(*) FROM public.auto_elements WHERE name LIKE 'web\\_%') <> ${ELEMENTS.length} THEN RAISE EXCEPTION '${V} p3 postflight: element'; END IF;
  IF (SELECT count(*) FROM public.auto_outcome_policies WHERE source = '${VERSION}') <> ${ERRORS.length + SITES.length} THEN RAISE EXCEPTION '${V} p3 postflight: chính sách'; END IF;
${BLOCKS.map(block => `  IF (SELECT md5(code) FROM public.auto_blocks WHERE name = ${q(block.name)}) IS DISTINCT FROM '${block.md5}' THEN RAISE EXCEPTION '${V} p3 postflight: code ${block.name}'; END IF;`).join('\n')}
END $post$;

COMMIT;
`
const R3 = `-- Gỡ ${V} p3: xoá dữ liệu quét data website. SINH TỪ scripts/build-${VERSION}-sql.cjs.
-- Còn chiến dịch / tài khoản web thì không xoá được loại chiến dịch (khoá ngoại): khi đó chỉ tắt công tắc (đổi web_scan.campaigns thành
-- {"organizationIds": []}) là đủ để không ai thấy / chạy được.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_campaigns WHERE action_id LIKE 'web\\_find\\_data\\_%') THEN
    RAISE EXCEPTION 'Gỡ ${V} p3: còn chiến dịch web, chỉ tắt công tắc ${SETTING_KEY}';
  END IF;
END $pre$;
DO $rules$
BEGIN
  IF to_regclass('public.auto_campaign_data_link_rules') IS NOT NULL THEN
    DELETE FROM public.auto_campaign_data_links WHERE rule_id IN
      (SELECT id FROM public.auto_campaign_data_link_rules WHERE source_action_id LIKE 'web\\_find\\_data\\_%');
    DELETE FROM public.auto_campaign_data_link_rules WHERE source_action_id LIKE 'web\\_find\\_data\\_%';
  END IF;
END $rules$;
DELETE FROM public.auto_outcome_policies WHERE source = '${VERSION}';
DELETE FROM public.auto_account_action_status WHERE action_code IN (${SITES.map(site => q(ACTION_CODES[site])).join(', ')})
   OR disabled_error_code IN (${ERRORS.map(e => q(e.code)).join(', ')});
DELETE FROM public.auto_error WHERE error_code IN (${ERRORS.map(e => q(e.code)).join(', ')});
DELETE FROM public.auto_elements WHERE name IN (${ELEMENTS.map(e => q(e.name)).join(', ')});
DELETE FROM public.auto_blocks WHERE name IN (${BLOCKS.map(b => q(b.name)).join(', ')});
DELETE FROM public.auto_campaign_actions WHERE id IN (${SITES.map(site => q(ACTION_IDS[site])).join(', ')});
DELETE FROM public.auto_account_actions WHERE code IN (${SITES.map(site => q(ACTION_CODES[site])).join(', ')});
DELETE FROM public.auto_system_settings WHERE key = '${SETTING_KEY}';
COMMIT;
`

module.exports = {
  VERSION, NAMES, SITES, ACTION_IDS, ACTION_CODES, ACTION_NAMES, SETTING_KEY, SETTING_VALUE, BLOCKS, ELEMENTS, ERRORS, LIVE, LIVE_MD5, NEXT_MD5,
  texts: { live, next }, sql: { p1: P1, p2: P2, p3: P3, r1: R1, r2: R2, r3: R3 }
}

if (require.main === module) {
  const files = { p1: P1, p2: P2, p3: P3, r1: R1, r2: R2, r3: R3 }
  for (const [key, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(ROOT, 'migrations', `${NAMES[key]}.sql`), text)
    console.log(`${NAMES[key]}.sql`, md5(text))
  }
  for (const key of PATCH_ORDER) console.log(key, LIVE_MD5[key], '->', NEXT_MD5[key])
}
