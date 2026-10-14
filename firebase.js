// ============================================================================
// FIREBASE.JS — KONFIGURASI & JEMBATAN CLOUD (FIRESTORE + REALTIME DB + AUTH)
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  collection
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
  getDatabase,
  ref as dbRef,
  set as dbSet,
  remove as dbRemove,
  onValue
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

// Konfigurasi Resmi Firebase Web App (viperstudio)
export const firebaseConfig = {
  apiKey: "AIzaSyAUXh8GjYo_UAlTfmY04qn1kdHJaCxLNwY",
  authDomain: "viperstudio.firebaseapp.com",
  databaseURL: "https://viperstudio-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "viperstudio",
  storageBucket: "viperstudio.firebasestorage.app",
  messagingSenderId: "810644102921",
  appId: "1:810644102921:web:5a70b76f7c9424ad053dd8",
  measurementId: "G-FFG1EMPQ82"
};

// Inisialisasi Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

// Inisialisasi Analytics secara aman (jika didukung browser)
export let analytics = null;
isSupported()
  .then((yes) => {
    if (yes) analytics = getAnalytics(app);
  })
  .catch(() => {});

const APP_ID_SLUG = typeof __app_id !== "undefined" ? __app_id : "portal-kelas-utama";
const FIRESTORE_MAIN_DOC = doc(db, "artifacts", APP_ID_SLUG, "public", "data", "portal_kelas_store", "main_state");
const RTDB_MAIN_PATH = `portal_kelas/${APP_ID_SLUG}/main_state`;
const RTDB_ADMINS_PATH = `portal_kelas/${APP_ID_SLUG}/admins`;

/**
 * Normalisasi dokumen akun pengurus dari Firestore / Realtime DB
 */
export function parseAdminRecord(id, data) {
  if (!data) return null;
  const rawUser = String(data.username || data.email || id || "").trim().toLowerCase();
  if (!rawUser) return null;
  const emailVal = rawUser.includes("@") ? rawUser : `${rawUser}@kelas.id`;
  const passVal = String(data.password ?? data.pin ?? data.pass ?? "");
  
  return {
    id: data.id || id || Date.now(),
    username: rawUser,
    email: emailVal,
    password: passVal,
    name: data.name || data.nama || (rawUser.startsWith("admin") ? "Administrator Utama" : rawUser),
    role: data.role || data.jabatan || "Super Admin",
    isSuperAdmin: Boolean(data.isSuperAdmin ?? true),
    permissions: Array.isArray(data.permissions) ?
      data.permissions :
      ["keuangan", "siswa", "info", "jadwal", "album", "akun", "pengaturan"]
  };
}

/**
 * Mengaktifkan sesi anonim awal & mendengarkan perubahan data real-time
 * dari Realtime Database & Cloud Firestore
 */
