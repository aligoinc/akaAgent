// Bot sự kiện: hợp đồng dùng chung giữa API Web, trang Web và Desktop.
// Bản gốc ở WebApp packages/control-api/src/eventBot.ts; akaAgent src/shared/eventBot.ts chép NGUYÊN VĂN (sửa ở đây trước).
// Đặc tả: akaAgent docs/EVENT_BOT_TECH.md. File này không import gì để chép được sang mọi nơi.

export const EVENT_BOT_EVENT_TYPES = ['birthday', 'tag_change', 'condition_group'] as const;
export type EventBotEventType = (typeof EVENT_BOT_EVENT_TYPES)[number];

export const EVENT_BOT_DIRECTIONS = ['birthday', 'added', 'removed', 'enter', 'leave'] as const;
export type EventBotDirection = (typeof EVENT_BOT_DIRECTIONS)[number];

export const EVENT_BOT_JOB_STATUSES = ['pending', 'sending', 'sent', 'skipped', 'expired', 'failed', 'unknown'] as const;
export type EventBotJobStatus = (typeof EVENT_BOT_JOB_STATUSES)[number];

export type EventBotRunsOn = 'desktop' | 'server' | 'fly' | 'akachat';
export type EventBotAccountKind = 'qr' | 'web' | 'server';

export const EVENT_BOT_LIMITS = {
  birthdayRules: 1,
  tagRules: 50,
  groupRules: 30,
  messageMaxChars: 2000,
  nameMaxChars: 80,
  exclusionsPerAccount: 5000,
  tagIdsPerRule: 20,
  delayMaxSeconds: 600,
  minGapMaxMinutes: 60 * 24 * 30,
  logMaxDays: 90,
} as const;

export const EVENT_BOT_DEFAULTS = {
  birthdaySendTime: '08:30',
  tagMinGapMinutes: 720,
  groupMinGapMinutes: 0,
  delay: { minSeconds: 20, maxSeconds: 60 },
} as const;

export type EventBotDelay = { minSeconds: number; maxSeconds: number };

export type EventBotBirthdayConfig = { sendTime: string; message: string };
export type EventBotTagConfig = {
  direction: 'added' | 'removed';
  tagIds: string[];
  tagNames: string[];
  message: string;
  delay: EventBotDelay;
};
export type EventBotGroupMessage = { enabled: boolean; message: string };
export type EventBotGroupConfig = { onEnter: EventBotGroupMessage; onLeave: EventBotGroupMessage; delay: EventBotDelay };

export type EventBotRule =
  | EventBotRuleBase<'birthday', EventBotBirthdayConfig>
  | EventBotRuleBase<'tag_change', EventBotTagConfig>
  | EventBotRuleBase<'condition_group', EventBotGroupConfig>;

type EventBotRuleBase<T extends EventBotEventType, C> = {
  id?: number;
  eventType: T;
  name: string;
  enabled: boolean;
  position: number;
  config: C;
  dataGroupId?: number | null;
  minGapMinutes: number;
  revision?: number;
};

export type EventBotSettings = {
  enabled: boolean;
  blocklistIds: number[];
  pausedUntil: string | null;
  pauseCode: string | null;
  pauseReason: string | null;
  revision: number;
  updatedAt: string | null;
  lastClaimAt: string | null;
  lastClaimSource: string | null;
};

export type EventBotAccountRow = {
  accountId: number;
  name: string;
  avatarUrl: string | null;
  kind: EventBotAccountKind;
  loginStatus: string;
  runsOn: EventBotRunsOn;
  botEnabled: boolean;
  enabledEvents: number;
  pausedUntil: string | null;
  pauseCode: string | null;
  lastClaimAt: string | null;
};

export type EventBotExclusion = {
  id: number;
  kind: 'uid' | 'phone';
  value: string;
  name: string | null;
  source: 'manual' | 'log';
  createdAt: string;
};

