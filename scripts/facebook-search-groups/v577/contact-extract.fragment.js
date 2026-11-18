// Tách SĐT / email từ chữ, dùng chung cho hai đoạn chạy trong trang (danh sách quản trị viên, trang cá nhân). Cùng quy tắc với
// src/shared/facebookGroupAdmins.ts (bài kiểm so hai bên): SĐT chỉ nhận di động Việt Nam như các block tìm SĐT khác, chuẩn hoá về 0xxxxxxxxx;
// email về chữ thường. Số nằm giữa một dãy số dài hơn (mã Facebook, giá tiền) không tính.
function normalizePhone(value) {
  let digits = String(value || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  return /^0[35789]\d{8}$/.test(digits) ? digits : '';
}
function findPhones(text) {
  const matches = String(text || '').match(/(?<![\d+])(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}(?!\d)/g) || [];
  return Array.from(new Set(matches.map(normalizePhone).filter(Boolean)));
}
function findEmails(text) {
  const matches = String(text || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g) || [];
  return Array.from(new Set(matches.map(value => value.replace(/[.\-]+$/g, '').toLowerCase()).filter(value => /\.[a-z]{2,}$/.test(value))));
}
