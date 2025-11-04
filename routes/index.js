import express from "express";
import { chargingStation } from "../controllers/adminController.js";
import { 
  registerUser, 
  loginUser, 
  getStudentByRFID, 
  addPoints, 
  getCurrentStudent,
  startChargingSession,
  stopChargingSession,
  getStudentTransactionHistory,
  getActiveChargingSession,
  getAllTransactions
} from "../controllers/firebaseController.js";
import { query, where, getDocs } from 'firebase/firestore';
import bcrypt from 'bcrypt';
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../models/firebase.js";
import nodemailer from 'nodemailer';
import { authAdmin, adminAvailable } from '../models/firebaseAdmin.js';
import { db } from '../models/firebase.js';
import { doc, setDoc, getDoc, updateDoc, collection } from 'firebase/firestore';

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

// Show RFID scanning page as landing page
router.get("/", (req, res) => {
  // Always show the RFID scanning index page first
  res.render('index.xian');
});

// Middleware: prevent authenticated users from seeing login/register pages
function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/user-dashboard');
  }
  next();
}

// Session status endpoint for client-side checks
router.get('/api/session', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.userId), role: req.session?.role || null });
});

// Auth routes
router.get("/login", redirectIfAuthenticated, (req, res) => {
  // prevent caching of login page so browser back button will revalidate session
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  return res.render("login.xian");
});
router.post("/login", loginUser);
router.get("/register", redirectIfAuthenticated, (req, res) => {
  // prevent caching of register page so browser back button will revalidate session
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  return res.render("register.xian");
});
router.post("/register", registerUser);
router.get("/logout", (req, res) => {
  // Properly destroy the session and clear the cookie, then redirect.
  req.session.destroy(err => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.redirect('/login');
    }
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});
router.get("/forgot-password", (req, res) => res.render("forgotpassword.xian"));
router.get('/verify-code', (req, res) => res.render('verify-code.xian'));
router.get('/reset-password', (req, res) => res.render('reset-password.xian'));

// Forgot password API
router.post("/api/send-reset", async (req, res) => {
  const { email } = req.body;
  try {
    // If Admin SDK is available and SMTP settings provided, generate a password reset link and email it.
    if (adminAvailable && authAdmin && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const link = await authAdmin.generatePasswordResetLink(email);
      // send email via nodemailer
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'Password reset for XianFire',
        html: `<p>Click the link below to reset your password:</p><p><a href="${link}">${link}</a></p>`
      });
      console.log('Password reset email sent:', info.messageId);
      return res.json({ success: true });
    }

    // Fallback: use client SDK sendPasswordResetEmail which uses Firebase's email templates
    await sendPasswordResetEmail(auth, email);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// OTP endpoints
router.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email required' });
  try {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes
    const otpRef = doc(db, 'otps', email);
    await setDoc(otpRef, { code, expiresAt, verified: false, createdAt: Date.now() });

    // send email via SMTP if configured
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'Your XianFire OTP',
        html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`
      });
    } else if (adminAvailable && authAdmin) {
      // If admin is available but no SMTP, we could generate a link — but for OTP we log it.
      console.log('OTP for', email, code);
    } else {
      console.log('OTP for', email, code);
    }

    const resp = { success: true };
    // In development you can opt-in to receive the OTP in the JSON response (useful for testing)
    if (process.env.DEV_SHOW_OTP === 'true') resp.devOtp = code;
    return res.json(resp);
  } catch (err) {
    console.error('send-otp error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/verify-otp', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ success: false, error: 'Email and code required' });
  try {
    const otpRef = doc(db, 'otps', email);
    const snap = await getDoc(otpRef);
    if (!snap.exists()) return res.status(400).json({ success: false, error: 'No OTP found' });
    const data = snap.data();
    if (data.verified) return res.status(400).json({ success: false, error: 'OTP already used' });
    if (Date.now() > (data.expiresAt || 0)) return res.status(400).json({ success: false, error: 'OTP expired' });
    if (data.code !== code.toString()) return res.status(400).json({ success: false, error: 'Invalid code' });

    await updateDoc(otpRef, { verified: true, verifiedAt: Date.now() });
    return res.json({ success: true });
  } catch (err) {
    console.error('verify-otp error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Protected routes
router.get("/charging-station", requireLogin, chargingStation);
router.get("/transaction-history", requireLogin, (req, res) => {
  res.render("transaction-history");
});
router.get("/user-dashboard", requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta http-equiv='refresh' content='0; url=/user-dashboard-page'></head><body><script>localStorage.setItem('rfid', '${req.session.rfid || ''}');</script></body></html>`);
});
router.get("/user-dashboard-page", requireLogin, async (req, res) => {
  try {
    const rfid = req.session && req.session.rfid;
    if (!rfid) return res.redirect('/login');
    const docRef = doc(db, 'students', rfid);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      return res.render("user-dashboard", { student: null });
    }
    const student = docSnap.data();
    return res.render("user-dashboard", { student });
  } catch (err) {
    console.error('Error loading user dashboard:', err);
    return res.render("user-dashboard", { student: null, error: err.message });
  }
});

// Firebase endpoints
router.get("/api/student/:rfid", getStudentByRFID);
router.post("/api/add-points", addPoints);
router.get('/api/me', requireLogin, getCurrentStudent);

// Transaction endpoints
router.post('/api/transactions/start', requireLogin, startChargingSession);
router.post('/api/transactions/stop', requireLogin, stopChargingSession);
router.get('/api/transactions/history/:rfid?', requireLogin, getStudentTransactionHistory);
router.get('/api/transactions/active/:rfid?', requireLogin, getActiveChargingSession);
router.get('/api/transactions/all', requireLogin, getAllTransactions);

// Reset password by email (used after OTP verification)
router.post('/api/reset-password', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, error: 'Missing fields' });
  try {
    // Find student doc by email
    const q = query(collection(db, 'students'), where('email', '==', email));
    const snaps = await getDocs(q);
    if (snaps.empty) return res.status(404).json({ success: false, error: 'User not found' });
    let rfid = null;
    snaps.forEach(s => { rfid = s.id; });
    if (!rfid) return res.status(404).json({ success: false, error: 'User not found' });
    // Verify OTP was validated
    const otpRef = doc(db, 'otps', email);
    const otpSnap = await getDoc(otpRef);
    if (!otpSnap.exists() || !otpSnap.data().verified) {
      return res.status(401).json({ success: false, error: 'OTP not verified' });
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);
    // Update Firestore passwordHash
    const studentRef = doc(db, 'students', rfid);
    await updateDoc(studentRef, { passwordHash: hashed });
    // Also update Firebase Auth password if Admin SDK available
    if (adminAvailable && authAdmin) {
      try {
        // get auth uid from student doc
        const s = await getDoc(studentRef);
        const authUid = s.exists() ? s.data().authUid : null;
        if (authUid) await authAdmin.updateUser(authUid, { password });
      } catch (e) { console.warn('Failed to update auth user password', e); }
    }
  // mark otp used
  try { await updateDoc(otpRef, { usedAt: Date.now() }); } catch (e) { /* ignore */ }
    return res.json({ success: true });
  } catch (err) {
    console.error('reset-password error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
