/**
 * Luật kiểm cấu hình dùng chung cho form Desktop, Web, form AI và engine (kiểm một lần ở đầu lượt chạy).
 * Bắt ba loại lỗi mà kiểm lúc lưu không bắt được: luật chỉ có lúc chạy, cấu hình lưu xong mới thành sai,
 * và chiến dịch không đi qua form Desktop. Mỗi lỗi mang mã nội bộ (auto_error) và mã công khai (CFGxx).
 */

export type ConfigIssueScope = 'campaign' | 'target'

export interface ConfigIssue {
  errorCode: string
  publicCode: string
  scope: ConfigIssueScope
  /** Câu tiếng Việt chỉ đúng chỗ cần sửa. */
  message: string
  field?: string
  value?: string
}

const ZALO_WEB_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
// Giữ đúng danh sách của src/shared/mediaTypes.ts (IMAGE_FILE_EXTENSIONS / VIDEO_FILE_EXTENSIONS).
const IMAGE_EXTENSIONS = new Set(['apng', 'avif', 'bmp', 'gif', 'heic', 'heif', 'jpg', 'jpeg', 'png', 'svg', 'tif', 'tiff', 'webp'])
const VIDEO_EXTENSIONS = new Set(['3g2', '3gp', 'avi', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm', 'wmv'])

/** Đuôi tệp giống getAttachmentExtension của zaloRuntimeService (bỏ query/hash, lấy sau dấu chấm cuối). */
export function attachmentExtension(source: string): string {
  const withoutQuery = String(source || '').trim().split(/[?#]/, 1)[0] ?? ''
  const fileName = withoutQuery.split(/[\\/]/).pop() || withoutQuery
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

export function attachmentName(source: string): string {
  const withoutQuery = String(source || '').trim().split(/[?#]/, 1)[0] ?? ''
  return withoutQuery.split(/[\\/]/).pop() || withoutQuery
}

/** Giống isZaloWebSupportedAttachment: data URI ảnh hoặc đuôi JPG/JPEG/PNG/WEBP/GIF. */
export function isZaloWebSupportedAttachment(source: string): boolean {
  const trimmed = String(source || '').trim()
  if (!trimmed) return false
  if (/^data:image\/(?:gif|jpe?g|png|webp)(?:[;,])/i.test(trimmed)) return true
  return ZALO_WEB_IMAGE_EXTENSIONS.has(attachmentExtension(trimmed))
}

export function mediaKind(source: string): 'image' | 'video' | 'other' {
  const trimmed = String(source || '').trim()
  if (/^data:image\//i.test(trimmed)) return 'image'
  if (/^data:video\//i.test(trimmed)) return 'video'
  const ext = attachmentExtension(trimmed)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return 'other'
}

/** Giới hạn tệp Zalo do server trả theo phiên (zca-js sharefile.max_file / restricted_ext_file). */
export interface ZaloShareFileLimits { maxFile?: number | null; restrictedExtensions?: readonly string[] | null }

export interface ZaloContentConfig {
  /** Tài khoản đang ở chế độ Zalo Web (is_zalo_show_web). */
  zaloWeb: boolean
  attachments: readonly string[]
  limits?: ZaloShareFileLimits | null
}

/** CFG10–CFG12: luật Zalo chỉ hiện ra lúc chạy. Sai thì dừng chiến dịch một lần, không đốt data. */
export function validateZaloContent(config: ZaloContentConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const files = config.attachments.map(item => String(item || '').trim()).filter(Boolean)
  if (config.zaloWeb) {
    const unsupported = files.filter(file => !isZaloWebSupportedAttachment(file))
    if (unsupported.length > 0) {
      issues.push({ errorCode: 'err_cfg_zalo_web_image_only', publicCode: 'CFG10', scope: 'campaign', field: 'attachments',
        value: unsupported.map(attachmentName).join(', '),
        message: `Tài khoản Zalo Web chỉ gửi được ảnh JPG, JPEG, PNG, WEBP hoặc GIF; hãy bỏ tệp ${unsupported.map(attachmentName).join(', ')}` })
    }
  }
  const maxFile = Number(config.limits?.maxFile)
  if (Number.isFinite(maxFile) && maxFile > 0 && files.length > maxFile) {
    issues.push({ errorCode: 'err_cfg_zalo_too_many_files', publicCode: 'CFG11', scope: 'campaign', field: 'attachments', value: String(files.length),
      message: `Zalo chỉ cho gửi tối đa ${maxFile} tệp trong một tin; nội dung đang có ${files.length} tệp` })
  }
  const restricted = new Set((config.limits?.restrictedExtensions || []).map(ext => String(ext).toLowerCase().replace(/^\./, '')))
  if (restricted.size > 0) {
    const blocked = files.filter(file => restricted.has(attachmentExtension(file)))
    if (blocked.length > 0) {
      issues.push({ errorCode: 'err_cfg_zalo_file_extension', publicCode: 'CFG12', scope: 'campaign', field: 'attachments',
        value: blocked.map(attachmentName).join(', '),
        message: `Zalo không cho gửi loại tệp này; hãy đổi định dạng tệp ${blocked.map(attachmentName).join(', ')}` })
    }
  }
  return issues
}

export interface FacebookMediaConfig {
  campaignActionId: string
  pagePostMode?: 'api' | 'ui' | string | null
  media: readonly string[]
  commentMedia?: readonly string[]
}

/** CFG14–CFG15: giống kiểm tra trong campaignScheduler (đăng fanpage bằng API, media/comment Facebook). */
export function validateFacebookMedia(config: FacebookMediaConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const media = config.media.map(item => String(item || '').trim()).filter(Boolean)
  if (config.campaignActionId === 'facebook_page_post' && config.pagePostMode === 'api' && media.some(item => mediaKind(item) !== 'image')) {
    issues.push({ errorCode: 'err_cfg_fb_api_post_image_only', publicCode: 'CFG14', scope: 'campaign', field: 'media',
      message: 'Đăng fanpage bằng API hiện chỉ hỗ trợ ảnh; hãy chuyển sang chế độ UI để dùng video' })
  }
  const all = [...media, ...(config.commentMedia || []).map(item => String(item || '').trim()).filter(Boolean)]
  const invalid = all.filter(item => mediaKind(item) === 'other')
  if (config.campaignActionId.startsWith('facebook_') && invalid.length > 0) {
    issues.push({ errorCode: 'err_cfg_fb_media_type', publicCode: 'CFG15', scope: 'campaign', field: 'media',
      value: invalid.map(attachmentName).join(', '),
      message: `Media Facebook chỉ hỗ trợ ảnh hoặc video; hãy bỏ tệp ${invalid.map(attachmentName).join(', ')}` })
  }
  return issues
}

/** Biến mẫu lấy từ cột của data (renderCampaignTemplateText). #{FULL_NAME}/#{ORIGINAL_NAME} lấy từ Zalo nên không kiểm. */
const TEMPLATE_INPUT_TOKENS: Record<string, string> = {
  INPUT_FULLNAME: 'name', UID: 'uid', EMAIL: 'email', PHONE: 'phone', MOBILE: 'phone',
  INFO1: 'info1', INFO2: 'info2', INFO3: 'info3', INFO4: 'info4', INFO5: 'info5'
}

/** Các biến mẫu mà data này thiếu giá trị (sau khi bỏ khoảng trắng). PHONE/MOBILE có thể lấy từ Zalo nên chỉ báo khi được yêu cầu. */
export function missingTemplateFields(template: string | null | undefined, input: Record<string, unknown>,
  options: { phoneFromTarget?: boolean } = {}): string[] {
  const used = new Set<string>()
  for (const match of String(template || '').matchAll(/#\{([A-Z_0-9]+)\}/g)) {
    const token = match[1]
    if (token && token in TEMPLATE_INPUT_TOKENS) used.add(token)
  }
  const missing: string[] = []
  for (const token of used) {
    const column = TEMPLATE_INPUT_TOKENS[token] as string
    if ((token === 'PHONE' || token === 'MOBILE') && options.phoneFromTarget) continue
    if (!String(input[column] ?? '').trim()) missing.push(`#{${token}}`)
  }
  return missing
}

/**
 * CFG13 theo data: nội dung sau khi điền biến rỗng mà không có tệp đính kèm. Không tính hạn mức, chỉ data này
 * chịu ảnh hưởng (chính sách của mã err_cfg_template_missing_column).
 */
export function validateRenderedTargetContent(rendered: string, attachments: readonly string[], template: string | null | undefined,
  input: Record<string, unknown>): ConfigIssue[] {
  if (String(rendered || '').trim() || attachments.some(item => String(item || '').trim())) return []
  const missing = missingTemplateFields(template, input)
  return [{ errorCode: 'err_cfg_template_missing_column', publicCode: 'CFG13', scope: 'target', field: 'content',
    value: missing.join(', '),
    message: missing.length > 0
      ? `Nội dung rỗng vì data thiếu ${missing.join(', ')}; hãy bổ sung cột cho data hoặc sửa mẫu`
      : 'Nội dung rỗng sau khi điền biến; hãy kiểm tra mẫu nội dung' }]
}
