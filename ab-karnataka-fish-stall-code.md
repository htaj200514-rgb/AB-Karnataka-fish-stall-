# A B Karnataka Fish Stall: Complete Website Code

Single-page ordering site: HTML/CSS/JS front-end + lightweight Node.js (Express) API.
Create the folder structure below and paste each file.

```
fish-stall/
├── package.json
├── .env.example        (copy to .env)
├── server.js
├── data/products.json
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    ├── admin.html
    ├── admin.js
    └── uploads/        (auto-created; put logo.png here)
```

---

## 1. package.json
```json
{
  "name": "ab-karnataka-fish-stall",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "nodemailer": "^6.9.14"
  }
}
```

## 2. .env.example
```
PORT=3000
ADMIN_PASSWORD=change-this-password
OWNER_PHONE=919999999999        # country code + number, no + or spaces
UPI_ID=yourshop@upi             # owner's UPI ID (works with PhonePe, GPay, BharatPe, Paytm)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=youremail@gmail.com
SMTP_PASS=your-gmail-app-password
OWNER_EMAIL=youremail@gmail.com
```

## 3. server.js
```js
// Backend API: products, orders, admin. Front-end lives in /public.
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const UPLOADS = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

// ---------- Public API ----------
app.get('/api/config', (req, res) => {
  res.json({ shopName: 'A B Karnataka Fish Stall', ownerPhone: process.env.OWNER_PHONE, upiId: process.env.UPI_ID });
});

app.get('/api/products', (req, res) => res.json(read(PRODUCTS_FILE, [])));

// Place an order: total is recalculated on the server (never trust the browser)
app.post('/api/orders', async (req, res) => {
  const { name, phone, address, items, paymentMethod } = req.body || {};
  if (!name || !/^\d{10}$/.test(String(phone || '').replace(/\D/g, '').slice(-10)) || !address || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Please fill name, 10-digit phone, address and pick items.' });

  const products = read(PRODUCTS_FILE, []);
  const lines = [];
  let total = 0;
  for (const it of items) {
    const p = products.find(x => x.id === it.id);
    const qty = Number(it.qty);
    if (!p || !p.available || !(qty > 0)) return res.status(400).json({ error: `${p ? p.name : 'Item'} is not available.` });
    lines.push({ name: p.name, qty, unit: p.unit, price: p.price, subtotal: p.price * qty });
    total += p.price * qty;
  }
  const order = {
    id: 'ORD' + Date.now(), createdAt: new Date().toISOString(),
    name, phone, address, items: lines, total,
    paymentMethod: paymentMethod === 'UPI' ? 'UPI' : 'Cash on Delivery'
  };
  const orders = read(ORDERS_FILE, []); orders.push(order); write(ORDERS_FILE, orders);

  const text = orderText(order);
  // Click-to-WhatsApp link (customer taps it; opens chat with owner, message pre-filled)
  const whatsappUrl = `https://wa.me/${process.env.OWNER_PHONE}?text=${encodeURIComponent(text)}`;
  // UPI deep link (opens PhonePe / GPay / BharatPe / Paytm)
  const upiUrl = `upi://pay?pa=${encodeURIComponent(process.env.UPI_ID || '')}&pn=${encodeURIComponent('A B Karnataka Fish Stall')}&am=${total}&cu=INR&tn=${order.id}`;

  sendEmail(order, text).catch(e => console.error('Email failed:', e.message)); // backup copy
  res.json({ order, whatsappUrl, upiUrl });
});

function orderText(o) {
  return `*New Order ${o.id}*\nName: ${o.name}\nPhone: ${o.phone}\nAddress: ${o.address}\n\n` +
    o.items.map(i => `- ${i.name} x ${i.qty} ${i.unit} = Rs.${i.subtotal}`).join('\n') +
    `\n\n*Total: Rs.${o.total}*\nPayment: ${o.paymentMethod}`;
}

async function sendEmail(order, text) {
  if (!process.env.SMTP_USER) return;
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await t.sendMail({ from: process.env.SMTP_USER, to: process.env.OWNER_EMAIL, subject: `New order ${order.id} - Rs.${order.total}`, text });
}

// ---------- Admin API (password -> temporary token) ----------
const tokens = new Set();
const auth = (req, res, next) => tokens.has(req.headers['x-admin-token']) ? next() : res.status(401).json({ error: 'Unauthorized' });

