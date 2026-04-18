import * as flowRepo from '../repositories/flowRepository'
import * as campaignActionRepo from '../repositories/campaignActionRepository'

const FACEBOOK_POST_ACTION_ID = 'facebook_timeline_post'
const FACEBOOK_POST_WORKFLOW_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const FACEBOOK_MSG_FRIEND_ACTION_ID = 'facebook_message_friend'

// Block + workflow IDs cho timeline post mở rộng (scrape source / share / reels)
export const FB_SCRAPE_POST_BLOCK_ID = 'b2c3d4e5-f6a7-8901-bcde-f23456789012'
export const FB_SHARE_POST_WORKFLOW_ID = 'c3d4e5f6-a7b8-9012-cdef-345678901234'
export const FB_REELS_WORKFLOW_ID = 'd4e5f6a7-b8c9-0123-def0-456789012345'
export const FB_POST_COPY_SOURCE_WORKFLOW_ID = 'e5f6a7b8-c9d0-1234-ef01-567890123456'
export const FB_MESSAGE_FRIEND_WORKFLOW_ID = 'f6a7b8c9-d0e1-2345-f012-678901234567'
export const FB_GROUP_POST_COMPLETION_BLOCK_ID = 'a7b8c9d0-e1f2-3456-0123-789012345678'

