/* eslint-disable no-template-curly-in-string */
import * as blockRepo from '../repositories/blockRepository'
import * as workflowV2Repo from '../repositories/workflowV2Repository'
import * as elementV2Repo from '../repositories/elementV2Repository'
import * as campaignActionRepo from '../repositories/campaignActionRepository'
import { getSupabaseClient } from '../supabaseClient'
import { BlockDef, WorkflowNode, WorkflowEdge } from '../../../shared/v2Types'

/**
 * Seed v2 — chạy idempotent (UPSERT theo name UNIQUE constraint).
 * Gọi từ handlers.ts khi app khởi động.
 *
 * Order:
 *   1. seedElements()  — XPath snippets
 *   2. seedBlocks()    — block library (system + JS)
 *   3. seedWorkflows() — 3 workflows (group_post, timeline_post, message_friend)
 *   4. bindToActions() — gán workflow_v2_id vào auto_campaign_actions
 */
export async function seedV2(): Promise<void> {
  try {
    await seedElements()
    const blockIds = await seedBlocks()
    const workflowIds = await seedWorkflows(blockIds)
    await bindToActions(workflowIds)
    console.log('[seedV2] Done.')
  } catch (err) {
    console.error('[seedV2] Failed:', err)
  }
}

// ============================================================
// 1. ELEMENTS
// ============================================================
async function seedElements(): Promise<void> {
  // XPath gốc lấy từ workflow engine cũ (auto_flows) — đã verified hoạt động trên FB UI hiện tại
  const elements: { name: string; xpath: string; description: string; category: string }[] = [
    { name: 'fb_main_role', xpath: "//*[@role='main']", description: 'Vùng main của Facebook', category: 'facebook' },
    // 4 element này dùng XPath UNION (|) để match cả 2 context: timeline (dialog-based) và group (form inline)
    { name: 'fb_composer_button', xpath: "//*[@role='button' and (contains(.,'đang nghĩ gì') or contains(.,'on your mind') or contains(.,'Write something') or contains(.,'Bạn viết gì đi'))]", description: 'Nút mở composer (timeline có "Bạn đang nghĩ gì, [tên]?" có dấu phẩy + tên trước "?" → contains "đang nghĩ gì" match cả timeline lẫn group)', category: 'facebook' },
    { name: 'fb_composer_dialog', xpath: "//*[@role='dialog']//*[@contenteditable='true'] | //form[@method='POST']//*[contains(@class,'notranslate')]", description: 'Khung soạn nội dung — timeline (dialog) hoặc group (form inline)', category: 'facebook' },
    { name: 'fb_composer_dialog_root', xpath: "//*[@role='dialog'] | //form[@method='POST']//*[contains(@class,'notranslate')]", description: 'Drop target ảnh — timeline (dialog) hoặc group (form)', category: 'facebook' },
    { name: 'fb_post_button', xpath: "//*[@role='dialog']//*[(@aria-label='Đăng' or @aria-label='Post') and @role='button'] | //*[not(@aria-hidden)]/form//*[@role='button' and (contains(.,'Post') or .='Đăng')]", description: 'Nút Đăng / Post — timeline (dialog aria-label) hoặc group (form text)', category: 'facebook' },
    { name: 'fb_pending_banner', xpath: "//*[contains(text(),'đang chờ được duyệt') or contains(text(),'chờ phê duyệt') or contains(text(),'Bài viết đang chờ duyệt') or contains(text(),'pending approval') or contains(text(),'Post pending approval')]", description: 'Banner báo bài đang chờ duyệt', category: 'facebook' },
    { name: 'fb_group_join_button', xpath: "//*[@role='button' and (contains(.,'Tham gia nhóm') or contains(.,'Join group') or contains(.,'Join Group'))]", description: 'Nút Tham gia nhóm', category: 'facebook' },
    { name: 'fb_group_menu_button', xpath: "//div[contains(@aria-label,'Đã tham gia') or contains(@aria-label,'Joined')]", description: 'Menu Đã tham gia (để mở dropdown rời nhóm)', category: 'facebook' },
    { name: 'fb_group_leave_menuitem', xpath: "//*[@role='menuitem' and (contains(.,'Rời nhóm') or contains(.,'Leave group') or contains(.,'Leave Group'))]", description: 'Menu item Rời nhóm trong dropdown', category: 'facebook' },
    { name: 'fb_group_leave_confirm', xpath: "//*[@role='dialog']//*[@role='button' and (contains(.,'Rời nhóm') or contains(.,'Leave Group') or contains(.,'Leave group'))]", description: 'Nút xác nhận Rời nhóm trong dialog', category: 'facebook' },
    { name: 'fb_messenger_textbox', xpath: '[role="textbox"][contenteditable="true"]', description: 'Khung nhập tin nhắn Messenger (CSS selector)', category: 'facebook' },
    { name: 'fb_add_friend_button', xpath: '//*[@role="button" and .="Thêm bạn bè"]', description: 'Nút Thêm bạn bè trên profile', category: 'facebook' },
    { name: 'fb_comment_box_at_n', xpath: "(//div[@aria-label='Viết bình luận...' or @aria-label='Write a comment...' or @aria-label='Write a comment' or @aria-label='Viết bình luận'])[${n}]", description: 'Khung Comment thứ ${n} (template ${n}=position)', category: 'facebook' },
    { name: 'fb_comment_textbox_at_n', xpath: "(//div[@aria-label='Viết bình luận...' or @aria-label='Write a comment...' or @aria-label='Write a comment' or @aria-label='Viết bình luận'])[${n}]", description: 'Khung gõ comment thứ ${n} (alias same as box)', category: 'facebook' },
    { name: 'fb_post_content_main', xpath: "//*[@role='main']//*[@data-ad-rendering-role='story_message' or @data-ad-preview='message']", description: 'Nội dung bài viết chính (cho scrape — fallback trang detail)', category: 'facebook' },

    // ===== Share / Reels / Scrape (XPath gốc từ engine v1 webviewController) =====
    { name: 'fb_post_container', xpath: '//*[@role="feed"]/following-sibling::*[not(@class)][1]/div[not(@class)] | //*[@class="x1yztbdb"]/following-sibling::*[not(@class)][1]/div[not(@class)] | //*[@role="dialog" and not(@aria-label="Thông báo") and not(@aria-label="Messenger")] | //*[@role="feed"][last()]/*/*/div[not(@class)][1]', description: 'Container bài đăng FB (union page/profile/dialog/group)', category: 'facebook' },
    { name: 'fb_share_button_inner', xpath: '//*[@role="button" and (@aria-label="Chia sẻ" or @aria-label="Share" or .="Chia sẻ" or .="Share" or .//*[@data-ad-rendering-role="share_button"])]', description: 'Nút Chia sẻ (descendant, append sau container)', category: 'facebook' },
    { name: 'fb_share_now_menuitem', xpath: '//*[@role="button" and contains(.,"Chia sẻ ngay")]', description: 'Nút "Chia sẻ ngay" trong menu chia sẻ', category: 'facebook' },
    { name: 'fb_reels_upload_input', xpath: 'input[type="file"]', description: 'Input file trên trang /reels/create', category: 'facebook' },
    { name: 'fb_reels_next_button', xpath: '//*[@role="button" and (.="Tiếp" or .="Next")]', description: 'Nút Tiếp/Next các bước Reels', category: 'facebook' },
    { name: 'fb_reels_description', xpath: '[contenteditable="true"][role="textbox"], [contenteditable="true"]', description: 'Ô caption Reels', category: 'facebook' },
    { name: 'fb_reels_publish_button', xpath: '//*[@role="button" and (.="Đăng" or .="Publish" or .="Post" or .="Chia sẻ")]', description: 'Nút Đăng Reels (cuối flow)', category: 'facebook' },
    { name: 'fb_see_more_inner', xpath: '//*[@role="button" and (normalize-space(.)="Xem thêm" or normalize-space(.)="See more")]', description: 'Nút "Xem thêm" expand nội dung (descendant, append sau container)', category: 'facebook' },
    { name: 'fb_post_content_inner', xpath: '//div[@dir="auto"]//*[@data-ad-rendering-role="story_message" or @class="xh8yej3" or @id]', description: 'Marker nội dung bài (descendant, append sau container)', category: 'facebook' }
  ]

  for (const el of elements) {
    try {
      await elementV2Repo.saveElementSystem(el)
    } catch (err) {
      console.error(`[seedV2] Failed to seed element ${el.name}:`, err)
    }
  }
}

// ============================================================
// 2. BLOCKS
// ============================================================
type BlockSeed = Partial<BlockDef> & { name: string; category: BlockDef['category']; kind: BlockDef['kind'] }