export type EventBotJobRow = {
  id: number;
  eventType: EventBotEventType;
  direction: EventBotDirection;
  ruleName: string | null;
  recipientName: string | null;
  recipientUid: string | null;
  status: EventBotJobStatus;
  reasonCode: string | null;
  zaloErrorCode: string | null;
  sendAfter: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type EventBotReport = {
  totals: { matched: number; sent: number; skipped: number; expired: number; failed: number; unknown: number };
  byDay: Array<{ date: string; sent: number; skipped: number; expired: number; failed: number }>;
  byRule: Array<{ ruleId: number; name: string; eventType: EventBotEventType; matched: number; sent: number }>;
  byReason: Array<{ code: string; count: number }>;
};

export const EVENT_BOT_EVENT_LABELS: Record<EventBotEventType, string> = {
  birthday: 'Sinh nhật',
  tag_change: 'Thêm/gỡ tag Zalo',
  condition_group: 'Vào/ra nhóm điều kiện',
};

export const EVENT_BOT_DIRECTION_LABELS: Record<EventBotDirection, string> = {
  birthday: 'Sinh nhật',
  added: 'Được gắn tag',
  removed: 'Bị gỡ tag',
  enter: 'Vào nhóm',
  leave: 'Ra nhóm',
};

export const EVENT_BOT_STATUS_LABELS: Record<EventBotJobStatus, string> = {
  pending: 'Chờ gửi',
  sending: 'Đang gửi',
  sent: 'Đã gửi',
  skipped: 'Bỏ qua',
  expired: 'Hết hạn',
  failed: 'Không gửi được',
  unknown: 'Chưa rõ kết quả',
};

// Lý do bot không gửi (reason_code). Câu cho khách.
export const EVENT_BOT_REASON_LABELS: Record<string, string> = {
  excluded: 'Người này nằm trong danh sách không gửi',
  min_gap: 'Người này vừa nhận tin của quy tắc này',
  bulk_tag: 'Nhiều người cùng đổi tag một lúc nên bot không gửi',
  tag_deleted: 'Tag đã bị xoá trên Zalo',
  not_person: 'Bot chỉ gửi cho cá nhân, không gửi cho nhóm',
  no_uid: 'Khách chưa có Zalo ID',
  rule_changed: 'Quy tắc đã được sửa sau lúc có sự kiện',
  rule_off: 'Quy tắc đã tắt',
  bot_off: 'Bot đã tắt',
  expired: 'Quá thời gian chờ gửi (app hoặc máy đang tắt)',
  no_longer_tagged: 'Khách không còn tag lúc tới lượt gửi',
  tagged_again: 'Khách đã được gắn lại tag lúc tới lượt gửi',
  left_group: 'Khách đã ra khỏi nhóm lúc tới lượt gửi',
  back_in_group: 'Khách đã vào lại nhóm lúc tới lượt gửi',
  no_msg_id: 'Zalo không nhận tin (có thể do gửi quá 30 tin trong 30 phút)',
  account_restricted: 'Zalo đang chặn tài khoản nhắn người lạ',
  rate_limited: 'Zalo báo gửi quá nhiều',
  recipient_error: 'Zalo không gửi được cho người này',
  runner_lost: 'App dừng giữa lúc gửi, không rõ khách đã nhận chưa',
  send_error: 'Gửi không thành công',
};

export function eventBotReasonLabel(code: string | null | undefined): string {
  if (!code) return '';
  return EVENT_BOT_REASON_LABELS[code] ?? 'Không gửi';
}

// Mã lỗi Zalo làm bot tự tạm dừng (phút). Giữ khớp với aka_agent_event_bot_report_v1.
export const EVENT_BOT_PAUSE_MINUTES: Record<string, number> = {
  '120': 24 * 60,
  '802': 24 * 60,
  '221': 60,
  no_msg_id: 30,
};

export const EVENT_BOT_PAUSE_LABELS: Record<string, string> = {
  '120': 'Zalo đang chặn tài khoản nhắn người lạ (120)',
  '802': 'Zalo đang chặn tài khoản nhắn người lạ (802)',
  '221': 'Zalo báo gửi quá nhiều (221)',
  no_msg_id: 'Zalo không nhận tin, có thể do gửi quá 30 tin trong 30 phút',
};

const SEND_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isEventBotSendTime(value: unknown): value is string {
  return typeof value === 'string' && SEND_TIME_RE.test(value);
}

export function normalizeEventBotPhone(value: string): string | null {
  const digits = String(value ?? '').replace(/[^\d+]/g, '');
  let d = digits.startsWith('+') ? digits.slice(1) : digits;
  if (d.startsWith('84')) d = '0' + d.slice(2);
  if (!/^0\d{9,10}$/.test(d)) return null;
  return d;
}

// Một dòng nhập ở tab Loại trừ: SĐT Việt Nam hoặc Zalo UID (chỉ chữ số, 8–25 ký tự).
export function parseEventBotExclusionInput(text: string): Array<{ kind: 'uid' | 'phone'; value: string }> {
  const out: Array<{ kind: 'uid' | 'phone'; value: string }> = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? '').split(/[\n,;]+/)) {
    const v = raw.trim();
    if (!v) continue;
    const phone = normalizeEventBotPhone(v);
    const item = phone
      ? { kind: 'phone' as const, value: phone }
      : /^\d{8,25}$/.test(v)
        ? { kind: 'uid' as const, value: v }
        : null;
    if (!item) continue;
    const key = item.kind + ':' + item.value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export type EventBotRuleIssue = { field: string; message: string };

function checkDelay(delay: EventBotDelay | undefined, issues: EventBotRuleIssue[]): void {
  const min = Number(delay?.minSeconds);
  const max = Number(delay?.maxSeconds);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > EVENT_BOT_LIMITS.delayMaxSeconds) {
    issues.push({ field: 'delay', message: `Thời gian chờ phải từ 0 đến ${EVENT_BOT_LIMITS.delayMaxSeconds} giây, số đầu không lớn hơn số sau` });
  }
}

