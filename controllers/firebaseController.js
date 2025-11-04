import { db, auth } from "../models/firebase.js";
import { collection, doc, getDoc, setDoc, updateDoc, query, where, getDocs } from "firebase/firestore";
import bcrypt from "bcrypt";
import { authAdmin, adminAvailable } from "../models/firebaseAdmin.js";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { TransactionModel } from "../models/transactionModel.js";

export const registerUser = async (req, res) => {
  const { name, email, password, rfid, section, year, contact } = req.body;
  // All users have 'user' role
  const role = "user";
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
  // Always redirect to user dashboard
  res.redirect("/user-dashboard");
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

export const getCurrentStudent = async (req, res) => {
  try {
    const rfid = req.session && req.session.rfid;
    if (!rfid) return res.status(401).json({ error: 'Not authenticated' });
    const docRef = doc(db, 'students', rfid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return res.json(docSnap.data());
    }
    return res.status(404).json({ error: 'Student not found' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

// ============ TRANSACTION ENDPOINTS ============

/**
 * Start a new charging session (create transaction)
 */
export const startChargingSession = async (req, res) => {
  try {
    const { rfid, pointsToSpend, socketType, socketNumber } = req.body;

    // Validate required fields
    if (!rfid || !pointsToSpend || !socketType || !socketNumber) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields" 
      });
    }

    // Get student data
    const studentRef = doc(db, "students", rfid);
    const studentDoc = await getDoc(studentRef);

    if (!studentDoc.exists()) {
      return res.status(404).json({ 
        success: false, 
        error: "Student not found" 
      });
    }

    const studentData = studentDoc.data();

    // Check if there's already an active transaction
    const activeTransaction = await TransactionModel.getActiveTransaction(rfid);
    if (activeTransaction) {
      return res.status(400).json({ 
        success: false, 
        error: "You already have an active charging session" 
      });
    }

    // Calculate expected end time (120 seconds per point = 2 minutes per point)
    const durationSeconds = pointsToSpend * 120;
    const expectedEndTime = new Date(Date.now() + durationSeconds * 1000);

    // Create transaction
    const transactionId = await TransactionModel.createTransaction({
      rfid,
      studentName: studentData.name,
      email: studentData.email,
      pointsToSpend,
      socketType,
      socketNumber,
      expectedEndTime
    });

    // Get updated student data
    const updatedStudentDoc = await getDoc(studentRef);
    const updatedStudentData = updatedStudentDoc.data();

    res.json({ 
      success: true, 
      transactionId,
      remainingPoints: updatedStudentData.points,
      expectedDuration: durationSeconds,
      message: "Charging session started successfully"
    });
  } catch (err) {
    console.error("Error starting charging session:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};

/**
 * Stop/Complete a charging session
 */
export const stopChargingSession = async (req, res) => {
  try {
    const { transactionId, status } = req.body;

    if (!transactionId) {
      return res.status(400).json({ 
        success: false, 
        error: "Transaction ID is required" 
      });
    }

    const finalStatus = status === "cancelled" ? "cancelled" : "completed";

    const updatedTransaction = await TransactionModel.completeTransaction(
      transactionId, 
      finalStatus
    );

    // Get updated student data
    const studentRef = doc(db, "students", updatedTransaction.rfid);
    const studentDoc = await getDoc(studentRef);
    const studentData = studentDoc.data();

    res.json({ 
      success: true, 
      transaction: updatedTransaction,
      remainingPoints: studentData.points,
      message: `Charging session ${finalStatus} successfully`
    });
  } catch (err) {
    console.error("Error stopping charging session:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};

/**
 * Get student's transaction history
 */
export const getStudentTransactionHistory = async (req, res) => {
  try {
    const rfid = req.params.rfid || req.session?.rfid;

    if (!rfid) {
      return res.status(401).json({ 
        success: false, 
        error: "Not authenticated" 
      });
    }

    const transactions = await TransactionModel.getStudentTransactions(rfid);
    const stats = await TransactionModel.getStudentStats(rfid);

    res.json({ 
      success: true, 
      transactions,
      stats
    });
  } catch (err) {
    console.error("Error getting transaction history:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};

/**
 * Get active charging session for a student
 */
export const getActiveChargingSession = async (req, res) => {
  try {
    const rfid = req.params.rfid || req.session?.rfid;

    if (!rfid) {
      return res.status(401).json({ 
        success: false, 
        error: "Not authenticated" 
      });
    }

    const activeTransaction = await TransactionModel.getActiveTransaction(rfid);

    res.json({ 
      success: true, 
      activeTransaction
    });
  } catch (err) {
    console.error("Error getting active session:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};

/**
 * Get all transactions (admin only)
 */
export const getAllTransactions = async (req, res) => {
  try {
    // Check if user is admin
    if (req.session?.role !== "admin") {
      return res.status(403).json({ 
        success: false, 
        error: "Unauthorized - Admin access required" 
      });
    }

    const limit = parseInt(req.query.limit) || 100;
    const transactions = await TransactionModel.getAllTransactions(limit);

    res.json({ 
      success: true, 
      transactions
    });
  } catch (err) {
    console.error("Error getting all transactions:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};
