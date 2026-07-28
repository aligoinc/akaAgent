import type { DataGroup } from '../../../../shared/types'
import DataGroupManagerModal from '../DataScan/DataGroupManagerModal'

export interface DataGroupPickerModalProps {
  selectedGroupId?: number | null
  actionId?: string | null
  compatibleDataTypeCategoryItemId?: number | null
  unrestrictedOnly?: boolean
  onSelect: (group: DataGroup) => void
  onClose: () => void
}

/**
 * Campaign/data-source picker for staff-shared data groups.
 *
 * Keep this component separate from the Facebook joined-group picker: a data
 * group can contain mixed accounts and mixed contact types, while a Facebook
 * joined group is an account-scoped automation target.
 */
export default function DataGroupPickerModal({
  selectedGroupId,
  actionId,
  compatibleDataTypeCategoryItemId,
  unrestrictedOnly,
  onSelect,
  onClose
}: DataGroupPickerModalProps) {
  return (
    <DataGroupManagerModal
      initialGroupId={selectedGroupId}
      compatibleActionId={actionId}
      compatibleDataTypeCategoryItemId={compatibleDataTypeCategoryItemId}
      unrestrictedOnly={unrestrictedOnly}
      selectionMode
      onSelectGroup={onSelect}
      onClose={onClose}
    />
  )
}