app.post('/api/admin/login', (req, res) => {
  if (!process.env.ADMIN_PASSWORD || req.body.password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Wrong password' });
  const token = crypto.randomBytes(24).toString('hex');
  tokens.add(token);
  res.json({ token });
});

app.get('/api/admin/orders', auth, (req, res) => res.json(read(ORDERS_FILE, []).reverse()));

// Save the whole product list (add / edit / delete / price / availability)
app.put('/api/admin/products', auth, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Invalid data' });
  const clean = req.body.map(p => ({
    id: p.id || 'p' + crypto.randomBytes(4).toString('hex'),
    name: String(p.name || 'New item'), price: Number(p.price) || 0,
    unit: String(p.unit || 'kg'), image: String(p.image || ''), available: !!p.available
  }));
  write(PRODUCTS_FILE, clean);
  res.json(clean);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|png|webp)/.test(file.mimetype))
});
app.post('/api/admin/upload', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a JPG/PNG/WebP under 5 MB' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.listen(process.env.PORT || 3000, () => console.log('Running on http://localhost:' + (process.env.PORT || 3000)));
```

## 4. data/products.json
```json
[
  { "id": "p1", "name": "Pomfret", "price": 650, "unit": "kg", "available": true,  "image": "https://i.ibb.co/yBpjnyjT/Whats-App-Image-2026-09-30-at-5-21-18-AM-2.jpg" },
  { "id": "p2", "name": "Mackerel (Bangude)", "price": 260, "unit": "kg", "available": true,  "image": "https://i.ibb.co/8D37QmKD/Whats-App-Image-2026-09-30-at-5-21-18-AM-1.jpg" },
  { "id": "p3", "name": "Prawns", "price": 550, "unit": "kg", "available": true,  "image": "https://i.ibb.co/S70yF62y/Whats-App-Image-2026-09-30-at-5-21-18-AM.jpg" },
  { "id": "p4", "name": "Crab", "price": 700, "unit": "kg", "available": false, "image": "https://i.ibb.co/fVhN2p65/Whats-App-Image-2026-09-30-at-5-21-17-AM-2.jpg" },
  { "id": "p5", "name": "Sardines (Boothai)", "price": 180, "unit": "kg", "available": true,  "image": "https://i.ibb.co/xnFVrbK/Whats-App-Image-2026-09-30-at-5-21-17-AM-1.jpg" },
  { "id": "p6", "name": "Fish 6", "price": 400, "unit": "kg", "available": true,  "image": "https://i.ibb.co/dwS0fFSN/Whats-App-Image-2026-09-30-at-5-21-17-AM.jpg" },
  { "id": "p7", "name": "Fish 7", "price": 400, "unit": "kg", "available": true,  "image": "https://i.ibb.co/Mk1SjgQ9/Whats-App-Image-2026-09-30-at-5-21-16-AM-1.jpg" },
  { "id": "p8", "name": "Fish 8", "price": 400, "unit": "kg", "available": true,  "image": "https://i.ibb.co/cKymb5mN/Whats-App-Image-2026-09-30-at-5-21-16-AM.jpg" }
]
```
(Prices and names are placeholders. Rename them from the admin panel.)

## 5. public/index.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>A B Karnataka Fish Stall | Fresh Catch Daily</title>
  <!-- Save your logo as public/uploads/logo.png (the share.google link is a web page, not an image file) -->
  <link rel="icon" href="/uploads/logo.png">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top">
    <img src="/uploads/logo.png" alt="Logo" class="logo" onerror="this.style.display='none'">
    <span>A B Karnataka Fish Stall</span>
    <nav><a href="#products">Fish</a><a href="#order">Order</a></nav>
  </header>

  <section class="hero" style="background-image:linear-gradient(rgba(6,50,90,.55),rgba(6,50,90,.7)),url('https://i.ibb.co/1G06s1Br/Whats-App-Image-2026-09-30-at-5-21-19-AM.jpg')">
    <h1>A B Karnataka Fish Stall</h1>
    <p>Fresh Catch Daily, straight from the coast</p>
    <button class="btn" onclick="document.getElementById('products').scrollIntoView({behavior:'smooth'})">Shop Now</button>
  </section>

  <section id="products">
    <h2>Today's Catch</h2>
    <div id="carousel" class="carousel"></div>
  </section>

  <section id="order">
    <h2>Place Your Order</h2>
    <form id="orderForm">
      <input id="name" placeholder="Your name" required>
      <input id="phone" type="tel" placeholder="Phone number (10 digits)" pattern="[0-9]{10}" required>
      <textarea id="address" placeholder="Delivery address" rows="3" required></textarea>

      <h3>Select items</h3>
      <div id="items"></div>
      <div class="total">Total: Rs. <span id="total">0</span></div>

      <h3>Payment</h3>
      <label class="radio"><input type="radio" name="pay" value="UPI" checked> Pay online (PhonePe / Google Pay / BharatPe / Paytm)</label>
      <label class="radio"><input type="radio" name="pay" value="Cash on Delivery"> Cash on Delivery</label>

      <button class="btn" type="submit">Place Order</button>
      <p id="msg" class="msg"></p>
    </form>

    <div id="done" class="done" hidden>
      <h3>Order placed!</h3>
      <div id="upiBox" hidden>
        <a id="upiBtn" class="btn">Pay with UPI app</a>
        <p>or scan with any UPI app:</p>
        <img id="qr" alt="UPI QR" width="200" height="200">
      </div>
      <a id="waBtn" class="btn wa" target="_blank" rel="noopener">Send order on WhatsApp</a>
      <p class="hint">Tap the WhatsApp button so the shop receives your order instantly.</p>
    </div>
  </section>

  <footer>&copy; A B Karnataka Fish Stall</footer>
  <a id="waFloat" class="wa-float" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">WhatsApp</a>
  <script src="app.js"></script>
</body>
</html>
```

## 6. public/style.css
```css
:root { --navy:#0b3d6b; --blue:#1479c9; --sky:#e8f4fd; --white:#fff; --grey:#8a97a3; --green:#25d366; }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:system-ui,Segoe UI,Roboto,sans-serif; background:var(--sky); color:#12283a; scroll-behavior:smooth; }
.top { position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:10px; padding:10px 16px; background:var(--navy); color:#fff; font-weight:700; }
.top .logo { width:36px; height:36px; border-radius:50%; object-fit:cover; }
.top nav { margin-left:auto; display:flex; gap:14px; }
.top a { color:#cfe8ff; text-decoration:none; font-weight:500; }
.hero { min-height:70vh; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:#fff; padding:24px; background-size:cover; background-position:center; }
.hero h1 { font-size:clamp(2rem,7vw,3.6rem); }
.hero p { margin:12px 0 24px; font-size:1.15rem; }
.btn { display:inline-block; background:var(--blue); color:#fff; border:0; border-radius:28px; padding:13px 28px; font-size:1rem; font-weight:600; cursor:pointer; text-decoration:none; }
.btn:hover { background:#0f66aa; }
.btn.wa { background:var(--green); margin-top:14px; }
section { max-width:1000px; margin:0 auto; padding:36px 16px; }
h2 { color:var(--navy); margin-bottom:16px; }
h3 { margin:18px 0 8px; color:var(--navy); }
.carousel { display:flex; gap:14px; overflow-x:auto; scroll-snap-type:x mandatory; padding-bottom:10px; }
.card { flex:0 0 230px; scroll-snap-align:start; background:#fff; border-radius:14px; overflow:hidden; box-shadow:0 3px 10px rgba(11,61,107,.12); }
.card img { width:100%; height:160px; object-fit:cover; display:block; }
.card .b { padding:12px; }
.card .p { color:var(--blue); font-weight:700; }
.badge { display:inline-block; margin-top:6px; padding:3px 10px; border-radius:12px; font-size:.8rem; background:#d7f5e1; color:#12703a; }
.card.out { filter:grayscale(1); opacity:.6; }
.card.out .badge { background:#e5e5e5; color:#555; }
form, .done { background:#fff; padding:20px; border-radius:14px; box-shadow:0 3px 10px rgba(11,61,107,.1); }
input, textarea { width:100%; padding:12px; margin-bottom:10px; border:1px solid #c7d8e6; border-radius:8px; font-size:1rem; font-family:inherit; }
.row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #eef3f8; }
.row .n { flex:1; }
.row input { width:80px; margin:0; }
.row.out { opacity:.45; }
.total { font-size:1.3rem; font-weight:700; margin:14px 0; color:var(--navy); }
.radio { display:block; padding:6px 0; }
.radio input { width:auto; margin-right:8px; }
.msg { margin-top:10px; color:#c0392b; }
.done { margin-top:20px; text-align:center; }
.hint { font-size:.85rem; color:var(--grey); margin-top:8px; }
footer { text-align:center; padding:20px; color:var(--grey); }
.wa-float { position:fixed; right:16px; bottom:16px; background:var(--green); color:#fff; text-decoration:none; padding:14px 18px; border-radius:30px; font-weight:700; box-shadow:0 4px 12px rgba(0,0,0,.25); z-index:20; }
@media (min-width:700px) { .card { flex-basis:260px; } }
```

## 7. public/app.js
```js
// Customer front-end: loads products, builds order, calls the API.
const $ = id => document.getElementById(id);
let products = [], config = {};

async function init() {
  [config, products] = await Promise.all([fetch('/api/config').then(r => r.json()), fetch('/api/products').then(r => r.json())]);
  $('waFloat').href = `https://wa.me/${config.ownerPhone}`;
  renderCarousel(); renderItems();
  autoSlide();
}