async function seedBlocks(): Promise<Map<string, number>> {
  const blocks: BlockSeed[] = [
    // ===== SYSTEM BLOCKS =====
    {
      name: 'if_else', category: 'control', kind: 'system', systemType: 'ifElse',
      icon: 'GitBranch', description: 'Rẽ nhánh true/false dựa trên điều kiện JS',
      configSchema: [
        { name: 'condition', type: 'code', label: 'Điều kiện (JS expression)', required: true, placeholder: 'vars.enableComment === true' }
      ],
      outputSchema: [
        { name: 'branch', type: 'string', label: 'Nhánh được chọn (true/false)' },
        { name: 'conditionResult', type: 'boolean', label: 'Giá trị evaluated' }
      ],
      defaultConfig: { condition: 'true' }
    },
    {
      name: 'loop', category: 'control', kind: 'system', systemType: 'loop',
      icon: 'Repeat', description: 'Lặp body subgraph theo count/forEach/while',
      configSchema: [
        { name: 'loopType', type: 'select', label: 'Loại loop', required: true, default: 'count', options: [
          { label: 'count (số lần cố định)', value: 'count' },
          { label: 'forEach (lặp qua array)', value: 'forEach' },
          { label: 'while (lặp khi condition true)', value: 'while' }
        ]},
        { name: 'count', type: 'number', label: 'count (cho loopType=count)', placeholder: '3' },
        { name: 'itemsExpr', type: 'code', label: 'items expression (cho forEach)', placeholder: 'vars.commentIterations' },
        { name: 'condition', type: 'code', label: 'condition (cho while)', placeholder: 'iter < 10' },
        { name: 'maxIterations', type: 'number', label: 'maxIterations (cho while)', default: 1000 }
      ],
      outputSchema: [{ name: 'iterations', type: 'number', label: 'Số iteration đã chạy' }],
      defaultConfig: { loopType: 'count', count: 3 }
    },
    {
      name: 'parallel', category: 'control', kind: 'system', systemType: 'parallel',
      icon: 'GitMerge', description: 'Split point (tự nhiên cho DAG có nhiều outgoing edges, optional)',
      configSchema: [], outputSchema: [], defaultConfig: {}
    },
    {
      name: 'merge', category: 'control', kind: 'system', systemType: 'merge',
      icon: 'GitCommit', description: 'Join point — đợi tất cả parents (mode=all) hoặc 1 parent (mode=any)',
      configSchema: [{
        name: 'mode', type: 'select', label: 'Mode', required: true, default: 'all', options: [
          { label: 'all — đợi tất cả parents (AND join)', value: 'all' },
          { label: 'any — chạy khi 1 parent xong (OR join)', value: 'any' }
        ]
      }],
      outputSchema: [], defaultConfig: { mode: 'all' }
    },

    // ===== NAVIGATION =====
    {
      name: 'nav_to_url', category: 'navigation', kind: 'js',
      icon: 'Globe', description: 'Mở URL trong webview',
      configSchema: [{ name: 'url', type: 'string', label: 'URL', required: true, placeholder: 'https://www.facebook.com' }],
      outputSchema: [{ name: 'currentUrl', type: 'string', label: 'URL sau khi load' }],
      defaultConfig: { url: '' },
      code: `await page.navigate(input.url || vars.url || '')\nreturn { currentUrl: page.getURL() }`
    },
    {
      name: 'nav_back', category: 'navigation', kind: 'js',
      icon: 'ArrowLeft', description: 'Quay lại trang trước',
      configSchema: [], outputSchema: [], defaultConfig: {},
      code: `await page.goBack()\nreturn { currentUrl: page.getURL() }`
    },
    {
      name: 'nav_forward', category: 'navigation', kind: 'js',
      icon: 'ArrowRight', description: 'Tiến tới trang kế',
      configSchema: [], outputSchema: [], defaultConfig: {},
      code: `await page.goForward()\nreturn { currentUrl: page.getURL() }`
    },
    {
      name: 'nav_reload', category: 'navigation', kind: 'js',
      icon: 'RefreshCw', description: 'Reload trang hiện tại',
      configSchema: [], outputSchema: [], defaultConfig: {},
      code: `await page.reload()\nreturn { currentUrl: page.getURL() }`
    },

    // ===== INTERACTION =====
    {
      name: 'click', category: 'interaction', kind: 'js',
      icon: 'MousePointer', description: 'Click element theo CSS hoặc XPath',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector (CSS hoặc XPath)', required: true },
        { name: 'clickCount', type: 'number', label: 'Số lần click', default: 1 }
      ],
      outputSchema: [], defaultConfig: { clickCount: 1 },
      code: `await page.click(input.selector, { clickCount: input.clickCount || 1 })\nreturn {}`
    },
    {
      name: 'type_text', category: 'interaction', kind: 'js',
      icon: 'Type', description: 'Gõ text vào element (insertText, hỗ trợ Lexical)',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector', required: true },
        { name: 'text', type: 'textarea', label: 'Text', required: true, multiline: true },
        { name: 'clearFirst', type: 'boolean', label: 'Xoá nội dung trước', default: false }
      ],
      outputSchema: [], defaultConfig: { clearFirst: false },
      code: `await page.type(input.selector, String(input.text || ''), { clearFirst: !!input.clearFirst })\nreturn {}`
    },
    {
      name: 'fill_value', category: 'interaction', kind: 'js',
      icon: 'Edit2', description: 'Set value (paste-based, mạnh hơn type cho Lexical)',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector', required: true },
        { name: 'value', type: 'textarea', label: 'Value', required: true }
      ],
      outputSchema: [], defaultConfig: {},
      code: `await page.fill(input.selector, String(input.value || ''))\nreturn {}`
    },
    {
      name: 'hover', category: 'interaction', kind: 'js',
      icon: 'Move', description: 'Hover qua element (focusin + pointer events, FB pattern)',
      configSchema: [{ name: 'selector', type: 'string', label: 'Selector', required: true }],
      outputSchema: [], defaultConfig: {},
      code: `await page.hover(input.selector)\nreturn {}`
    },
    {
      name: 'press_key', category: 'interaction', kind: 'js',
      icon: 'CornerDownLeft', description: 'Bấm phím (Enter, Tab, Escape, ...)',
      configSchema: [{ name: 'key', type: 'select', label: 'Phím', required: true, default: 'Enter', options: [
        { label: 'Enter', value: 'Enter' }, { label: 'Tab', value: 'Tab' }, { label: 'Escape', value: 'Escape' },
        { label: 'Backspace', value: 'Backspace' }, { label: 'Space', value: 'Space' },
        { label: 'ArrowUp', value: 'ArrowUp' }, { label: 'ArrowDown', value: 'ArrowDown' },
        { label: 'ArrowLeft', value: 'ArrowLeft' }, { label: 'ArrowRight', value: 'ArrowRight' }
      ]}],
      outputSchema: [], defaultConfig: { key: 'Enter' },
      code: `await page.press(input.key || 'Enter')\nreturn {}`
    },
    {
      name: 'scroll', category: 'interaction', kind: 'js',
      icon: 'ChevronsDown', description: 'Scroll window hoặc element',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector (để trống = window)' },
        { name: 'direction', type: 'select', label: 'Direction', required: true, default: 'down', options: [
          { label: 'down', value: 'down' }, { label: 'up', value: 'up' },
          { label: 'left', value: 'left' }, { label: 'right', value: 'right' }
        ]},
        { name: 'amount', type: 'number', label: 'Amount (px)', default: 500 }
      ],
      outputSchema: [
        { name: 'scrollX', type: 'number', label: 'scrollX' },
        { name: 'scrollY', type: 'number', label: 'scrollY' }
      ],
      defaultConfig: { direction: 'down', amount: 500 },
      code: `return await page.scroll({ selector: input.selector || undefined, direction: input.direction || 'down', amount: Number(input.amount || 500) })`
    },
    {
      name: 'select_option', category: 'interaction', kind: 'js',
      icon: 'List', description: 'Chọn value cho <select> element',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector', required: true },
        { name: 'value', type: 'string', label: 'Value', required: true }
      ],
      outputSchema: [{ name: 'selectedValue', type: 'string', label: 'Value đã chọn' }],
      defaultConfig: {},
      code: `const v = await page.select(input.selector, String(input.value || ''))\nreturn { selectedValue: v }`
    },

    // ===== DATA =====
    {
      name: 'get_text', category: 'data', kind: 'js',
      icon: 'FileText', description: 'Lấy innerText của element',
      configSchema: [{ name: 'selector', type: 'string', label: 'Selector', required: true }],
      outputSchema: [{ name: 'text', type: 'string', label: 'Text content' }],
      defaultConfig: {},
      code: `return { text: await page.getText(input.selector) }`
    },
    {
      name: 'get_value', category: 'data', kind: 'js',
      icon: 'Edit3', description: 'Lấy value của input/textarea',
      configSchema: [{ name: 'selector', type: 'string', label: 'Selector', required: true }],
      outputSchema: [{ name: 'value', type: 'string', label: 'Value' }],
      defaultConfig: {},
      code: `return { value: await page.getValue(input.selector) }`
    },
    {
      name: 'get_attribute', category: 'data', kind: 'js',
      icon: 'Tag', description: 'Lấy attribute của element',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector', required: true },
        { name: 'attribute', type: 'string', label: 'Tên attribute', required: true, placeholder: 'href' }
      ],
      outputSchema: [{ name: 'value', type: 'string', label: 'Attribute value' }],
      defaultConfig: {},
      code: `return { value: await page.getAttribute(input.selector, input.attribute) || '' }`
    },
    {
      name: 'take_screenshot', category: 'data', kind: 'js',
      icon: 'Camera', description: 'Chụp ảnh trang hiện tại (base64)',
      configSchema: [], outputSchema: [{ name: 'imageBase64', type: 'string', label: 'PNG base64' }],
      defaultConfig: {},
      code: `return { imageBase64: await page.screenshot() }`
    },

    // ===== UTILITY =====
    {
      name: 'sleep', category: 'utility', kind: 'js',
      icon: 'Clock', description: 'Pause N ms',
      configSchema: [{ name: 'ms', type: 'number', label: 'ms', required: true, default: 1000 }],
      outputSchema: [], defaultConfig: { ms: 1000 },
      code: `await helpers.sleep(Number(input.ms || 1000), signal)\nreturn {}`
    },
    {
      name: 'wait_for_selector', category: 'utility', kind: 'js',
      icon: 'Search', description: 'Đợi element xuất hiện (visible)',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector', required: true },
        { name: 'timeout', type: 'number', label: 'Timeout (ms)', default: 10000 }
      ],
      outputSchema: [{ name: 'found', type: 'boolean', label: 'Có tìm thấy không' }],
      defaultConfig: { timeout: 10000 },
      code: `try { const found = await page.waitForSelector(input.selector, { timeout: Number(input.timeout || 10000) }); return { found } } catch (e) { return { found: false } }`
    },
    {
      name: 'wait_for_navigation', category: 'utility', kind: 'js',
      icon: 'Loader', description: 'Đợi navigation xong',
      configSchema: [{ name: 'timeout', type: 'number', label: 'Timeout (ms)', default: 30000 }],
      outputSchema: [{ name: 'currentUrl', type: 'string', label: 'URL sau navigation' }],
      defaultConfig: { timeout: 30000 },
      code: `await page.waitForNavigation(Number(input.timeout || 30000))\nreturn { currentUrl: page.getURL() }`
    },
    {
      name: 'api_call', category: 'utility', kind: 'js',
      icon: 'Server', description: 'Gọi HTTP API (fetch trong main process, bypass Chromium)',
      configSchema: [
        { name: 'url', type: 'string', label: 'URL', required: true },
        { name: 'method', type: 'select', label: 'Method', default: 'GET', options: [
          { label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' }, { label: 'PATCH', value: 'PATCH' }, { label: 'DELETE', value: 'DELETE' }
        ]},
        { name: 'headers', type: 'json', label: 'Headers (JSON)' },
        { name: 'body', type: 'textarea', label: 'Body' },
        { name: 'timeout', type: 'number', label: 'Timeout (ms)', default: 30000 }
      ],
      outputSchema: [
        { name: 'status', type: 'number', label: 'HTTP status' },
        { name: 'data', type: 'any', label: 'Response data' },
        { name: 'headers', type: 'json', label: 'Response headers' }
      ],
      defaultConfig: { method: 'GET', timeout: 30000 },
      code: `return await page.apiCall({ url: input.url, method: input.method || 'GET', headers: input.headers, body: input.body, timeout: Number(input.timeout || 30000) })`
    },
    {
      name: 'download_url', category: 'utility', kind: 'js',
      icon: 'Download', description: 'Tải URL về temp file (kèm cookies từ webview)',
      configSchema: [
        { name: 'url', type: 'string', label: 'URL', required: true },
        { name: 'timeout', type: 'number', label: 'Timeout (ms)', default: 30000 }
      ],
      outputSchema: [
        { name: 'filePath', type: 'string', label: 'File path local' },
        { name: 'byteLength', type: 'number', label: 'Kích thước file' }
      ],
      defaultConfig: { timeout: 30000 },
      code: `return await page.downloadUrl(input.url, { timeout: Number(input.timeout || 30000) })`
    },
    {
      name: 'upload_file', category: 'file', kind: 'js',
      icon: 'Upload', description: 'Upload file vào <input type=file> qua CDP',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector của input file', required: true },
        { name: 'filePaths', type: 'json', label: 'File paths (array)', required: true }
      ],
      outputSchema: [{ name: 'fileCount', type: 'number', label: 'Số file đã upload' }],
      defaultConfig: { filePaths: [] },
      code: `const paths = Array.isArray(input.filePaths) ? input.filePaths : (typeof input.filePaths === 'string' ? JSON.parse(input.filePaths) : [])\nreturn await page.uploadFile(input.selector, paths)`
    },
    {
      name: 'drop_file', category: 'file', kind: 'js',
      icon: 'Upload', description: 'Drag-and-drop file vào element (FB composer/messenger)',
      configSchema: [
        { name: 'selector', type: 'string', label: 'Selector của drop target', required: true },
        { name: 'filePaths', type: 'json', label: 'File paths (array)', required: true }
      ],
      outputSchema: [{ name: 'fileCount', type: 'number', label: 'Số file đã drop' }],
      defaultConfig: { filePaths: [] },
      code: `const paths = Array.isArray(input.filePaths) ? input.filePaths : (typeof input.filePaths === 'string' ? JSON.parse(input.filePaths) : [])\nreturn await page.dropFile(input.selector, paths)`
    },

    // ===== FACEBOOK BLOCKS =====
    {
      name: 'fb_resolve_url', category: 'facebook', kind: 'js',
      icon: 'Link2',
      description: 'Verify input là UID hay link, normalize thành URL FB đầy đủ theo type (group/profile/messenger).',
      configSchema: [
        {
          name: 'urlType', type: 'select', label: 'Loại URL', required: true, default: 'group',
          options: [
            { label: 'Group (đăng bài vào nhóm)', value: 'group' },
            { label: 'Profile (trang cá nhân)', value: 'profile' },
            { label: 'Messenger (cuộc trò chuyện)', value: 'messenger' }
          ]
        },
        { name: 'raw', type: 'string', label: 'Input raw (để rỗng = vars.detailUid)', placeholder: 'UID hoặc link FB' }
      ],
      outputSchema: [
        { name: 'uid', type: 'string', label: 'UID đã extract' },
        { name: 'url', type: 'string', label: 'URL FB đầy đủ' }
      ],
      defaultConfig: { urlType: 'group' },
      code: `// Verify input có thể là UID thuần ("164469482423151"), slug ("quangnhut27"),
// hoặc link đầy đủ ("https://www.facebook.com/groups/164...", "fb.com/quangnhut27").
// Trả về { uid, url } đã normalize theo urlType.

const raw = String(input.raw || vars.detailUid || '').trim()
if (!raw) throw new Error('fb_resolve_url: thiếu input (raw + vars.detailUid đều rỗng)')

// Extract UID gốc — ưu tiên profile.php?id, fallback last segment của pathname
let uid = raw
try {
  const u = new URL(/^https?:\\/\\//i.test(raw) ? raw : 'https://' + raw)
  const idParam = u.searchParams.get('id')
  if (idParam) {
    uid = idParam
  } else {
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length > 0) {
      // Loại bỏ prefix 'groups' nếu có (vd /groups/164... → uid = 164...)
      uid = parts[parts.length - 1]
    }
  }
} catch (e) {
  // Không phải URL hợp lệ → giữ nguyên uid = raw
}

const urlType = String(input.urlType || 'group')
let url = ''

if (urlType === 'group') {
  if (/^https?:\\/\\//i.test(raw)) url = raw
  else if (/^(www\\.)?facebook\\.com\\//i.test(raw)) url = 'https://' + raw
  else if (/^groups\\//i.test(raw)) url = 'https://www.facebook.com/' + raw.replace(/^\\/+|\\/+$/g, '')
  else url = 'https://www.facebook.com/groups/' + uid + '/'
} else if (urlType === 'messenger') {
  // Messenger luôn theo bare UID (không hỗ trợ paste link profile vào /messages/t/)
  url = 'https://www.facebook.com/messages/t/' + uid
} else {
  // profile (mặc định)
  if (/^https?:\\/\\//i.test(raw)) url = raw
  else if (/^(www\\.)?facebook\\.com\\//i.test(raw)) url = 'https://' + raw
  else if (/^\\d+$/.test(uid)) url = 'https://www.facebook.com/profile.php?id=' + uid
  else url = 'https://www.facebook.com/' + uid
}

helpers.log('🔗 ' + urlType + ' URL: ' + url + ' (UID: ' + uid + ')')
return { uid: uid, url: url }`
    },
    {
      name: 'fb_open_composer', category: 'facebook', kind: 'js',
      icon: 'Edit', description: 'Click button "Bạn đang nghĩ gì?" + chờ form đăng bài hiện ra',
      configSchema: [], outputSchema: [], defaultConfig: {},
      code: `const btn = await helpers.element('fb_composer_button')
await page.waitForSelector(btn, { timeout: 15000 })
await helpers.sleep(500, signal)
await page.click(btn)
// Chờ form đăng bài (//form[@method='POST']) — giống pattern cũ sleep 5s
await helpers.sleep(5000, signal)
const dialog = await helpers.element('fb_composer_dialog')
await page.waitForSelector(dialog, { timeout: 15000 })
return { opened: true }`
    },
    {
      name: 'fb_type_post_content', category: 'facebook', kind: 'js',
      icon: 'Type', description: 'Gõ nội dung vào khung composer (fallback vars.campaignContent)',
      configSchema: [{ name: 'content', type: 'textarea', label: 'Nội dung (để rỗng để dùng vars.campaignContent)' }],
      outputSchema: [], defaultConfig: {},
      code: `const text = String(input.content || vars.campaignContent || '')
const dialog = await helpers.element('fb_composer_dialog')
await page.waitForSelector(dialog, { timeout: 10000 })
await helpers.sleep(800, signal)
await page.fill(dialog, text)
return { typed: true, content: text }`
    },
    {
      name: 'fb_drop_post_images', category: 'facebook', kind: 'js',
      icon: 'Image', description: 'Drop ảnh vào composer (fallback vars.images)',
      configSchema: [{ name: 'images', type: 'json', label: 'Images (array path) — để rỗng để dùng vars.images', default: [] }],
      outputSchema: [{ name: 'fileCount', type: 'number', label: 'Số ảnh đã drop' }],
      defaultConfig: { images: [] },
      code: `const imgs = Array.isArray(input.images) && input.images.length > 0
  ? input.images
  : (Array.isArray(vars.images) ? vars.images : [])
if (imgs.length === 0) return { fileCount: 0 }
const dialog = await helpers.element('fb_composer_dialog_root')
const result = await page.dropFile(dialog, imgs)
await helpers.sleep(2000, signal)
return result`
    },
    {
      name: 'fb_click_post_button', category: 'facebook', kind: 'js',
      icon: 'Send', description: 'Click nút Đăng + chờ trang xử lý',
      configSchema: [], outputSchema: [{ name: 'posted', type: 'boolean', label: 'Đã click' }],
      defaultConfig: {},
      code: `const btn = await helpers.element('fb_post_button')
await page.waitForSelector(btn, { timeout: 10000 })
await page.click(btn)
await helpers.sleep(3000, signal)
return { posted: true }`
    },
    {
      name: 'fb_detect_pending_post', category: 'facebook', kind: 'js',
      icon: 'AlertCircle', description: 'Phát hiện bài đăng đang chờ duyệt (banner text)',
      configSchema: [], outputSchema: [{ name: 'isPending', type: 'boolean', label: 'Bài có đang chờ duyệt không' }],
      defaultConfig: {},
      code: `const banner = await helpers.element('fb_pending_banner')
try {
  const found = await page.waitForSelector(banner, { timeout: 3000 })
  return { isPending: !!found }
} catch (e) {
  return { isPending: false }
}`
    },
    {
      name: 'fb_leave_group_if_pending', category: 'facebook', kind: 'js',
      icon: 'LogOut', description: 'Rời nhóm nếu bài đang chờ duyệt (qua menu)',
      configSchema: [{ name: 'enabled', type: 'boolean', label: 'Enable', default: false }],
      outputSchema: [{ name: 'left', type: 'boolean', label: 'Đã rời nhóm chưa' }],
      defaultConfig: { enabled: false },
      code: `if (!input.enabled) return { left: false }
try {
  const menuBtn = await helpers.element('fb_group_menu_button')
  await page.click(menuBtn)
  await helpers.sleep(800, signal)
  const leaveItem = await helpers.element('fb_group_leave_menuitem')
  await page.click(leaveItem)
  await helpers.sleep(800, signal)
  const confirm = await helpers.element('fb_group_leave_confirm')
  await page.click(confirm)
  await helpers.sleep(2000, signal)
  helpers.log('👋 Đã rời nhóm')
  return { left: true }
} catch (e) {
  helpers.log('Không rời được nhóm: ' + e.message)
  return { left: false }
}`
    },
    {
      name: 'fb_join_group_if_not_member', category: 'facebook', kind: 'js',
      icon: 'UserPlus', description: 'Tự tham gia nhóm sau khi đăng bài',
      configSchema: [{ name: 'enabled', type: 'boolean', label: 'Enable', default: false }],
      outputSchema: [{ name: 'joined', type: 'boolean', label: 'Đã click tham gia chưa' }],
      defaultConfig: { enabled: false },
      code: `if (!input.enabled) return { joined: false }
try {
  const btn = await helpers.element('fb_group_join_button')
  const found = await page.waitForSelector(btn, { timeout: 2000 })
  if (!found) return { joined: false }
  await page.click(btn)
  await helpers.sleep(1500, signal)
  helpers.log('🤝 Đã nhấn Tham gia nhóm')
  return { joined: true }
} catch (e) {
  return { joined: false }
}`
    },
    {
      name: 'fb_comment_at_position', category: 'facebook', kind: 'js',
      icon: 'MessageCircle', description: 'Comment vào bài thứ N (fallback vars.loopItem khi chạy trong loop forEach commentIterations)',
      configSchema: [
        { name: 'position', type: 'number', label: 'Vị trí (1-based, để rỗng = lấy từ loopItem)' },
        { name: 'text', type: 'textarea', label: 'Nội dung comment (để rỗng = lấy từ loopItem)' }
      ],
      outputSchema: [
        { name: 'commented', type: 'boolean', label: 'Đã comment chưa' },
        { name: 'position', type: 'number', label: 'Vị trí đã comment' },
        { name: 'text', type: 'string', label: 'Nội dung đã comment' }
      ],
      defaultConfig: {},
      code: `const item = (vars && vars.loopItem) ? vars.loopItem : {}
const pos = Number(input.position || item.position || 1)
const text = String(input.text || item.text || '')
if (!text) return { commented: false, position: pos, text: '' }

// FB comment box dùng Lexical → page.type (insertText) hoạt động, page.fill (paste) thì không.
// Pattern giống block "Comment vào bài viết" cũ: click → sleep 2s → type clearFirst → sleep 1s → Enter
const boxXpath = await helpers.elementWith('fb_comment_box_at_n', { n: pos })
await page.waitForSelector(boxXpath, { timeout: 8000 })
await page.click(boxXpath)
await helpers.sleep(2000, signal)
await page.type(boxXpath, text, { clearFirst: true })
await helpers.sleep(1000, signal)
await page.press('Enter')
await helpers.sleep(3000, signal)
helpers.log('💬 Đã comment vào bài #' + pos + ': ' + text.substring(0, 50))
return { commented: true, position: pos, text: text }`
    },
    {
      name: 'fb_scrape_post', category: 'facebook', kind: 'js',
      icon: 'Copy', description: 'Scrape nội dung bài viết (refactored từ webviewController.fbScrapePost). Tự click "Xem thêm" để expand.',
      configSchema: [
        { name: 'sourceLink', type: 'string', label: 'Source URL (để rỗng = vars.sourceLink)' },
        { name: 'includeImages', type: 'boolean', label: 'Lấy kèm hình ảnh', default: false },
        { name: 'appendContent', type: 'textarea', label: 'Nội dung append vào sau (để rỗng = vars.campaignContent)' }
      ],
      outputSchema: [
        { name: 'scrapedText', type: 'string', label: 'Nội dung đã scrape (đã append nếu có)' },
        { name: 'scrapedImages', type: 'json', label: 'Đường dẫn ảnh đã tải (data URIs hoặc temp paths)' }
      ],
      defaultConfig: { includeImages: false },
      code: `const link = String(input.sourceLink || vars.sourceLink || '').trim()
const appendContent = String(input.appendContent || vars.campaignContent || '')
if (!link) return { scrapedText: appendContent, scrapedImages: [] }

// Build URL từ link (UID/slug/full URL)
const url = /^https?:\\/\\//i.test(link) ? link
  : (/^\\d+$/.test(link) ? 'https://www.facebook.com/profile.php?id=' + link
    : 'https://www.facebook.com/' + link)

await page.navigate(url)
await helpers.sleep(4000, signal)
try { await page.waitForSelector(await helpers.element('fb_main_role'), { timeout: 10000 }) } catch {}
await helpers.sleep(1500, signal)

// Lazy-render bài
await page.scroll({ direction: 'down', amount: 2000 }).catch(() => {})
await helpers.sleep(3000, signal)

// Đợi container bài đăng (union 4 patterns)
const containerSel = await helpers.element('fb_post_container')
const containerFound = await page.waitForSelector(containerSel, { timeout: 5000 }).catch(() => false)
if (!containerFound) {
  helpers.log('⚠️ Không tìm thấy container bài đăng nguồn — fallback về appendContent')
  vars.campaignContent = appendContent
  return { scrapedText: appendContent, scrapedImages: [] }
}

// Click "Xem thêm" tối đa 2 vòng để expand nội dung dài
const seeMoreInner = await helpers.element('fb_see_more_inner')
const seeMoreSel = containerSel.split('|').map(c => c.trim() + seeMoreInner).join(' | ')
for (let i = 0; i < 2; i++) {
  const probe = await page.waitForSelector(seeMoreSel, { timeout: 1500 }).catch(() => false)
  if (!probe) break
  await page.click(seeMoreSel).catch(() => {})
  await helpers.sleep(1000, signal)
}

// Lấy nội dung — walk lên dir='auto' wrapper từ marker.
// Dùng 3 method extract (innerText / innerHTML parse / walkDOM) — pick best
// để (a) handle emoji FB render bằng <img alt="😀">, (b) giữ ngắt dòng đúng.
const contentInner = await helpers.element('fb_post_content_inner')
const contentSel = containerSel.split('|').map(c => c.trim() + contentInner).join(' | ')

// Build evalCode bằng string concat (tránh template literal lồng nhau gây escape lỗi)
const evalCode =
  'var sel = ' + JSON.stringify(contentSel) + ';' +
  'var marker = null;' +
  'try { var r = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null); marker = r.singleNodeValue; } catch(e) {}' +
  'if (!marker) return "";' +
  // Walk lên dir='auto' wrapper
  'var wrapper = marker, depth = 0;' +
  'while (wrapper && wrapper.parentElement && depth < 20) {' +
  '  if (wrapper.tagName === "DIV" && wrapper.getAttribute && wrapper.getAttribute("dir") === "auto") break;' +
  '  wrapper = wrapper.parentElement; depth++;' +
  '}' +
  'if (!wrapper || wrapper === document.body) wrapper = marker;' +
  // Method A: innerText (CSS-based, không có emoji <img>)
  'var aText = (typeof wrapper.innerText === "string" ? wrapper.innerText : (wrapper.textContent || "")).trim();' +
  // Method B: innerHTML parse — replace <img alt="..."> thành alt text (= emoji), <br> → \\n, block close → \\n
  'var html = wrapper.innerHTML || "";' +
  'html = html.replace(/<img[^>]*\\\\balt="([^"]*)"[^>]*>/gi, "$1");' +
  'html = html.replace(/<img[^>]*\\\\balt=' + "'" + '([^' + "'" + ']*)' + "'" + '[^>]*>/gi, "$1");' +
  'html = html.replace(/<br\\\\s*\\\\/?\\\\s*>/gi, "\\\\n");' +
  'html = html.replace(/<\\\\/(div|p|h[1-6]|li|blockquote)\\\\s*>/gi, "\\\\n");' +
  'var tmp = document.createElement("div");' +
  'tmp.innerHTML = html;' +
  'var bText = (tmp.textContent || "").replace(/\\\\n{3,}/g, "\\\\n\\\\n").trim();' +
  // Method C: walk DOM tree — handle emoji <img alt> + block element newlines
  'var BLOCK = {DIV:1,P:1,H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,LI:1,UL:1,OL:1,BLOCKQUOTE:1,ARTICLE:1,SECTION:1};' +
  'var out = [];' +
  'function walk(node) {' +
  '  if (node.nodeType === 3) { out.push(node.nodeValue || ""); return; }' +
  '  if (node.nodeType !== 1) return;' +
  '  if (node.tagName === "BR") { out.push("\\\\n"); return; }' +
  '  if (node.tagName === "SCRIPT" || node.tagName === "STYLE") return;' +
  '  if (node.tagName === "IMG") {' +
  '    var alt = (node.getAttribute && node.getAttribute("alt")) || "";' +
  '    if (alt) out.push(alt);' +
  '    return;' +
  '  }' +
  '  var isBlock = BLOCK[node.tagName] === 1;' +
  '  if (!isBlock) {' +
  '    try { var disp = window.getComputedStyle(node).display; isBlock = (disp === "block" || disp === "flex" || disp === "grid" || disp === "list-item"); } catch(e) {}' +
  '  }' +
  '  if (isBlock && out.length && out[out.length-1].slice(-1) !== "\\\\n") out.push("\\\\n");' +
  '  for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);' +
  '  if (isBlock && out.length && out[out.length-1].slice(-1) !== "\\\\n") out.push("\\\\n");' +
  '}' +
  'walk(wrapper);' +
  'var cText = out.join("").replace(/\\\\n{3,}/g, "\\\\n\\\\n").trim();' +
  // Pick best: ưu tiên candidate có \\n (multi-line), trong đó chọn cái dài nhất
  'var candidates = [{name:"innerText",text:aText},{name:"innerHTML",text:bText},{name:"walkDOM",text:cText}];' +
  'var withBreaks = candidates.filter(function(c){ return c.text.indexOf("\\\\n") !== -1; });' +
  'var pool = withBreaks.length > 0 ? withBreaks : candidates;' +
  'var best = pool[0];' +
  'for (var i = 1; i < pool.length; i++) { if (pool[i].text.length > best.text.length) best = pool[i]; }' +
  'return best.text;'

let scrapedText = ''
try {
  scrapedText = await page.evaluate(evalCode)
} catch (e) {
  helpers.log('Lỗi scrape nội dung: ' + e.message)
}

if (!scrapedText) {
  helpers.log('⚠️ Marker tìm thấy nhưng extract rỗng → fallback về appendContent')
}

// Build finalText: ưu tiên scrapedText, append appendContent vào sau (newline cách)
const finalText = scrapedText
  ? (appendContent ? scrapedText + '\\n\\n' + appendContent : scrapedText)
  : appendContent

// Mutate vars.campaignContent — output của block không cascade xa qua chain,
// nhưng vars là shared reference → mọi block downstream sẽ đọc được giá trị mới.
vars.campaignContent = finalText

// === SCRAPE IMAGES — fallback vars.includeSourceImages (scheduler set tên này) ===
let scrapedImages = []
const shouldIncludeImages = input.includeImages === true || vars.includeSourceImages === true
if (shouldIncludeImages) {
  // XPath ảnh: từ wrapper dir=auto chứa marker, lấy following-sibling/div//img
  const imgInner = '//*[@dir="auto" and .//*[@data-ad-comet-preview="message" or @data-ad-rendering-role="story_message" or @data-ad-preview="message" or @class="xh8yej3" or @id]]/following-sibling::*[1]/div[1]//img'
  const imgSel = containerSel.split('|').map(c => c.trim() + imgInner).join(' | ')
  const imgEvalCode =
    'var sel = ' + JSON.stringify(imgSel) + ';' +
    'var r = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);' +
    'var srcs = [];' +
    'for (var i = 0; i < r.snapshotLength && i < 10; i++) {' +
    '  var el = r.snapshotItem(i);' +
    '  var src = el.src || el.getAttribute("src");' +
    '  if (src && src.indexOf("data:") !== 0) srcs.push(src);' +
    '}' +
    'return srcs;'

  let imgSrcs = []
  try { imgSrcs = await page.evaluate(imgEvalCode) || [] } catch (e) {}
  helpers.log('📷 Tìm thấy ' + imgSrcs.length + ' URL ảnh, đang tải về...')

  for (const src of imgSrcs) {
    if (signal.aborted) break
    try {
      const dl = await page.downloadUrl(src, { timeout: 30000 })
      if (dl && dl.filePath) {
        scrapedImages.push(dl.filePath)
      }
    } catch (e) {
      helpers.log('⚠️ Lỗi tải ảnh: ' + (e.message || e))
    }
  }
  helpers.log('📷 Đã tải ' + scrapedImages.length + '/' + imgSrcs.length + ' ảnh về local')

  // Mutate vars.images: merge ảnh user upload + ảnh scraped (theo thứ tự user trước)
  if (scrapedImages.length > 0) {
    const userImages = Array.isArray(vars.images) ? vars.images : []
    vars.images = userImages.concat(scrapedImages)
  }
}

helpers.log('📋 Scrape: ' + scrapedText.length + ' ký tự + ' + scrapedImages.length + ' ảnh từ ' + link)
return { scrapedText: finalText, scrapedImages: scrapedImages }`
    },
    {
      name: 'fb_share_post', category: 'facebook', kind: 'js',
      icon: 'Share2', description: 'Đăng bài bằng cách chia sẻ từ source link (refactored từ webviewController.fbSharePost)',
      configSchema: [
        { name: 'sourceLink', type: 'string', label: 'Source URL (để rỗng = vars.sourceLink)' },
        { name: 'content', type: 'textarea', label: 'Nội dung kèm theo (để rỗng = vars.campaignContent)' }
      ],
      outputSchema: [
        { name: 'shared', type: 'boolean', label: 'Đã chia sẻ thành công' },
        { name: 'sourceLink', type: 'string', label: 'Source link đã share' }
      ],
      defaultConfig: {},
      code: `const link = String(input.sourceLink || vars.sourceLink || '').trim()
if (!link) throw new Error('sourceLink rỗng')
const content = String(input.content || vars.campaignContent || '')

// Build URL từ link (UID/slug/full URL)
const url = /^https?:\\/\\//i.test(link) ? link
  : (/^\\d+$/.test(link) ? 'https://www.facebook.com/profile.php?id=' + link
    : 'https://www.facebook.com/' + link)

await page.navigate(url)
await helpers.sleep(4000, signal)

// Scroll xuống để FB lazy-render bài (tránh waitForSelector container fail oan)
await page.scroll({ direction: 'down', amount: 2000 })
await helpers.sleep(1500, signal)

// Đợi container bài đăng (union 4 patterns: page/profile/dialog/group)
const containerSel = await helpers.element('fb_post_container')
const found = await page.waitForSelector(containerSel, { timeout: 10000 }).catch(() => false)
if (!found) throw new Error('Không tìm thấy container bài đăng nguồn')
await helpers.sleep(1500, signal)

// Build share button selector: append descendant pattern sau mỗi container path
const shareInner = await helpers.element('fb_share_button_inner')
const shareBtnSel = containerSel.split('|').map(c => c.trim() + shareInner).join(' | ')
await page.click(shareBtnSel)
await helpers.sleep(2500, signal)

// Click "Chia sẻ ngay" trong menu pop-up
const shareNowSel = await helpers.element('fb_share_now_menuitem')
await page.click(shareNowSel)
await helpers.sleep(3500, signal)

// Composer dialog mở — thêm content + click Đăng
const composer = await helpers.element('fb_composer_dialog')
const composerFound = await page.waitForSelector(composer, { timeout: 5000 }).catch(() => false)
if (composerFound && content) {
  await page.click(composer).catch(() => {})
  await helpers.sleep(500, signal)
  await page.fill(composer, content).catch(() => {})
  await helpers.sleep(1500, signal)
}
const postBtn = await helpers.element('fb_post_button')
await page.click(postBtn)
await helpers.sleep(5000, signal)

helpers.log('🔀 Đã chia sẻ từ ' + link)
return { shared: true, sourceLink: link }`
    },
    {
      name: 'fb_post_reels', category: 'facebook', kind: 'js',
      icon: 'Video', description: 'Đăng video dạng Reels (refactored từ webviewController.fbPostReels)',
      configSchema: [
        { name: 'videoPath', type: 'string', label: 'Path video (để rỗng = vars.videoPath)' },
        { name: 'content', type: 'textarea', label: 'Caption (để rỗng = vars.campaignContent)' }
      ],
      outputSchema: [
        { name: 'posted', type: 'boolean', label: 'Đã đăng Reels' }
      ],
      defaultConfig: {},
      code: `const videoPath = String(input.videoPath || vars.videoPath || '').trim()
if (!videoPath) throw new Error('videoPath rỗng (cần ít nhất 1 video trong vars.images)')
const content = String(input.content || vars.campaignContent || '')

// Mở trang tạo Reels
await page.navigate('https://www.facebook.com/reels/create')
await helpers.sleep(5000, signal)

// Upload video
const uploadInput = await helpers.element('fb_reels_upload_input')
const uploaded = await page.uploadFile(uploadInput, [videoPath])
if (!uploaded || uploaded.fileCount === 0) throw new Error('Không upload được video cho Reels')
await helpers.sleep(6000, signal)

// Click Tiếp/Next 2 lần (Reels có 2-3 bước trước khi đến caption)
const nextSel = await helpers.element('fb_reels_next_button')
await page.click(nextSel).catch(() => {})
await helpers.sleep(3000, signal)
await page.click(nextSel).catch(() => {})
await helpers.sleep(3000, signal)

// Nhập caption
if (content) {
  const descSel = await helpers.element('fb_reels_description')
  await page.click(descSel).catch(() => {})
  await helpers.sleep(500, signal)
  await page.fill(descSel, content).catch(() => {})
  await helpers.sleep(1500, signal)
}

// Click Đăng
const publishSel = await helpers.element('fb_reels_publish_button')
await page.click(publishSel)
await helpers.sleep(6000, signal)

helpers.log('🎬 Đã đăng Reels: ' + videoPath)
return { posted: true }`
    },
    {
      name: 'fb_send_message', category: 'facebook', kind: 'js',
      icon: 'MessageSquare', description: 'Gửi tin nhắn qua Messenger',
      configSchema: [
        { name: 'text', type: 'textarea', label: 'Nội dung', required: true },
        { name: 'images', type: 'json', label: 'Ảnh kèm (array path)', default: [] }
      ],
      outputSchema: [
        { name: 'ok', type: 'boolean', label: 'Gửi thành công không' },
        { name: 'error', type: 'string', label: 'Lỗi (nếu có)' }
      ],
      defaultConfig: { images: [] },
      code: `try {
  const text = String(input.text || vars.campaignContent || '').trim()
  const imgs = Array.isArray(input.images) && input.images.length > 0
    ? input.images
    : (Array.isArray(vars.images) ? vars.images : [])

  // Đóng dialog "Khôi phục đoạn chat" nếu hiện
  try {
    const closeBtn = '[aria-label="Đóng"], [aria-label="Close"]'
    const found = await page.waitForSelector(closeBtn, { timeout: 3000 })
    if (found) {
      await page.click(closeBtn)
      await helpers.sleep(2000, signal)
      const confirm = '(//*[@role="button" and @aria-label="Không khôi phục tin nhắn" and @tabindex="0"])[position()=2]'
      const c = await page.waitForSelector(confirm, { timeout: 3000 }).catch(() => false)
      if (c) {
        await page.click(confirm)
        await helpers.sleep(2000, signal)
      }
    }
  } catch (e) { /* không có dialog → bỏ qua */ }

  // Đóng dialog E2EE "Tiếp tục" nếu hiện
  try {
    const cont = '//*[@role="button" and .="Tiếp tục"]'
    const found = await page.waitForSelector(cont, { timeout: 2000 })
    if (found) {
      await page.click(cont)
      await helpers.sleep(2000, signal)
    }
  } catch (e) { /* không có → bỏ qua */ }

  const box = await helpers.element('fb_messenger_textbox')
  await page.waitForSelector(box, { timeout: 15000 })
  await helpers.sleep(1000, signal)
  await page.click(box)
  await helpers.sleep(500, signal)

  if (text) {
    await page.fill(box, text)
    await helpers.sleep(1000, signal)
  }
  if (imgs.length > 0) {
    await page.dropFile(box, imgs)
    await helpers.sleep(Math.max(3000, imgs.length * 1500), signal)
  }
  if (text || imgs.length > 0) {
    await page.press('Enter')
    await helpers.sleep(2000, signal)
  }
  return { ok: true }
} catch (e) {
  return { ok: false, error: e.message }
}`
    },
    {
      name: 'fb_add_friend', category: 'facebook', kind: 'js',
      icon: 'UserPlus',
      description: 'Click nút Thêm bạn bè. Nếu không có nút → coi là đã là bạn / FB ẩn nút (KHÔNG lỗi).',
      configSchema: [], outputSchema: [
        { name: 'ok', type: 'boolean', label: 'Có lỗi nghiêm trọng không (false=lỗi, true=OK hoặc skipped)' },
        { name: 'clicked', type: 'boolean', label: 'Đã click nút kết bạn chưa' },
        { name: 'alreadyFriend', type: 'boolean', label: 'Skip do đã là bạn / nút bị ẩn' },
        { name: 'error', type: 'string', label: 'Lỗi (nếu có)' }
      ],
      defaultConfig: {},
      code: `try {
  const btn = await helpers.element('fb_add_friend_button')
  // waitForSelector throws khi timeout → catch ở dưới chỉ catch lỗi engine, không phải timeout
  const found = await page.waitForSelector(btn, { timeout: 5000 }).catch(() => false)
  if (!found) {
    // Không có nút "Thêm bạn bè" — tình huống bình thường:
    //   - Đã là bạn (FB hiện "Bạn bè" thay vì "Thêm bạn bè")
    //   - Đã gửi lời mời, đang chờ phản hồi (FB hiện "Đã gửi yêu cầu")
    //   - Profile khoá / FB ẩn nút (privacy settings)
    // → KHÔNG coi là lỗi, return ok: true với cờ alreadyFriend
    helpers.log('ℹ️ Không có nút Thêm bạn bè — bỏ qua (có thể đã là bạn hoặc nút bị ẩn)')
    return { ok: true, clicked: false, alreadyFriend: true }
  }
  await page.click(btn)
  await helpers.sleep(2000, signal)
  return { ok: true, clicked: true, alreadyFriend: false }
} catch (e) {
  return { ok: false, clicked: false, alreadyFriend: false, error: e.message }
}`
    }
  ]

  const ids = new Map<string, number>()
  for (const b of blocks) {
    try {
      const saved = await blockRepo.saveBlockSystem(b)
      ids.set(saved.name, saved.id)
    } catch (err) {
      console.error(`[seedV2] Failed to seed block ${b.name}:`, err)
    }
  }
  return ids
}

