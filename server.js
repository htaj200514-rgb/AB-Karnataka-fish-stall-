require('dotenv').config();
const express = require('express'), multer = require('multer'), fs = require('fs'),
  path = require('path'), crypto = require('crypto'), nodemailer = require('nodemailer');
const E = process.env, app = express();
const DB = path.join(__dirname, 'products.json'), UP = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UP, { recursive: true });
if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify([
  { id: 1, name: 'Pomfret', price: 650, emoji: '🐟', inStock: true },
  { id: 2, name: 'Mackerel (Bangude)', price: 280, emoji: '🐠', inStock: true },
  { id: 3, name: 'Prawns', price: 550, emoji: '🦐', inStock: true },
  { id: 4, name: 'Crab', price: 600, emoji: '🦀', inStock: false },
  { id: 5, name: 'Sardines (Boothai)', price: 160, emoji: '🐟', inStock: true }
], null, 2));
const read = () => JSON.parse(fs.readFileSync(DB)), save = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2));
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (r, f, cb) => cb(null, crypto.randomBytes(8).toString('hex') + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 5e6 }, fileFilter: (r, f, cb) => cb(null, /^image\//.test(f.mimetype))
});
const mailer = E.SMTP_HOST ? nodemailer.createTransport({ host: E.SMTP_HOST, port: +E.SMTP_PORT || 465, secure: (+E.SMTP_PORT || 465) === 465, auth: { user: E.SMTP_USER, pass: E.SMTP_PASS } }) : null;
const tokens = new Set();
const auth = (q, s, n) => tokens.has(q.get('x-token')) ? n() : s.status(401).json({ error: 'Unauthorized' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/products', (q, s) => s.json({ products: read(), wa: E.OWNER_WHATSAPP || '' }));

app.post('/api/order', async (q, s) => {
  const { name, phone, address, items, pay } = q.body || {};
  if (!name || !/^\d{10}$/.test(String(phone).replace(/\D/g, '').slice(-10)) || !address || !Array.isArray(items) || !items.length)
    return s.status(400).json({ error: 'Please fill all fields and choose at least one item.' });
  const db = read(); let total = 0; const lines = [];
  for (const it of items) {
    const p = db.find(x => x.id === it.id), qty = Number(it.qty);
    if (!p || !p.inStock || !(qty > 0)) return s.status(400).json({ error: `${p ? p.name : 'Item'} is unavailable.` });
    total += p.price * qty; lines.push(`• ${p.name} – ${qty} kg × ₹${p.price} = ₹${p.price * qty}`);
  }
  const id = 'AB' + Date.now().toString().slice(-6);
  const text = `🐟 New Order ${id}\nName: ${name}\nPhone: ${phone}\nAddress: ${address}\n\nItems:\n${lines.join('\n')}\n\nTotal: ₹${total}\nPayment: ${pay === 'upi' ? 'UPI (online)' : 'Cash on Delivery'}`;
  fs.appendFileSync(path.join(__dirname, 'orders.log'), text + '\n---\n');
  if (mailer) mailer.sendMail({ from: E.SMTP_USER, to: E.OWNER_EMAIL, subject: `New order ${id} – ₹${total}`, text }).catch(e => console.error('Email failed:', e.message));
  const upi = new URLSearchParams({ pa: E.UPI_ID || '', pn: 'A B Karnataka Fish Stall', am: total, cu: 'INR', tn: 'Order ' + id }).toString();
  s.json({ id, total, upi, wa: `https://wa.me/${E.OWNER_WHATSAPP}?text=${encodeURIComponent(text)}` });
});

app.post('/api/admin/login', (q, s) => {
  if ((q.body || {}).password !== E.ADMIN_PASSWORD || !E.ADMIN_PASSWORD) return s.status(401).json({ error: 'Wrong password' });
  const t = crypto.randomBytes(24).toString('hex'); tokens.add(t); s.json({ token: t });
});
const fields = (b, o = {}) => ({ ...o, name: b.name || o.name, price: +b.price || o.price, emoji: b.emoji || o.emoji || '🐟', inStock: b.inStock === undefined ? o.inStock : String(b.inStock) === 'true' });
app.post('/api/admin/products', auth, upload.single('image'), (q, s) => {
  const db = read(), p = { id: Date.now(), ...fields(q.body) };
  if (q.file) p.image = '/uploads/' + q.file.filename;
  db.push(p); save(db); s.json(p);
});
app.put('/api/admin/products/:id', auth, upload.single('image'), (q, s) => {
  const db = read(), i = db.findIndex(x => x.id == q.params.id);
  if (i < 0) return s.sendStatus(404);
  db[i] = fields(q.body, db[i]); if (q.file) db[i].image = '/uploads/' + q.file.filename;
  save(db); s.json(db[i]);
});
app.delete('/api/admin/products/:id', auth, (q, s) => { save(read().filter(x => x.id != q.params.id)); s.sendStatus(204); });

app.listen(E.PORT || 3000, () => console.log('Running on http://localhost:' + (E.PORT || 3000)));
