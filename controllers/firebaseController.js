import { db } from "../models/firebase.js";
import { collection, doc, getDoc, setDoc, updateDoc, query, where, getDocs } from "firebase/firestore";
import bcrypt from "bcrypt";

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

    // Hash password
    const saltRounds = 10;
    const hashed = await bcrypt.hash(password, saltRounds);

    // Save user in Firestore under document id == rfid
    await setDoc(rfidRef, {
      name,
      email,
      rfid,
      section: section || null,
      year: year || null,
      contact: contact || null,
      passwordHash: hashed,
      points: 100,
      lastUsed: null,
      role
    });

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
