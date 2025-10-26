import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC5r-Qmo8VevrWXAAe2hrMQG0nCmqaaJjg",
  authDomain: "xianfire-integ-project.firebaseapp.com",
  projectId: "xianfire-integ-project",
  storageBucket: "xianfire-integ-project.firebasestorage.app",
  messagingSenderId: "89575172145",
  appId: "1:89575172145:web:a0b08c139ae05988910d10",
  measurementId: "G-RSWTX7BTHT"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);