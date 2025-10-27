import { db, auth } from "../models/firebase.js";
import { collection, doc, getDoc, setDoc, updateDoc, query, where, getDocs } from "firebase/firestore";
import bcrypt from "bcrypt";
import { authAdmin, adminAvailable } from "../models/firebaseAdmin.js";
import { createUserWithEmailAndPassword } from "firebase/auth";

export const registerUser = async (req, res) => {
  const { name, email, password, rfid, section, year, contact } = req.body;
  // If registering as admin, use a special RFID or email (for demo, use 'admin@xianfire.com')
  const role = email === "admin@xianfire.com" ? "admin" : "user";
  try {
    // Basic validation
    if (!name || !email || !password || !rfid) {
      return res.redirect("/register?error=" + encodeURIComponent("Missing required fields"));
    }

    // Check if user with same RFID or email already exists
    const rfidRef = doc(db, "students", rfid);
    const existing = await getDoc(rfidRef);
    if (existing.exists()) {
      return res.redirect("/register?error=" + encodeURIComponent("RFID already registered"));
    }

    // Also check by email
    const q = query(collection(db, "students"), where("email", "==", email));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      return res.redirect("/register?error=" + encodeURIComponent("Email already registered"));
    }

    // Create Auth user first (prefer Admin SDK which allows setting uid to RFID)
    let createdAuthUser = null;
    if (adminAvailable && authAdmin) {
      try {
        createdAuthUser = await authAdmin.createUser({ uid: rfid, email, password, displayName: name });
      } catch (err) {
        console.error("Admin createUser failed, will attempt client SDK fallback:", err);
        createdAuthUser = null;
      }
    }

    // Fallback: try client SDK createUser if admin wasn't available or failed
    if (!createdAuthUser) {
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        createdAuthUser = { uid: userCredential.user.uid, email: userCredential.user.email };
      } catch (err) {
        console.error("Client createUser failed:", err);
        return res.redirect("/register?error=" + encodeURIComponent("Failed to create authentication user. Configure firebase-admin or check Firebase project settings."));
      }
    }

    // Hash password for Firestore record
    const saltRounds = 10;
    const hashed = await bcrypt.hash(password, saltRounds);

    // Save user in Firestore under document id == rfid
    try {
      await setDoc(rfidRef, {
        name,
        email,
        rfid,
        section: section || null,
        year: year || null,
        contact: contact || null,
        passwordHash: hashed,
        authUid: createdAuthUser.uid,
        points: 100,
        lastUsed: null,
        role
      });
    } catch (err) {
      console.error("Failed to save Firestore doc after creating auth user:", err);
      // If we created the auth user with Admin SDK using RFID as uid, try to rollback
      if (adminAvailable && authAdmin && createdAuthUser && createdAuthUser.uid === rfid) {
        try {
          await authAdmin.deleteUser(createdAuthUser.uid);
          console.log("Rolled back auth user due to Firestore save failure:", createdAuthUser.uid);
        } catch (delErr) {
          console.error("Failed to rollback created auth user:", delErr);
        }
      }
      return res.redirect("/register?error=" + encodeURIComponent("Failed to save user data, please try again."));
    }

    res.redirect("/login?success=1");
  } catch (err) {
    console.error("Register error:", err);
    res.redirect("/register?error=" + encodeURIComponent(err.message || "Registration failed"));
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    // Find user by email
    const q = query(collection(db, "students"), where("email", "==", email));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      return res.redirect("/login?error=" + encodeURIComponent("Invalid email or password"));
    }

    let userDoc = null;
    querySnapshot.forEach(docSnap => { userDoc = { id: docSnap.id, ...docSnap.data() }; });

    if (!userDoc) {
      return res.redirect("/login?error=" + encodeURIComponent("Invalid email or password"));
    }

    const match = await bcrypt.compare(password, userDoc.passwordHash || "");
    if (!match) {
      return res.redirect("/login?error=" + encodeURIComponent("Invalid email or password"));
    }

    // Authenticated
  req.session.userId = userDoc.id;
  req.session.rfid = userDoc.rfid;
  req.session.role = userDoc.role || "user";
  req.session.email = userDoc.email;
  req.session.isAuthenticated = true;
  // Set session duration (24 hours)
  if (req.session.cookie) req.session.cookie.maxAge = 24 * 60 * 60 * 1000;
    if (req.session.role === "admin") {
      res.redirect("/admin-dashboard");
    } else {
      res.redirect("/user-dashboard");
    }
  } catch (err) {
    console.error("Login error:", err);
    res.redirect("/login?error=" + encodeURIComponent(err.message || "Login failed"));
  }
};

export const getStudentByRFID = async (req, res) => {
  const { rfid } = req.params;
  try {
    const docRef = doc(db, "students", rfid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      res.json(docSnap.data());
    } else {
      res.status(404).json({ error: "Student not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const addPoints = async (req, res) => {
  const { rfid, points } = req.body;
  try {
    const docRef = doc(db, "students", rfid);
    await updateDoc(docRef, { points });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
