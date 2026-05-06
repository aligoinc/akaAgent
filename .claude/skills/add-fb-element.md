---
name: add-fb-element
description: Use when adding a new XPath element to auto_elements (FB selector pattern reusable bởi blocks qua helpers.element). Cũng dùng khi update XPath cho element có sẵn (FB đổi UI). DB is the source of truth; there is no seedV2 sync.
---

# Add / Update XPath element trong engine v2

## Khi nào dùng skill này

- Block `fb_*` báo `waitForSelector timeout` → cần update XPath
- Cần selector mới cho 1 FB action chưa có (e.g. nút "Báo cáo bài đăng")
- FB đổi UI region nào → multiple elements cần update đồng loạt

## Steps

### 1. Verify XPath thực tế

Mở DevTools webview FB, chạy `document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue` — nếu trả node visible thì OK. Test trên **cả 2 context** (timeline + group) nếu element có thể xuất hiện ở cả 2 — dùng XPath union `A | B`.

Pattern phổ biến trong project:
- Text-based: `//*[@role='button' and (contains(.,'Text') or .='Text')]`
- aria-label: `//*[@role='button' and (@aria-label='X' or contains(@aria-label,'X'))]`
- CSS selector cho stable structures: `[role="dialog"] [contenteditable="true"]`
- Template với placeholder: `(//div[...])[${n}]` — dùng `helpers.elementWith(name, {n: 3})`

### 2. UPSERT vào DB qua Supabase MCP

```sql
INSERT INTO auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id)
VALUES ('fb_<name>', '<xpath>', '<desc>', 'facebook', true, 1, 1)
ON CONFLICT (name) DO UPDATE
  SET xpath = EXCLUDED.xpath, description = EXCLUDED.description;
```

`staff_id=1, organization_id=1` = admin tenant (verify qua `SELECT id, staff_admin_id FROM org_organization WHERE is_admin_akabiz=true`).

### 3. Cache invalidation

Element cache trong main process (`elementV2Repository.ts:_xpathCache`) chỉ invalidate khi save qua API `saveElement`. Update SQL trực tiếp KHÔNG invalidate cache. **Phải restart app** để cache reset, HOẶC update qua UI "Cài đặt Workflow → Elements" (gọi IPC `v2:element:save`).

### 4. DB source of truth

`auto_elements` is the only source of truth for reusable XPath entries. There is no `seedV2` file and restart will not overwrite SQL/UI changes.

### 5. Verify

Restart `npm run dev` if the main-process element cache was already loaded, then test the related campaign. Element listing ở "Cài đặt Workflow → Elements" cũng phản ánh giá trị mới.

## Anti-patterns

- KHÔNG hardcode XPath inline trong block code — luôn dùng `helpers.element('name')` để admin sửa được qua UI mà không build lại app
- KHÔNG update SQL trực tiếp rồi quên invalidate cache/restart
- KHÔNG dùng tọa độ viewport trong XPath (vd `[x=100]`) — webview có thể không focus