// ============================================================
// 3. WORKFLOWS
// ============================================================
async function seedWorkflows(blockIds: Map<string, number>): Promise<{ groupPostId?: number; timelinePostId?: number; messageFriendId?: number }> {
  const groupPostId = await seedGroupPostWorkflow(blockIds)
  const timelinePostId = await seedTimelinePostWorkflow(blockIds)
  const messageFriendId = await seedMessageFriendWorkflow(blockIds)
  return { groupPostId, timelinePostId, messageFriendId }
}

function blockRef(blockIds: Map<string, number>, name: string): { blockId: number; blockName: string } {
  const id = blockIds.get(name)
  if (!id) throw new Error(`Block không tìm thấy trong seed: ${name}`)
  return { blockId: id, blockName: name }
}

async function seedGroupPostWorkflow(blockIds: Map<string, number>): Promise<number> {
  const ref = (n: string) => blockRef(blockIds, n)
  const nodes: WorkflowNode[] = [
    {
      id: 'resolve_url', position: { x: 100, y: -100 }, ...ref('fb_resolve_url'),
      config: { urlType: 'group' },
      label: 'Resolve link/UID → URL group'
    },
    {
      id: 'nav', position: { x: 100, y: 0 }, ...ref('nav_to_url'),
      config: {},
      label: 'Mở group'
      // input.url được merge từ output của resolve_url ({uid, url})
    },
    { id: 'wait_main', position: { x: 100, y: 100 }, ...ref('wait_for_selector'), config: { selector: "//*[@role='main']", timeout: 10000 }, label: 'Chờ trang group' },
    { id: 'open_composer', position: { x: 100, y: 200 }, ...ref('fb_open_composer'), config: {} },
    { id: 'sleep1', position: { x: 100, y: 300 }, ...ref('sleep'), config: { ms: 2000 } },
    { id: 'type_content', position: { x: 100, y: 400 }, ...ref('fb_type_post_content'), config: {} },
    { id: 'drop_images', position: { x: 100, y: 500 }, ...ref('fb_drop_post_images'), config: {} },
    { id: 'sleep2', position: { x: 100, y: 600 }, ...ref('sleep'), config: { ms: 5000 } },
    { id: 'click_post', position: { x: 100, y: 700 }, ...ref('fb_click_post_button'), config: {} },
    { id: 'sleep3', position: { x: 100, y: 800 }, ...ref('sleep'), config: { ms: 3000 } },
    { id: 'detect_pending', position: { x: 100, y: 900 }, ...ref('fb_detect_pending_post'), config: {} },
    // Comment branch
    { id: 'if_comment', position: { x: 100, y: 1000 }, ...ref('if_else'), systemType: 'ifElse', config: { condition: 'vars.enableComment === true && Array.isArray(vars.commentIterations) && vars.commentIterations.length > 0' } },
    { id: 'loop_comment', position: { x: 0, y: 1100 }, ...ref('loop'), systemType: 'loop', config: { loopType: 'forEach', itemsExpr: 'vars.commentIterations' } },
    { id: 'comment', position: { x: 0, y: 1200 }, ...ref('fb_comment_at_position'), config: {}, label: 'Comment iteration', },
    { id: 'merge_comment', position: { x: 100, y: 1300 }, ...ref('merge'), systemType: 'merge', config: { mode: 'any' } },
    // Leave group branch
    { id: 'if_leave', position: { x: 100, y: 1400 }, ...ref('if_else'), systemType: 'ifElse', config: { condition: 'vars.leaveGroupOnPendingApproval === true && input.isPending === true' } },
    { id: 'leave_group', position: { x: 0, y: 1500 }, ...ref('fb_leave_group_if_pending'), config: { enabled: true } },
    { id: 'merge_leave', position: { x: 100, y: 1600 }, ...ref('merge'), systemType: 'merge', config: { mode: 'any' } },
    // Join group branch
    { id: 'if_join', position: { x: 100, y: 1700 }, ...ref('if_else'), systemType: 'ifElse', config: { condition: 'vars.autoJoinGroupAfterPost === true && input.isPending !== true' } },
    { id: 'join_group', position: { x: 0, y: 1800 }, ...ref('fb_join_group_if_not_member'), config: { enabled: true } },
    { id: 'merge_join', position: { x: 100, y: 1900 }, ...ref('merge'), systemType: 'merge', config: { mode: 'any' } }
  ]

  const edges: WorkflowEdge[] = [
    e('resolve_url', 'nav'),
    e('nav', 'wait_main'), e('wait_main', 'open_composer'),
    e('open_composer', 'sleep1'), e('sleep1', 'type_content'),
    e('type_content', 'drop_images'), e('drop_images', 'sleep2'),
    e('sleep2', 'click_post'), e('click_post', 'sleep3'),
    e('sleep3', 'detect_pending'),
    e('detect_pending', 'if_comment'),
    // Comment branch
    e('if_comment', 'loop_comment', 'true'),
    e('if_comment', 'merge_comment', 'false'),
    e('loop_comment', 'comment', 'body'),
    e('loop_comment', 'merge_comment', 'done'),
    // Leave branch
    e('merge_comment', 'if_leave'),
    e('if_leave', 'leave_group', 'true'),
    e('if_leave', 'merge_leave', 'false'),
    e('leave_group', 'merge_leave'),
    // Join branch
    e('merge_leave', 'if_join'),
    e('if_join', 'join_group', 'true'),
    e('if_join', 'merge_join', 'false'),
    e('join_group', 'merge_join')
  ]

  const wf = await workflowV2Repo.saveWorkflowSystem({
    name: 'facebook_group_post',
    description: 'Workflow đăng bài vào group (có thể kèm comment, rời nhóm khi pending, tham gia nhóm sau khi đăng)',
    nodes, edges,
    variablesSchema: [
      { name: 'detailUid', type: 'string', label: 'URL group', description: 'URL hoặc UID group đã normalize bởi scheduler' },
      { name: 'campaignContent', type: 'string', label: 'Nội dung bài đăng' },
      { name: 'images', type: 'array', label: 'Ảnh kèm theo (paths)' },
      { name: 'enableComment', type: 'boolean', label: 'Bật comment sau khi đăng' },
      { name: 'commentIterations', type: 'array', label: 'Danh sách comment (mỗi item {position, text})' },
      { name: 'leaveGroupOnPendingApproval', type: 'boolean', label: 'Rời nhóm nếu bài chờ duyệt' },
      { name: 'autoJoinGroupAfterPost', type: 'boolean', label: 'Tự tham gia nhóm sau khi đăng' }
    ],
    defaultVariables: {
      detailUid: '', campaignContent: '', images: [],
      enableComment: false, commentIterations: [],
      leaveGroupOnPendingApproval: false, autoJoinGroupAfterPost: false
    }
  })
  return wf.id
}

