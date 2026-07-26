import type { DataGroup } from '../../../../shared/types'
import DataGroupManagerModal from '../DataScan/DataGroupManagerModal'

export interface DataGroupPickerModalProps {
  selectedGroupId?: number | null
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
  onSelect,
  onClose
}: DataGroupPickerModalProps) {
  return (
    <DataGroupManagerModal
      initialGroupId={selectedGroupId}
      selectionMode
      onSelectGroup={onSelect}
      onClose={onClose}
    />
  )
}
