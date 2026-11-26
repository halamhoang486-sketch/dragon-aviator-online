const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, 'game.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 1000000,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS tx_rounds (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  bet INTEGER NOT NULL,
  d1 INTEGER NOT NULL,
  d2 INTEGER NOT NULL,
  d3 INTEGER NOT NULL,
  revealed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS aviator_rounds (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  bet INTEGER NOT NULL,
  crash_at REAL NOT NULL,
  started_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  cashed_at REAL,
  payout INTEGER DEFAULT 0
);
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function token() { return crypto.randomBytes(32).toString('hex'); }
function auth(req, res, next) {
  const t = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!t) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`).get(t);
  if (!row) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
  req.user = row; req.token = t; next();
}
function cleanUser(u) { return { username: u.username, balance: u.balance }; }
function adjustBalance(userId, delta) {
  const result = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0').run(delta, userId, delta);
  if (result.changes !== 1) throw new Error('Số dư không đủ.');
  return db.prepare('SELECT balance FROM users WHERE id=?').get(userId).balance;
}
function crashPoint() {
  const r = crypto.randomInt(0, 1000000) / 1000000;
  if (r < 0.12) return 1.00;
  if (r < 0.65) return +(1.15 + crypto.randomInt(0, 2200000) / 1000000).toFixed(2);
  if (r < 0.92) return +(3.0 + crypto.randomInt(0, 6000000) / 1000000).toFixed(2);
  return +(10.0 + crypto.randomInt(0, 25000000) / 1000000).toFixed(2);
}
function currentMultiplier(round) {
  const elapsed = (Date.now() - round.started_at) / 1000;
  const mult = 1 + elapsed * 0.7 + Math.max(0, elapsed - 8) * 0.15;
  return +Math.min(round.crash_at, mult).toFixed(2);
}

app.post('/api/register', (req,res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 3 || username.length > 24) return res.status(400).json({error:'Tên tài khoản 3–24 ký tự.'});
  if (password.length < 4) return res.status(400).json({error:'Mật khẩu tối thiểu 4 ký tự.'});
  const {salt, hash} = hashPassword(password);
  try {
    const info = db.prepare('INSERT INTO users(username,password_hash,salt,balance) VALUES(?,?,?,1000000)').run(username,hash,salt);
    const t = token(); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, info.lastInsertRowid);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    res.json({token:t,user:cleanUser(u)});
  } catch (e) { res.status(409).json({error:'Tên tài khoản này đã có người sử dụng.'}); }
});

app.post('/api/login', (req,res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || !verifyPassword(password,u.salt,u.password_hash)) return res.status(401).json({error:'Sai tên đăng nhập hoặc mật khẩu.'});
  const t=token(); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t,u.id);
  res.json({token:t,user:cleanUser(u)});
});

app.get('/api/me', auth, (req,res)=>res.json({user:cleanUser(req.user)}));
app.post('/api/logout', auth, (req,res)=>{ db.prepare('DELETE FROM sessions WHERE token=?').run(req.token); res.json({ok:true}); });
app.post('/api/free-coins', auth, (req,res)=>{ const balance=adjustBalance(req.user.id,500000); res.json({balance}); });

app.post('/api/tx/start', auth, (req,res)=>{
  const side = req.body.side === 'TAI' ? 'TAI' : req.body.side === 'XIU' ? 'XIU' : null;
  const bet = Math.floor(Number(req.body.bet));
  if (!side || !Number.isFinite(bet) || bet <= 0) return res.status(400).json({error:'Mức đặt không hợp lệ.'});
  try {
    adjustBalance(req.user.id, -bet);
    const d1=crypto.randomInt(1,7), d2=crypto.randomInt(1,7), d3=crypto.randomInt(1,7);
    const id=crypto.randomBytes(12).toString('hex');
    db.prepare('INSERT INTO tx_rounds(id,user_id,side,bet,d1,d2,d3) VALUES(?,?,?,?,?,?,?)').run(id,req.user.id,side,bet,d1,d2,d3);
    const balance=db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance;
    res.json({roundId:id,balance});
  } catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/tx/reveal', auth, (req,res)=>{
  const r=db.prepare('SELECT * FROM tx_rounds WHERE id=? AND user_id=?').get(req.body.roundId,req.user.id);
  if (!r) return res.status(404).json({error:'Không tìm thấy phiên.'});
  if (r.revealed) return res.status(400).json({error:'Phiên đã mở.'});
  const total=r.d1+r.d2+r.d3, winSide=total>=11?'TAI':'XIU';
  let payout=0;
  if(r.side===winSide) payout=Math.floor(r.bet*1.98);
  db.prepare('UPDATE tx_rounds SET revealed=1 WHERE id=?').run(r.id);
  if(payout) adjustBalance(req.user.id,payout);
  const balance=db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance;
  res.json({d1:r.d1,d2:r.d2,d3:r.d3,total,winSide,payout,balance});
});

app.post('/api/aviator/start', auth, (req,res)=>{
  const bet=Math.floor(Number(req.body.bet));
  if(!Number.isFinite(bet)||bet<=0) return res.status(400).json({error:'Mức đặt không hợp lệ.'});
  const existing=db.prepare("SELECT * FROM aviator_rounds WHERE user_id=? AND status='RUNNING'").get(req.user.id);
  if(existing) return res.status(400).json({error:'Bạn đang có một ván Aviator.'});
  try{
    adjustBalance(req.user.id,-bet);
    const id=crypto.randomBytes(12).toString('hex');
    db.prepare('INSERT INTO aviator_rounds(id,user_id,bet,crash_at,started_at) VALUES(?,?,?,?,?)').run(id,req.user.id,bet,crashPoint(),Date.now());
    const balance=db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance;
    res.json({roundId:id,balance});
  }catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/aviator/state/:id', auth, (req,res)=>{
  const r=db.prepare('SELECT * FROM aviator_rounds WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if(!r) return res.status(404).json({error:'Không tìm thấy ván.'});
  if(r.status==='RUNNING'){
    const mult=currentMultiplier(r);
    if(mult>=r.crash_at){db.prepare("UPDATE aviator_rounds SET status='CRASHED' WHERE id=?").run(r.id); return res.json({status:'CRASHED',multiplier:r.crash_at,balance:req.user.balance});}
    return res.json({status:'RUNNING',multiplier:mult});
  }
  res.json({status:r.status,multiplier:r.cashed_at||r.crash_at,payout:r.payout,balance:req.user.balance});
});
app.post('/api/aviator/cashout', auth, (req,res)=>{
  const r=db.prepare("SELECT * FROM aviator_rounds WHERE id=? AND user_id=? AND status='RUNNING'").get(req.body.roundId,req.user.id);
  if(!r) return res.status(400).json({error:'Ván không còn hiệu lực.'});
  const mult=currentMultiplier(r);
  if(mult>=r.crash_at){db.prepare("UPDATE aviator_rounds SET status='CRASHED' WHERE id=?").run(r.id); return res.status(409).json({error:'Máy bay đã rơi.',multiplier:r.crash_at});}
  const payout=Math.floor(r.bet*mult);
  adjustBalance(req.user.id,payout);
  db.prepare("UPDATE aviator_rounds SET status='CASHED',cashed_at=?,payout=? WHERE id=?").run(mult,payout,r.id);
  const balance=db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance;
  res.json({multiplier:mult,payout,balance});
});

app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Dragon Aviator Online: http://localhost:${PORT}`));
