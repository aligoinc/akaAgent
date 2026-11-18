#!/usr/bin/env node
// V578: block "[engine] fb_collect_search_group_admins" (lấy quản trị viên của group khi tìm group bằng search, V577) lấy chỗ tìm phần tử trên
// trang từ bảng auto_elements thay vì viết thẳng trong code (18/11/2026, anh hỏi "các element mới có lưu vào bảng auto element chưa", rồi
// "chuyển đi"). Facebook đổi giao diện thì sửa XPath ở màn Cài đặt Workflow → Element, không cần migration.
//
// Thêm 8 element (category facebook, built-in) và đổi code block 2922. Phần vẫn nằm trong code vì là cách xử lý chứ không phải chỗ tìm phần
// tử: nhãn vai trò ("Quản trị viên" / "Admin"…), dạng link /groups/<nhóm>/user/<uid>/ để lấy UID, cách đi từ hàng tab ra vùng tên và từ cột
// trái ra khối "Thông tin liên hệ", quy tắc tách SĐT / email. Hành vi không đổi so với V577 (bài kiểm chạy cùng bộ trang giả cho cả hai bản).
// Chỉ workflow engine; bộ cũ không đổi. Code block không ghi số migration. Số chỉ giữ được khi đã vào sổ: kiểm lại sổ ngay trước khi apply.
// Chạy: node scripts/build-v578-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const V577 = require('./build-v577-sql.cjs')

const ROOT = path.resolve(__dirname, '..')
const FRAGMENTS = path.join(ROOT, 'scripts/facebook-search-groups')
const read = name => fs.readFileSync(path.join(FRAGMENTS, name), 'utf8')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const stripComments = text => text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').replace(/\n+$/, '')

const NAME = 'migration_v578_engine_facebook_group_admin_elements'
const ROLLBACK_NAME = 'rollback_v578_engine_facebook_group_admin_elements'
const BLOCK_NAME = V577.BLOCK_NAME
const OLD_CODE = V577.ADMINS_CODE
const OLD_MD5 = V577.ADMINS_MD5

/** XPath bắt đầu bằng "." là tương đối: tính từ dòng người (hai cái của danh sách) hoặc từ cột trái mục Giới thiệu (hai cái của trang cá nhân). */
const ELEMENTS = [
  { name: 'fb_main_region', xpath: "//*[@role='main']", description: 'Vùng nội dung chính của trang Facebook' },
  { name: 'fb_group_admin_row', xpath: "//*[@role='main']//*[@role='listitem']",
    description: 'Trang quản trị viên của group (/members/admins): dòng của từng người; group riêng tư chưa tham gia thì là từng ảnh đại diện' },
  { name: 'fb_group_admin_profile_link', xpath: ".//a[contains(@href,'/user/') or contains(@href,'profile.php')]",
    description: 'Trong dòng quản trị viên của group: link tới người đó (lấy UID và tên)' },
  { name: 'fb_group_admin_avatar', xpath: ".//a[@href]//*[local-name()='svg' or local-name()='img']",
    description: 'Trong dòng quản trị viên của group: ảnh đại diện (dòng chỉ có ảnh, không chữ = Facebook không hiện danh sách)' },
  { name: 'fb_group_admin_heading', xpath: "//*[@role='main']//*[self::h2 or self::h3 or @role='heading']",
    description: 'Trang quản trị viên của group: các tiêu đề (tìm "Quản trị viên và người kiểm duyệt · N" để biết số người)' },
  { name: 'fb_profile_tablist', xpath: "//*[@role='main']//*[@role='tablist']",
    description: 'Trang cá nhân: các hàng tab (hàng đầu tiên là tab của trang cá nhân, vùng tên + dòng giới thiệu đứng ngay trước nó)' },
  { name: 'fb_profile_directory_link', xpath: ".//a[contains(@href,'directory_')]",
    description: 'Trang cá nhân, mục Giới thiệu: link của một mục ở cột trái (nhận ra hàng tab nào là cột trái)' },
  { name: 'fb_profile_contact_link', xpath: ".//a[contains(@href,'directory_contact_info')]",
    description: 'Trang cá nhân, mục Giới thiệu: link "Thông tin liên hệ" ở cột trái (chỉ có khi người đó để công khai)' }
]

const XPATH = stripComments(read('dom-xpath.fragment.js'))
const EXTRACT = stripComments(read('contact-extract.fragment.js'))
if (EXTRACT !== V577.EXTRACT) throw new Error('contact-extract.fragment.js khác bản V577: quy tắc tách SĐT / email không được đổi trong bản này')
const ADMINS_PAGE_SCRIPT = `${XPATH}\n${EXTRACT}\n${stripComments(read('admins-page.fragment.js'))}`
const PROFILE_PAGE_SCRIPT = `${XPATH}\n${EXTRACT}\n${stripComments(read('admin-profile-page.fragment.js'))}`
for (const [label, script] of [['admins-page', ADMINS_PAGE_SCRIPT], ['admin-profile-page', PROFILE_PAGE_SCRIPT]]) {
  if (script.includes('`') || script.includes('${')) throw new Error(`Đoạn chạy trong trang ${label} có dấu \` hoặc \${`)
  if (/querySelector|getElementsBy/.test(script)) throw new Error(`Đoạn ${label} còn selector viết thẳng (phải lấy từ auto_elements)`)
  try { new Function(`return (async function () { var __args = []; ${script}\n})`) } catch (error) { throw new Error(`Đoạn ${label} không hợp lệ: ${error.message}`) }
}

