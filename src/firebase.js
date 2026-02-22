import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBogBZWVh7YxtW2W8SBtayUq6fZY6NOOkk",
  authDomain: "dnd-companion-59f98.firebaseapp.com",
  projectId: "dnd-companion-59f98",
  storageBucket: "dnd-companion-59f98.firebasestorage.app",
  messagingSenderId: "444941586076",
  appId: "1:444941586076:web:14ab4c73e7b9d7d9c7e759"
};

const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);
export const auth = getAuth(app);