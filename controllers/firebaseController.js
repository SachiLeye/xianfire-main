import { db, auth } from "../models/firebase.js";
import { collection, doc, getDoc, setDoc, updateDoc, query, where, getDocs } from "firebase/firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

export const registerUser = async (req, res) => {
  const { name, email, password, rfid } = req.body;
  // If registering as admin, use a special RFID or email (for demo, use 'admin@xianfire.com')
  const role = email === "admin@xianfire.com" ? "admin" : "user";
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    await setDoc(doc(db, "students", rfid), {
      name,
      email,
      rfid,
      points: 100,
      lastUsed: null,
      role
    });
    res.redirect("/login?success=1");
  } catch (err) {
    res.redirect("/register?error=" + encodeURIComponent(err.message));
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    req.session.userId = userCredential.user.uid;
    // Find user role from Firestore
    const q = query(collection(db, "students"), where("email", "==", email));
    const querySnapshot = await getDocs(q);
    let role = "user";
    let rfid = "";
    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      role = data.role || "user";
      rfid = data.rfid;
    });
    req.session.rfid = rfid;
    req.session.role = role;
    if (role === "admin") {
      res.redirect("/admin-dashboard");
    } else {
      res.redirect("/user-dashboard");
    }
  } catch (err) {
    res.redirect("/login?error=" + encodeURIComponent(err.message));
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
