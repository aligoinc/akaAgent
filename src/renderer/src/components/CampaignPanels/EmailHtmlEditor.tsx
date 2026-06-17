import { useEffect, type MutableRefObject, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  Unlink
} from 'lucide-react'

export type EmailHtmlEditorHandle = Editor

interface EmailHtmlEditorProps {
  value: string
  onChange: (html: string) => void
  editorRef?: MutableRefObject<EmailHtmlEditorHandle | null>
}

interface ToolbarButtonProps {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function ToolbarButton({ title, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      className={`email-html-toolbar-button${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const getStoredHtml = (editor: Editor): string => {
  const html = editor.getHTML()
  return html === '<p></p>' ? '' : html
}

export default function EmailHtmlEditor({ value, onChange, editorRef }: EmailHtmlEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Underline,
      Link.configure({
        autolink: true,
        openOnClick: false,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank'
        }
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph']
      })
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'email-html-editor-content'
      }
    },
    onUpdate({ editor: activeEditor }) {
      onChange(getStoredHtml(activeEditor))
    }
  })

  useEffect(() => {
    if (!editorRef) return
    editorRef.current = editor
    return () => {
      if (editorRef.current === editor) editorRef.current = null
    }
  }, [editor, editorRef])

  useEffect(() => {
    if (!editor) return
    if (getStoredHtml(editor) !== (value || '')) {
      editor.commands.setContent(value || '', { emitUpdate: false })
    }
  }, [editor, value])

  if (!editor) {
    return <div className="email-html-editor-shell" />
  }

  const currentBlock = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'paragraph'

  const setLink = () => {
    const currentHref = String(editor.getAttributes('link').href || '')
    const href = window.prompt('Nhập URL', currentHref || 'https://')
    if (href === null) return
    const nextHref = href.trim()
    if (!nextHref) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: nextHref }).run()
  }

  const applyBlock = (value: string) => {
    const chain = editor.chain().focus()
    if (value === 'h1') chain.toggleHeading({ level: 1 }).run()
    else if (value === 'h2') chain.toggleHeading({ level: 2 }).run()
    else if (value === 'h3') chain.toggleHeading({ level: 3 }).run()
    else chain.setParagraph().run()
  }

  return (
    <div className="email-html-editor-shell">
      <div className="email-html-toolbar">
        <select
          className="email-html-toolbar-select"
          value={currentBlock}
          onChange={e => applyBlock(e.target.value)}
        >
          <option value="paragraph">Văn bản</option>
          <option value="h1">Tiêu đề 1</option>
          <option value="h2">Tiêu đề 2</option>
          <option value="h3">Tiêu đề 3</option>
        </select>
        <ToolbarButton title="Đậm" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton title="Nghiêng" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton title="Gạch chân" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={16} />
        </ToolbarButton>
        <ToolbarButton title="Gạch ngang" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={16} />
        </ToolbarButton>
        <span className="email-html-toolbar-divider" />
        <ToolbarButton title="Danh sách" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton title="Danh sách số" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton title="Trích dẫn" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={16} />
        </ToolbarButton>
        <span className="email-html-toolbar-divider" />
        <ToolbarButton title="Căn trái" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
          <AlignLeft size={16} />
        </ToolbarButton>
        <ToolbarButton title="Căn giữa" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
          <AlignCenter size={16} />
        </ToolbarButton>
        <ToolbarButton title="Căn phải" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
          <AlignRight size={16} />
        </ToolbarButton>
        <span className="email-html-toolbar-divider" />
        <ToolbarButton title="Thêm link" active={editor.isActive('link')} onClick={setLink}>
          <Link2 size={16} />
        </ToolbarButton>
        <ToolbarButton title="Bỏ link" disabled={!editor.isActive('link')} onClick={() => editor.chain().focus().unsetLink().run()}>
          <Unlink size={16} />
        </ToolbarButton>
        <span className="email-html-toolbar-divider" />
        <ToolbarButton title="Xoá định dạng" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting size={16} />
        </ToolbarButton>
        <ToolbarButton title="Đoạn văn" onClick={() => editor.chain().focus().setParagraph().run()}>
          <Pilcrow size={16} />
        </ToolbarButton>
        <span className="email-html-toolbar-divider" />
        <ToolbarButton title="Hoàn tác" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </ToolbarButton>
        <ToolbarButton title="Làm lại" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
