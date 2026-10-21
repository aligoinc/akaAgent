import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Filter, X } from 'lucide-react'
import { COLUMN_FILTER_OPERATORS, columnFilterDateBoundary, getDataColumn, normalizeColumnFilters } from '../../../../shared/dataColumnFilters'
import type { ColumnFilter, ColumnFilterOperator, ColumnFilterOption, ColumnFilterRequest, DataTableSource } from '../../../../shared/dataColumnFilters'
import type { DataColumnReadRequest, DataColumnReadResult } from '../../../../shared/types'
import './ColumnFilters.css'

const labels: Record<ColumnFilterOperator,string> = { contains:'Chứa',not_contains:'Không chứa',eq:'Bằng',neq:'Khác',starts_with:'Bắt đầu bằng',in:'Là một trong',gt:'Lớn hơn',gte:'Từ',lt:'Nhỏ hơn / trước',lte:'Không lớn hơn',between:'Trong khoảng',empty:'Trống',not_empty:'Không trống' }
export type ColumnFilterOptions = Partial<Record<'zaloTags'|'akaBizTags'|'accounts'|'dataTypes'|'actions',ColumnFilterOption[]>>
export function useColumnFilters(source: DataTableSource, scope: string, onApply: () => void, clearLegacy?: (field: string) => void) {
  const [state,setState] = useState<{scope:string;value:ColumnFilterRequest}>({scope,value:{version:1,filters:[]}})
  const filters = useMemo(() => state.scope === scope ? state.value : {version:1 as const,filters:[]},[scope,state])
  const [available,setAvailable] = useState<boolean | undefined>()
  const [editor,setEditor] = useState<{field:string;x:number;y:number;anchor:HTMLElement;scope:string} | null>(null)
  const formId = useRef(crypto.randomUUID())
  const generation = useRef(0)
  const requestIdRef = useRef<string | null>(null)
  const applyRef = useRef(onApply); applyRef.current=onApply
  const clearRef = useRef(clearLegacy); clearRef.current=clearLegacy
  const cancel = useCallback(() => {
    generation.current++
    const requestId = requestIdRef.current; requestIdRef.current = null
    if(requestId)void window.electronAPI?.cancelDataColumnFilters?.(formId.current,requestId).catch(()=>{})
  },[])
  useLayoutEffect(() => {cancel();setAvailable(undefined);setEditor(null)},[scope,cancel])
  useEffect(() => cancel,[cancel])
  const replace = useCallback((next: ColumnFilter[], legacyField?: string) => {
    const value=normalizeColumnFilters(source,{version:1,filters:next})
    if (legacyField) clearRef.current?.(legacyField)
    cancel();setState({scope,value});setEditor(null);applyRef.current()
  },[source,scope,cancel])
  const remove = useCallback((field:string) => replace(filters.filters.filter(f=>f.field!==field)),[filters,replace])
  const apply = (filter:ColumnFilter):void => replace([...filters.filters.filter(f=>f.field!==filter.field),filter],filter.field)
  const edit = (field:string,anchor:HTMLElement):void => {
    const rect=anchor.getBoundingClientRect()
    setEditor({field,anchor,scope,x:Math.max(12,Math.min(rect.left,window.innerWidth-352)),y:Math.max(12,Math.min(rect.bottom+6,window.innerHeight-430))})
  }
  const read = useCallback(async (query:DataColumnReadRequest['query'],accountId?:number,mode:'page'|'export'|'ids'='page',fallback?:()=>Promise<Partial<DataColumnReadResult>>):Promise<DataColumnReadResult> => {
    const version=++generation.current
    const request:DataColumnReadRequest={source,accountId,formId:formId.current,requestId:crypto.randomUUID(),query:{...query,columnFilters:filters}}
    requestIdRef.current=request.requestId
    const api=window.electronAPI
    let result:DataColumnReadResult
    if (!api?.readDataColumnFilters) {
      if(filters.filters.length)throw new Error('Ứng dụng chưa hỗ trợ backend bộ lọc.')
      result={available:false,contacts:[],members:[],ids:[],total:0}
    } else {
      result=mode==='page'?await api.readDataColumnFilters(request):await api.exportDataColumnFilters(request,mode==='ids')
    }
    if(version!==generation.current)throw new Error('Đã hủy lượt lọc dữ liệu.')
    setAvailable(result.available)
    if (!result.available && filters.filters.length) throw new Error('Backend bộ lọc chưa được cập nhật. Hãy xóa điều kiện hoặc cập nhật backend.')
    if(!result.available&&fallback){
      const legacy=await fallback()
      if(version!==generation.current)throw new Error('Đã hủy lượt lọc dữ liệu.')
      return {...result,...legacy}
    }
    return result
  },[source,filters])
  return {source,filters,available,editor:editor?.scope===scope?editor:null,setEditor,edit,apply,replace,remove,read,cancel}
}
export type ColumnFilterController = ReturnType<typeof useColumnFilters>

