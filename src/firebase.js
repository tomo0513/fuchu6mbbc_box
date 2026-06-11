import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBwQHXKd6F2eL9lEIuwAff_Z8WYVR8veB0",
  authDomain: "fuchu6mbbc-37e68.firebaseapp.com",
  projectId: "fuchu6mbbc-37e68",
  storageBucket: "fuchu6mbbc-37e68.firebasestorage.app",
  messagingSenderId: "934958575750",
  appId: "1:934958575750:web:162c860dc5e37a430a6107"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TEAM_DOC = "fuchu6mbbc";

export async function loadData() {
  const ref = doc(db, "teams", TEAM_DOC);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data().payload : null;
}

export async function saveData(data) {
  const ref = doc(db, "teams", TEAM_DOC);
  await setDoc(ref, { payload: JSON.stringify(data) });
}