export async function seedBuiltinCampaignActions(): Promise<void> {
  // Seed các block + workflow built-in (idempotent — saveFlow là upsert).
  // Phải gọi TRƯỚC early-return của facebook_timeline_post bên dưới để
  // installation cũ (đã có timeline_post action) vẫn được seed các flow mới.
  await seedScrapePostBlock()
  await seedSharePostWorkflow()
  await seedReelsWorkflow()
  await seedPostCopySourceWorkflow()
  await seedMessageFriendWorkflow()
  await seedGroupPostCompletionBlock()

  // Seed facebook_message_friend campaign action (đã có workflow ID giờ).
  // Nếu action đã tồn tại nhưng chưa có workflowId → update.
  const existingMsgFriend = await campaignActionRepo.getCampaignAction(FACEBOOK_MSG_FRIEND_ACTION_ID)
  if (!existingMsgFriend) {
    try {
      await campaignActionRepo.createCampaignAction({
        id: FACEBOOK_MSG_FRIEND_ACTION_ID,
        name: 'Facebook - Nhắn tin & Kết bạn đến bạn bè/UID',
        flatformType: 'facebook',
        isActive: true,
        workflowId: FB_MESSAGE_FRIEND_WORKFLOW_ID
      })
      console.log('[Seed] Created built-in campaign action: facebook_message_friend')
    } catch (err) {
      console.error('[Seed] Failed to create facebook_message_friend action:', err)
    }
  } else if (existingMsgFriend.workflowId !== FB_MESSAGE_FRIEND_WORKFLOW_ID) {
    // Backfill workflowId cho installation cũ (trước Round 2 message_friend ko có workflow)
    try {
      await campaignActionRepo.updateCampaignAction(FACEBOOK_MSG_FRIEND_ACTION_ID, {
        workflowId: FB_MESSAGE_FRIEND_WORKFLOW_ID
      })
      console.log('[Seed] Updated facebook_message_friend with workflow ID')
    } catch (err) {
      console.error('[Seed] Failed to update facebook_message_friend workflowId:', err)
    }
  }

  const existing = await campaignActionRepo.getCampaignAction(FACEBOOK_POST_ACTION_ID)
  if (existing) return

  const workflowNodes = [
    {
      id: 'node_get_content', type: 'actionNode', position: { x: 250, y: 50 },
      data: { actionType: 'blockInput', label: 'Lấy nội dung chiến dịch', icon: 'Download', category: 'block', config: { fieldName: 'campaignContent', defaultValue: '' }, inputMapping: {} }
    },
    {
      id: 'node_nav_fb', type: 'actionNode', position: { x: 250, y: 170 },
      data: { actionType: 'navigate', label: 'Mở Facebook', icon: 'Globe', category: 'navigation', config: { url: 'https://www.facebook.com' }, inputMapping: {} }
    },
    {
      id: 'node_wait_composer', type: 'actionNode', position: { x: 250, y: 290 },
      data: { actionType: 'waitForSelector', label: 'Chờ trang tải', icon: 'Clock', category: 'utility', config: { selector: '[role="main"]', timeout: 10000 }, inputMapping: {} }
    },
    {
      id: 'node_click_composer', type: 'actionNode', position: { x: 250, y: 410 },
      data: { actionType: 'click', label: 'Click ô đăng bài', icon: 'MousePointer', category: 'interaction', config: { selector: '[role="main"] [role="button"][tabindex="0"]' }, inputMapping: {} }
    },
    {
      id: 'node_wait_dialog', type: 'actionNode', position: { x: 250, y: 530 },
      data: { actionType: 'waitForSelector', label: 'Chờ hộp thoại đăng bài', icon: 'Clock', category: 'utility', config: { selector: '[role="dialog"] [contenteditable="true"]', timeout: 10000 }, inputMapping: {} }
    },
    {
      id: 'node_sleep_1', type: 'actionNode', position: { x: 250, y: 650 },
      data: { actionType: 'sleep', label: 'Đợi 2 giây', icon: 'Clock', category: 'utility', config: { duration: 2000 }, inputMapping: {} }
    },
    {
      id: 'node_type_content', type: 'actionNode', position: { x: 250, y: 770 },
      data: { actionType: 'type', label: 'Nhập nội dung bài đăng', icon: 'Type', category: 'interaction', config: { selector: '[role="dialog"] [contenteditable="true"]', text: '' }, inputMapping: { text: { sourceNodeId: 'node_get_content', sourceField: 'value' } } }
    },
    {
      id: 'node_sleep_2', type: 'actionNode', position: { x: 250, y: 890 },
      data: { actionType: 'sleep', label: 'Đợi 2 giây', icon: 'Clock', category: 'utility', config: { duration: 2000 }, inputMapping: {} }
    },
    {
      id: 'node_click_post', type: 'actionNode', position: { x: 250, y: 1010 },
      data: { actionType: 'click', label: 'Click nút Đăng', icon: 'MousePointer', category: 'interaction', config: { selector: '[role="dialog"] [aria-label="Đăng"], [role="dialog"] [aria-label="Post"]' }, inputMapping: {} }
    },
    {
      id: 'node_wait_done', type: 'actionNode', position: { x: 250, y: 1130 },
      data: { actionType: 'sleep', label: 'Chờ hoàn thành', icon: 'Clock', category: 'utility', config: { duration: 3000 }, inputMapping: {} }
    }
  ]

  const workflowEdges = [
    { id: 'e0', source: 'node_get_content', target: 'node_nav_fb' },
    { id: 'e1', source: 'node_nav_fb', target: 'node_wait_composer' },
    { id: 'e2', source: 'node_wait_composer', target: 'node_click_composer' },
    { id: 'e3', source: 'node_click_composer', target: 'node_wait_dialog' },
    { id: 'e4', source: 'node_wait_dialog', target: 'node_sleep_1' },
    { id: 'e5', source: 'node_sleep_1', target: 'node_type_content' },
    { id: 'e6', source: 'node_type_content', target: 'node_sleep_2' },
    { id: 'e7', source: 'node_sleep_2', target: 'node_click_post' },
    { id: 'e8', source: 'node_click_post', target: 'node_wait_done' }
  ]

  try {
    await flowRepo.saveFlow({
      id: FACEBOOK_POST_WORKFLOW_ID,
      name: '[Built-in] Đăng bài lên dòng thời gian Facebook',
      description: 'Workflow tự động đăng bài lên Facebook Timeline. Sử dụng nội dung từ campaign.',
      nodes: workflowNodes as any,
      edges: workflowEdges,
      variables: {},
      isBlock: false
    })

    await campaignActionRepo.createCampaignAction({
      id: FACEBOOK_POST_ACTION_ID,
      name: 'Facebook - Đăng bài lên trang cá nhân',
      flatformType: 'facebook',
      isActive: true,
      workflowId: FACEBOOK_POST_WORKFLOW_ID
    })

    console.log('[Seed] Created built-in campaign action: facebook_timeline_post')
  } catch (err) {
    console.error('[Seed] Failed to create built-in campaign action:', err)
  }
}

/**
 * Block "Lấy nội dung bài viết Facebook" (isBlock=true).
 * Đóng gói 1 node `fbScrapePost` — input: sourceLink, includeImages;
 * output: scrapedText, scrapedImages (array file path local đã download).
 * Workflow khác có thể dùng block này qua node actionType='block' ref tới ID.
 */
