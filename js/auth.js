/**
 * TraktiRie Auth — Supabase Auth (session) + Turso profile (via /api/profile)
 * Semua fungsi login/signup/session sekarang ASYNC (return Promise) karena
 * beneran manggil server, bukan localStorage lagi.
 *
 * Butuh dimuat setelah: supabase-js CDN, js/backend-config.js, js/backend-client.js
 */

function _client() {
  return window.TraktiRieBackend.client;
}

async function getSession() {
  const { data } = await _client().auth.getSession();
  return data ? data.session : null;
}

/** Ambil profil creator (username, displayName, bio, role, dst) dari Turso. */
async function getUser() {
  const session = await getSession();
  if (!session) return null;
  try {
    const { profile } = await window.TraktiRieBackend.apiFetch('/api/profile');
    return profile;
  } catch (e) {
    return null;
  }
}

async function isLoggedIn() {
  return !!(await getSession());
}

/** Dipanggil di awal halaman yang butuh login. Redirect kalau belum login. */
async function requireAuth(redirectTo = '/login.html') {
  if (!(await isLoggedIn())) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

async function logout() {
  await _client().auth.signOut();
  window.location.href = '/index.html';
}

/**
 * Login dengan email ATAU username + password.
 * @returns {Promise<{ success: boolean, message?: string, user?: object }>}
 */
async function login(id, password) {
  let email = (id || '').trim();
  if (!email) return { success: false, message: 'Enter email or username first.' };

  if (!email.includes('@')) {
    // input berupa username → cari email-nya lewat profil publik
    try {
      const { profile } = await window.TraktiRieBackend.apiFetch(
        '/api/profile?username=' + encodeURIComponent(email.replace(/^@/, ''))
      );
      if (!profile) return { success: false, message: 'Account not found. Please sign up first.' };
      email = profile.email;
    } catch (e) {
      return { success: false, message: 'Account not found. Please sign up first.' };
    }
  }

  const { data, error } = await _client().auth.signInWithPassword({ email, password });
  if (error) {
    const msg = /invalid/i.test(error.message) ? 'Wrong email/username or password.' : error.message;
    return { success: false, message: msg };
  }
  const user = await getUser();
  return { success: true, user };
}

/**
 * Signup creator baru. Username harus unik (dicek dulu ke Turso sebelum
 * membuat akun Supabase, biar tidak ada akun "yatim" kalau ternyata dipakai).
 */
async function signup({ username, email, password, displayName }) {
  const cleanUser = (username || '').trim().replace(/^@/, '').toLowerCase();
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!cleanUser || cleanUser.length < 3) return { success: false, message: 'Username must be at least 3 characters.' };
  if (!/^[a-z0-9_]+$/.test(cleanUser)) return { success: false, message: 'Username can only contain letters, numbers, and underscore.' };
  if (!cleanEmail || !cleanEmail.includes('@')) return { success: false, message: 'Invalid email.' };
  if (!password || password.length < 6) return { success: false, message: 'Password must be at least 6 characters.' };

  try {
    const { profile } = await window.TraktiRieBackend.apiFetch('/api/profile?username=' + encodeURIComponent(cleanUser));
    if (profile) return { success: false, message: 'Username is already taken.' };
  } catch (e) { /* tidak ketemu = aman, lanjut */ }

  const { data, error } = await _client().auth.signUp({
    email: cleanEmail,
    password,
    options: { data: { username: cleanUser, displayName: displayName || cleanUser } }
  });
  if (error) {
    const msg = /already registered|already exists/i.test(error.message) ? 'Email is already in use.' : error.message;
    return { success: false, message: msg };
  }
  if (!data.session) {
    // Project Supabase masih "Confirm email: ON" — lihat SETUP.md untuk mematikannya,
    // karena app ini sudah punya alur verifikasi OTP sendiri sebelum sampai sini.
    return { success: false, message: 'Signup requires email confirmation from Supabase. Turn off "Confirm email" in the Supabase Dashboard (see SETUP.md).' };
  }
  const user = await getUser(); // auto-create row profil di Turso
  return { success: true, user };
}