async function seedTimelinePostWorkflow(blockIds: Map<string, number>): Promise<number> {
  const ref = (n: string) => blockRef(blockIds, n)
  const nodes: WorkflowNode[] = [
    { id: 'nav', position: { x: 100, y: 0 }, ...ref('nav_to_url'), config: { url: 'https://www.facebook.com' } },
    { id: 'wait_main', position: { x: 100, y: 100 }, ...ref('wait_for_selector'), config: { selector: "//*[@role='main']", timeout: 10000 } },
    // Branch 1: postAsReels
    { id: 'if_reels', position: { x: 100, y: 200 }, ...ref('if_else'), systemType: 'ifElse', config: { condition: 'vars.postAsReels === true' } },
    { id: 'post_reels', position: { x: 0, y: 300 }, ...ref('fb_post_reels'), config: {} },
    // Branch 2: sharePost
    { id: 'if_share', position: { x: 200, y: 300 }, ...ref('if_else'), systemType: 'ifElse', config: { condition: 'vars.sharePost === true && !!vars.sourceLink' } },
    { id: 'share_post', position: { x: 100, y: 400 }, ...ref('fb_share_post'), config: {} },
    // Branch 3: copyContentFromSource
    { id: 'if_copy', position: { x: 300, y: 400 }, ...ref('if_else'), systemType: 'ifElse', config: { condition: 'vars.copyContentFromSource === true && !!vars.sourceLink' } },
    { id: 'scrape', position: { x: 200, y: 500 }, ...ref('fb_scrape_post'), config: {} },
    // Sau khi scrape ở trang nguồn, phải quay về fb.com để đăng bài lên trang cá nhân
    { id: 'nav_home_after_scrape', position: { x: 200, y: 580 }, ...ref('nav_to_url'), config: { url: 'https://www.facebook.com' }, label: 'Quay về trang chủ FB' },
    { id: 'wait_main_after_scrape', position: { x: 200, y: 660 }, ...ref('wait_for_selector'), config: { selector: "//*[@role='main']", timeout: 10000 } },
    // Merge: scrape branch + default branch hội tụ tại đây trước khi vào composer
    // (mode='any' để chạy ngay khi 1 trong 2 parent xong; AND join mặc định sẽ skip
    // open_composer vì 1 parent luôn skipped)
    { id: 'merge_compose', position: { x: 300, y: 740 }, ...ref('merge'), systemType: 'merge', config: { mode: 'any' } },
    // Default branch (compose post)
    { id: 'open_composer', position: { x: 300, y: 820 }, ...ref('fb_open_composer'), config: {} },
    { id: 'sleep_after_open', position: { x: 300, y: 900 }, ...ref('sleep'), config: { ms: 2000 } },
    { id: 'type_content', position: { x: 300, y: 980 }, ...ref('fb_type_post_content'), config: {} },
    { id: 'drop_images', position: { x: 300, y: 1060 }, ...ref('fb_drop_post_images'), config: {} },
    { id: 'sleep_after_drop', position: { x: 300, y: 1140 }, ...ref('sleep'), config: { ms: 5000 } },
    { id: 'click_post', position: { x: 300, y: 1220 }, ...ref('fb_click_post_button'), config: {} },
    // Merge tất cả 3 path (reels / share / compose)
    { id: 'merge_all', position: { x: 200, y: 1340 }, ...ref('merge'), systemType: 'merge', config: { mode: 'any' } }
  ]

  const edges: WorkflowEdge[] = [
    e('nav', 'wait_main'),
    e('wait_main', 'if_reels'),
    // Reels branch
    e('if_reels', 'post_reels', 'true'),
    e('if_reels', 'if_share', 'false'),
    // Share branch
    e('if_share', 'share_post', 'true'),
    e('if_share', 'if_copy', 'false'),
    // Copy branch: scrape → quay về fb.com → wait main → merge
    e('if_copy', 'scrape', 'true'),
    e('if_copy', 'merge_compose', 'false'),
    e('scrape', 'nav_home_after_scrape'),
    e('nav_home_after_scrape', 'wait_main_after_scrape'),
    e('wait_main_after_scrape', 'merge_compose'),
    // Compose chain
    e('merge_compose', 'open_composer'),
    e('open_composer', 'sleep_after_open'),
    e('sleep_after_open', 'type_content'),
    e('type_content', 'drop_images'),
    e('drop_images', 'sleep_after_drop'),
    e('sleep_after_drop', 'click_post'),
    // All 3 path converge
    e('post_reels', 'merge_all'),
    e('share_post', 'merge_all'),
    e('click_post', 'merge_all')
  ]

  const wf = await workflowV2Repo.saveWorkflowSystem({
    name: 'facebook_timeline_post',
    description: 'Workflow đăng bài lên trang cá nhân (gộp các biến thể: default / share / reels / copy-source qua ifElse)',
    nodes, edges,
    variablesSchema: [
      { name: 'campaignContent', type: 'string', label: 'Nội dung bài' },
      { name: 'images', type: 'array', label: 'Ảnh' },
      { name: 'postAsReels', type: 'boolean', label: 'Đăng dưới dạng Reels' },
      { name: 'sharePost', type: 'boolean', label: 'Chia sẻ từ source link' },
      { name: 'copyContentFromSource', type: 'boolean', label: 'Copy nội dung từ source' },
      { name: 'sourceLink', type: 'string', label: 'Source link (cho share/copy)' },
      { name: 'videoPath', type: 'string', label: 'Đường dẫn video (cho reels)' },
      { name: 'includeSourceImages', type: 'boolean', label: 'Lấy kèm ảnh từ source' }
    ],
    defaultVariables: {
      campaignContent: '', images: [],
      postAsReels: false, sharePost: false, copyContentFromSource: false,
      sourceLink: '', videoPath: '', includeSourceImages: false
    }
  })
  return wf.id
}

