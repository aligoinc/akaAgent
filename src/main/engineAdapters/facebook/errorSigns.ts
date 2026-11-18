// Dấu hiệu nhận ra lỗi Facebook (anh chốt 17/11/2026): chỉ phát mã lỗi cụ thể khi THẤY dấu hiệu của đúng lỗi đó, không suy ra lỗi từ việc
// "không thấy" một phần tử (Facebook đổi giao diện thì "không thấy" xảy ra với mọi data). Hai nguồn:
//   - message: câu lỗi do chính block / bộ dựng lịch sử của mình viết (chứa câu của dấu hiệu);
//   - page: chữ trên trang lúc block lỗi, chỉ ở tiêu đề, cảnh báo, nút trong vùng chính và hộp thoại (bằng đúng chữ của dấu hiệu, không so
//     cả trang, để chữ trong bài viết không làm nhận nhầm).
// Danh sách ở auto_system_settings `facebook.error_signs` (V559), sửa bằng SQL không cần phát hành app. Mã nào có dấu hiệu thì chính sách
// engine của mã đó giữ y cách đang xử lý trường hợp đó hôm nay, chỉ đổi câu cho khách (anh chốt 17/11). Không khớp, danh sách hỏng hay
// bước đọc trang lỗi thì không đổi gì: kết quả như hôm nay. Không I/O.
import type { Phase } from '../../../../packages/campaign-engine/src/index'

export interface FacebookErrorSign {
  /** Mã nội bộ phát ra (auto_error.error_code). */
  code: string
  source: 'message' | 'page'
  /** Thao tác áp dụng; rỗng = mọi thao tác. */
  actions: string[]
  /** Chỉ áp ở các pha này; rỗng = mọi pha. */
  phases: Phase[]
  /** Mã đang có mà dấu hiệu được thay; rỗng = chỉ kết quả chưa có mã. */
  replaces: string[]
  /** Chữ của dấu hiệu, đã chuẩn hoá (normalizeSignText). */
  texts: string[]
}

export interface FacebookErrorSignContext {
  actionCode: string
  phase: Phase
  /** Mã kết quả đang có (block trả hoặc dòng lịch sử có mã); null = chưa có mã. */
  currentErrorCode: string | null
}

const PHASES: readonly Phase[] = ['before_send', 'in_flight', 'after_send']
export const MAX_FACEBOOK_ERROR_SIGNS = 200
export const MAX_FACEBOOK_ERROR_SIGN_TEXTS = 20

