// The target is already open through the existing resolve/navigation blocks.
signal.throwIfAborted();
const titleXPath = await helpers.element('fb_group_share_target_title');
const title = await page.evaluate(`
  const rows = document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  if (rows.snapshotLength !== 1) return null;
  return { name: rows.snapshotItem(0).textContent.trim(), url: location.href };
`, titleXPath);
if (!title || !title.name) throw new Error('Không lấy được tên nhóm để chia sẻ');
const identity = value => {
  try { return decodeURIComponent(new URL(value).pathname.match(/^\/groups\/([^/]+)/i)?.[1] || '').toLowerCase(); }
  catch { return ''; }
};
const original = String(vars.inputDataUid || vars.targetUrl || '').trim();
const originalKey = identity(original) || (/^[\w.-]+$/.test(original) ? original.toLowerCase() : '');
const currentKey = identity(title.url);
if (!currentKey) throw new Error('Không xác minh được trang nhóm đích');
vars.groupShareTarget = { name: title.name, url: title.url, keys: [...new Set([originalKey, currentKey].filter(Boolean))] };
vars.groupShareSourceUrl = String(vars.sourceLink || '').trim();
vars.groupShareSelected = false;
vars.groupPostSubmitted = false;
vars.groupPostUrl = '';
vars.postUrl = '';
if (!vars.groupShareSourceUrl) throw new Error('Thiếu link bài viết để chia sẻ');
return { groupName: title.name, groupUrl: title.url };