async function seedMessageFriendWorkflow(blockIds: Map<string, number>): Promise<number> {
  const ref = (n: string) => blockRef(blockIds, n)
  const nodes: WorkflowNode[] = [
    // Branch 1: send message
    { id: 'if_msg', position: { x: 100, y: 0 }, ...ref('if_else'), systemType: 'ifElse', config: { condition: 'vars.enableMessage === true' } },
    { id: 'resolve_msg', position: { x: 0, y: 80 }, ...ref('fb_resolve_url'), config: { urlType: 'messenger' }, label: 'Resolve UID/link → /messages/t/' },
    { id: 'nav_msg', position: { x: 0, y: 160 }, ...ref('nav_to_url'), config: {}, label: 'Mở Messenger' },
    { id: 'send_msg', position: { x: 0, y: 240 }, ...ref('fb_send_message'), config: {} },
    { id: 'merge_msg', position: { x: 100, y: 340 }, ...ref('merge'), systemType: 'merge', config: { mode: 'any' } },
    // Branch 2: add friend
    { id: 'if_friend', position: { x: 100, y: 440 }, ...ref('if_else'), systemType: 'ifElse', config: { condition: 'vars.enableAddFriend === true' } },
    { id: 'resolve_profile', position: { x: 0, y: 520 }, ...ref('fb_resolve_url'), config: { urlType: 'profile' }, label: 'Resolve UID/link → profile URL' },
    { id: 'nav_profile', position: { x: 0, y: 600 }, ...ref('nav_to_url'), config: {}, label: 'Mở profile' },
    { id: 'add_friend', position: { x: 0, y: 680 }, ...ref('fb_add_friend'), config: {} },
    { id: 'merge_friend', position: { x: 100, y: 780 }, ...ref('merge'), systemType: 'merge', config: { mode: 'any' } }
  ]

  const edges: WorkflowEdge[] = [
    e('if_msg', 'resolve_msg', 'true'),
    e('if_msg', 'merge_msg', 'false'),
    e('resolve_msg', 'nav_msg'),
    e('nav_msg', 'send_msg'),
    e('send_msg', 'merge_msg'),
    e('merge_msg', 'if_friend'),
    e('if_friend', 'resolve_profile', 'true'),
    e('if_friend', 'merge_friend', 'false'),
    e('resolve_profile', 'nav_profile'),
    e('nav_profile', 'add_friend'),
    e('add_friend', 'merge_friend')
  ]

  const wf = await workflowV2Repo.saveWorkflowSystem({
    name: 'facebook_message_friend',
    description: 'Workflow nhắn tin & kết bạn (mỗi action self-catch lỗi, không fail toàn workflow)',
    nodes, edges,
    variablesSchema: [
      { name: 'detailUid', type: 'string', label: 'UID/URL của target' },
      { name: 'campaignContent', type: 'string', label: 'Nội dung tin nhắn' },
      { name: 'images', type: 'array', label: 'Ảnh kèm tin nhắn' },
      { name: 'enableMessage', type: 'boolean', label: 'Bật gửi tin nhắn' },
      { name: 'enableAddFriend', type: 'boolean', label: 'Bật kết bạn' }
    ],
    defaultVariables: {
      detailUid: '', campaignContent: '', images: [],
      enableMessage: true, enableAddFriend: false
    }
  })
  return wf.id
}