async function seedScrapePostBlock(): Promise<void> {
  // Luôn upsert (saveFlow là upsert) để updates về definition mới có hiệu lực
  // sau khi user restart app. Built-in flows không nên bị user edit thủ công.
  try {
    await flowRepo.saveFlow({
      id: FB_SCRAPE_POST_BLOCK_ID,
      name: '[Built-in] Block: Lấy nội dung bài viết Facebook',
      description: 'Mở link nguồn → bấm "Xem thêm" → lấy text (nối với appendContent qua \\n) + tải ảnh về file tạm',
      isBlock: true,
      inputSchema: [
        { name: 'sourceLink', type: 'string', label: 'Link/UID nguồn', required: true },
        { name: 'includeImages', type: 'boolean', label: 'Lấy kèm hình ảnh', defaultValue: false },
        { name: 'appendContent', type: 'string', label: 'Nội dung nối thêm sau khi scrape', defaultValue: '' },
        { name: 'appendImages', type: 'json', label: 'Ảnh user nối vào (đứng trước ảnh scrape)', defaultValue: [] }
      ],
      outputSchema: [
        { name: 'scrapedText', type: 'string', label: 'Nội dung đã lấy (đã nối appendContent)' },
        { name: 'scrapedImages', type: 'json', label: 'Ảnh tổng hợp (appendImages + ảnh tải về)' }
      ],
      nodes: [
        {
          id: 'node_in_link', type: 'actionNode', position: { x: 50, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: sourceLink', icon: 'Download', category: 'block',
            config: { fieldName: 'sourceLink', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_in_images', type: 'actionNode', position: { x: 200, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: includeImages', icon: 'Download', category: 'block',
            config: { fieldName: 'includeImages', defaultValue: false }, inputMapping: {}
          }
        },
        {
          id: 'node_in_append', type: 'actionNode', position: { x: 350, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: appendContent', icon: 'Download', category: 'block',
            config: { fieldName: 'appendContent', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_in_append_imgs', type: 'actionNode', position: { x: 500, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: appendImages', icon: 'Download', category: 'block',
            config: { fieldName: 'appendImages', defaultValue: [] }, inputMapping: {}
          }
        },
        {
          id: 'node_scrape', type: 'actionNode', position: { x: 275, y: 200 },
          data: {
            actionType: 'fbScrapePost', label: 'Scrape nội dung bài', icon: 'FileSearch', category: 'data',
            config: { sourceLink: '', includeImages: false, appendContent: '', appendImages: [] },
            inputMapping: {
              sourceLink: { sourceNodeId: 'node_in_link', sourceField: 'value' },
              includeImages: { sourceNodeId: 'node_in_images', sourceField: 'value' },
              appendContent: { sourceNodeId: 'node_in_append', sourceField: 'value' },
              appendImages: { sourceNodeId: 'node_in_append_imgs', sourceField: 'value' }
            }
          }
        },
        {
          id: 'node_out_text', type: 'actionNode', position: { x: 150, y: 350 },
          data: {
            actionType: 'blockOutput', label: 'Output: scrapedText', icon: 'Upload', category: 'block',
            config: { fieldName: 'scrapedText' },
            inputMapping: { value: { sourceNodeId: 'node_scrape', sourceField: 'scrapedText' } }
          }
        },
        {
          id: 'node_out_images', type: 'actionNode', position: { x: 400, y: 350 },
          data: {
            actionType: 'blockOutput', label: 'Output: scrapedImages', icon: 'Upload', category: 'block',
            config: { fieldName: 'scrapedImages' },
            inputMapping: { value: { sourceNodeId: 'node_scrape', sourceField: 'scrapedImages' } }
          }
        }
      ] as any,
      edges: [
        { id: 'be1', source: 'node_in_link', target: 'node_scrape' },
        { id: 'be2', source: 'node_in_images', target: 'node_scrape' },
        { id: 'be3', source: 'node_in_append', target: 'node_scrape' },
        { id: 'be4', source: 'node_in_append_imgs', target: 'node_scrape' },
        { id: 'be5', source: 'node_scrape', target: 'node_out_text' },
        { id: 'be6', source: 'node_scrape', target: 'node_out_images' }
      ],
      variables: {}
    })
    console.log('[Seed] Created block: scrape-post-content')
  } catch (err) {
    console.error('[Seed] Failed to create scrape-post-content block:', err)
  }
}

/**
 * Workflow "Đăng bài bằng cách chia sẻ" — dùng action fbSharePost.
 * Input vars (từ campaign): sourceLink, campaignContent.
 */
async function seedSharePostWorkflow(): Promise<void> {
  try {
    await flowRepo.saveFlow({
      id: FB_SHARE_POST_WORKFLOW_ID,
      name: '[Built-in] Đăng bài Facebook bằng cách chia sẻ',
      description: 'Mở link nguồn → click Chia sẻ → Chia sẻ ngay → điền nội dung → Đăng',
      isBlock: false,
      nodes: [
        {
          id: 'node_in_link', type: 'actionNode', position: { x: 100, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: sourceLink', icon: 'Download', category: 'block',
            config: { fieldName: 'sourceLink', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_in_content', type: 'actionNode', position: { x: 300, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: campaignContent', icon: 'Download', category: 'block',
            config: { fieldName: 'campaignContent', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_share', type: 'actionNode', position: { x: 200, y: 200 },
          data: {
            actionType: 'fbSharePost', label: 'Chia sẻ bài', icon: 'Share2', category: 'interaction',
            config: { sourceUrl: '', content: '' },
            inputMapping: {
              sourceUrl: { sourceNodeId: 'node_in_link', sourceField: 'value' },
              content: { sourceNodeId: 'node_in_content', sourceField: 'value' }
            }
          }
        }
      ] as any,
      edges: [
        { id: 'se1', source: 'node_in_link', target: 'node_share' },
        { id: 'se2', source: 'node_in_content', target: 'node_share' }
      ],
      variables: {}
    })
    console.log('[Seed] Created workflow: share-post')
  } catch (err) {
    console.error('[Seed] Failed to create share-post workflow:', err)
  }
}

/**
 * Workflow "Đăng bài Facebook (copy nội dung từ nguồn)" — dùng BLOCK
 * scrape-post-content làm node ngay đầu, sau đó là composer post chuẩn.
 *
 * Luồng:
 *   blockInput sourceLink/includeImages/campaignContent
 *     → block(FB_SCRAPE_POST_BLOCK_ID) trả scrapedText (đã merge), scrapedImages
 *     → navigate FB → click composer → wait dialog → type(scrapedText) → click Đăng
 *
 * Khác workflow timeline post mặc định ở chỗ: input của type là output của
 * block scrape (thay vì campaignContent thuần). Block tự nối nội dung user
 * vào sau scraped (scraped + '\n' + appendContent).
 */
async function seedPostCopySourceWorkflow(): Promise<void> {
  try {
    await flowRepo.saveFlow({
      id: FB_POST_COPY_SOURCE_WORKFLOW_ID,
      name: '[Built-in] Đăng bài Facebook (copy nội dung từ nguồn)',
      description: 'Dùng block scrape-post-content lấy nội dung + ảnh từ link nguồn → đăng lên trang cá nhân',
      isBlock: false,
      nodes: [
        {
          id: 'node_in_link', type: 'actionNode', position: { x: 50, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: sourceLink', icon: 'Download', category: 'block',
            config: { fieldName: 'sourceLink', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_in_images', type: 'actionNode', position: { x: 200, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: includeImages', icon: 'Download', category: 'block',
            config: { fieldName: 'includeImages', defaultValue: false }, inputMapping: {}
          }
        },
        {
          id: 'node_in_content', type: 'actionNode', position: { x: 350, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: campaignContent', icon: 'Download', category: 'block',
            config: { fieldName: 'campaignContent', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          // images là mảng file paths user upload (đã filter qua imageOption trong runWorkflowForDetail)
          id: 'node_in_user_imgs', type: 'actionNode', position: { x: 500, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: images (user)', icon: 'Download', category: 'block',
            config: { fieldName: 'images', defaultValue: [] }, inputMapping: {}
          }
        },
        {
          // Block node — invoke FB_SCRAPE_POST_BLOCK_ID. Output: scrapedText (merged), scrapedImages (merged).
          id: 'node_block_scrape', type: 'actionNode', position: { x: 275, y: 200 },
          data: {
            actionType: 'block', label: 'Block: Lấy nội dung bài viết', icon: 'Box', category: 'block',
            config: { blockId: FB_SCRAPE_POST_BLOCK_ID, sourceLink: '', includeImages: false, appendContent: '', appendImages: [] },
            inputMapping: {
              sourceLink: { sourceNodeId: 'node_in_link', sourceField: 'value' },
              includeImages: { sourceNodeId: 'node_in_images', sourceField: 'value' },
              appendContent: { sourceNodeId: 'node_in_content', sourceField: 'value' },
              appendImages: { sourceNodeId: 'node_in_user_imgs', sourceField: 'value' }
            }
          }
        },
        {
          id: 'node_nav_fb', type: 'actionNode', position: { x: 275, y: 350 },
          data: {
            actionType: 'navigate', label: 'Mở Facebook', icon: 'Globe', category: 'navigation',
            config: { url: 'https://www.facebook.com' }, inputMapping: {}
          }
        },
        {
          id: 'node_wait_main', type: 'actionNode', position: { x: 275, y: 470 },
          data: {
            actionType: 'waitForSelector', label: 'Chờ trang tải', icon: 'Clock', category: 'utility',
            config: { selector: '[role="main"]', timeout: 10000 }, inputMapping: {}
          }
        },
        {
          id: 'node_click_composer', type: 'actionNode', position: { x: 275, y: 590 },
          data: {
            actionType: 'click', label: 'Click ô đăng bài', icon: 'MousePointer', category: 'interaction',
            config: { selector: '[role="main"] [role="button"][tabindex="0"]' }, inputMapping: {}
          }
        },
        {
          id: 'node_wait_dialog', type: 'actionNode', position: { x: 275, y: 710 },
          data: {
            actionType: 'waitForSelector', label: 'Chờ hộp thoại', icon: 'Clock', category: 'utility',
            config: { selector: '[role="dialog"] [contenteditable="true"]', timeout: 10000 }, inputMapping: {}
          }
        },
        {
          id: 'node_sleep_1', type: 'actionNode', position: { x: 275, y: 830 },
          data: {
            actionType: 'sleep', label: 'Đợi 2 giây', icon: 'Clock', category: 'utility',
            config: { duration: 2000 }, inputMapping: {}
          }
        },
        {
          // setValue (paste-based) — handle multiline tốt hơn `type` cho FB
          // Lexical editor (paste event với text/plain bảo toàn \n thành paragraph).
          id: 'node_type_content', type: 'actionNode', position: { x: 275, y: 950 },
          data: {
            actionType: 'setValue', label: 'Nhập nội dung (paste)', icon: 'Type', category: 'interaction',
            config: { selector: '[role="dialog"] [contenteditable="true"]', value: '' },
            inputMapping: { value: { sourceNodeId: 'node_block_scrape', sourceField: 'scrapedText' } }
          }
        },
        {
          // Drop ảnh (cả ảnh user lẫn ảnh scrape — block đã merge thành scrapedImages).
          // dropFile no-op nếu mảng rỗng → workflow không fail khi không có ảnh.
          id: 'node_drop_images', type: 'actionNode', position: { x: 275, y: 1070 },
          data: {
            actionType: 'dropFile', label: 'Đẩy ảnh vào composer', icon: 'Image', category: 'utility',
            config: { selector: '[role="dialog"] [contenteditable="true"]', filePaths: [] },
            inputMapping: { filePaths: { sourceNodeId: 'node_block_scrape', sourceField: 'scrapedImages' } }
          }
        },
        {
          id: 'node_sleep_2', type: 'actionNode', position: { x: 275, y: 1190 },
          data: {
            actionType: 'sleep', label: 'Đợi ảnh upload xong', icon: 'Clock', category: 'utility',
            config: { duration: 5000 }, inputMapping: {}
          }
        },
        {
          id: 'node_click_post', type: 'actionNode', position: { x: 275, y: 1310 },
          data: {
            actionType: 'click', label: 'Click nút Đăng', icon: 'MousePointer', category: 'interaction',
            config: { selector: '[role="dialog"] [aria-label="Đăng"], [role="dialog"] [aria-label="Post"]' },
            inputMapping: {}
          }
        },
        {
          id: 'node_wait_done', type: 'actionNode', position: { x: 275, y: 1430 },
          data: {
            actionType: 'sleep', label: 'Chờ hoàn thành', icon: 'Clock', category: 'utility',
            config: { duration: 3000 }, inputMapping: {}
          }
        }
      ] as any,
      edges: [
        { id: 'pe1', source: 'node_in_link', target: 'node_block_scrape' },
        { id: 'pe2', source: 'node_in_images', target: 'node_block_scrape' },
        { id: 'pe3', source: 'node_in_content', target: 'node_block_scrape' },
        { id: 'pe4', source: 'node_in_user_imgs', target: 'node_block_scrape' },
        { id: 'pe5', source: 'node_block_scrape', target: 'node_nav_fb' },
        { id: 'pe6', source: 'node_nav_fb', target: 'node_wait_main' },
        { id: 'pe7', source: 'node_wait_main', target: 'node_click_composer' },
        { id: 'pe8', source: 'node_click_composer', target: 'node_wait_dialog' },
        { id: 'pe9', source: 'node_wait_dialog', target: 'node_sleep_1' },
        { id: 'pe10', source: 'node_sleep_1', target: 'node_type_content' },
        { id: 'pe11', source: 'node_type_content', target: 'node_drop_images' },
        { id: 'pe12', source: 'node_drop_images', target: 'node_sleep_2' },
        { id: 'pe13', source: 'node_sleep_2', target: 'node_click_post' },
        { id: 'pe14', source: 'node_click_post', target: 'node_wait_done' }
      ],
      variables: {}
    })
    console.log('[Seed] Created workflow: post-copy-source')
  } catch (err) {
    console.error('[Seed] Failed to create post-copy-source workflow:', err)
  }
}

/**
 * Workflow "Đăng Reels Facebook" — dùng action fbPostReels.
 * Input vars (từ campaign): campaignContent, videoPath (từ campaign.images[0]).
 */
async function seedReelsWorkflow(): Promise<void> {
  try {
    await flowRepo.saveFlow({
      id: FB_REELS_WORKFLOW_ID,
      name: '[Built-in] Đăng Reels Facebook',
      description: 'Mở /reels/create → upload video → Tiếp x2 → nhập nội dung → Đăng',
      isBlock: false,
      nodes: [
        {
          id: 'node_in_video', type: 'actionNode', position: { x: 100, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: videoPath', icon: 'Download', category: 'block',
            config: { fieldName: 'videoPath', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_in_content', type: 'actionNode', position: { x: 300, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: campaignContent', icon: 'Download', category: 'block',
            config: { fieldName: 'campaignContent', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_reels', type: 'actionNode', position: { x: 200, y: 200 },
          data: {
            actionType: 'fbPostReels', label: 'Đăng Reels', icon: 'Video', category: 'interaction',
            config: { videoPath: '', content: '' },
            inputMapping: {
              videoPath: { sourceNodeId: 'node_in_video', sourceField: 'value' },
              content: { sourceNodeId: 'node_in_content', sourceField: 'value' }
            }
          }
        }
      ] as any,
      edges: [
        { id: 're1', source: 'node_in_video', target: 'node_reels' },
        { id: 're2', source: 'node_in_content', target: 'node_reels' }
      ],
      variables: {}
    })
    console.log('[Seed] Created workflow: reels')
  } catch (err) {
    console.error('[Seed] Failed to create reels workflow:', err)
  }
}

/**
 * Workflow "Nhắn tin & Kết bạn (per-detail)" — chạy 1 lần cho 1 detail.
 * Scheduler loop qua details, mỗi detail invoke workflow này với uid + flags.
 *
 * Cả 2 action đều check `enabled` flag — nếu false thì no-op, nên workflow
 * này dùng được cho cả 3 chế độ: chỉ nhắn tin / chỉ kết bạn / cả 2.
 */
async function seedMessageFriendWorkflow(): Promise<void> {
  try {
    await flowRepo.saveFlow({
      id: FB_MESSAGE_FRIEND_WORKFLOW_ID,
      name: '[Built-in] Nhắn tin & Kết bạn (per-detail)',
      description: 'Workflow chạy cho 1 UID: gửi tin nhắn (nếu enabled) + gửi lời mời kết bạn (nếu enabled)',
      isBlock: false,
      nodes: [
        {
          id: 'node_in_uid', type: 'actionNode', position: { x: 50, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: detailUid', icon: 'Download', category: 'block',
            config: { fieldName: 'detailUid', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_in_msg', type: 'actionNode', position: { x: 200, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: campaignContent', icon: 'Download', category: 'block',
            config: { fieldName: 'campaignContent', defaultValue: '' }, inputMapping: {}
          }
        },
        {
          id: 'node_in_imgs', type: 'actionNode', position: { x: 350, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: images', icon: 'Download', category: 'block',
            config: { fieldName: 'images', defaultValue: [] }, inputMapping: {}
          }
        },
        {
          id: 'node_in_enable_msg', type: 'actionNode', position: { x: 500, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: enableMessage', icon: 'Download', category: 'block',
            config: { fieldName: 'enableMessage', defaultValue: false }, inputMapping: {}
          }
        },
        {
          id: 'node_in_enable_friend', type: 'actionNode', position: { x: 650, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: enableAddFriend', icon: 'Download', category: 'block',
            config: { fieldName: 'enableAddFriend', defaultValue: false }, inputMapping: {}
          }
        },
        {
          id: 'node_send_msg', type: 'actionNode', position: { x: 200, y: 220 },
          data: {
            actionType: 'fbSendMessage', label: 'Gửi tin nhắn', icon: 'MessageCircle', category: 'interaction',
            config: { uid: '', content: '', images: [], enabled: false },
            inputMapping: {
              uid: { sourceNodeId: 'node_in_uid', sourceField: 'value' },
              content: { sourceNodeId: 'node_in_msg', sourceField: 'value' },
              images: { sourceNodeId: 'node_in_imgs', sourceField: 'value' },
              enabled: { sourceNodeId: 'node_in_enable_msg', sourceField: 'value' }
            }
          }
        },
        {
          id: 'node_add_friend', type: 'actionNode', position: { x: 500, y: 220 },
          data: {
            actionType: 'fbAddFriend', label: 'Kết bạn', icon: 'UserPlus', category: 'interaction',
            config: { uid: '', enabled: false },
            inputMapping: {
              uid: { sourceNodeId: 'node_in_uid', sourceField: 'value' },
              enabled: { sourceNodeId: 'node_in_enable_friend', sourceField: 'value' }
            }
          }
        }
      ] as any,
      edges: [
        { id: 'mfe1', source: 'node_in_uid', target: 'node_send_msg' },
        { id: 'mfe2', source: 'node_in_msg', target: 'node_send_msg' },
        { id: 'mfe3', source: 'node_in_imgs', target: 'node_send_msg' },
        { id: 'mfe4', source: 'node_in_enable_msg', target: 'node_send_msg' },
        { id: 'mfe5', source: 'node_send_msg', target: 'node_add_friend' },
        { id: 'mfe6', source: 'node_in_uid', target: 'node_add_friend' },
        { id: 'mfe7', source: 'node_in_enable_friend', target: 'node_add_friend' }
      ],
      variables: {}
    })
    console.log('[Seed] Created workflow: message-friend')
  } catch (err) {
    console.error('[Seed] Failed to create message-friend workflow:', err)
  }
}

/**
 * Block "Group Post Completion" (isBlock=true) — chạy sau khi đăng bài group
 * thành công, để xử lý các task hậu kỳ:
 *   - Detect bài có chờ duyệt không
 *   - Rời nhóm nếu bài chờ duyệt + leaveOnPending bật
 *   - Tham gia nhóm nếu chưa member + joinAfterPost bật
 *
 * 3 action node tự check enabled/isPending → no-op khi không match điều kiện,
 * nên block luôn chạy hết 3 nodes mà không cần ifElse trong flow.
 *
 * Inputs:  leaveOnPending (bool), joinAfterPost (bool)
 * Outputs: isPending (bool), left (bool), joined (bool)
 */
async function seedGroupPostCompletionBlock(): Promise<void> {
  try {
    await flowRepo.saveFlow({
      id: FB_GROUP_POST_COMPLETION_BLOCK_ID,
      name: '[Built-in] Block: Hậu kỳ đăng bài Group Facebook',
      description: 'Detect chờ duyệt → rời nhóm (nếu cần) → tham gia nhóm (nếu cần)',
      isBlock: true,
      inputSchema: [
        { name: 'leaveOnPending', type: 'boolean', label: 'Rời nhóm khi bài chờ duyệt', defaultValue: false },
        { name: 'joinAfterPost', type: 'boolean', label: 'Tham gia nhóm sau khi đăng', defaultValue: false }
      ],
      outputSchema: [
        { name: 'isPending', type: 'boolean', label: 'Bài có đang chờ duyệt' },
        { name: 'left', type: 'boolean', label: 'Đã rời nhóm' },
        { name: 'joined', type: 'boolean', label: 'Đã tham gia nhóm' }
      ],
      nodes: [
        {
          id: 'node_in_leave', type: 'actionNode', position: { x: 50, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: leaveOnPending', icon: 'Download', category: 'block',
            config: { fieldName: 'leaveOnPending', defaultValue: false }, inputMapping: {}
          }
        },
        {
          id: 'node_in_join', type: 'actionNode', position: { x: 250, y: 50 },
          data: {
            actionType: 'blockInput', label: 'Input: joinAfterPost', icon: 'Download', category: 'block',
            config: { fieldName: 'joinAfterPost', defaultValue: false }, inputMapping: {}
          }
        },
        {
          id: 'node_detect', type: 'actionNode', position: { x: 150, y: 200 },
          data: {
            actionType: 'fbDetectPostPending', label: 'Detect bài chờ duyệt', icon: 'Clock', category: 'data',
            config: {}, inputMapping: {}
          }
        },
        {
          id: 'node_leave', type: 'actionNode', position: { x: 50, y: 350 },
          data: {
            actionType: 'fbLeaveGroupIfPending', label: 'Rời nhóm (có điều kiện)', icon: 'LogOut', category: 'interaction',
            config: { enabled: false, isPending: false },
            inputMapping: {
              enabled: { sourceNodeId: 'node_in_leave', sourceField: 'value' },
              isPending: { sourceNodeId: 'node_detect', sourceField: 'isPending' }
            }
          }
        },
        {
          id: 'node_join', type: 'actionNode', position: { x: 250, y: 350 },
          data: {
            actionType: 'fbJoinGroupIfNotMember', label: 'Tham gia nhóm (có điều kiện)', icon: 'UserPlus', category: 'interaction',
            config: { enabled: false, isPending: false },
            inputMapping: {
              enabled: { sourceNodeId: 'node_in_join', sourceField: 'value' },
              isPending: { sourceNodeId: 'node_detect', sourceField: 'isPending' }
            }
          }
        },
        {
          id: 'node_out_pending', type: 'actionNode', position: { x: 50, y: 500 },
          data: {
            actionType: 'blockOutput', label: 'Output: isPending', icon: 'Upload', category: 'block',
            config: { fieldName: 'isPending' },
            inputMapping: { value: { sourceNodeId: 'node_detect', sourceField: 'isPending' } }
          }
        },
        {
          id: 'node_out_left', type: 'actionNode', position: { x: 200, y: 500 },
          data: {
            actionType: 'blockOutput', label: 'Output: left', icon: 'Upload', category: 'block',
            config: { fieldName: 'left' },
            inputMapping: { value: { sourceNodeId: 'node_leave', sourceField: 'left' } }
          }
        },
        {
          id: 'node_out_joined', type: 'actionNode', position: { x: 350, y: 500 },
          data: {
            actionType: 'blockOutput', label: 'Output: joined', icon: 'Upload', category: 'block',
            config: { fieldName: 'joined' },
            inputMapping: { value: { sourceNodeId: 'node_join', sourceField: 'joined' } }
          }
        }
      ] as any,
      edges: [
        { id: 'gpe1', source: 'node_in_leave', target: 'node_detect' },
        { id: 'gpe2', source: 'node_in_join', target: 'node_detect' },
        { id: 'gpe3', source: 'node_detect', target: 'node_leave' },
        { id: 'gpe4', source: 'node_leave', target: 'node_join' },
        { id: 'gpe5', source: 'node_detect', target: 'node_out_pending' },
        { id: 'gpe6', source: 'node_leave', target: 'node_out_left' },
        { id: 'gpe7', source: 'node_join', target: 'node_out_joined' }
      ],
      variables: {}
    })
    console.log('[Seed] Created block: group-post-completion')
  } catch (err) {
    console.error('[Seed] Failed to create group-post-completion block:', err)
  }
}
