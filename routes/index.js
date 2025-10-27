import express from "express";
import { homePage } from "../controllers/homeController.js";
import { adminDashboard, chargingStation } from "../controllers/adminController.js";
import { registerUser, loginUser, getStudentByRFID, addPoints } from "../controllers/firebaseController.js";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../models/firebase.js";

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

// Show login/register first
// Redirect root to login or to dashboard if already authenticated
router.get("/", (req, res) => {
  if (req.session && req.session.userId) {
    // send to role-specific dashboard
    if (req.session.role === "admin") return res.redirect('/admin-dashboard');
    return res.redirect('/user-dashboard');
  }
  res.redirect('/login');
});

// Middleware: prevent authenticated users from seeing login/register pages
function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    if (req.session.role === 'admin') return res.redirect('/admin-dashboard');
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

// Forgot password API
router.post("/api/send-reset", async (req, res) => {
  const { email } = req.body;
  try {
    await sendPasswordResetEmail(auth, email);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Protected routes
router.get("/home", requireLogin, homePage);
router.get("/admin-dashboard", requireLogin, (req, res) => res.render("admin-dashboard.xian"));
router.get("/charging-station", requireLogin, chargingStation);
router.get("/student-points", requireLogin, (req, res) => res.render("student-points.xian"));
router.get("/sections", requireLogin, (req, res) => res.render("sections.xian"));
router.get("/user-dashboard", requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta http-equiv='refresh' content='0; url=/user-dashboard-page'></head><body><script>localStorage.setItem('rfid', '${req.session.rfid || ''}');</script></body></html>`);
});
router.get("/user-dashboard-page", requireLogin, (req, res) => res.render("user-dashboard.xian"));

// Firebase endpoints
router.get("/api/student/:rfid", getStudentByRFID);
router.post("/api/add-points", addPoints);

export default router;
