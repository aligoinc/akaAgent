// TỆP SINH TỰ ĐỘNG từ src/shared (scripts/campaign-sheet-sync/build-edge-core.cjs). Không sửa tay.
// src/shared/phone.ts
var OLD_VN_MOBILE_PREFIX_MAP = {
  "0162": "032",
  "0163": "033",
  "0164": "034",
  "0165": "035",
  "0166": "036",
  "0167": "037",
  "0168": "038",
  "0169": "039",
  "0120": "070",
  "0121": "079",
  "0122": "077",
  "0126": "076",
  "0128": "078",
  "0123": "083",
  "0124": "084",
  "0125": "085",
  "0127": "081",
  "0129": "082",
  "0186": "056",
  "0188": "058",
  "0199": "059"
};
var VIETNAM_MOBILE_PREFIX_CARRIER_MAP = {
  "032": "viettel",
  "033": "viettel",
  "034": "viettel",
  "035": "viettel",
  "036": "viettel",
  "037": "viettel",
  "038": "viettel",
  "039": "viettel",
  "086": "viettel",
  "096": "viettel",
  "097": "viettel",
  "098": "viettel",
  "081": "vinaphone",
  "082": "vinaphone",
  "083": "vinaphone",
  "084": "vinaphone",
  "085": "vinaphone",
  "088": "vinaphone",
  "091": "vinaphone",
  "094": "vinaphone",
  "070": "mobifone",
  "076": "mobifone",
  "077": "mobifone",
  "078": "mobifone",
  "079": "mobifone",
  "089": "mobifone",
  "090": "mobifone",
  "093": "mobifone",
  "052": "vietnamobile",
  "056": "vietnamobile",
  "058": "vietnamobile",
  "092": "vietnamobile",
  "059": "gmobile",
  "099": "gmobile",
  "087": "itel",
  "055": "wintel"
};
function phoneInputText(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value).toString() : "";
  }
  const text = String(value).trim();
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? Math.trunc(parsed).toString() : text;
  }
  return text;
}
function normalizeVietnamMobilePhone(value) {
  let digits = phoneInputText(value).replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("0084") && digits.length >= 13) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("84") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  if (digits.length === 9 && /^[35789]/.test(digits)) {
    digits = `0${digits}`;
  }
  if (digits.length === 10) {
    const mappedPrefix = OLD_VN_MOBILE_PREFIX_MAP[`0${digits.slice(0, 3)}`];
    if (mappedPrefix) digits = `${mappedPrefix}${digits.slice(3)}`;
  }
  if (digits.length === 11) {
    const mappedPrefix = OLD_VN_MOBILE_PREFIX_MAP[digits.slice(0, 4)];
    if (mappedPrefix) digits = `${mappedPrefix}${digits.slice(4)}`;
  }
  return /^0[35789]\d{8}$/.test(digits) ? digits : "";
}
function getVietnamMobileCarrier(value) {
  const phone = normalizeVietnamMobilePhone(value);
  if (!phone) return "";
  return VIETNAM_MOBILE_PREFIX_CARRIER_MAP[phone.slice(0, 3)] || "unknown";
}

// src/shared/vietnamTime.ts
var VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1e3;

