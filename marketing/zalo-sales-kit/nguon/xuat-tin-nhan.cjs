// Xuất tin nhắn mẫu ra Markdown để nhân viên mở trên GitHub / điện thoại và sao chép.
const fs = require('fs');
const path = require('path');
const { scripts, common } = require('./tin-nhan-mau.cjs');

const lines = [];
lines.push('# Tin nhắn mẫu akaAgent Zalo');
lines.push('');
lines.push('Dành cho nhân viên bán hàng và CSKH. Mỗi chủ đề gồm: khi nào dùng, gửi kèm file nào, 3 tin theo thứ tự (mở đầu → giải thích → mời dùng thử) và câu hỏi thường gặp.');
lines.push('');
lines.push('Quy tắc giọng akaBiz: nói ngắn, mỗi tin kết bằng một lời mời hành động có mục đích; không dùng từ gợi rủi ro (khoá, bay nick, lỗi...); không "nhưng", không đáp cụt "không". `[Tên]` là tên của bạn; đổi "anh/chị" theo khách.');
lines.push('');
scripts.forEach((s, i) => {
  lines.push(`## ${i + 1}. ${s.title}`);
  lines.push('');
  lines.push(`**Khi nào dùng:** ${s.when}`);
  lines.push('');
  lines.push(`**Gửi kèm:** ${s.attach.join(' · ')}`);
  lines.push('');
  s.messages.forEach((m) => {
    lines.push(`**${m.label}**`);
    lines.push('');
    lines.push('```text');
    lines.push(m.text);
    lines.push('```');
    lines.push('');
  });
  lines.push('**Câu hỏi thường gặp**');
  lines.push('');
  s.faq.forEach((f) => {
    lines.push(`- *${f.q}*`);
    lines.push('');
    lines.push('  ```text');
    f.a.split('\n').forEach((l) => lines.push('  ' + l));
    lines.push('  ```');
    lines.push('');
  });
  if (s.note) { lines.push(`> ${s.note}`); lines.push(''); }
});
lines.push('## Câu hỏi chung');
lines.push('');
common.forEach((f) => {
  lines.push(`- *${f.q}*`);
  lines.push('');
  lines.push('  ```text');
  f.a.split('\n').forEach((l) => lines.push('  ' + l));
  lines.push('  ```');
  lines.push('');
});

const out = path.resolve(__dirname, '..', 'tin-nhan-mau.md');
fs.writeFileSync(out, lines.join('\n'));
console.log('ok   ' + out);