async function updateProfile(updates) {
  try {
    const { profile } = await window.TraktiRieBackend.apiFetch('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    return { success: true, user: profile };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** Lookup profil publik creator lain (untuk halaman shop/linkbio/support). */
async function getProfileByUsername(username) {
  try {
    const { profile } = await window.TraktiRieBackend.apiFetch('/api/profile?username=' + encodeURIComponent(username));
    return profile;
  } catch (e) {
    return null;
  }
}

/* ============================================================
 * Social login — real Supabase OAuth (redirect flow)
 * ============================================================ */

const OAUTH_CONFIG = {
  google: { enabled: true, label: 'Google' },
  github: { enabled: true, label: 'GitHub' },
  x: { enabled: true, label: 'X' },
  tiktok: { enabled: false, label: 'TikTok' } // Supabase Auth belum dukung TikTok secara native
};

const SUPABASE_PROVIDER_MAP = { google: 'google', github: 'github', x: 'twitter' };

/**
 * Redirect browser ke halaman login provider. Setelah sukses, Supabase
 * otomatis balikin session ke halaman redirectTo — tinggal panggil getUser().
 */
async function loginWithSocial(provider) {
  const cfg = OAUTH_CONFIG[provider];
  if (!cfg || !cfg.enabled) {
    return { success: false, message: (cfg ? cfg.label : provider) + ' is not supported yet. Enable the provider first in Supabase Dashboard → Authentication → Providers.' };
  }
  const { error } = await _client().auth.signInWithOAuth({
    provider: SUPABASE_PROVIDER_MAP[provider],
    options: { redirectTo: window.location.origin + '/dashboard.html' }
  });
  if (error) return { success: false, message: error.message };
  return { success: true, redirecting: true };
}

/* ============================================================
 * Email OTP + Cloudflare Turnstile helpers
 * (tetap lokal — ini cuma gate UI sebelum signup, bukan data sensitif)
 * ============================================================ */

const OTP_KEY = 'sw_otp_pending';

function getSecurityConfig() {
  if (window.TraktiRieSecurity && TraktiRieSecurity.SECURITY_CONFIG) {
    return TraktiRieSecurity.SECURITY_CONFIG;
  }
  return {
    turnstile: { enabled: true, siteKey: '', theme: 'dark', size: 'normal' },
    emailOtp: { enabled: true, codeLength: 6, expiryMinutes: 10, maxAttempts: 5, provider: 'demo', emailjs: {} }
  };
}

function generateOtpCode(length) {
  const len = Math.max(4, Math.min(8, length || 6));
  let code = '';
  for (let i = 0; i < len; i++) code += Math.floor(Math.random() * 10);
  return code;
}

async function sendEmailOTP(email, username) {
  const cfg = getSecurityConfig().emailOtp;
  if (!cfg.enabled) return { success: true, message: 'OTP dimatikan.', skip: true };
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) return { success: false, message: 'Invalid email.' };

  const code = generateOtpCode(cfg.codeLength);
  const expires = Date.now() + (cfg.expiryMinutes || 10) * 60 * 1000;
  const pending = { email: cleanEmail, username: username || '', code, expires, attempts: 0, createdAt: Date.now() };
  try {
    localStorage.setItem(OTP_KEY, JSON.stringify(pending));
  } catch (e) {
    return { success: false, message: 'Failed to save OTP.' };
  }

  if (cfg.provider === 'emailjs' && cfg.emailjs && cfg.emailjs.publicKey) {
    try {
      if (typeof emailjs === 'undefined') return { success: false, message: 'EmailJS SDK is not loaded.' };
      if (!cfg.emailjs.serviceId || !cfg.emailjs.templateId) return { success: false, message: 'EmailJS serviceId / templateId is not set.' };
      emailjs.init(cfg.emailjs.publicKey);
      const displayName = username || cleanEmail.split('@')[0];
      const appName = cfg.appName || 'TraktiRie';
      const expiryMin = cfg.expiryMinutes || 10;
      const fill = (str) => String(str || '')
        .replace(/\{\{otp_code\}\}/g, code)
        .replace(/\{\{username\}\}/g, displayName)
        .replace(/\{\{app_name\}\}/g, appName)
        .replace(/\{\{expiry_minutes\}\}/g, String(expiryMin))
        .replace(/\{\{to_email\}\}/g, cleanEmail);
      const subject = fill(cfg.subject || 'Verification Code ' + appName + ' — ' + code);
      const message = fill(cfg.message || 'Use the code below to verify your email.');
      await emailjs.send(cfg.emailjs.serviceId, cfg.emailjs.templateId, {
        to_email: cleanEmail, otp_code: code, username: displayName, app_name: appName,
        subject, message, expiry_minutes: String(expiryMin)
      });
      return { success: true, message: 'Verification code sent to ' + cleanEmail };
    } catch (err) {
      const detail = (err && err.text) ? err.text : (err && err.message) ? err.message : '';
      return { success: false, message: 'Failed to send email. ' + (detail || 'Check EmailJS config & connection.') };
    }
  }

  console.log('[TraktiRie OTP DEMO] Kode untuk', cleanEmail, '→', code);
  return { success: true, message: 'Verification code (demo mode): ' + code, code, demo: true };
}

function verifyEmailOTP(email, inputCode) {
  const cfg = getSecurityConfig().emailOtp;
  if (!cfg.enabled) return { success: true, skip: true };
  const cleanEmail = (email || '').trim().toLowerCase();
  const code = String(inputCode || '').trim();
  let pending;
  try {
    pending = JSON.parse(localStorage.getItem(OTP_KEY) || 'null');
  } catch {
    pending = null;
  }
  if (!pending || pending.email !== cleanEmail) return { success: false, message: 'No active code. Please resend first.' };
  if (Date.now() > pending.expires) {
    localStorage.removeItem(OTP_KEY);
    return { success: false, message: 'Code has expired. Please resend.' };
  }
  if (pending.attempts >= (cfg.maxAttempts || 5)) {
    localStorage.removeItem(OTP_KEY);
    return { success: false, message: 'Terlalu banyak percobaan. Send ulang kode.' };
  }
  if (pending.code !== code) {
    pending.attempts = (pending.attempts || 0) + 1;
    localStorage.setItem(OTP_KEY, JSON.stringify(pending));
    return { success: false, message: 'Kode salah. Sisa percobaan: ' + ((cfg.maxAttempts || 5) - pending.attempts) };
  }
  localStorage.removeItem(OTP_KEY);
  return { success: true, message: 'Email verified.' };
}

function clearPendingOTP() {
  try { localStorage.removeItem(OTP_KEY); } catch (e) {}
}

function isTurnstileEnabled() {
  const cfg = getSecurityConfig().turnstile;
  return !!(cfg && cfg.enabled && cfg.siteKey && String(cfg.siteKey).trim());
}

function getTurnstileToken() {
  if (!isTurnstileEnabled()) return 'demo_pass';
  if (typeof turnstile === 'undefined') return null;
  try {
    return turnstile.getResponse() || null;
  } catch (e) {
    return null;
  }
}

function resetTurnstile() {
  if (!isTurnstileEnabled()) return;
  if (typeof turnstile === 'undefined') return;
  try { turnstile.reset(); } catch (e) {}
}

/** Signup setelah OTP custom lolos (dipanggil oleh signup.html). */
async function signupVerified(data) {
  const result = await signup(data);
  if (result.success) clearPendingOTP();
  return result;
}

if (typeof window !== 'undefined') {
  window.SWAuth = {
    getSession, getUser, isLoggedIn, requireAuth, logout,
    login, signup, signupVerified, updateProfile, getProfileByUsername,
    loginWithSocial, OAUTH_CONFIG,
    sendEmailOTP, verifyEmailOTP, clearPendingOTP,
    isTurnstileEnabled, getTurnstileToken, resetTurnstile, getSecurityConfig
  };
}
