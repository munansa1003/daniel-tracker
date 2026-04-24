import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDnY73MnZviHLP1W-hE7fsamOqL35lpyRc",
  authDomain: "daniel-tracker-cb781.firebaseapp.com",
  projectId: "daniel-tracker-cb781",
  storageBucket: "daniel-tracker-cb781.firebasestorage.app",
  messagingSenderId: "418220594110",
  appId: "1:418220594110:web:9304a8af3673a917939fef"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
