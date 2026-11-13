import { formatVietnamDate, formatVietnamTime } from './campaignInputDuplicates'
import { IMPORT_FIELDS, IMPORT_MAX_ROWS, importText, type ImportVerificationEntry, type ImportVerificationResult } from './campaignImportVerification'
import type { DataGroupMatchContactType, DataGroupMemberMatch } from './dataGroupMemberMatches'

/**
 * Nhập danh sách từ cửa sổ "Thêm data từ file" vào một Nhóm data trên Desktop: tên danh sách khi có dòng bị lọc, tách
 * các dòng đã có trong nhóm, file Excel của các nhóm kết quả và câu báo sau khi thêm. Cùng luật với akaAgentWebApp
 * `apps/web/src/lib/dataGroupImport.ts` (Web: docs/DATA_GROUP_IMPORT_DUPLICATES.md); khác ở cách Desktop đặt tên danh
 * sách (tên file, "Ảnh dán", "Google Sheet · id") và chữ "data". Hợp đồng: docs/DATA_GROUP_MEMBER_MATCHES_DESKTOP_V522.md.
 */

/** Số dòng hợp lệ cửa sổ nhập đã bỏ trước khi gửi, kèm giờ của lượt đối chiếu. */
export interface DataGroupImportFiltered {
  /** Đã đối chiếu với chiến dịch khác (V491): giờ đối chiếu và số dòng đã bỏ. */
  duplicates?: { checkedAt: string; skipped: number }
  /** Đã đối chiếu với thành viên nhóm (V519): số dòng đã bỏ vì có trong nhóm này / ở nhóm khác. */
  members?: { checkedAt: string; inGroup: number; otherGroups: number }
}

export interface DataGroupImportPlan {
  /** `manual`: dán tay hoặc file txt, cộng dồn. `upload`: DB lưu thành một danh sách theo tên. */
  kind: 'manual' | 'upload'
  datasetName: string
  /** Danh sách mang tên riêng vì có dòng bị bỏ do đã có trong nhóm, ở nhóm khác hoặc ở chiến dịch khác. */
  filtered: boolean
}

/** Giới hạn tên danh sách của DB. */
const DATASET_NAME_MAX = 255

/** Hậu tố của danh sách đã lọc trùng (với nhóm hoặc chiến dịch khác), giờ Việt Nam: " · đã lọc trùng 13/11 10:42". */
export const dataGroupFilteredSuffix = (checkedAt: string | Date): string =>
  ` · đã lọc trùng ${formatVietnamDate(checkedAt).slice(0, 5)} ${formatVietnamTime(checkedAt)}`

export function dataGroupFilteredDatasetName(baseName: string, checkedAt: string | Date): string {
  const suffix = dataGroupFilteredSuffix(checkedAt)
  return `${baseName.trim().slice(0, DATASET_NAME_MAX - suffix.length)}${suffix}`
}

/**
 * DB coi mỗi lần nhập kiểu `upload` là làm mới danh sách cùng tên trong nhóm: data thuộc danh sách đó mà vắng ở lần
 * nhập này bị gỡ khỏi nhóm (trừ khi còn nguồn khác). Khi cửa sổ nhập đã bỏ bớt dòng, phần còn lại không còn là cả
 * file, nên phải lưu dưới một tên riêng; nếu không DB sẽ gỡ đúng những data vừa bị lọc. Nhập từ ô dán/file txt là
 * `manual` (cộng dồn) nên giữ nguyên tên.
 */
export function planDataGroupImport(importSource: string, datasetName: string, filtered: DataGroupImportFiltered = {}): DataGroupImportPlan {
  if (importSource === 'textbox') return { kind: 'manual', datasetName, filtered: false }
  const membersSkipped = (filtered.members?.inGroup ?? 0) + (filtered.members?.otherGroups ?? 0)
  const campaignSkipped = filtered.duplicates?.skipped ?? 0
  // Giờ trong tên là giờ của lượt đối chiếu đã bỏ dòng: nhóm trước (chạy trước), rồi tới chiến dịch.
  const checkedAt = membersSkipped > 0 ? filtered.members?.checkedAt : campaignSkipped > 0 ? filtered.duplicates?.checkedAt : undefined
  return {
    kind: 'upload',
    datasetName: checkedAt ? dataGroupFilteredDatasetName(datasetName, checkedAt) : datasetName,
    filtered: Boolean(checkedAt)
  }
}