function renderCarousel() {
  $('carousel').innerHTML = products.map(p => `
    <div class="card ${p.available ? '' : 'out'}">
      <img src="${p.image}" alt="${p.name}" loading="lazy">
      <div class="b"><strong>${p.name}</strong>
        <div class="p">Rs. ${p.price} / ${p.unit}</div>
        <span class="badge">${p.available ? 'In Stock' : 'Out of Stock'}</span>
      </div></div>`).join('');
}

function autoSlide() { // gentle auto-scroll, pauses on touch/hover
  const c = $('carousel'); let paused = false;
  ['mouseenter', 'touchstart'].forEach(e => c.addEventListener(e, () => paused = true));
  ['mouseleave', 'touchend'].forEach(e => c.addEventListener(e, () => paused = false));
  setInterval(() => {
    if (paused) return;
    if (c.scrollLeft + c.clientWidth >= c.scrollWidth - 5) c.scrollTo({ left: 0, behavior: 'smooth' });
    else c.scrollBy({ left: 240, behavior: 'smooth' });
  }, 3000);
}

function renderItems() {
  $('items').innerHTML = products.map(p => `
    <div class="row ${p.available ? '' : 'out'}">
      <span class="n">${p.name} <small>(Rs. ${p.price}/${p.unit})</small></span>
      <input type="number" min="0" step="0.5" value="0" data-id="${p.id}" ${p.available ? '' : 'disabled'}>
      <span>${p.unit}</span>
    </div>`).join('');
  $('items').addEventListener('input', updateTotal);
}