/** So chữ không phân biệt hoa thường, dấu cách thừa, cách gõ dấu tiếng Việt (NFC). */
export function normalizeSignText(value: unknown): string {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : []

/** Đọc dòng thiết lập (chuỗi JSON hoặc mảng). Mục sai bị bỏ; cả dòng sai thì rỗng (= không nhận dấu hiệu nào). */
export function parseFacebookErrorSigns(raw: unknown): FacebookErrorSign[] {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  const out: FacebookErrorSign[] = []
  for (const item of value.slice(0, MAX_FACEBOOK_ERROR_SIGNS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const code = typeof row.code === 'string' ? row.code.trim() : ''
    const source = row.source === 'message' || row.source === 'page' ? row.source : null
    // Chữ quá ngắn dễ khớp nhầm; quá dài là chép nhầm cả đoạn.
    const texts = strings(row.texts).map(normalizeSignText).filter(text => text.length >= 6 && text.length <= 200)
      .slice(0, MAX_FACEBOOK_ERROR_SIGN_TEXTS)
    if (!/^[a-z0-9_]+$/.test(code) || !source || texts.length === 0) continue
    out.push({
      code, source, actions: strings(row.actions),
      phases: strings(row.phases).filter((phase): phase is Phase => (PHASES as readonly string[]).includes(phase)),
      replaces: strings(row.replaces), texts
    })
  }
  return out
}

function applies(sign: FacebookErrorSign, ctx: FacebookErrorSignContext): boolean {
  if (sign.actions.length > 0 && !sign.actions.includes(ctx.actionCode)) return false
  if (sign.phases.length > 0 && !sign.phases.includes(ctx.phase)) return false
  // Mã đang có chỉ được thay khi dấu hiệu khai rõ (vd chữ "nội dung không hiển thị" thay FB40 "không thấy ô đăng bài"); dấu hiệu không khai
  // thì chỉ gắn mã cho kết quả chưa có mã.
  return ctx.currentErrorCode ? sign.replaces.includes(ctx.currentErrorCode) : sign.replaces.length === 0
}

/** Câu lỗi của block / dòng lịch sử có chứa chữ của một dấu hiệu `message`. */
export function matchMessageSign(signs: readonly FacebookErrorSign[], ctx: FacebookErrorSignContext,
  messages: ReadonlyArray<string | null | undefined>): FacebookErrorSign | null {
  const texts = messages.map(normalizeSignText).filter(Boolean)
  if (texts.length === 0) return null
  for (const sign of signs) {
    if (sign.source === 'message' && applies(sign, ctx) && sign.texts.some(text => texts.some(message => message.includes(text)))) return sign
  }
  return null
}

/** Trên trang có đúng chữ của một dấu hiệu `page` (chữ đã đọc bằng PAGE_SIGN_TEXTS_SCRIPT). */
export function matchPageSign(signs: readonly FacebookErrorSign[], ctx: FacebookErrorSignContext,
  pageTexts: readonly string[] | null | undefined): FacebookErrorSign | null {
  if (!pageTexts || pageTexts.length === 0) return null
  const seen = new Set(pageTexts.map(normalizeSignText))
  for (const sign of signs) {
    if (sign.source === 'page' && applies(sign, ctx) && sign.texts.some(text => seen.has(text))) return sign
  }
  return null
}

/** Chữ trên trang trước (dấu hiệu Facebook hiện ra), rồi câu lỗi của block. */
export function pickFacebookErrorSign(signs: readonly FacebookErrorSign[], ctx: FacebookErrorSignContext,
  input: { pageTexts?: readonly string[] | null; messages: ReadonlyArray<string | null | undefined> }): FacebookErrorSign | null {
  if (signs.length === 0) return null
  return matchPageSign(signs, ctx, input.pageTexts) ?? matchMessageSign(signs, ctx, input.messages)
}

/** Mã lỗi "không thấy ô bình luận" (FB41): câu block chứa lỗi của hàm chờ phần tử kèm XPath. */
export const COMMENT_BOX_NOT_FOUND_ERROR_CODE = 'err_fb_comment_box_not_found'

/**
 * Câu cho khách của mã vừa nhận ra qua dấu hiệu (anh duyệt 18/11/2026): bỏ phần kỹ thuật của câu block. FB41: "Không comment được bài
 * thứ 2: waitForSelector timeout: (//div[…])" → "Không comment được bài thứ 2: không thấy ô bình luận". Mã khác giữ nguyên câu.
 */
export function rewriteFacebookSignMessage(code: string, message: string): string {
  return code === COMMENT_BOX_NOT_FOUND_ERROR_CODE ? message.replace(/waitForSelector timeout:[\s\S]*$/i, 'không thấy ô bình luận') : message
}

/** Có dấu hiệu `page` dùng được cho kết quả này không (thao tác, mã đang có; chưa biết pha): chỉ đọc chữ trên trang khi cần. */
export function hasPageSigns(signs: readonly FacebookErrorSign[], actionCode: string, currentErrorCode: string | null): boolean {
  return signs.some(sign => sign.source === 'page' && (sign.actions.length === 0 || sign.actions.includes(actionCode))
    && (currentErrorCode ? sign.replaces.includes(currentErrorCode) : sign.replaces.length === 0))
}

/**
 * Đọc chữ trên trang ngay sau block lỗi (PageController.evaluate chạy như thân hàm): tiêu đề, cảnh báo, nút trong vùng chính và hộp thoại,
 * tối đa 300 chữ, mỗi chữ ≤ 160 ký tự. Không đọc thanh bên (thông báo, tin nhắn riêng). Dòng đầu là dấu để trang giả trong bài kiểm nhận ra.
 */
export const PAGE_SIGN_TEXTS_SCRIPT = `/* aka:page-sign-texts */
var out = [];
var seen = {};
var push = function (value) {
  var text = String(value || '').replace(/\\s+/g, ' ').trim();
  if (!text || text.length > 160 || seen[text]) return;
  seen[text] = true;
  out.push(text);
};
var roots = Array.prototype.slice.call(document.querySelectorAll('[role="main"], [role="dialog"], [role="alertdialog"]'));
if (roots.length === 0 && document.body) roots.push(document.body);
for (var i = 0; i < roots.length && out.length < 300; i++) {
  var nodes = roots[i].querySelectorAll('h1, h2, h3, [role="heading"], [role="alert"], [role="button"], button');
  for (var j = 0; j < nodes.length && out.length < 300; j++) {
    push(nodes[j].getAttribute('aria-label'));
    push(nodes[j].innerText);
  }
}
return out;`

/** Thời gian chờ tối đa khi đọc chữ trên trang sau block lỗi: quá thì coi như không đọc được. */
export const PAGE_SIGN_TIMEOUT_MS = 2_000
