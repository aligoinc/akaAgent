---
name: add-builtin-block
description: Use when adding a new built-in block to seedV2 — viết JS code chạy trong vm.createContext sandbox với context (input, page, vars, helpers, signal). Cũng dùng khi refactor block có sẵn (đổi config schema, đổi code). KHÔNG dùng cho block custom user tự tạo qua UI — đó là run-time CRUD qua BlockCrudModal.
---

# Add / Update built-in block trong engine v2

## Bối cảnh

Built-in blocks seed qua [src/main/data/seed/seedV2.ts](src/main/data/seed/seedV2.ts) với `is_builtin=true`. UPSERT theo UNIQUE `name` → mỗi lần app start sync code mới nhất. Block code chạy trong sandbox với context:

```typescript
{
  input: Record<string, unknown>     // node.config + parents output merged
  page: PageController                // page.click/type/fill/scroll/evaluate/$$/...
  vars: Record<string, unknown>      // workflow vars (campaignContent, detailUid, ...)
  helpers: BlockHelpers              // sleep, log, element(name), normalizeFbUrl, ...
  signal: AbortSignal                // check signal.aborted trong long loops
}
```

Block return object → output. Throw → block fail. Output cascade qua edges chỉ tới parent trực tiếp — nếu cần data đi xa, **mutate `vars`** thay vì rely vào input chain.

## Steps

### 1. Identify block category

| Category | Khi dùng |
|---|---|
| `navigation` | URL nav (nav_to_url, nav_back, ...) |
| `interaction` | User actions (click, type, scroll, hover) |
| `data` | Read DOM (get_text, get_attribute) |
| `utility` | Sleep, wait, api_call, download |
| `file` | Upload/drop file |
| `control` | System blocks (kind='system': ifElse, loop, parallel, merge) |
| `facebook` | FB-specific compound (fb_open_composer, fb_send_message) |
| `custom` | User block (KHÔNG seed) |

### 2. Define configSchema + outputSchema

`configSchema` quy định form fields trong UI ConfigPanelV2. Field types: `string` / `number` / `boolean` / `json` / `select` / `textarea` / `code`.

```typescript
{
  name: 'fb_my_action', category: 'facebook', kind: 'js',
  icon: 'IconName',  // lucide-react icon
  description: '...',
  configSchema: [
    { name: 'selector', type: 'string', label: '...', required: true, placeholder: '...' },
    { name: 'flag', type: 'boolean', label: '...', default: false }
  ],
  outputSchema: [
    { name: 'ok', type: 'boolean', label: 'Thành công không' },
    { name: 'error', type: 'string', label: 'Lỗi (nếu có)' }
  ],
  defaultConfig: { flag: false },
  code: `...`
}
```

### 3. Code body — patterns

**Đọc input + fallback vars** (FB blocks luôn fallback vì scheduler inject vars chứ không config):
```js
const text = String(input.content || vars.campaignContent || '')
const imgs = Array.isArray(input.images) && input.images.length > 0
  ? input.images
  : (Array.isArray(vars.images) ? vars.images : [])
```

**Dùng element qua helpers** (KHÔNG hardcode XPath):
```js
const btn = await helpers.element('fb_post_button')
await page.waitForSelector(btn, { timeout: 15000 })
await page.click(btn)
```

**Self-catch lỗi** cho block không nên fail toàn workflow (vd `fb_send_message`, `fb_add_friend`):
```js
try {
  // ... logic
  return { ok: true, ... }
} catch (e) {
  return { ok: false, error: e.message }
}
```

**Loop iteration data** đọc từ `vars.loopItem` khi block là body của `loop` system block:
```js
const item = (vars && vars.loopItem) ? vars.loopItem : {}
const pos = Number(input.position || item.position || 1)
```

**Mutate vars** khi cần pass data qua chain dài:
```js
vars.campaignContent = scrapedText  // type_content downstream sẽ đọc giá trị này
```

**Skip case "đã làm rồi"** trả `ok: true` với cờ riêng (vd `alreadyFriend`):
```js
if (!found) return { ok: true, alreadyFriend: true }
```
Scheduler `logMilestonesV2` sẽ phân biệt 3 case (clicked/skipped/error) → log chính xác.

### 4. Sandbox restrictions

KHÔNG truy cập trong block code:
- `process`, `require`, `Buffer`, `__dirname`, `electron`, `fs`
- Direct DOM access — phải qua `page.evaluate(code, ...args)`
- Top-level `await` — code đã wrap trong async IIFE

CÓ thể dùng:
- `Promise`, `JSON`, `Math`, `Date`, `RegExp`, `Array`, `Object`, `String`, `Number`, `Boolean`, `Map`, `Set`, `URL`
- `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`
- `console.log/warn/error` (capture vào `helpers.log`)

### 5. Test trong UI

Restart `npm run dev` → seedV2 UPSERT block. Vào "Cài đặt Workflow":
- Block xuất hiện trong sidebar Library (đúng category)
- Drag vào canvas → ConfigPanel render đúng schema
- "Sửa code (Monaco)" → autocomplete `page.*`/`helpers.*` hoạt động (intellisense từ blockApiTypes.ts)
- Test panel: chọn channel webview → "Test block" → log realtime

### 6. Per-milestone logging (FB blocks dùng cho campaign)

Nếu block là **milestone** scheduler cần track (đăng bài, comment, gửi tin, kết bạn) → đặt `name` cố định để `logMilestonesV2` scan được:
- `fb_click_post_button` → "Đăng bài"
- `fb_comment_at_position` → "Comment"  
- `fb_send_message` → "Nhắn tin"
- `fb_add_friend` → "Kết bạn"

Output phải có data scheduler đọc được (vd `position`, `text` cho comment — đọc từ `s.output` chứ KHÔNG `s.input`).

### 7. Update CLAUDE.md nếu pattern mới

Nếu block introduce convention mới (vd new helper pattern, new vars key, new milestone action_name) → update CLAUDE.md section "Common pitfalls" hoặc "Vietnamese UI conventions".