export async function initCloudSynchronization({ onStateReceived, onAdminsReceived }) {
  try {
    if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
      await signInWithCustomToken(auth, __initial_auth_token);
    } else if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
  } catch (e) {
    // Lanjutkan meskipun anonymous auth dibatasi
  }
  
  // 1. Listener Utama: Firebase Realtime Database (Mendukung foto ukuran besar tanpa batas 1MB)
  try {
    const mainRtdbRef = dbRef(rtdb, RTDB_MAIN_PATH);
    onValue(mainRtdbRef, (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.val();
        if (val && val.payload) {
          try {
            const parsed = typeof val.payload === "string" ? JSON.parse(val.payload) : val.payload;
            onStateReceived(parsed, "rtdb");
          } catch (err) {}
        }
      }
    }, () => {});
  } catch (err) {}
  
  // 2. Listener Cadangan: Cloud Firestore
  try {
    onSnapshot(FIRESTORE_MAIN_DOC, (snapshot) => {
      if (snapshot.exists()) {
        const cloudData = snapshot.data();
        if (cloudData && cloudData.payload) {
          try {
            const parsed = JSON.parse(cloudData.payload);
            onStateReceived(parsed, "firestore");
          } catch (err) {}
        }
      }
    }, () => {});
  } catch (err) {}
  
  // 3. Listener Koleksi Akun Admin di Realtime Database
  try {
    const adminsRtdbRef = dbRef(rtdb, RTDB_ADMINS_PATH);
    onValue(adminsRtdbRef, (snapshot) => {
      if (snapshot.exists()) {
        const rawObj = snapshot.val() || {};
        const list = [];
        Object.keys(rawObj).forEach((k) => {
          const parsed = parseAdminRecord(k, rawObj[k]);
          if (parsed) list.push(parsed);
        });
        if (list.length > 0) onAdminsReceived(list, "rtdb");
      }
    }, () => {});
  } catch (err) {}
  
  // 4. Listener Koleksi Akun Admin di Firestore (Path Artifacts & Root Collections)
  try {
    const artifactsAdminCol = collection(db, "artifacts", APP_ID_SLUG, "public", "data", "admins");
    onSnapshot(artifactsAdminCol, (snap) => {
      const list = [];
      snap.forEach((d) => {
        const parsed = parseAdminRecord(d.id, d.data());
        if (parsed) list.push(parsed);
      });
      onAdminsReceived(list, "firestore-artifacts");
    }, () => {});
  } catch (err) {}
  
  ["admins", "admin", "users"].forEach((colName) => {
    try {
      const colRef = collection(db, colName);
      onSnapshot(colRef, (snap) => {
        const list = [];
        snap.forEach((d) => {
          const parsed = parseAdminRecord(d.id, d.data());
          if (parsed) list.push(parsed);
        });
        if (list.length > 0) onAdminsReceived(list, `firestore-${colName}`);
      }, () => {});
    } catch (err) {}
  });
}

/**
 * Menyimpan seluruh state aplikasi ke Realtime Database & Cloud Firestore
 */
export async function savePortalStateToCloud(appData, actorUsername = "admin") {
  const timestamp = new Date().toISOString();
  const serialized = JSON.stringify(appData);
  let savedSuccess = false;
  
  // 1. Simpan ke Realtime Database (Prioritas utama karena mendukung foto tanpa batas 1MB)
  try {
    await dbSet(dbRef(rtdb, RTDB_MAIN_PATH), {
      payload: serialized,
      updatedAt: timestamp,
      updatedBy: actorUsername
    });
    savedSuccess = true;
  } catch (rtdbErr) {}
  
  // 2. Simpan ke Cloud Firestore (Jika ukuran payload masih di bawah batas dokumen Firestore ~950KB)
  try {
    if (serialized.length < 950000) {
      await setDoc(FIRESTORE_MAIN_DOC, {
        payload: serialized,
        updatedAt: timestamp,
        updatedBy: actorUsername
      });
      savedSuccess = true;
    }
  } catch (fsErr) {}
  
  return savedSuccess;
}

/**
 * Menyimpan akun pengurus ke Firestore & Realtime Database
 */
export async function saveAdminAccountToCloud(accountObj) {
  const safeKey = String(accountObj.username).toLowerCase().replace(/[.#$/[\]]/g, "_");
  try {
    await dbSet(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`), accountObj);
  } catch (e) {}
  
  try {
    await setDoc(doc(db, "artifacts", APP_ID_SLUG, "public", "data", "admins", accountObj.username), accountObj);
  } catch (e) {}
}

/**
 * Menghapus akun pengurus secara permanen dari Firestore & Realtime Database
 */
export async function deleteAdminAccountFromCloud(username) {
  const cleanUser = String(username).trim().toLowerCase();
  const safeKey = cleanUser.replace(/[.#$/[\]]/g, "_");
  
  try {
    await dbRemove(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`));
  } catch (e) {}
  
  try {
    await deleteDoc(doc(db, "artifacts", APP_ID_SLUG, "public", "data", "admins", cleanUser));
  } catch (e) {}
  
  ["admins", "admin", "users"].forEach(async (colName) => {
    try {
      await deleteDoc(doc(db, colName, cleanUser));
    } catch (e) {}
  });
}

/**
 * Login menggunakan Firebase Authentication (Email & Password)
 */
export async function loginWithFirebaseAuth(email, password) {
  return await signInWithEmailAndPassword(auth, email, password);
}

/**
 * Logout dari sesi Firebase Authentication
 */
export async function logoutFirebaseSession() {
  try {
    await signOut(auth);
    await signInAnonymously(auth);
  } catch (e) {}
}