function selected() {
  return [...document.querySelectorAll('#items input')].map(i => ({ id: i.dataset.id, qty: Number(i.value) })).filter(i => i.qty > 0);
}
function updateTotal() {
  $('total').textContent = selected().reduce((s, i) => s + i.qty * products.find(p => p.id === i.id).price, 0);
}

$('orderForm').addEventListener('submit', async e => {
  e.preventDefault();
  const items = selected();
  if (!items.length) { $('msg').textContent = 'Please select at least one item.'; return; }
  $('msg').textContent = 'Placing order...';
  const res = await fetch('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: $('name').value, phone: $('phone').value, address: $('address').value, items,
      paymentMethod: document.querySelector('input[name=pay]:checked').value })
  });
  const data = await res.json();
  if (!res.ok) { $('msg').textContent = data.error; return; }

  $('msg').textContent = '';
  $('orderForm').hidden = true; $('done').hidden = false;
  $('waBtn').href = data.whatsappUrl;
  if (data.order.paymentMethod === 'UPI') {
    $('upiBox').hidden = false;
    $('upiBtn').href = data.upiUrl;
    $('qr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(data.upiUrl);
  }
});

init();
```

## 8. public/admin.html
```html
<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin | A B Karnataka Fish Stall</title>
  <link rel="stylesheet" href="style.css">
  <style>.arow{display:grid;grid-template-columns:70px 1fr;gap:8px;background:#fff;padding:12px;border-radius:12px;margin-bottom:10px}
  .arow img{width:70px;height:70px;object-fit:cover;border-radius:8px}.arow input{margin:0 0 6px}.line{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .line input[type=number]{width:90px}.line input[type=text]{flex:1;min-width:120px}.del{background:#c0392b}</style>
</head><body>
  <header class="top"><span>Admin Panel</span><nav><a href="/">View site</a></nav></header>
  <section>
    <div id="login">
      <h2>Owner login</h2>
      <input id="pw" type="password" placeholder="Password">
      <button class="btn" onclick="login()">Login</button>
      <p id="err" class="msg"></p>
    </div>
    <div id="panel" hidden>
      <h2>Products</h2>
      <div id="list"></div>
      <button class="btn" onclick="addItem()">+ Add product</button>
      <button class="btn wa" onclick="save()">Save changes</button>
      <p id="status" class="hint"></p>
      <h2 style="margin-top:30px">Recent orders</h2>
      <div id="orders"></div>
    </div>
  </section>
  <script src="admin.js"></script>
</body></html>
```

## 9. public/admin.js
```js
let token = sessionStorage.getItem('adminToken'), items = [];
const $ = id => document.getElementById(id);
const H = () => ({ 'Content-Type': 'application/json', 'x-admin-token': token });

async function login() {
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('pw').value }) });
  const d = await r.json();
  if (!r.ok) { $('err').textContent = d.error; return; }
  token = d.token; sessionStorage.setItem('adminToken', token); start();
}