function checkMessage(field: string, message: string | undefined, issues: EventBotRuleIssue[]): void {
  const text = String(message ?? '');
  if (!text.trim()) {
    issues.push({ field, message: 'Nhập nội dung tin' });
    return;
  }
  if (text.length > EVENT_BOT_LIMITS.messageMaxChars) {
    issues.push({ field, message: `Nội dung tối đa ${EVENT_BOT_LIMITS.messageMaxChars} ký tự` });
  }
  if (/#\{\s*INPUT_/i.test(text)) {
    issues.push({ field, message: 'Bot không điền được biến cột file (#{INPUT_…})' });
  }
}

// Kiểm một quy tắc trước khi lưu. Mảng rỗng = hợp lệ. API Web và DB kiểm lại cùng luật.
export function validateEventBotRule(rule: EventBotRule): EventBotRuleIssue[] {
  const issues: EventBotRuleIssue[] = [];
  if (!rule || !EVENT_BOT_EVENT_TYPES.includes(rule.eventType)) {
    return [{ field: 'eventType', message: 'Loại sự kiện không hợp lệ' }];
  }
  if (String(rule.name ?? '').length > EVENT_BOT_LIMITS.nameMaxChars) {
    issues.push({ field: 'name', message: `Tên tối đa ${EVENT_BOT_LIMITS.nameMaxChars} ký tự` });
  }
  const gap = Number(rule.minGapMinutes);
  if (!Number.isInteger(gap) || gap < 0 || gap > EVENT_BOT_LIMITS.minGapMaxMinutes) {
    issues.push({ field: 'minGapMinutes', message: 'Khoảng cách tối thiểu không hợp lệ' });
  }
  if (rule.eventType === 'birthday') {
    if (!isEventBotSendTime(rule.config?.sendTime)) issues.push({ field: 'sendTime', message: 'Giờ gửi dạng HH:MM' });
    checkMessage('message', rule.config?.message, issues);
  } else if (rule.eventType === 'tag_change') {
    const c = rule.config;
    if (c?.direction !== 'added' && c?.direction !== 'removed') issues.push({ field: 'direction', message: 'Chọn được gắn hoặc bị gỡ tag' });
    const tagIds = Array.isArray(c?.tagIds) ? c.tagIds : [];
    if (tagIds.length === 0) issues.push({ field: 'tagIds', message: 'Chọn ít nhất một tag' });
    if (tagIds.length > EVENT_BOT_LIMITS.tagIdsPerRule) issues.push({ field: 'tagIds', message: `Tối đa ${EVENT_BOT_LIMITS.tagIdsPerRule} tag mỗi quy tắc` });
    checkMessage('message', c?.message, issues);
    checkDelay(c?.delay, issues);
  } else {
    const c = rule.config;
    if (!Number.isInteger(Number(rule.dataGroupId)) || Number(rule.dataGroupId) <= 0) {
      issues.push({ field: 'dataGroupId', message: 'Chọn nhóm điều kiện' });
    }
    if (!c?.onEnter?.enabled && !c?.onLeave?.enabled) {
      issues.push({ field: 'onEnter', message: 'Bật ít nhất một tin: khi vào nhóm hoặc khi ra nhóm' });
    }
    if (c?.onEnter?.enabled) checkMessage('onEnter', c.onEnter.message, issues);
    if (c?.onLeave?.enabled) checkMessage('onLeave', c.onLeave.message, issues);
    checkDelay(c?.delay, issues);
  }
  return issues;
}