export function ColumnFilterHeader({controller,field,children,className}: {controller:ColumnFilterController;field:string;children?:React.ReactNode;className?:string}) {
  const column=getDataColumn(controller.source,field)
  const active=controller.filters.filters.some(f=>f.field===field)
  return <th className={className} aria-label={typeof children==='string'?children:column.label}><span className="column-filter-heading">{children||column.label}<button type="button" className={`column-filter-trigger${active?' is-active':''}`} disabled={controller.available===false} aria-label={`Lọc cột ${column.label}`} aria-pressed={active} aria-expanded={controller.editor?.field===field} title={controller.available===false?'Backend bộ lọc chưa được cập nhật':`Lọc ${column.label}`} onClick={event=>controller.edit(field,event.currentTarget)}><Filter size={13}/></button></span></th>
}

function dateLabel(value:unknown,end=false):string {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return ''
  return new Date(Date.parse(value)+7*3600000-(end?86400000:0)).toISOString().slice(0,10)
}
function FilterEditor({controller,options}: {controller:ColumnFilterController;options:ColumnFilterOptions}) {
  const editing=controller.editor!
  const column=getDataColumn(controller.source,editing.field)
  const existing=controller.filters.filters.find(f=>f.field===editing.field)
  const [op,setOp]=useState<ColumnFilterOperator>(existing?.op||COLUMN_FILTER_OPERATORS[column.kind][0])
  const [value,setValue]=useState(column.kind==='date'?dateLabel(existing?.value):Array.isArray(existing?.value)?existing!.value.join('\n'):String(existing?.value??''))
  const [to,setTo]=useState(column.kind==='date'?dateLabel(existing?.to,true):String(existing?.to??''))
  const [selected,setSelected]=useState<string[]>(Array.isArray(existing?.value)?existing.value:[])
  const [search,setSearch]=useState('')
  const [error,setError]=useState('')
  const container=useRef<HTMLDivElement>(null)
  const allOptions=column.options||options[column.optionSource!]||[]
  const choices=allOptions.filter(o=>o.label.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')))
  const close=useCallback(()=>{controller.setEditor(null);editing.anchor.focus()},[controller.setEditor,editing.anchor])
  useEffect(()=>{
    const click=(event:MouseEvent):void=>{if(!container.current?.contains(event.target as Node)&&!editing.anchor.contains(event.target as Node))close()}
    const key=(event:KeyboardEvent):void=>{if(event.key==='Escape'){event.stopPropagation();close()}}
    document.addEventListener('mousedown',click);document.addEventListener('keydown',key,true)
    return()=>{document.removeEventListener('mousedown',click);document.removeEventListener('keydown',key,true)}
  },[close,editing.anchor])
  const submit=(event:React.FormEvent):void=>{
    event.preventDefault()
    try {
      const condition:ColumnFilter={field:column.id,op}
      if(!['empty','not_empty'].includes(op)) {
        if(op==='in')condition.value=column.kind==='enum'||column.kind==='set'?selected:value.split(/[,\n]/).map(v=>v.trim()).filter(Boolean)
        else if(column.kind==='date') {condition.value=columnFilterDateBoundary(value);if(op==='between')condition.to=columnFilterDateBoundary(to,true)}
        else if(column.kind==='number') {if(!value.trim()||(op==='between'&&!to.trim()))throw new Error('Vui lòng nhập giá trị.');condition.value=Number(value);if(op==='between')condition.to=Number(to)}
        else condition.value=value
      }
      controller.apply(condition);editing.anchor.focus()
    }catch(err){setError(err instanceof Error?err.message:'Điều kiện không hợp lệ.')}
  }
  return createPortal(<div ref={container} className="column-filter-popover" style={{left:editing.x,top:editing.y}} role="dialog" aria-label={`Lọc ${column.label}`}><form onSubmit={submit}>
    <div className="column-filter-title"><strong>{column.label}</strong><button type="button" aria-label="Đóng bộ lọc" onClick={close}><X size={16}/></button></div>
    <label>Điều kiện<select aria-label="Điều kiện" autoFocus value={op} onChange={e=>{setOp(e.target.value as ColumnFilterOperator);setError('')}}>{COLUMN_FILTER_OPERATORS[column.kind].map(item=><option key={item} value={item}>{labels[item]}</option>)}</select></label>
    {!['empty','not_empty'].includes(op)&&(column.kind==='enum'||column.kind==='set'?<>
      <input aria-label="Tìm giá trị lọc" placeholder="Tìm giá trị…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="column-filter-options">{choices.map(option=><label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={e=>setSelected(current=>e.target.checked?[...current,option.value]:current.filter(v=>v!==option.value))}/>{option.label}</label>)}{choices.length===0&&<span className="text-muted">Không có giá trị để chọn.</span>}{selected.filter(v=>!allOptions.some(o=>o.value===v)).map(v=><label key={v}><input type="checkbox" checked onChange={()=>setSelected(current=>current.filter(item=>item!==v))}/>{v} (đã chọn)</label>)}</div>
    </>:<label>{column.kind==='date'?'Ngày (giờ Việt Nam)':op==='in'?'Mỗi giá trị một dòng hoặc ngăn cách bằng dấu phẩy':'Giá trị'}{op==='in'?<textarea value={value} onChange={e=>setValue(e.target.value)}/>:<input type={column.kind==='date'?'date':column.kind==='number'?'number':'text'} step="any" value={value} onChange={e=>setValue(e.target.value)}/>}</label>)}
    {op==='between'&&<label>Đến{column.kind==='date'?' hết ngày':''}<input type={column.kind==='date'?'date':'number'} step="any" value={to} onChange={e=>setTo(e.target.value)}/></label>}
    {error&&<p role="alert" className="column-filter-error">{error}</p>}
    <div className="column-filter-actions"><button type="button" onClick={()=>{controller.remove(column.id);editing.anchor.focus()}}>Xóa điều kiện</button><button type="submit" className="btn-primary">Áp dụng</button></div>
  </form></div>,document.body)
}
export function ColumnFilterBar({controller,options={}}:{controller:ColumnFilterController;options?:ColumnFilterOptions}) {
  return <div className="column-filter-bar" aria-label="Các điều kiện lọc cột">
    {controller.available===false&&<span className="text-muted">{controller.filters.filters.length ? 'Bộ lọc cột cần cập nhật backend. Điều kiện đang được giữ lại.' : 'Bộ lọc cột cần cập nhật backend. Danh sách hiện dùng cách đọc cũ.'}</span>}
    {controller.filters.filters.length===0?<span className="text-muted"><Filter size={13}/> Lọc dữ liệu bằng biểu tượng trên từng cột.</span>:<>
      {controller.filters.filters.map(filter=>{
        const column=getDataColumn(controller.source,filter.field),catalog=column.options||options[column.optionSource!]||[]
        const values=Array.isArray(filter.value)?filter.value.map(v=>catalog.find(o=>o.value===v)?.label||v).join(', '):column.kind==='date'?dateLabel(filter.value):String(filter.value??'')
        const summary=`${column.label}: ${labels[filter.op]} ${values}${filter.to!==undefined?` → ${column.kind==='date'?dateLabel(filter.to,true):filter.to}`:''}`
        return <span key={filter.field} className="column-filter-chip"><button type="button" title={summary} onClick={e=>controller.edit(filter.field,e.currentTarget)}>{summary}</button><button type="button" aria-label={`Bỏ điều kiện ${column.label}`} onClick={()=>controller.remove(filter.field)}><X size={12}/></button></span>
      })}<button type="button" className="column-filter-clear" onClick={()=>controller.replace([])}>Xóa lọc cột</button>
    </>}
    {controller.editor&&<FilterEditor key={`${controller.editor.field}:${JSON.stringify(controller.filters)}`} controller={controller} options={options}/>}
  </div>
}
