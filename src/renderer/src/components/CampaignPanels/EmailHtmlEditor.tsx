import { useEffect, type MutableRefObject, type ReactNode } from 'react'
import { EditorContent, Extension, InputRule, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, type Transaction } from '@tiptap/pm/state'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  IndentDecrease,
  IndentIncrease,
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
import {
  FORMATTED_CONTENT_INDENT_EM,
  FORMATTED_CONTENT_MAX_INDENT
} from '../../../../shared/formattedContent'

export type FormattedContentEditorHandle = Editor
export type EmailHtmlEditorHandle = FormattedContentEditorHandle

export interface FormattedContentEditorProps {
  value: string
  onChange: (html: string) => void
  editorRef?: MutableRefObject<FormattedContentEditorHandle | null>
  onEditorReady?: (editor: FormattedContentEditorHandle | null) => void
  onFocus?: (editor: FormattedContentEditorHandle) => void
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

const normalizeIndentLevel = (value: unknown): number => {
  const numericValue = Number(value)
  if (!Number.isSafeInteger(numericValue) || numericValue <= 0) return 0
  return Math.min(numericValue, FORMATTED_CONTENT_MAX_INDENT)
}

const isInsideListItem = (doc: ProseMirrorNode, position: number): boolean => {
  const resolved = doc.resolve(Math.min(position + 1, doc.content.size))
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'listItem') return true
  }
  return false
}

const FormattedTextIndent = Extension.create({
  name: 'formattedTextIndent',
  priority: 110,
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: element => element.closest('li')
            ? 0
            : normalizeIndentLevel(element.getAttribute('data-indent')),
          renderHTML: attributes => {
            const indentLevel = normalizeIndentLevel(attributes.indent)
            return indentLevel > 0
              ? {
                  'data-indent': String(indentLevel),
                  style: `margin-left: ${indentLevel * FORMATTED_CONTENT_INDENT_EM}em`
                }
              : {}
          }
        }
      }
    }]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some(transaction => transaction.docChanged)) return null
        const transaction = newState.tr
        let changed = false
        newState.doc.descendants((node, position) => {
          if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
          if (normalizeIndentLevel(node.attrs.indent) <= 0 || !isInsideListItem(newState.doc, position)) {
            return false
          }
          transaction.setNodeMarkup(position, undefined, { ...node.attrs, indent: 0 })
          changed = true
          return false
        })
        return changed ? transaction : null
      }
    })]
  },
  addInputRules() {
    const headingType = this.editor.schema.nodes.heading
    return [1, 2, 3].map(level => new InputRule({
      find: new RegExp(`^(#{1,${level}})\\s$`),
      handler: ({ state, range }) => {
        const $start = state.doc.resolve(range.from)
        if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), headingType)) {
          return null
        }
        state.tr
          .delete(range.from, range.to)
          .setBlockType(range.from, range.from, headingType, {
            ...$start.parent.attrs,
            level
          })
      }
    }))
  }
})

interface SelectedIndentBlock {
  node: ProseMirrorNode
  position: number
  indentLevel: number
  insideListItem: boolean
}

interface IndentSelectionState {
  blocks: SelectedIndentBlock[]
  hasListBlocks: boolean
  hasNonListBlocks: boolean
  currentIndentLevel: number
}

const collectSelectedIndentBlocks = (
  doc: ProseMirrorNode,
  from: number,
  to: number
): SelectedIndentBlock[] => {
  const blocks: SelectedIndentBlock[] = []
  doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
    blocks.push({
      node,
      position,
      indentLevel: normalizeIndentLevel(node.attrs.indent),
      insideListItem: isInsideListItem(doc, position)
    })
    return false
  })
  return blocks
}

const getIndentSelectionState = (editor: Editor): IndentSelectionState => {
  const { from, to } = editor.state.selection
  const blocks = collectSelectedIndentBlocks(editor.state.doc, from, to)
  return {
    blocks,
    hasListBlocks: blocks.some(block => block.insideListItem),
    hasNonListBlocks: blocks.some(block => !block.insideListItem),
    currentIndentLevel: blocks.reduce((maximum, block) => Math.max(maximum, block.indentLevel), 0)
  }
}

const resetSelectedBlockIndent = (transaction: Transaction): void => {
  const { from, to } = transaction.selection
  const blocks = collectSelectedIndentBlocks(transaction.doc, from, to)
  for (const block of blocks) {
    if (block.indentLevel <= 0) continue
    transaction.setNodeMarkup(block.position, undefined, { ...block.node.attrs, indent: 0 })
  }
}

const setBlockTypePreservingFormatting = (
  editor: Editor,
  value: 'paragraph' | 'h1' | 'h2' | 'h3'
): boolean => {
  const { from, to } = editor.state.selection
  const preservedBlocks = collectSelectedIndentBlocks(editor.state.doc, from, to).map(block => ({
    position: block.position,
    indent: block.indentLevel,
    textAlign: block.node.attrs.textAlign
  }))
  let chain = editor.chain().focus()
  if (value === 'h1') chain = chain.setHeading({ level: 1 })
  else if (value === 'h2') chain = chain.setHeading({ level: 2 })
  else if (value === 'h3') chain = chain.setHeading({ level: 3 })
  else chain = chain.setParagraph()

  return chain.command(({ tr }) => {
    for (const preserved of preservedBlocks) {
      const mappedPosition = tr.mapping.map(preserved.position, 1)
      const node = tr.doc.nodeAt(mappedPosition)
      if (!node || (node.type.name !== 'paragraph' && node.type.name !== 'heading')) continue
      tr.setNodeMarkup(mappedPosition, undefined, {
        ...node.attrs,
        indent: preserved.indent,
        textAlign: preserved.textAlign
      })
    }
    return true
  }).run()
}

