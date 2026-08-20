import { X } from 'lucide-react'
import { DataGroup, DataTypeCategoryCode } from '../../../../shared/types'
import { getDataTypeDisplayName, isDataGroupTypeCompatible } from '../../../../shared/dataGroupSemantics'

interface DataScanGroupSelectionModalProps {
  dataTypeCode: DataTypeCategoryCode | null
  groupsLoading: boolean
  contactGroups: DataGroup[]
  selectedGroupIds: Set<number>
  onClose: () => void
  onToggleGroup: (groupId: number) => void
  onConfirm: () => void
}

export default function DataScanGroupSelectionModal({
  dataTypeCode,
  groupsLoading,
  contactGroups,
  selectedGroupIds,
  onClose,
  onToggleGroup,
  onConfirm
}: DataScanGroupSelectionModalProps) {
  const selectedCount = contactGroups.filter(group => selectedGroupIds.has(group.id)).length

  return (
    <div className="data-scan-group-modal-backdrop" onClick={onClose}>
      <div className="data-scan-group-modal" onClick={event => event.stopPropagation()}>
        <div className="data-scan-group-modal-header">
          <div>
            <div className="data-scan-group-modal-title">Chọn nhóm data</div>
            <div className="data-scan-group-modal-subtitle">{selectedCount} nhóm đã chọn</div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="data-scan-group-modal-body">
          <div className="data-scan-group-modal-label">Danh sách nhóm</div>
          <div className="data-scan-group-modal-list">
            {groupsLoading ? (
              <div className="data-scan-group-empty">Đang tải nhóm data...</div>
            ) : contactGroups.length === 0 ? (
              <div className="data-scan-group-empty">Chưa có nhóm data.</div>
            ) : (
              contactGroups.map(group => {
                const isCompatible = isDataGroupTypeCompatible(group.dataTypeCode, dataTypeCode)
                return (
                  <label
                    key={group.id}
                    className={`data-scan-group-modal-option ${isCompatible ? '' : 'is-disabled'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.has(group.id)}
                      onChange={() => onToggleGroup(group.id)}
                      disabled={!isCompatible}
                    />
                    <span className="data-scan-group-modal-option-main">
                      <span className="data-scan-group-modal-option-name">{group.name}</span>
                      <span className="data-scan-contact-type-badge">{getDataTypeDisplayName(group.dataTypeCode, group.dataTypeName)}</span>
                    </span>
                    <span className="data-scan-group-count">
                      {isCompatible ? `${group.activeMembershipCount || 0} data` : 'Không đúng loại'}
                    </span>
                  </label>
                )
              })
            )}
          </div>
        </div>

        <div className="data-scan-group-modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={selectedCount === 0}>
            Chọn
          </button>
        </div>
      </div>
    </div>
  )
}