/** Một dòng hợp lệ mà máy chủ báo đã là thành viên của nhóm đang nhập hoặc của nhóm khác. */
export interface DataGroupImportMemberEntry extends ImportVerificationEntry {
  match: DataGroupMemberMatch
}

export interface DataGroupMemberSplit {
  report: ImportVerificationResult
  inGroup: DataGroupImportMemberEntry[]
  otherGroups: DataGroupImportMemberEntry[]
}

/** Định danh gửi đi đối chiếu cho một dòng hợp lệ: SĐT với nhóm loại SĐT, còn lại là UID hoặc link group. */
export const dataGroupMatchValue = (entry: ImportVerificationEntry, contactType: DataGroupMatchContactType): string =>
  importText(contactType === 'phone' ? entry.row.phone || entry.normalizedValue : entry.row.uid || entry.normalizedValue)

/**
 * Tách khỏi danh sách hợp lệ các dòng máy chủ báo đã có. `matches[].index` là vị trí trong `report.valid` (đúng thứ
 * tự đã gửi). Dòng vừa có trong nhóm này vừa có ở nhóm khác tính là "đã có trong nhóm này". Lựa chọn nào tắt thì
 * không bỏ dòng theo lựa chọn đó. Giữ thứ tự, không đổi nhóm lỗi/trùng trong file.
 */
export function splitDataGroupMemberEntries(
  report: ImportVerificationResult,
  matches: readonly DataGroupMemberMatch[],
  options: { inGroup: boolean; otherGroups: boolean }
): DataGroupMemberSplit {
  const byIndex = new Map(matches.map(match => [match.index, match]))
  const valid: ImportVerificationEntry[] = []
  const inGroup: DataGroupImportMemberEntry[] = []
  const otherGroups: DataGroupImportMemberEntry[] = []
  report.valid.forEach((entry, index) => {
    const match = byIndex.get(index)
    if (match && options.inGroup && match.inGroup) inGroup.push({ ...entry, reason: 'Đã có trong nhóm này.', match })
    else if (match && options.otherGroups && match.otherGroupCount > 0) otherGroups.push({ ...entry, reason: 'Đã có ở nhóm data khác.', match })
    else valid.push(entry)
  })
  return { report: { ...report, valid, limitExceeded: valid.length > IMPORT_MAX_ROWS }, inGroup, otherGroups }
}

/** File Excel của nhóm "Đã có trong nhóm này" / "Đã có ở nhóm khác": 9 cột template + vị trí nguồn + nhóm đã có. */
export function dataGroupMemberExportMatrix(entries: readonly DataGroupImportMemberEntry[], group: 'inGroup' | 'otherGroups'): string[][] {
  const base = ['Fullname', 'Uid', 'Mobile', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5', 'Nguồn', 'Sheet', 'Dòng gốc', 'Mục trong dòng']
  const header = group === 'otherGroups' ? [...base, 'Đã có ở nhóm (gần nhất)', 'Ngày vào nhóm', 'Số nhóm khác có data này'] : base
  return [header, ...entries.map(entry => {
    const row = [
      ...IMPORT_FIELDS.map(field => importText(entry.row[field])),
      entry.location.source, entry.location.sheet, String(entry.location.row), String(entry.location.item)
    ]
    if (group !== 'otherGroups') return row
    const other = entry.match.otherGroup
    return [...row, other?.name ?? '', other?.addedAt ? `${formatVietnamDate(other.addedAt)} ${formatVietnamTime(other.addedAt)}`.trim() : '',
      String(entry.match.otherGroupCount)]
  })]
}

const count = (value: number): string => value.toLocaleString('vi-VN')

/** Cụm "đã bỏ qua …" của câu báo sau khi thêm: các dòng cửa sổ nhập đã bỏ trước khi gửi. Không bỏ dòng nào thì rỗng. */
export function dataGroupSkippedSummary(filtered: DataGroupImportFiltered = {}): string {
  const parts: string[] = []
  if ((filtered.members?.inGroup ?? 0) > 0) parts.push(`${count(filtered.members?.inGroup ?? 0)} data đã có trong nhóm`)
  if ((filtered.members?.otherGroups ?? 0) > 0) parts.push(`${count(filtered.members?.otherGroups ?? 0)} data đã có ở nhóm khác`)
  if ((filtered.duplicates?.skipped ?? 0) > 0) parts.push(`${count(filtered.duplicates?.skipped ?? 0)} số đã có ở chiến dịch khác`)
  return parts.length ? `đã bỏ qua ${parts.join(', ')}` : ''
}
