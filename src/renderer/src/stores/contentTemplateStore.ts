import { create } from 'zustand'
import type { ContentTemplate, ContentTemplateContentType, ContentTemplateGroup } from '../../../shared/types'
import { useAuthStore } from './authStore'

interface ContentTemplateLibrary {
  templates: ContentTemplate[]
  groups: ContentTemplateGroup[]
  contentTypes: ContentTemplateContentType[]
}

interface ContentTemplateState extends ContentTemplateLibrary {
  templatesLoaded: boolean
  groupsLoaded: boolean
  loading: boolean
  error: string | null
}

const emptyState = (): ContentTemplateState => ({
  templates: [], groups: [], contentTypes: [],
  templatesLoaded: false, groupsLoaded: false, loading: false, error: null
})

export const useContentTemplateStore = create<ContentTemplateState>(() => emptyState())

let generation = 0
let revision = 0
let pending: Promise<ContentTemplateLibrary | null> | null = null

const userScope = (user: ReturnType<typeof useAuthStore.getState>['user']): string =>
  user ? `${user.organizationId}:${user.staffId}` : ''

// Memory only. A response belonging to a previous login must never repopulate
// the library, even if the next login uses the same staff ID.
useAuthStore.subscribe((state, previous) => {
  if (userScope(state.user) === userScope(previous.user)) return
  generation += 1
  revision = 0
  pending = null
  useContentTemplateStore.setState(emptyState())
})

/** No polling or automatic retries. All callers share the pending refresh. */
export function refreshContentTemplateLibrary(afterMutation = false): Promise<ContentTemplateLibrary | null> {
  if (!useAuthStore.getState().user) return Promise.resolve(null)
  if (afterMutation) revision += 1
  if (pending) return pending

  const requestGeneration = generation
  useContentTemplateStore.setState({ loading: true })
  pending = (async () => {
    while (requestGeneration === generation) {
      const requestRevision = revision
      const [templateResult, groupResult, typeResult] = await Promise.allSettled([
        window.electronAPI.listContentTemplates(),
        window.electronAPI.listContentTemplateGroups(),
        window.electronAPI.listContentTemplateContentTypes()
      ])
      if (requestGeneration !== generation) return null
      // A mutation during this read requires one fresh pass after the old
      // requests drain. Never let an older snapshot overwrite a saved change.
      if (requestRevision !== revision) continue

      const previous = useContentTemplateStore.getState()
      const templates = templateResult.status === 'fulfilled' ? templateResult.value : previous.templates
      const templatesLoaded = templateResult.status === 'fulfilled' || previous.templatesLoaded
      const rawGroups = groupResult.status === 'fulfilled' ? groupResult.value : previous.groups
      const counts = new Map<number, number>()
      for (const template of templates) {
        if (template.groupId !== null && !template.isDelete) {
          counts.set(template.groupId, (counts.get(template.groupId) || 0) + 1)
        }
      }
      const previousCounts = new Map(previous.groups.map(group => [group.id, group.templateCount]))
      const groups = rawGroups.map(group => ({
        ...group,
        // If only groups refresh successfully, a newly discovered group has
        // no known count. Do not infer zero from an older template snapshot.
        templateCount: templateResult.status === 'fulfilled'
          ? counts.get(group.id) || 0
          : previousCounts.get(group.id) ?? null
      }))
      const contentTypes = typeResult.status === 'fulfilled' ? typeResult.value : previous.contentTypes
      const failures = [
        templateResult.status === 'rejected' ? 'mẫu nội dung' : '',
        groupResult.status === 'rejected' ? 'nhóm mẫu' : '',
        typeResult.status === 'rejected' ? 'loại nội dung' : ''
      ].filter(Boolean)
      useContentTemplateStore.setState({
        templates, groups, contentTypes, templatesLoaded,
        groupsLoaded: groupResult.status === 'fulfilled' || previous.groupsLoaded,
        error: failures.length ? `Chưa cập nhật được ${failures.join(', ')}. Dữ liệu đã tải được giữ lại.` : null
      })
      return failures.length ? null : { templates, groups, contentTypes }
    }
    return null
  })().finally(() => {
    if (requestGeneration !== generation) return
    pending = null
    useContentTemplateStore.setState({ loading: false })
  })
  return pending
}