// Kiểm cả bộ quy tắc của một tài khoản (trần số lượng, mỗi tài khoản một quy tắc sinh nhật).
export function validateEventBotRules(rules: EventBotRule[]): Array<EventBotRuleIssue & { index: number }> {
  const out: Array<EventBotRuleIssue & { index: number }> = [];
  const count = { birthday: 0, tag_change: 0, condition_group: 0 } as Record<EventBotEventType, number>;
  rules.forEach((rule, index) => {
    if (rule && EVENT_BOT_EVENT_TYPES.includes(rule.eventType)) count[rule.eventType] += 1;
    for (const issue of validateEventBotRule(rule)) out.push({ ...issue, index });
  });
  if (count.birthday > EVENT_BOT_LIMITS.birthdayRules) out.push({ index: -1, field: 'rules', message: 'Mỗi tài khoản chỉ có một quy tắc sinh nhật' });
  if (count.tag_change > EVENT_BOT_LIMITS.tagRules) out.push({ index: -1, field: 'rules', message: `Tối đa ${EVENT_BOT_LIMITS.tagRules} quy tắc tag` });
  if (count.condition_group > EVENT_BOT_LIMITS.groupRules) out.push({ index: -1, field: 'rules', message: `Tối đa ${EVENT_BOT_LIMITS.groupRules} nhóm điều kiện` });
  return out;
}

// Kết quả gửi mà nơi chạy báo về DB (p_result của aka_agent_event_bot_report_v1).
export type EventBotSendResult =
  | { status: 'sent'; msgId: string | null }
  | { status: 'failed'; zaloCode: string | null; errorMessage: string }
  | { status: 'unknown'; errorMessage: string };

// Việc nơi chạy nhận được từ aka_agent_event_bot_claim_v1.
export type EventBotClaimedJob = {
  jobId: number;
  claimToken: string;
  accountId: number;
  eventType: EventBotEventType;
  direction: EventBotDirection;
  recipientUid: string;
  recipientName: string | null;
  message: string;
};

export type EventBotSyncAccount = {
  accountId: number;
  staffId: number;
  birthday: { enabled: boolean; sendTime: string; scanToday: boolean };
};

export type EventBotSyncResult = {
  ok: true;
  enabled: boolean;
  pollSeconds: number;
  accounts: EventBotSyncAccount[];
};

// ── Trang Web / API (mục 7 của EVENT_BOT_TECH.md) ─────────────────────────────────────────────────────────────

/** Thao tác của `aka_agent_control_event_bot` mà API Web nhận ở `POST /event-bot` (thân `{ action, ...payload }`). */
export const EVENT_BOT_CONTROL_ACTIONS = [
  'access', 'accounts', 'get', 'save', 'stop', 'exclusion_add', 'exclusion_remove', 'log', 'log_detail', 'report',
] as const;
export type EventBotControlAction = (typeof EVENT_BOT_CONTROL_ACTIONS)[number];

export type EventBotAccess = { enabled: boolean; audience: string };

/** `accountId`: tài khoản của danh sách (DB so theo UID Zalo nên danh sách của tài khoản khác hầu như không khớp). */
export type EventBotBlocklist = { id: number; name: string; count: number; updatedAt: string | null; accountId?: number | null };
export type EventBotTagOption = { id: string; name: string };
export type EventBotDataGroupOption = { id: number; name: string; hasDynamicFilter: boolean; memberCount: number };
export type EventBotGroupStats = { inGroup: number; entered24h: number; left24h: number; sent7d: number };

/**
 * App Desktop của nhân viên (đọc từ `auto_staff_device_presence`), để dải trạng thái phân biệt "app đang tắt" với
 * "app cần cập nhật". Trường tuỳ chọn: thiếu thì trang chỉ dựa vào lần hỏi việc gần nhất (`lastClaimAt`).
 */
export type EventBotDesktopPresence = {
  online: boolean;
  lastSeenAt: string | null;
  appVersion: string | null;
  /** Ảnh chụp bộ chạy có khối `eventBot` (app đã có Bot sự kiện). null = không biết. */
  supportsEventBot: boolean | null;
};

