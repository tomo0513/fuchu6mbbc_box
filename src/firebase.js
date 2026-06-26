import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAJ512cWwu01JSR7X0qYxF7dUJQWRtnUaM",
  authDomain: "furoku-basketball.firebaseapp.com",
  projectId: "furoku-basketball",
  storageBucket: "furoku-basketball.firebasestorage.app",
  messagingSenderId: "845634120975",
  appId: "1:845634120975:web:a439ee6ee6455456e6627a"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export async function loadData() {
  const ref = doc(db, "app", "data");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data().payload : null;
}

export async function saveData(data) {
  const ref = doc(db, "app", "data");
  await setDoc(ref, { payload: data });
}