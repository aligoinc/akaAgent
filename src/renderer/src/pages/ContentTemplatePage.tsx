import ContentTemplateWorkspace from '../components/ContentTemplates/ContentTemplateWorkspace'

interface ContentTemplatePageProps {
  isActive?: boolean
}

export default function ContentTemplatePage({ isActive = true }: ContentTemplatePageProps) {
  return <ContentTemplateWorkspace isActive={isActive} />
}
