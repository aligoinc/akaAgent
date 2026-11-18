// Tìm phần tử theo XPath lấy từ bảng auto_elements (block truyền vào qua __args). XPath bắt đầu bằng "." là tương đối so với context.
function xpathAll(expression, context) {
  const found = [];
  if (!expression) return found;
  const result = document.evaluate(String(expression), context || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  for (let index = 0; index < result.snapshotLength; index += 1) found.push(result.snapshotItem(index));
  return found;
}