export type EventBotDetail = {
  account: EventBotAccountRow;
  settings: EventBotSettings;
  rules: EventBotRule[];
  exclusions: EventBotExclusion[];
  blocklists: EventBotBlocklist[];
  tags: EventBotTagOption[];
  dataGroups: EventBotDataGroupOption[];
  conflicts: {
    birthdayCampaigns: Array<{ id: number; name: string }>;
    tagAutoAddCampaigns: Array<{ id: number; name: string; tagIds: string[] }>;
  };
  /** Khoá là id quy tắc nhóm điều kiện (chuỗi). */
  stats: Record<string, EventBotGroupStats>;
  desktop?: EventBotDesktopPresence | null;
  /** Chỉ có trong kết quả `save` / `stop`: số việc đang chờ vừa bị đóng (bot_off / rule_off / rule_changed). */
  closedJobs?: number;
};

export type EventBotSaveRequest = {
  accountId: number;
  revision: number;
  enabled: boolean;
  blocklistIds: number[];
  rules: EventBotRule[];
};

export type EventBotLogPage = { items: EventBotJobRow[]; nextBefore: number | null };

export type EventBotJobDetail = EventBotJobRow & {
  ruleId: number | null;
  tagId: string | null;
  contactId: number | null;
  messageTemplate: string | null;
  errorMessage: string | null;
  expiresAt: string | null;
  claimedBy: string | null;
  zaloMsgId: string | null;
};

// Câu cho khách theo mã lỗi của RPC / API (RPC đã có câu riêng thì dùng câu của RPC).
export const EVENT_BOT_ERROR_MESSAGES: Record<string, string> = {
  event_bot_not_ready: 'Tính năng Bot sự kiện đang được cập nhật. Vui lòng thử lại sau.',
  event_bot_disabled: 'Bot sự kiện chưa mở cho tài khoản của bạn.',
  not_enabled: 'Bot sự kiện chưa mở cho tài khoản của bạn.',
  invalid_request: 'Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.',
  unknown_action: 'Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.',
  rule_invalid: 'Có quy tắc chưa hợp lệ. Vui lòng kiểm tra lại.',
  rule_not_found: 'Quy tắc đã bị xoá ở nơi khác. Tải lại để xem bản mới nhất.',
  data_group_not_found: 'Không tìm thấy Nhóm khách hàng của quy tắc, hoặc nhóm không thuộc tài khoản này.',
  data_group_no_filter: 'Nhóm khách hàng này chưa có Bộ lọc động nên không dùng được cho bot.',
  duplicate_group: 'Mỗi Nhóm khách hàng chỉ dùng cho một quy tắc của tài khoản.',
  blocklist_not_found: 'Danh sách không gửi đã bị xoá. Bỏ chọn danh sách đó rồi lưu lại.',
  exclusion_invalid: 'SĐT hoặc Zalo UID không hợp lệ.',
  event_bot_invalid: 'Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.',
  event_bot_rules_invalid: 'Có quy tắc chưa hợp lệ. Vui lòng kiểm tra lại.',
  account_not_found: 'Không tìm thấy tài khoản Zalo này hoặc tài khoản không thuộc bạn.',
  revision_conflict: 'Cài đặt bot đã được sửa ở nơi khác. Tải lại để xem bản mới nhất rồi sửa tiếp.',
  account_on_akachat: 'Tài khoản này cài bot ở akaChat. Sửa cài đặt ở trang Chatbot sự kiện của akaChat.',
  runtime_not_supported: 'Tài khoản này chạy trên máy chủ mới, bot sự kiện chưa hỗ trợ.',
  exclusion_limit: `Mỗi tài khoản tối đa ${EVENT_BOT_LIMITS.exclusionsPerAccount} người trong danh sách loại trừ.`,
  job_not_found: 'Không tìm thấy dòng nhật ký này.',
  event_bot_busy: 'Hệ thống đang bận. Vui lòng thử lại sau ít giây.',
  event_bot_timeout: 'Xử lý quá thời gian. Vui lòng thử lại.',
  event_bot_failed: 'Không xử lý được yêu cầu Bot sự kiện. Vui lòng thử lại sau.',
};

export function eventBotErrorMessage(code: string | null | undefined): string {
  return (code && EVENT_BOT_ERROR_MESSAGES[code]) || EVENT_BOT_ERROR_MESSAGES.event_bot_failed;
}