async function start() {
  $('login').hidden = true; $('panel').hidden = false;
  items = await fetch('/api/products').then(r => r.json());
  render(); loadOrders();
}

function render() {
  $('list').innerHTML = items.map((p, i) => `
    <div class="arow">
      <img src="${p.image}" alt="">
      <div>
        <div class="line"><input type="text" value="${p.name}" onchange="items[${i}].name=this.value">
          <input type="number" value="${p.price}" onchange="items[${i}].price=Number(this.value)">
          <input type="text" style="max-width:70px" value="${p.unit}" onchange="items[${i}].unit=this.value"></div>
        <div class="line">
          <label><input type="checkbox" ${p.available ? 'checked' : ''} onchange="items[${i}].available=this.checked"> Available</label>
          <input type="file" accept="image/*" onchange="upload(${i},this.files[0])">
          <button class="btn del" onclick="items.splice(${i},1);render()">Remove</button>
        </div>
      </div>
    </div>`).join('');
}

function addItem() { items.push({ name: 'New fish', price: 0, unit: 'kg', image: '', available: true }); render(); }

async function upload(i, file) {
  if (!file) return;
  const fd = new FormData(); fd.append('photo', file);
  const r = await fetch('/api/admin/upload', { method: 'POST', headers: { 'x-admin-token': token }, body: fd });
  const d = await r.json();
  if (r.ok) { items[i].image = d.url; render(); } else alert(d.error);
}

async function save() {
  const r = await fetch('/api/admin/products', { method: 'PUT', headers: H(), body: JSON.stringify(items) });
  if (r.status === 401) { sessionStorage.clear(); location.reload(); return; }
  items = await r.json(); render();
  $('status').textContent = 'Saved!';
}

async function loadOrders() {
  const r = await fetch('/api/admin/orders', { headers: H() });
  const o = await r.json();
  $('orders').innerHTML = o.slice(0, 20).map(x => `<div class="arow" style="grid-template-columns:1fr"><div><b>${x.id}</b> | ${x.name} | ${x.phone}<br>${x.address}<br>${x.items.map(i => i.name + ' x' + i.qty).join(', ')}<br><b>Rs. ${x.total}</b> (${x.paymentMethod})</div></div>`).join('') || '<p>No orders yet.</p>';
}

if (token) start().catch(() => sessionStorage.clear());
```

---

## 10. README

### Run locally
1. Install Node.js 18+.
2. In the `fish-stall` folder run `npm install`.
3. Copy `.env.example` to `.env` and fill in: owner WhatsApp number, UPI ID, admin password, email (Gmail needs an *App Password*).
4. Save your logo as `public/uploads/logo.png`.
5. Run `npm start`, then open `http://localhost:3000`. Admin is at `http://localhost:3000/admin.html`.

### How orders reach the owner
- **Email:** sent automatically by the server on every order (backup copy).
- **WhatsApp:** after ordering, the customer taps "Send order on WhatsApp", which opens a chat with the owner with the full order pre-filled. To send silently without the customer tapping, you would need the WhatsApp Business Cloud API (Meta approval required); it can be added inside `POST /api/orders`.
- All orders are also stored in `data/orders.json` and shown in the admin panel.

### Payments
UPI uses a standard `upi://pay` link plus QR, which works with PhonePe, Google Pay, BharatPe and Paytm. It does not confirm payment automatically, so check your UPI app for the credit against the order ID. For automatic confirmation, use a gateway such as Razorpay.

### Deploy
Deploy on Render, Railway or a VPS: set the same variables from `.env` in the host's dashboard, build command `npm install`, start command `npm start`. Product photos uploaded from admin and JSON data files need a persistent disk on the host (otherwise they reset on redeploy).

### Later: mobile app
The API (`/api/...`) is separate from the front-end, so a React Native app can call the same endpoints. Alternatively, wrap the site with Capacitor or a WebView.

### Security notes
Use a strong `ADMIN_PASSWORD`, serve over HTTPS, and never commit `.env`.