function e(source: string, target: string, sourceHandle?: string): WorkflowEdge {
  return {
    id: `e-${source}-${target}${sourceHandle ? '-' + sourceHandle : ''}`,
    source, target, sourceHandle
  }
}

// ============================================================
// 4. BIND TO CAMPAIGN ACTIONS
// ============================================================
async function bindToActions(workflowIds: { groupPostId?: number; timelinePostId?: number; messageFriendId?: number }): Promise<void> {
  const client = getSupabaseClient()
  const updates: { actionId: string; workflowId?: number }[] = [
    { actionId: 'facebook_group_post', workflowId: workflowIds.groupPostId },
    { actionId: 'facebook_timeline_post', workflowId: workflowIds.timelinePostId },
    { actionId: 'facebook_message_friend', workflowId: workflowIds.messageFriendId }
  ]

  for (const u of updates) {
    if (!u.workflowId) continue
    try {
      // Đảm bảo action tồn tại trước (chỉ update nếu có)
      const existing = await campaignActionRepo.getCampaignAction(u.actionId)
      if (!existing) {
        console.log(`[seedV2] Skip bind: action ${u.actionId} chưa được seed bởi engine cũ`)
        continue
      }
      const { error } = await client
        .from('auto_campaign_actions')
        .update({ workflow_v2_id: u.workflowId })
        .eq('id', u.actionId)
      if (error) console.error(`[seedV2] Bind ${u.actionId} failed:`, error.message)
      else console.log(`[seedV2] Bound ${u.actionId} → workflow_v2_id=${u.workflowId}`)
    } catch (err) {
      console.error(`[seedV2] Bind ${u.actionId} threw:`, err)
    }
  }
}
