// Trong trang batdongsan: đã qua lớp xác minh và có ô tìm chưa. __args: [ô tìm]. Chưa thì { pending }.
const inputSelector = String(__args[0] || '');
const title = norm(document.title).slice(0, 120);
if (isChallenge()) return { pending: true, challenge: true, title };
if (document.readyState === 'loading' || !document.body) return { pending: true, title };
if (!findOne(inputSelector)) return { pending: true, title };
return { ok: true, title };
