const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { one, query } = require('../db');
const { sign, requireAuth, audit, setMediaCookie, clearMediaCookie } = require('../auth');
const { ah, str, bad, forbid } = require('../util');
const { registrationEnabled } = require('../settings');

// Hanya percobaan GAGAL yang dihitung, per IP + email. Peserta di satu Wi-Fi (satu IP) tidak saling memblokir.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.LOGIN_RATE_LIMIT || '10', 10),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String((req.body && req.body.email) || '').toLowerCase().trim()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login gagal untuk akun ini. Coba lagi dalam 15 menit.' },
});
// Pembatas kasar per IP untuk menahan tebak password massal ke banyak akun.
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.LOGIN_IP_RATE_LIMIT || '200', 10),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login gagal dari jaringan ini. Coba lagi nanti.' },
});

router.post(
  '/login',
  loginIpLimiter,
  loginLimiter,
  ah(async (req, res) => {
    const email = str(req.body.email, { required: true, name: 'Email' }).toLowerCase();
    const password = String(req.body.password || '');
    const user = await one('SELECT * FROM users WHERE email=$1', [email]);
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      // catat percobaan gagal agar admin bisa melacak masalah login / percobaan tebak password
      await audit(req, 'login_failed', 'user', user ? user.id : null, {
        email,
        reason: !user ? 'email_tidak_terdaftar' : !user.is_active ? 'akun_nonaktif' : 'password_salah',
      });
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    await query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
    req.user = user;
    await audit(req, 'login', 'user', user.id);
    setMediaCookie(req, res, user);
    res.json({
      token: sign(user),
      user: { id: user.id, email: user.email, name: user.name, role: user.role, organization: user.organization },
    });
  })
);

router.get(
  '/config',
  ah(async (req, res) => {
    // daftar akun demo di halaman login hanya tampil bila akun demo memang ada dan aktif
    const demo = await one(`SELECT 1 FROM users WHERE email='fasilitator@ttx.local' AND is_active`);
    res.json({ registration: await registrationEnabled(), demo: !!demo });
  })
);

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: parseInt(process.env.REGISTER_RATE_LIMIT || '200', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak pendaftaran dari alamat ini. Coba lagi nanti.' },
});

router.post(
  '/register',
  registerLimiter,
  ah(async (req, res) => {
    if (!(await registrationEnabled())) forbid('Pendaftaran mandiri dinonaktifkan. Hubungi admin.');
    const name = str(req.body.name, { required: true, name: 'Nama', max: 120 });
    const email = str(req.body.email, { required: true, name: 'Email', max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Format email tidak valid');
    const password = String(req.body.password || '');
    if (password.length < 8) bad('Password minimal 8 karakter');
    const organization = str(req.body.organization, { max: 200 });
    if (await one('SELECT 1 FROM users WHERE email=$1', [email])) bad('Email sudah terdaftar');
    // Pendaftar selalu menjadi peserta (player); peran lain hanya diberikan admin.
    const user = await one(
      `INSERT INTO users(email, name, password_hash, role, organization, last_login_at) VALUES ($1,$2,$3,'player',$4, now())
       RETURNING id, email, name, role, organization`,
      [email, name, await bcrypt.hash(password, 10), organization]
    );
    req.user = user;
    await audit(req, 'register', 'user', user.id);
    setMediaCookie(req, res, user);
    res.status(201).json({ token: sign(user), user });
  })
);

router.get('/me', requireAuth, (req, res) => {
  setMediaCookie(req, res, req.user);
  res.json({ user: req.user });
});

router.post('/logout', (req, res) => {
  clearMediaCookie(res);
  res.json({ ok: true });
});

router.post(
  '/password',
  requireAuth,
  ah(async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!new_password || String(new_password).length < 8) bad('Password baru minimal 8 karakter');
    const user = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(String(current_password || ''), user.password_hash))) bad('Password saat ini salah');
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(String(new_password), 10), req.user.id]);
    await audit(req, 'change_password', 'user', req.user.id);
    res.json({ ok: true });
  })
);

router.put(
  '/profile',
  requireAuth,
  ah(async (req, res) => {
    const name = str(req.body.name, { required: true, name: 'Nama', max: 120 });
    const organization = str(req.body.organization, { max: 200 });
    const u = await one(
      'UPDATE users SET name=$1, organization=$2 WHERE id=$3 RETURNING id, email, name, role, organization',
      [name, organization, req.user.id]
    );
    res.json({ user: u });
  })
);

module.exports = router;