const BLOCK_TEMPLATE = read('admins-block.fragment.js').replace(/\n+$/, '')
for (const token of ['__ADMINS_PAGE_SCRIPT__', '__PROFILE_PAGE_SCRIPT__']) {
  if (BLOCK_TEMPLATE.split(token).length !== 2) throw new Error(`Khuôn block phải có đúng một ${token}`)
}
const NEW_CODE = '\n' + BLOCK_TEMPLATE.replace('__ADMINS_PAGE_SCRIPT__', () => ADMINS_PAGE_SCRIPT).replace('__PROFILE_PAGE_SCRIPT__', () => PROFILE_PAGE_SCRIPT) + '\n'
const NEW_MD5 = md5(NEW_CODE)
// Block phải gọi đúng các element của bản này, không hơn không kém.
const used = [...NEW_CODE.matchAll(/helpers\.element\('([^']+)'\)/g)].map(match => match[1]).sort()
if (JSON.stringify(used) !== JSON.stringify(ELEMENTS.map(element => element.name).sort())) {
  throw new Error(`Element block gọi (${used.join(', ')}) khác danh sách thêm vào bảng`)
}
const TAG = '$v578_block$'
for (const [label, code] of [['block mới', NEW_CODE], ['block V577', OLD_CODE]]) {
  if (code.includes(TAG)) throw new Error(`${label} chứa thẻ dollar-quote`)
  try { new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${code}\n})`) } catch (error) { throw new Error(`${label} không hợp lệ: ${error.message}`) }
}

const sqlText = value => `'${String(value).replace(/'/g, "''")}'`
const NAMES_SQL = ELEMENTS.map(element => sqlText(element.name)).join(', ')
const VALUES_SQL = ELEMENTS.map(element => `  (${sqlText(element.name)}, ${sqlText(element.xpath)}, ${sqlText(element.description)}, 'facebook', true)`).join(',\n')

const migration = `-- V578: block "${BLOCK_NAME}" (lấy quản trị viên của group khi tìm group bằng search) lấy chỗ tìm phần tử trên trang từ bảng
-- auto_elements thay vì viết thẳng trong code: thêm ${ELEMENTS.length} element (category facebook, built-in) và đổi code block. Hành vi không đổi so với V577.
-- Facebook đổi giao diện thì sửa XPath ở màn Cài đặt Workflow → Element. Chỉ workflow engine; bộ cũ không đổi.
-- SINH TỪ scripts/build-v578-sql.cjs, không sửa tay. Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt;
-- element mới được app đọc lại khi gặp tên chưa có trong bộ nhớ đệm (elementV2Repository.resolveXpathByName). Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v578_%') THEN
      RAISE EXCEPTION 'V578 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'V578: block "${BLOCK_NAME}" không còn đúng bản V577 (md5 ${OLD_MD5}), đọc lại và sinh lại';
  END IF;
  SELECT string_agg(name, ', ') INTO v_bad FROM public.auto_elements WHERE name IN (${NAMES_SQL});
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V578: đã có element trùng tên: %', v_bad; END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin) VALUES
${VALUES_SQL};

UPDATE public.auto_blocks SET code = ${TAG}${NEW_CODE}${TAG}, updated_at = now()
 WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${OLD_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V578 postflight: code block không phải bản mới (md5 ${NEW_MD5})';
  END IF;
  IF (SELECT count(*) FROM public.auto_elements WHERE name IN (${NAMES_SQL}) AND category = 'facebook' AND is_builtin
        AND staff_id IS NULL AND organization_id IS NULL AND btrim(xpath) <> '') <> ${ELEMENTS.length} THEN
    RAISE EXCEPTION 'V578 postflight: chưa đủ ${ELEMENTS.length} element';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V578: block "${BLOCK_NAME}" về code V577 (selector viết thẳng trong code) và xoá ${ELEMENTS.length} element V578 thêm (kể cả khi XPath đã được
-- sửa ở màn Element: bản V577 không dùng các element này). Chỉ chạy khi block đang đúng bản V578. SINH TỪ scripts/build-v578-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V578: block "${BLOCK_NAME}" không phải bản V578 (md5 ${NEW_MD5}), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${OLD_CODE}${TAG}, updated_at = now()
 WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${NEW_MD5}';
DELETE FROM public.auto_elements WHERE name IN (${NAMES_SQL}) AND is_builtin AND staff_id IS NULL;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V578 postflight: block chưa về bản V577';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${NAMES_SQL})) THEN
    RAISE EXCEPTION 'Gỡ V578 postflight: còn element của V578';
  END IF;
END $post$;

COMMIT;
`

module.exports = { NAME, ROLLBACK_NAME, BLOCK_NAME, ELEMENTS, OLD_CODE, OLD_MD5, NEW_CODE, NEW_MD5, ADMINS_PAGE_SCRIPT, PROFILE_PAGE_SCRIPT, EXTRACT, migration, rollback }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`V578: block ${OLD_MD5} → ${NEW_MD5} (${NEW_CODE.length} ký tự), ${ELEMENTS.length} element; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