// src/shared/googleSheetSync.ts
var SHEET_MAX_BYTES = 10 * 1024 * 1024;
var SHEET_MAX_ROWS = 1e4;
var GoogleSheetError = class extends Error {
  constructor(message, permanent = true) {
    super(message);
    this.permanent = permanent;
    this.name = "GoogleSheetError";
  }
};
function googleSheetUrl(raw) {
  try {
    if (typeof raw !== "string" || raw.length > 4096) throw new Error();
    const url = new URL(raw.trim());
    const id = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port || url.username || url.password || !id) throw new Error();
    const gid = url.searchParams.get("gid") ?? new URLSearchParams(url.hash.slice(1)).get("gid") ?? "";
    if (gid && !/^\d{1,20}$/.test(gid)) throw new Error();
    return {
      url: `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? `#gid=${gid}` : ""}`,
      downloadUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`
    };
  } catch {
    throw new GoogleSheetError("Vui lòng nhập link https://docs.google.com/spreadsheets/d/… hợp lệ.");
  }
}
function parseSheetCsv(csv) {
  const rows = [];
  let row = [], cell = "", quoted = false, closed = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 512) throw new GoogleSheetError("Sheet có quá nhiều cột (tối đa 512 cột).");
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > SHEET_MAX_ROWS + 1) throw new GoogleSheetError("Sheet vượt giới hạn 10.000 dòng dữ liệu.");
  };
  csv = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === ",") pushCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      pushRow();
    } else if (c === '"' && cell === "" && !closed) quoted = true;
    else if (closed || c === '"') throw new GoogleSheetError("Dữ liệu CSV không hợp lệ.");
    else cell += c;
  }
  if (quoted) throw new GoogleSheetError("Dữ liệu CSV thiếu dấu đóng ngoặc kép.");
  if (cell || row.length || closed) pushRow();
  return rows;
}
async function readGoogleSheet(raw, hasHeader, fetcher = fetch) {
  const target = googleSheetUrl(raw);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3e4);
  try {
    let next = target.downloadUrl, response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const u = new URL(next);
      if (u.protocol !== "https:" || u.port || u.username || u.password || !(u.hostname === "docs.google.com" || u.hostname.endsWith(".googleusercontent.com"))) {
        throw new GoogleSheetError("Sheet yêu cầu đăng nhập. Hãy bật “Bất kỳ ai có đường liên kết”.");
      }
      response = await fetcher(next, { redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 3) throw new GoogleSheetError("Không thể đọc đường dẫn chuyển tiếp của Google Sheet.");
        next = new URL(location, next).href;
      } else break;
    }
    if (!response?.ok) {
      await response?.body?.cancel();
      throw new GoogleSheetError(`Không đọc được Sheet (HTTP ${response?.status}). Kiểm tra link, tab và quyền chia sẻ.`, !response || ![408, 429].includes(response.status) && response.status < 500);
    }
    if (response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel();
      throw new GoogleSheetError("Sheet chưa cho phép đọc qua link hoặc tab không tồn tại.");
    }
    if (Number(response.headers.get("content-length")) > SHEET_MAX_BYTES) {
      await response.body?.cancel();
      throw new GoogleSheetError("Sheet vượt giới hạn 10 MiB.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new GoogleSheetError("Không nhận được dữ liệu Sheet.", false);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0, text = "";
    try {
      for (; ; ) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > SHEET_MAX_BYTES) throw new GoogleSheetError("Sheet vượt giới hạn 10 MiB.");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
    if (/^\s*<(?:!doctype|html)/i.test(text)) throw new GoogleSheetError("Sheet chưa cho phép đọc qua link.");
    const parsed = parseSheetCsv(text);
    const headers = hasHeader ? (parsed.shift() || []).map((s) => s.trim()) : [];
    if (parsed.length > SHEET_MAX_ROWS) throw new GoogleSheetError("Sheet vượt giới hạn 10.000 dòng dữ liệu.");
    const width = Math.max(headers.length, ...parsed.map((row) => row.length), 0);
    return { url: target.url, headers: hasHeader ? headers : Array.from({ length: width }, () => ""), rows: parsed };
  } catch (error) {
    if (error instanceof GoogleSheetError) throw error;
    throw new GoogleSheetError(controller.signal.aborted ? "Đọc Sheet quá 30 giây. Hệ thống sẽ thử lại." : "Không thể kết nối Google Sheet. Vui lòng thử lại.", false);
  } finally {
    clearTimeout(timeout);
  }
}

// src/shared/types.ts
var MEDIA_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
var MEDIA_FILE_MAX_SIZE_BYTES = 25 * 1024 * 1024;
var CAMPAIGN_INPUT_DATA_REQUIREMENTS = {
  facebook_group_post: { field: "uid", label: "group URL" },
  facebook_join_group: { field: "uid", label: "group URL/UID" },
  facebook_group_invite: { field: "uid", label: "UID/link bạn bè" },
  facebook_page_post: { field: "uid", label: "Page ID" },
  facebook_message_friend: { field: "uid", label: "UID/link bạn bè" },
  facebook_message_uid: { field: "uid", label: "UID/link profile" },
  facebook_page_to_message: { field: "uid", label: "PSID khách inbox Page" },
  facebook_find_data_group: { field: "uid", label: "group URL" },
  facebook_find_data_search: { field: "uid", label: "từ khóa" },
  facebook_comment_seeding: { field: "uid", label: "group/page/profile" },
  facebook_comment_seeding_post: { field: "uid", label: "link bài post" },
  zalo_message_phone: { field: "phone", label: "SĐT Zalo" },
  zalo_message_friend: { field: "uid", label: "UID bạn bè Zalo" },
  zalo_message_group_member: { field: "uid", label: "UID Zalo" },
  zalo_message_group_realtime: { field: "uid", label: "UID thành viên group Zalo theo thời gian thực" },
  zalo_message_remarketing_customer: { field: "uid", label: "UID khách hàng Zalo đã từng gửi tin" },
  zalo_message_group: { field: "uid", label: "ID group Zalo" },
  zalo_add_group_member: { field: "phone_or_uid", label: "SĐT hoặc UID Zalo" },
  zalo_join_group_link: { field: "uid", label: "Link group Zalo" },
  zalo_cancel_sent_friend_request: { field: "uid", label: "UID lời mời kết bạn Zalo đã gửi" },
  sms_send: { field: "phone", label: "SĐT SMS" },
  voice_call: { field: "phone", label: "SĐT gọi tự động" },
  email_send: { field: "email", label: "email người nhận" }
};
var normalizeEmailInputDataValue = (value) => String(value ?? "").trim();
var isValidEmailInputDataValue = (value) => {
  const email = normalizeEmailInputDataValue(value);
  if (!email || email.length > 254 || /\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64 || domain.length > 253) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
};
var getCampaignInputDataRequirement = (actionId) => {
  if (!actionId) return null;
  return CAMPAIGN_INPUT_DATA_REQUIREMENTS[actionId] || null;
};

// src/shared/zaloUidImport.ts
var isZaloUidImportAction = (actionId) => actionId === "zalo_message_group_member";
var normalizeZaloImportUid = (value) => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  const uid = String(value).replace(/\s+/g, "");
  return /^\d{5,30}$/.test(uid) ? uid : "";
};

// src/shared/campaignInputDuplicates.ts
var VIETNAM_DATE = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
var VIETNAM_TIME = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });

// src/shared/campaignImportVerification.ts
var IMPORT_MAX_ROWS = 1e4;
var IMPORT_LIMIT_MESSAGE = "Mỗi lần chỉ được nhập tối đa 10.000 dòng dữ liệu. Vui lòng chia nhỏ dữ liệu rồi thử lại.";
var IMPORT_FIELDS = ["name", "uid", "phone", "email", "info1", "info2", "info3", "info4", "info5"];
var importText = (value) => value == null ? "" : String(value).trim();
var importTargetField = (platform, actionId) => {
  if (actionId === "zalo_add_group_member") return "phone";
  if (actionId === "data_group_zalo_person_uid") return "uid";
  const field = getCampaignInputDataRequirement(actionId)?.field;
  if (field === "phone" || field === "uid" || field === "email") return field;
  return platform === "zalo" || platform === "sms" ? "phone" : platform === "email" ? "email" : "uid";
};
function exactScientificInteger(text) {
  const scientific = text.match(/^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
  if (!scientific) return null;
  const digits = scientific[2] + (scientific[3] || "");
  const shift = Number(scientific[4]) - (scientific[3]?.length || 0);
  if (!Number.isSafeInteger(shift) || shift > 0) {
    return { value: "", reason: "Số dạng khoa học có thể thiếu chữ số. Vui lòng nhập số đầy đủ." };
  }
  if (scientific[1] === "-" || -shift >= digits.length || shift < 0 && !/^0+$/.test(digits.slice(shift))) {
    return { value: "", reason: "Số dạng khoa học không phải số nguyên không âm." };
  }
  const integer = shift < 0 ? digits.slice(0, shift) : digits;
  return { value: integer.replace(/^0+(?=\d)/, ""), reason: "" };
}
function normalizeImportPhone(raw) {
  const invalid = { value: "", reason: "Số điện thoại Việt Nam không hợp lệ." };
  if (typeof raw === "number" && (!Number.isSafeInteger(raw) || raw < 0)) return invalid;
  let text = importText(raw).replace(/^'/, "").trim();
  if (!text) return { value: "", reason: "Thiếu số điện thoại." };
  const scientific = exactScientificInteger(text);
  if (scientific) {
    if (!scientific.value) return scientific;
    text = scientific.value;
  } else if (/^[+-]?\d+(?:\.\d+)?e/i.test(text)) {
    return invalid;
  }
  if (/^\+?\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
  const numericSpan = text.match(/\d[\s\S]*\d/)?.[0] || text;
  if (/[^\d\s().+\-\u200b-\u200d\ufeff]/.test(numericSpan)) return invalid;
  let digits = text.replace(/\D+/g, "");
  if (/^840\d{9}$/.test(digits)) digits = digits.slice(2);
  else if (/^084\d{9}$/.test(digits)) digits = `0${digits.slice(3)}`;
  const value = normalizeVietnamMobilePhone(digits);
  return value ? { value, reason: "" } : invalid;
}
var normalizeImportGroupLink = (value) => {
  const raw = importText(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const code = (host === "zalo.me" || host.endsWith(".zalo.me")) && parts[0]?.toLowerCase() === "g" ? parts[1] : (host === "zaloapp.com" || host.endsWith(".zaloapp.com")) && parts[0]?.toLowerCase() === "qr" && parts[1]?.toLowerCase() === "g" ? parts[2] : "";
    return code ? `https://zalo.me/g/${code}` : "";
  } catch {
    return "";
  }
};
var normalizeUid = (value) => {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    return { value: "", reason: "UID dạng số không còn đủ độ chính xác. Vui lòng nhập UID đầy đủ dạng text." };
  }
  const text = importText(value).replace(/\s+/g, "").replace(/\/+$/, "");
  const scientific = exactScientificInteger(text);
  if (scientific) return scientific;
  return { value: ["uid", "url", "link", "group", "profile", "facebook", "facebookuid"].includes(text.toLowerCase()) ? "" : text, reason: "" };
};
var keyword = (value) => {
  const text = importText(value).replace(/\s+/g, " ");
  return ["keyword", "keywords", "tu khoa", "từ khóa", "search", "tìm kiếm"].includes(text.toLowerCase()) ? "" : text;
};
var isBlankRow = (row) => row.every((cell) => !importText(cell.value) && !cell.text.trim());
function mapImportTable(table, mapping, startIndex, source) {
  const result = [];
  for (let index = startIndex; index < table.rows.length; index++) {
    const cells = table.rows[index];
    if (isBlankRow(cells)) continue;
    const data = {}, display = {}, errors = {};
    for (const field of IMPORT_FIELDS) {
      const column = mapping[field];
      if (column === void 0) continue;
      const cell = cells[column];
      data[field] = field === "phone" || field === "uid" ? cell?.value ?? "" : cell?.text ?? "";
      display[field] = cell?.text ?? "";
      if (cell?.error) errors[field] = cell.error;
    }
    result.push({ data, display, errors, location: { source, sheet: table.name, row: table.rowNumbers[index] ?? index + 1, item: 1 } });
    if (result.length > IMPORT_MAX_ROWS) throw new Error(IMPORT_LIMIT_MESSAGE);
  }
  return result;
}
function verifyImportRows(rows, options) {
  const { actionId, platform, kind } = options;
  const target = importTargetField(platform, actionId);
  const sourceRowCount = new Set(rows.map((row) => JSON.stringify([row.location.source, row.location.sheet, row.location.row]))).size;
  if (sourceRowCount > IMPORT_MAX_ROWS) throw new Error(IMPORT_LIMIT_MESSAGE);
  const result = { valid: [], rejected: [], duplicates: [], sourceRowCount, itemCount: 0, limitExceeded: false };
  const seen = /* @__PURE__ */ new Map();
  const tablePolicy = ["excel", "akabizTemplate", "sheet"].includes(kind) ? options.phonePolicy || "first" : "all";
  for (const source of rows) {
    const original = Object.fromEntries(IMPORT_FIELDS.map((field) => [field, source.display?.[field] ?? importText(source.data[field])]));
    let raw = source.data[target];
    let sourceField = target;
    if (!source.errors?.[target] && !importText(raw) && (actionId === "facebook_join_group" || actionId === "facebook_find_data_search" || actionId === "data_group_zalo_person_uid" || kind === "akabizTemplate" && ["zalo_join_group_link", "facebook_comment_seeding_post", "zalo_add_group_member"].includes(actionId))) {
      raw = source.data.name;
      sourceField = "name";
    }
    const cellError = source.errors?.[sourceField];
    const parts = !cellError && target === "phone" && typeof raw === "string" ? raw.split(/[,;]/).map((part) => part.trim()).filter(Boolean) : [raw];
    if (!parts.length) parts.push("");
    let tookFirst = false;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex];
      const row = { ...original };
      let normalizedValue = "", reason = "", key = "";
      if (cellError) {
        reason = `Ô dữ liệu người nhận bị lỗi Excel ${cellError}. Vui lòng sửa ô nguồn rồi nhập lại.`;
        row[target] = "";
      } else if (target === "phone") {
        const phone = normalizeImportPhone(part);
        normalizedValue = phone.value;
        reason = phone.reason;
        row.phone = phone.value;
        row.phoneCarrier = getVietnamMobileCarrier(phone.value) || null;
        if (kind !== "akabizTemplate" || actionId === "zalo_add_group_member") {
          row.uid = "";
          row.email = "";
        }
        if (actionId === "zalo_add_group_member" && normalizeImportPhone(row.name).value === phone.value) row.name = "";
        if (parts.length > 1 && tablePolicy === "discard") reason = "Bị bỏ theo lựa chọn bỏ dòng có nhiều SĐT.";
        else if (phone.value && tablePolicy === "first") {
          if (tookFirst) reason = "Bị bỏ theo lựa chọn chỉ lấy số hợp lệ đầu tiên.";
          else tookFirst = true;
        }
      } else if (target === "email") {
        normalizedValue = importText(part).toLowerCase();
        if (!isValidEmailInputDataValue(normalizedValue)) {
          normalizedValue = "";
          reason = "Email không hợp lệ hoặc bị thiếu.";
        }
        row.email = normalizedValue;
        if (kind !== "akabizTemplate") {
          row.uid = "";
          row.phone = "";
        }
      } else {
        if (isZaloUidImportAction(actionId) || actionId === "data_group_zalo_person_uid") normalizedValue = normalizeZaloImportUid(part);
        else if (actionId === "zalo_join_group_link") normalizedValue = normalizeImportGroupLink(part);
        else if (actionId === "facebook_find_data_search") normalizedValue = keyword(part);
        else {
          const uid = normalizeUid(part);
          normalizedValue = uid.value;
          reason = uid.reason;
        }
        if (!normalizedValue && !reason) reason = `${getCampaignInputDataRequirement(actionId)?.label || "UID"} không hợp lệ hoặc bị thiếu.`;
        row.uid = normalizedValue;
        if (kind !== "akabizTemplate" || isZaloUidImportAction(actionId) || ["data_group_zalo_person_uid", "zalo_join_group_link", "facebook_join_group", "facebook_find_data_search", "facebook_comment_seeding_post"].includes(actionId)) {
          row.phone = "";
          row.email = "";
        }
        if (actionId === "facebook_find_data_search" || actionId === "facebook_comment_seeding_post" && kind === "akabizTemplate") row.name = "";
        else if (["data_group_zalo_person_uid", "zalo_join_group_link", "facebook_join_group"].includes(actionId) && importText(row.name) === importText(part)) row.name = "";
      }
      key = actionId === "facebook_find_data_search" || target === "email" || kind === "akabizTemplate" ? normalizedValue.toLowerCase() : normalizedValue;
      const entry = {
        id: ++result.itemCount,
        location: { ...source.location, item: parts.length > 1 ? partIndex + 1 : source.location.item },
        original: { ...original, [target]: importText(part) },
        row,
        originalValue: importText(raw) || source.rawRecord || "",
        displayValue: source.display?.[target] ?? importText(raw),
        normalizedValue,
        reason
      };
      if (reason || !key) result.rejected.push(entry);
      else if (seen.has(key)) {
        entry.reason = "Trùng dữ liệu sau chuẩn hóa trong lần upload này.";
        entry.duplicateOf = seen.get(key).location;
        result.duplicates.push(entry);
      } else {
        seen.set(key, entry);
        result.valid.push(entry);
      }
    }
  }
  result.limitExceeded = result.valid.length > IMPORT_MAX_ROWS;
  return result;
}