const FormattedBlockShortcuts = Extension.create({
  name: 'formattedBlockShortcuts',
  priority: 110,
  addKeyboardShortcuts() {
    const applyAndConsume = (value: 'paragraph' | 'h1' | 'h2' | 'h3'): boolean => {
      setBlockTypePreservingFormatting(this.editor, value)
      return true
    }
    return {
      'Mod-Alt-0': () => applyAndConsume('paragraph'),
      'Mod-Alt-1': () => applyAndConsume('h1'),
      'Mod-Alt-2': () => applyAndConsume('h2'),
      'Mod-Alt-3': () => applyAndConsume('h3')
    }
  }
})

const updateSelectedBlockIndent = (editor: Editor, delta: -1 | 1): boolean => {
  editor.commands.focus()
  const { state, view } = editor
  const selectionState = getIndentSelectionState(editor)
  if (selectionState.blocks.length === 0 || selectionState.hasListBlocks) return false
  const transaction = state.tr
  let changed = false

  for (const block of selectionState.blocks) {
    const nextIndent = Math.max(0, Math.min(FORMATTED_CONTENT_MAX_INDENT, block.indentLevel + delta))
    if (nextIndent !== block.indentLevel) {
      transaction.setNodeMarkup(block.position, undefined, { ...block.node.attrs, indent: nextIndent })
      changed = true
    }
  }

  if (changed) view.dispatch(transaction.scrollIntoView())
  return changed
}

export function FormattedContentEditor({ value, onChange, editorRef, onEditorReady, onFocus }: FormattedContentEditorProps) {
  const editor = useEditor({
    shouldRerenderOnTransaction: true,
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
      }),
      FormattedTextIndent,
      FormattedBlockShortcuts
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'email-html-editor-content'
      }
    },
    onUpdate({ editor: activeEditor }) {
      onChange(getStoredHtml(activeEditor))
    },
    onFocus({ editor: activeEditor }) {
      onFocus?.(activeEditor)
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
    onEditorReady?.(editor)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

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
  const indentSelection = getIndentSelectionState(editor)
  const hasMixedListSelection = indentSelection.hasListBlocks && indentSelection.hasNonListBlocks
  const isListSelection = indentSelection.hasListBlocks && !indentSelection.hasNonListBlocks
  const canIncreaseIndent = !hasMixedListSelection && indentSelection.blocks.length > 0 && (
    isListSelection
      ? editor.can().sinkListItem('listItem')
      : indentSelection.blocks.some(block => block.indentLevel < FORMATTED_CONTENT_MAX_INDENT)
  )
  const canDecreaseIndent = !hasMixedListSelection && indentSelection.blocks.length > 0 && (
    isListSelection
      ? editor.can().liftListItem('listItem')
      : indentSelection.blocks.some(block => block.indentLevel > 0)
  )

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
    if (value === 'h1' || value === 'h2' || value === 'h3' || value === 'paragraph') {
      setBlockTypePreservingFormatting(editor, value)
    }
  }

  const changeIndent = (delta: -1 | 1) => {
    const selectionState = getIndentSelectionState(editor)
    if (selectionState.hasListBlocks && selectionState.hasNonListBlocks) return
    if (selectionState.hasListBlocks) {
      const chain = editor.chain().focus()
      if (delta > 0) chain.sinkListItem('listItem').run()
      else chain.liftListItem('listItem').run()
      return
    }
    updateSelectedBlockIndent(editor, delta)
  }

  const toggleList = (type: 'bullet' | 'ordered') => {
    const chain = editor.chain().focus().command(({ tr }) => {
      resetSelectedBlockIndent(tr)
      return true
    })
    if (type === 'bullet') chain.toggleBulletList().run()
    else chain.toggleOrderedList().run()
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
        <ToolbarButton title="Danh sách" active={editor.isActive('bulletList')} onClick={() => toggleList('bullet')}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton title="Danh sách số" active={editor.isActive('orderedList')} onClick={() => toggleList('ordered')}>
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton title="Trích dẫn" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={16} />
        </ToolbarButton>
        <ToolbarButton title="Giảm thụt đầu dòng" disabled={!canDecreaseIndent} onClick={() => changeIndent(-1)}>
          <IndentDecrease size={16} />
        </ToolbarButton>
        <ToolbarButton title="Tăng thụt đầu dòng" active={!isListSelection && indentSelection.currentIndentLevel > 0} disabled={!canIncreaseIndent} onClick={() => changeIndent(1)}>
          <IndentIncrease size={16} />
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
        <ToolbarButton title="Đoạn văn" onClick={() => setBlockTypePreservingFormatting(editor, 'paragraph')}>
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

export default FormattedContentEditor
