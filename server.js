const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = 5001;
const JWT_SECRET = 'btcagentic_s3cr3t_k3y_!z9Rp4Nm7Xw2';
const JWT_EXPIRY = '7d';
const DB_PATH = path.join(__dirname, 'bitcoinagentic.db');

const BTC_PRICE_USD = 97500; // Updated periodically in production

const PLANS = {
  basic: {
    name: 'Basic',
    price_cents: 1500,
    price: 15,
    data_gb: 5,
    cashback_pct: 5,
    sats_per_month: Math.round((15 * 0.05) / (BTC_PRICE_USD / 1e8)),
    referral_sats: 5000,
    calls: 'Unlimited',
    texts: 'Unlimited',
  },
  pro: {
    name: 'Pro',
    price_cents: 3000,
    price: 30,
    data_gb: 25,
    cashback_pct: 10,
    sats_per_month: Math.round((30 * 0.10) / (BTC_PRICE_USD / 1e8)),
    referral_sats: 10000,
    calls: 'Unlimited',
    texts: 'Unlimited',
  },
};

const SIGNUP_BONUS_SATS = 1000;
const MIN_WITHDRAWAL_SATS = 10000;

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    phone           TEXT UNIQUE,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    referral_code   TEXT UNIQUE NOT NULL,
    referred_by     TEXT,
    plan            TEXT DEFAULT 'none',
    plan_status     TEXT DEFAULT 'inactive',
    esim_iccid      TEXT,
    esim_status     TEXT DEFAULT 'none',
    sats_balance    INTEGER DEFAULT 0,
    data_used_mb    INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'active',
    role            TEXT DEFAULT 'user',
    created_at      TEXT NOT NULL,
    last_login      TEXT,
    CONSTRAINT valid_plan CHECK (plan IN ('none', 'basic', 'pro'))
  );

  CREATE TABLE IF NOT EXISTS sats_ledger (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount      INTEGER NOT NULL,
    type        TEXT NOT NULL,
    description TEXT NOT NULL,
    reference   TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents      INTEGER NOT NULL,
    currency          TEXT DEFAULT 'USD',
    status            TEXT NOT NULL,
    plan              TEXT NOT NULL,
    billing_period    TEXT NOT NULL,
    sats_earned       INTEGER DEFAULT 0,
    created_at        TEXT NOT NULL,
    paid_at           TEXT
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id              TEXT PRIMARY KEY,
    referrer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT DEFAULT 'pending',
    referrer_sats   INTEGER DEFAULT 0,
    referred_sats   INTEGER DEFAULT 0,
    qualified_at    TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE(referrer_id, referred_id)
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_sats   INTEGER NOT NULL,
    destination   TEXT NOT NULL,
    dest_type     TEXT NOT NULL,
    status        TEXT NOT NULL,
    tx_hash       TEXT,
    fee_sats      INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL,
    completed_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sats_ledger_user ON sats_ledger(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
  CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateReferralCode(name) {
  const clean = (name || 'USER').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${clean}-${suffix}`;
}

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

function creditSats(userId, amount, type, description, reference) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sats_ledger (id, user_id, amount, type, description, reference, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, amount, type, description, reference || null, now);
  db.prepare('UPDATE users SET sats_balance = sats_balance + ? WHERE id = ?').run(amount, userId);
  return id;
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

function seedDatabase() {
  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@bitcoinagentic.com');
  if (adminExists) return;

  const now = new Date().toISOString();
  const adminHash = bcrypt.hashSync('admin123', 10);
  const adminId = uuidv4();

  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, phone, referral_code, plan, plan_status, sats_balance, data_used_mb, status, role, created_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(adminId, 'admin@bitcoinagentic.com', adminHash, 'Admin', '+1-000-000-0000', 'ADMIN-0001', 'pro', 'active', 0, 0, 'active', 'admin', now, now);

  const fakeUsers = [
    { name: 'Marcus Chen',     email: 'marcus.chen@email.com',     phone: '+1-415-555-0142', plan: 'pro' },
    { name: 'Olivia Johnson',  email: 'olivia.johnson@email.com',  phone: '+1-212-555-0198', plan: 'basic' },
    { name: 'Raj Patel',       email: 'raj.patel@email.com',       phone: '+1-305-555-0267', plan: 'pro' },
    { name: 'Sofia Rodriguez', email: 'sofia.rodriguez@email.com', phone: '+1-512-555-0334', plan: 'basic' },
    { name: 'Tyler Brooks',    email: 'tyler.brooks@email.com',    phone: '+1-720-555-0411', plan: 'pro' },
    { name: 'Amina Okafor',    email: 'amina.okafor@email.com',    phone: '+234-801-555-0678', plan: 'basic' },
    { name: 'James Mwangi',    email: 'james.mwangi@email.com',    phone: '+254-722-555-0345', plan: 'pro' },
    { name: 'Lena Schmidt',    email: 'lena.schmidt@email.com',    phone: '+49-151-555-0891', plan: 'basic' },
  ];

  const txTypes = ['cashback', 'referral_bonus', 'signup_bonus'];

  const seedAll = db.transaction(() => {
    const userIds = [];
    for (const fake of fakeUsers) {
      const userId = uuidv4();
      userIds.push(userId);
      const hashedPw = bcrypt.hashSync('password123', 10);
      const refCode = generateReferralCode(fake.name);
      const satsBalance = Math.floor(Math.random() * 60000) + 5000;
      const dataUsed = Math.floor(Math.random() * (PLANS[fake.plan].data_gb * 1024 * 0.8));
      const createdAt = new Date(Date.now() - Math.floor(Math.random() * 90 * 86400000)).toISOString();
      const lastLogin = new Date(Date.now() - Math.floor(Math.random() * 7 * 86400000)).toISOString();

      db.prepare(`
        INSERT INTO users (id, email, password_hash, name, phone, referral_code, plan, plan_status, sats_balance, data_used_mb, status, role, created_at, last_login)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, fake.email, hashedPw, fake.name, fake.phone, refCode, fake.plan, 'active', satsBalance, dataUsed, 'active', 'user', createdAt, lastLogin);

      // Sats ledger entries
      for (let i = 0; i < 5; i++) {
        const type = txTypes[i % txTypes.length];
        const amount = type === 'cashback'
          ? PLANS[fake.plan].sats_per_month + Math.floor(Math.random() * 2000)
          : type === 'referral_bonus'
            ? PLANS[fake.plan].referral_sats
            : SIGNUP_BONUS_SATS;
        const descriptions = {
          cashback: `${new Date(Date.now() - i * 30 * 86400000).toLocaleString('default', { month: 'long' })} plan cashback`,
          referral_bonus: 'Referral bonus - friend joined',
          signup_bonus: 'Welcome bonus',
        };
        const txDate = new Date(Date.now() - i * 30 * 86400000).toISOString();
        db.prepare(`
          INSERT INTO sats_ledger (id, user_id, amount, type, description, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), userId, amount, type, descriptions[type], txDate);
      }

      // Invoices
      for (let i = 0; i < 3; i++) {
        const invoiceDate = new Date(Date.now() - i * 30 * 86400000);
        const period = invoiceDate.toISOString().slice(0, 7);
        db.prepare(`
          INSERT INTO invoices (id, user_id, amount_cents, status, plan, billing_period, sats_earned, created_at, paid_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), userId, PLANS[fake.plan].price_cents, 'paid', fake.plan, period, PLANS[fake.plan].sats_per_month, invoiceDate.toISOString(), invoiceDate.toISOString());
      }
    }

    // Create some referral relationships
    if (userIds.length >= 4) {
      const refNow = new Date().toISOString();
      db.prepare(`
        INSERT INTO referrals (id, referrer_id, referred_id, status, referrer_sats, referred_sats, qualified_at, created_at)
        VALUES (?, ?, ?, 'qualified', ?, ?, ?, ?)
      `).run(uuidv4(), userIds[0], userIds[1], PLANS.pro.referral_sats, SIGNUP_BONUS_SATS, refNow, refNow);
      db.prepare(`
        INSERT INTO referrals (id, referrer_id, referred_id, status, referrer_sats, referred_sats, qualified_at, created_at)
        VALUES (?, ?, ?, 'qualified', ?, ?, ?, ?)
      `).run(uuidv4(), userIds[0], userIds[3], PLANS.pro.referral_sats, SIGNUP_BONUS_SATS, refNow, refNow);
      db.prepare(`
        INSERT INTO referrals (id, referrer_id, referred_id, status, referrer_sats, referred_sats, created_at)
        VALUES (?, ?, ?, 'pending', 0, 0, ?)
      `).run(uuidv4(), userIds[2], userIds[4], refNow);
    }

    // One withdrawal
    if (userIds.length >= 1) {
      db.prepare(`
        INSERT INTO withdrawals (id, user_id, amount_sats, destination, dest_type, status, tx_hash, fee_sats, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), userIds[0], 25000, 'lnbc250n1pj...fake', 'lightning', 'completed', 'txhash_abc123', 10, new Date(Date.now() - 5 * 86400000).toISOString(), new Date(Date.now() - 5 * 86400000).toISOString());
    }
  });

  seedAll();
  console.log('Database seeded with admin + 8 demo users.');
}

seedDatabase();

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.userId = decoded.id;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function verifyAdmin(req, res, next) {
  verifyToken(req, res, () => {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

// Rate limiting (simple in-memory)
const rateLimits = {};
function rateLimit(windowMs, maxReqs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    if (!rateLimits[key]) rateLimits[key] = [];
    rateLimits[key] = rateLimits[key].filter(t => t > now - windowMs);
    if (rateLimits[key].length >= maxReqs) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    rateLimits[key].push(now);
    next();
  };
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

app.post('/api/auth/register', rateLimit(60000, 5), (req, res) => {
  try {
    const { email, password, name, phone, referral_code } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'This email is already registered. Sign in instead?' });
    }

    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();
    const refCode = generateReferralCode(name);

    let referredBy = null;
    if (referral_code) {
      const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referral_code);
      if (referrer) referredBy = referrer.id;
    }

    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, phone, referral_code, referred_by, plan, plan_status, sats_balance, data_used_mb, status, role, created_at, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'none', 'inactive', 0, 0, 'active', 'user', ?, ?)
    `).run(id, email, passwordHash, name, phone || null, refCode, referredBy, now, now);

    // Signup bonus
    creditSats(id, SIGNUP_BONUS_SATS, 'signup_bonus', 'Welcome to Bitcoin Agentic! Here are your first sats.', null);

    // Create referral record if referred
    if (referredBy) {
      db.prepare(`
        INSERT INTO referrals (id, referrer_id, referred_id, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run(uuidv4(), referredBy, id, now);
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const token = generateToken(user);

    res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', rateLimit(60000, 10), (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now, user.id);

    const token = generateToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', verifyToken, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: sanitizeUser(user) });
});

// ---------------------------------------------------------------------------
// Plans (public)
// ---------------------------------------------------------------------------

app.get('/api/plans', (req, res) => {
  res.json({ plans: PLANS, btc_price_usd: BTC_PRICE_USD });
});

// ---------------------------------------------------------------------------
// Plan subscription
// ---------------------------------------------------------------------------

app.post('/api/plans/subscribe', verifyToken, (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Choose basic or pro.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.plan !== 'none' && user.plan_status === 'active') {
      return res.status(400).json({ error: 'You already have an active plan. Use /api/plans/change to switch.' });
    }

    const now = new Date().toISOString();
    const period = now.slice(0, 7);

    db.prepare('UPDATE users SET plan = ?, plan_status = ? WHERE id = ?').run(plan, 'active', req.userId);

    // Create invoice
    const invoiceId = uuidv4();
    db.prepare(`
      INSERT INTO invoices (id, user_id, amount_cents, status, plan, billing_period, sats_earned, created_at, paid_at)
      VALUES (?, ?, ?, 'paid', ?, ?, ?, ?, ?)
    `).run(invoiceId, req.userId, PLANS[plan].price_cents, plan, period, PLANS[plan].sats_per_month, now, now);

    // Credit cashback sats
    creditSats(req.userId, PLANS[plan].sats_per_month, 'cashback', `First month cashback - ${PLANS[plan].name} plan`, invoiceId);

    // Qualify referral if exists
    const pendingRef = db.prepare(`
      SELECT * FROM referrals WHERE referred_id = ? AND status = 'pending'
    `).get(req.userId);
    if (pendingRef) {
      const referrerPlan = db.prepare('SELECT plan FROM users WHERE id = ?').get(pendingRef.referrer_id);
      const referrerSats = PLANS[referrerPlan?.plan || 'basic'].referral_sats;
      db.prepare(`
        UPDATE referrals SET status = 'qualified', referrer_sats = ?, referred_sats = ?, qualified_at = ? WHERE id = ?
      `).run(referrerSats, SIGNUP_BONUS_SATS, now, pendingRef.id);
      creditSats(pendingRef.referrer_id, referrerSats, 'referral_bonus', 'Referral bonus - your friend subscribed!', pendingRef.referred_id);
    }

    // Simulate eSIM
    db.prepare('UPDATE users SET esim_iccid = ?, esim_status = ? WHERE id = ?').run(
      '8901410' + Math.random().toString().slice(2, 15), 'active', req.userId
    );

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    res.json({
      message: `Subscribed to ${PLANS[plan].name} plan! Your first sats have been credited.`,
      user: sanitizeUser(updated),
      plan_details: PLANS[plan],
      invoice_id: invoiceId,
    });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Subscription failed' });
  }
});

app.put('/api/plans/change', verifyToken, (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Choose basic or pro.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.plan === plan) {
      return res.status(400).json({ error: 'You are already on this plan.' });
    }

    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, req.userId);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    res.json({
      message: `Plan changed to ${PLANS[plan].name}. Takes effect next billing cycle.`,
      user: sanitizeUser(updated),
      plan_details: PLANS[plan],
    });
  } catch (err) {
    console.error('Change plan error:', err);
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

app.post('/api/plans/cancel', verifyToken, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.plan === 'none' || user.plan_status !== 'active') {
      return res.status(400).json({ error: 'No active plan to cancel.' });
    }

    db.prepare('UPDATE users SET plan_status = ? WHERE id = ?').run('cancelled', req.userId);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    res.json({
      message: 'Plan cancelled. Your sats balance is available for withdrawal for 90 days.',
      user: sanitizeUser(updated),
    });
  } catch (err) {
    console.error('Cancel plan error:', err);
    res.status(500).json({ error: 'Failed to cancel plan' });
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

app.get('/api/dashboard', verifyToken, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const planDetails = PLANS[user.plan] || null;
    const recentTx = db.prepare(`
      SELECT * FROM sats_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
    `).all(req.userId);

    const currentInvoice = db.prepare(`
      SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(req.userId);

    const referralCount = db.prepare(`
      SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = ? AND status = 'qualified'
    `).get(req.userId).count;

    const satsUsd = (user.sats_balance / 1e8 * BTC_PRICE_USD).toFixed(2);

    res.json({
      user: sanitizeUser(user),
      plan_details: planDetails,
      sats_balance: user.sats_balance,
      sats_usd: satsUsd,
      data_used_mb: user.data_used_mb,
      data_total_mb: planDetails ? planDetails.data_gb * 1024 : 0,
      current_invoice: currentInvoice || null,
      recent_transactions: recentTx,
      referral_count: referralCount,
      btc_price_usd: BTC_PRICE_USD,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

app.get('/api/wallet/balance', verifyToken, (req, res) => {
  const user = db.prepare('SELECT sats_balance FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    sats_balance: user.sats_balance,
    sats_usd: (user.sats_balance / 1e8 * BTC_PRICE_USD).toFixed(2),
    btc_price_usd: BTC_PRICE_USD,
    min_withdrawal: MIN_WITHDRAWAL_SATS,
  });
});

app.get('/api/wallet/history', verifyToken, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const transactions = db.prepare(`
      SELECT * FROM sats_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(req.userId, limit, offset);

    const total = db.prepare('SELECT COUNT(*) AS count FROM sats_ledger WHERE user_id = ?').get(req.userId).count;

    res.json({ transactions, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Wallet history error:', err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

app.post('/api/wallet/withdraw', verifyToken, (req, res) => {
  try {
    const { amount_sats, destination, dest_type } = req.body;
    if (!amount_sats || !destination || !dest_type) {
      return res.status(400).json({ error: 'Amount, destination, and dest_type are required' });
    }
    if (!['lightning', 'onchain'].includes(dest_type)) {
      return res.status(400).json({ error: 'dest_type must be lightning or onchain' });
    }
    if (amount_sats < MIN_WITHDRAWAL_SATS) {
      return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL_SATS} sats` });
    }

    const user = db.prepare('SELECT sats_balance FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.sats_balance < amount_sats) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const withdrawalId = uuidv4();
    const now = new Date().toISOString();
    const fee = dest_type === 'lightning' ? 10 : 500;

    db.prepare(`
      INSERT INTO withdrawals (id, user_id, amount_sats, destination, dest_type, status, fee_sats, created_at)
      VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)
    `).run(withdrawalId, req.userId, amount_sats, destination, dest_type, fee, now);

    creditSats(req.userId, -amount_sats, 'withdrawal', `Withdrawal to ${dest_type} address`, withdrawalId);

    // Simulate completion
    const txHash = 'tx_' + crypto.randomBytes(16).toString('hex');
    db.prepare(`
      UPDATE withdrawals SET status = 'completed', tx_hash = ?, completed_at = ? WHERE id = ?
    `).run(txHash, now, withdrawalId);

    res.json({
      message: 'Withdrawal processing',
      withdrawal: { id: withdrawalId, amount_sats, destination, dest_type, status: 'completed', tx_hash: txHash, fee_sats: fee },
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).json({ error: 'Withdrawal failed' });
  }
});

app.get('/api/wallet/withdraw/:id', verifyToken, (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!w) return res.status(404).json({ error: 'Withdrawal not found' });
  res.json({ withdrawal: w });
});

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

app.get('/api/referrals', verifyToken, (req, res) => {
  try {
    const user = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const referrals = db.prepare(`
      SELECT r.*, u.name AS referred_name, u.plan AS referred_plan
      FROM referrals r
      LEFT JOIN users u ON r.referred_id = u.id
      WHERE r.referrer_id = ?
      ORDER BY r.created_at DESC
    `).all(req.userId);

    const totalEarned = referrals.reduce((sum, r) => sum + r.referrer_sats, 0);
    const qualifiedCount = referrals.filter(r => r.status === 'qualified').length;

    res.json({
      referral_code: user.referral_code,
      referrals,
      total_earned_sats: totalEarned,
      total_referrals: referrals.length,
      qualified_referrals: qualifiedCount,
    });
  } catch (err) {
    console.error('Referrals error:', err);
    res.status(500).json({ error: 'Failed to load referrals' });
  }
});

app.get('/api/referrals/share', verifyToken, (req, res) => {
  const user = db.prepare('SELECT referral_code, name FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const link = `https://69.67.172.182/bitcoinagentic/?ref=${user.referral_code}`;
  res.json({
    referral_code: user.referral_code,
    link,
    message: `I earn Bitcoin just by having a phone plan. Join Bitcoin Agentic with my link and we both get bonus sats: ${link}`,
  });
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

app.get('/api/billing/invoices', verifyToken, (req, res) => {
  try {
    const invoices = db.prepare(`
      SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.userId);
    res.json({ invoices });
  } catch (err) {
    console.error('Invoices error:', err);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

app.get('/api/billing/invoices/:id', verifyToken, (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoice });
});

app.get('/api/billing/upcoming', verifyToken, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user || user.plan === 'none') return res.json({ upcoming: null });
  const plan = PLANS[user.plan];
  const lastInvoice = db.prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.userId);
  const nextDate = lastInvoice
    ? new Date(new Date(lastInvoice.created_at).getTime() + 30 * 86400000).toISOString().slice(0, 10)
    : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  res.json({
    upcoming: {
      amount_cents: plan.price_cents,
      plan: user.plan,
      next_billing_date: nextDate,
      sats_to_earn: plan.sats_per_month,
    },
  });
});

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

app.put('/api/user/profile', verifyToken, (req, res) => {
  try {
    const { name, phone, email } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (email && email !== user.email) {
      const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.userId);
      if (taken) return res.status(409).json({ error: 'Email already in use' });
    }

    db.prepare('UPDATE users SET name = ?, phone = ?, email = ? WHERE id = ?').run(
      name !== undefined ? name : user.name,
      phone !== undefined ? phone : user.phone,
      email !== undefined ? email : user.email,
      req.userId
    );

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

app.get('/api/admin/stats', verifyAdmin, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users WHERE role != ?').get('admin').count;
    const activeUsers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE plan_status = 'active' AND role != 'admin'").get().count;
    const totalRevenueCents = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoices WHERE status = 'paid'").get().total;
    const totalSatsPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM sats_ledger WHERE amount > 0').get().total;
    const totalWithdrawals = db.prepare("SELECT COALESCE(SUM(amount_sats), 0) AS total FROM withdrawals WHERE status = 'completed'").get().total;

    const planBreakdown = db.prepare(`
      SELECT plan, COUNT(*) AS count FROM users WHERE plan_status = 'active' AND role != 'admin' GROUP BY plan
    `).all();

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const newUsersThisMonth = db.prepare('SELECT COUNT(*) AS count FROM users WHERE created_at >= ? AND role != ?').get(monthStart.toISOString(), 'admin').count;

    const totalReferrals = db.prepare("SELECT COUNT(*) AS count FROM referrals WHERE status = 'qualified'").get().count;

    const recentSignups = db.prepare(`
      SELECT id, name, email, plan, plan_status, sats_balance, created_at
      FROM users WHERE role != 'admin'
      ORDER BY created_at DESC LIMIT 5
    `).all();

    res.json({
      totalUsers,
      activeUsers,
      totalRevenueCents,
      totalRevenue: (totalRevenueCents / 100).toFixed(2),
      totalSatsPaid,
      totalWithdrawals,
      planBreakdown,
      newUsersThisMonth,
      totalReferrals,
      recentSignups,
      monthlyRecurringRevenue: (activeUsers * 22.5 * 100).toFixed(0), // Blended avg
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

app.get('/api/admin/users', verifyAdmin, (req, res) => {
  try {
    const search = req.query.search || '';
    const status = req.query.status || '';
    const plan = req.query.plan || '';

    let query = 'SELECT * FROM users WHERE role != ?';
    const params = ['admin'];

    if (search) {
      query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      query += ' AND plan_status = ?';
      params.push(status);
    }
    if (plan) {
      query += ' AND plan = ?';
      params.push(plan);
    }

    query += ' ORDER BY created_at DESC';
    const users = db.prepare(query).all(...params);
    res.json({ users: users.map(sanitizeUser) });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.get('/api/admin/users/:id', verifyAdmin, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const transactions = db.prepare('SELECT * FROM sats_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id);
    const invoices = db.prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
    const referrals = db.prepare(`
      SELECT r.*, u.name AS referred_name FROM referrals r LEFT JOIN users u ON r.referred_id = u.id WHERE r.referrer_id = ?
    `).all(user.id);
    const withdrawals = db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC').all(user.id);

    res.json({
      user: sanitizeUser(user),
      transactions,
      invoices,
      referrals,
      withdrawals,
    });
  } catch (err) {
    console.error('Admin user detail error:', err);
    res.status(500).json({ error: 'Failed to load user details' });
  }
});

app.put('/api/admin/users/:id', verifyAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status, plan, plan_status, sats_adjustment, adjustment_reason } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (status) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
    if (plan) db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, id);
    if (plan_status) db.prepare('UPDATE users SET plan_status = ? WHERE id = ?').run(plan_status, id);

    if (sats_adjustment && adjustment_reason) {
      creditSats(id, sats_adjustment, 'admin_adjustment', adjustment_reason, `admin:${req.userId}`);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/admin/users/:id', verifyAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin user' });

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ message: 'User deleted', id });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/admin/transactions', verifyAdmin, (req, res) => {
  try {
    const transactions = db.prepare(`
      SELECT sl.*, u.email AS user_email, u.name AS user_name
      FROM sats_ledger sl
      LEFT JOIN users u ON sl.user_id = u.id
      ORDER BY sl.created_at DESC
      LIMIT 100
    `).all();
    res.json({ transactions });
  } catch (err) {
    console.error('Admin transactions error:', err);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

app.get('/api/admin/referrals', verifyAdmin, (req, res) => {
  try {
    const referrals = db.prepare(`
      SELECT r.*,
        u1.name AS referrer_name, u1.email AS referrer_email,
        u2.name AS referred_name, u2.email AS referred_email
      FROM referrals r
      LEFT JOIN users u1 ON r.referrer_id = u1.id
      LEFT JOIN users u2 ON r.referred_id = u2.id
      ORDER BY r.created_at DESC
    `).all();
    res.json({ referrals });
  } catch (err) {
    console.error('Admin referrals error:', err);
    res.status(500).json({ error: 'Failed to load referrals' });
  }
});

app.get('/api/admin/withdrawals', verifyAdmin, (req, res) => {
  try {
    const withdrawals = db.prepare(`
      SELECT w.*, u.name AS user_name, u.email AS user_email
      FROM withdrawals w
      LEFT JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC
    `).all();
    res.json({ withdrawals });
  } catch (err) {
    console.error('Admin withdrawals error:', err);
    res.status(500).json({ error: 'Failed to load withdrawals' });
  }
});

app.get('/api/admin/invoices', verifyAdmin, (req, res) => {
  try {
    const invoices = db.prepare(`
      SELECT i.*, u.name AS user_name, u.email AS user_email
      FROM invoices i
      LEFT JOIN users u ON i.user_id = u.id
      ORDER BY i.created_at DESC
      LIMIT 100
    `).all();
    res.json({ invoices });
  } catch (err) {
    console.error('Admin invoices error:', err);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Bitcoin Agentic server running on port ${PORT}`);
  console.log(`Admin: admin@bitcoinagentic.com / admin123`);
});