// src/shared/campaignSheetSyncRows.ts
var CampaignSheetSyncError = class extends Error {
  constructor(code, message, permanent) {
    super(message);
    this.code = code;
    this.permanent = permanent;
    this.name = "CampaignSheetSyncError";
  }
};
var headerCell = (value) => importText(value).replace(/\s+/g, " ");
function campaignSheetTable(rows) {
  return {
    name: "Google Sheet",
    rowNumbers: rows.map((_, index) => index + 1),
    rows: rows.map((row) => row.map((value) => ({ value, text: value })))
  };
}
function campaignSheetSyncRows(table, config, actionId) {
  if (config.hasHeader) {
    const header = (table.rows[0] || []).map((cell) => headerCell(cell.text));
    const expected = config.expectedHeaders.map(headerCell);
    for (let index = 0; index < expected.length; index++) {
      if ((header[index] || "") !== expected[index]) {
        throw new CampaignSheetSyncError("sheet_columns_changed", "Cột của Sheet đã thay đổi. Hãy kết nối và ghép cột lại.", true);
      }
    }
  }
  const mapping = config.mapping;
  let report;
  try {
    const source = mapImportTable(table, mapping, config.hasHeader ? 1 : 0, "Google Sheet");
    report = verifyImportRows(source, {
      platform: config.platform,
      actionId,
      kind: "sheet",
      phonePolicy: config.phonePolicy
    });
  } catch (error) {
    throw new CampaignSheetSyncError("sheet_too_large", error instanceof Error ? error.message : "Sheet vượt giới hạn dòng.", true);
  }
  const field = config.targetField;
  const rows = report.valid.map((entry) => {
    const row = {};
    const name = importText(entry.row.name);
    if (name) row.name = name;
    row[field] = entry.normalizedValue;
    for (const info of ["info1", "info2", "info3", "info4", "info5"]) {
      const value = importText(entry.row[info]);
      if (value) row[info] = value;
    }
    if (field === "phone" && entry.row.phoneCarrier) row.phoneCarrier = entry.row.phoneCarrier;
    return row;
  });
  return { rows, rowCount: report.sourceRowCount, invalid: report.rejected.length, duplicates: report.duplicates.length };
}
export {
  CampaignSheetSyncError,
  GoogleSheetError,
  campaignSheetSyncRows,
  campaignSheetTable,
  readGoogleSheet
};
