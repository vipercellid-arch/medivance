// ============================================================================
// FIREBASE.JS — MESIN CLOUD REAL-TIME (AUTO-CHUNKING FIRESTORE + RTDB + AUTH)
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
    getDoc,
    setDoc,
    deleteDoc,
    getDocs,
    onSnapshot,
    collection
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    getDatabase,
    ref as dbRef,
    set as dbSet,
    get as dbGet,
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

export let analytics = null;
isSupported()
    .then((yes) => {
        if (yes) analytics = getAnalytics(app);
    })
    .catch(() => {});

const APP_ID_SLUG = typeof __app_id !== "undefined" ? __app_id : "portal-kelas-utama";

// Path Cloud Firestore
const FIRESTORE_MAIN_DOC = doc(db, "artifacts", APP_ID_SLUG, "public", "data", "portal_kelas_store", "main_state");
const FIRESTORE_CHUNKS_COL = ["artifacts", APP_ID_SLUG, "public", "data", "portal_kelas_chunks"];
const FIRESTORE_ADMINS_COL = ["artifacts", APP_ID_SLUG, "public", "data", "admins"];

// Path Realtime Database
const RTDB_MAIN_PATH = `portal_kelas/${APP_ID_SLUG}/main_state`;
const RTDB_ADMINS_PATH = `portal_kelas/${APP_ID_SLUG}/admins`;

// Ukuran maksimum per dokumen chunk Firestore (700 KB agar selalu aman di bawah batas 1 MB)
const CHUNK_SIZE_LIMIT = 700000;

/**
 * Normalisasi objek akun pengurus dari database
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
        permissions: Array.isArray(data.permissions)
            ? data.permissions
            : ["keuangan", "absensi", "siswa", "info", "jadwal", "album", "akun", "pengaturan"]
    };
}

/**
 * Mengambil dan menyatukan dokumen chunk dari Firestore jika data berukuran besar
 */
async function assembleFirestoreChunks(totalChunks) {
    const promises = [];
    for (let i = 0; i < totalChunks; i++) {
        const chunkRef = doc(db, ...FIRESTORE_CHUNKS_COL, `chunk_${i}`);
        promises.push(getDoc(chunkRef));
    }
    const snapshots = await Promise.all(promises);
    let fullString = "";
    for (let i = 0; i < snapshots.length; i++) {
        if (!snapshots[i].exists()) return null;
        fullString += snapshots[i].data().data || "";
    }
    return JSON.parse(fullString);
}

/**
 * Memastikan sesi otentikasi aktif sebelum baca/tulis ke Firebase
 */
export async function ensureAuthReady() {
    try {
        if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
            if (!auth.currentUser) {
                await signInWithCustomToken(auth, __initial_auth_token);
            }
        } else if (!auth.currentUser) {
            await signInAnonymously(auth);
        }
    } catch (e) {}
}

/**
 * Membaca seluruh daftar akun admin langsung dari server Firebase (Digunakan saat Login)
 */
export async function fetchAllAdminsFromCloud() {
    await ensureAuthReady();
    const collected = [];

    // 1. Cek dari koleksi Firestore Artifacts
    try {
        const snap = await getDocs(collection(db, ...FIRESTORE_ADMINS_COL));
        snap.forEach((d) => {
            const parsed = parseAdminRecord(d.id, d.data());
            if (parsed) collected.push(parsed);
        });
    } catch (e) {}

    // 2. Cek dari Root Collections di Firestore
    for (const colName of ["admins", "admin", "users"]) {
        try {
            const snap = await getDocs(collection(db, colName));
            snap.forEach((d) => {
                const parsed = parseAdminRecord(d.id, d.data());
                if (parsed) collected.push(parsed);
            });
        } catch (e) {}
    }

    // 3. Cek dari Realtime Database
    try {
        const rtSnap = await dbGet(dbRef(rtdb, RTDB_ADMINS_PATH));
        if (rtSnap.exists()) {
            const rawObj = rtSnap.val() || {};
            Object.keys(rawObj).forEach((k) => {
                const parsed = parseAdminRecord(k, rawObj[k]);
                if (parsed) collected.push(parsed);
            });
        }
    } catch (e) {}

    return collected;
}

/**
 * Inisialisasi Listener Real-Time dari Cloud Firestore & Realtime Database
 */
export async function initCloudSynchronization({ onStateReceived, onAdminsReceived, onConnectionStatus }) {
    await ensureAuthReady();

    // 1. Listener Utama: Cloud Firestore (Mendukung Single Doc & Multi-Chunk Doc)
    try {
        onSnapshot(
            FIRESTORE_MAIN_DOC,
            async (snapshot) => {
                if (onConnectionStatus) onConnectionStatus(true);
                if (!snapshot.exists()) return;
                const cloudData = snapshot.data();
                if (!cloudData) return;

                try {
                    if (cloudData.isChunked && cloudData.totalChunks > 0) {
                        const assembled = await assembleFirestoreChunks(cloudData.totalChunks);
                        if (assembled) {
                            onStateReceived(assembled, cloudData.updatedAt || "", "firestore-chunked");
                        }
                    } else if (cloudData.payload) {
                        const parsed = JSON.parse(cloudData.payload);
                        onStateReceived(parsed, cloudData.updatedAt || "", "firestore");
                    }
                } catch (err) {
                    console.error("Gagal memproses data Firestore:", err);
                }
            },
            (err) => {
                console.warn("Firestore listener warning:", err);
            }
        );
    } catch (err) {}

    // 2. Listener Paralel: Firebase Realtime Database
    try {
        const mainRtdbRef = dbRef(rtdb, RTDB_MAIN_PATH);
        onValue(
            mainRtdbRef,
            (snapshot) => {
                if (snapshot.exists()) {
                    if (onConnectionStatus) onConnectionStatus(true);
                    const val = snapshot.val();
                    if (val && val.payload) {
                        try {
                            const parsed = typeof val.payload === "string" ? JSON.parse(val.payload) : val.payload;
                            onStateReceived(parsed, val.updatedAt || "", "rtdb");
                        } catch (err) {}
                    }
                }
            },
            () => {}
        );
    } catch (err) {}

    // 3. Listener Koleksi Akun Pengurus di Firestore & RTDB
    try {
        const artifactsAdminCol = collection(db, ...FIRESTORE_ADMINS_COL);
        onSnapshot(
            artifactsAdminCol,
            (snap) => {
                const list = [];
                snap.forEach((d) => {
                    const parsed = parseAdminRecord(d.id, d.data());
                    if (parsed) list.push(parsed);
                });
                onAdminsReceived(list, "firestore-artifacts");
            },
            () => {}
        );
    } catch (e) {}

    ["admins", "admin", "users"].forEach((colName) => {
        try {
            const colRef = collection(db, colName);
            onSnapshot(
                colRef,
                (snap) => {
                    const list = [];
                    snap.forEach((d) => {
                        const parsed = parseAdminRecord(d.id, d.data());
                        if (parsed) list.push(parsed);
                    });
                    if (list.length > 0) onAdminsReceived(list, `firestore-${colName}`);
                },
                () => {}
            );
        } catch (e) {}
    });

    try {
        const adminsRtdbRef = dbRef(rtdb, RTDB_ADMINS_PATH);
        onValue(
            adminsRtdbRef,
            (snapshot) => {
                if (snapshot.exists()) {
                    const rawObj = snapshot.val() || {};
                    const list = [];
                    Object.keys(rawObj).forEach((k) => {
                        const parsed = parseAdminRecord(k, rawObj[k]);
                        if (parsed) list.push(parsed);
                    });
                    if (list.length > 0) onAdminsReceived(list, "rtdb");
                }
            },
            () => {}
        );
    } catch (err) {}
}

/**
 * Menyimpan seluruh state aplikasi langsung ke Firebase (Otomatis memecah chunk jika > 700KB)
 */
export async function savePortalStateToCloud(appData, actorUsername = "admin") {
    await ensureAuthReady();
    const timestamp = new Date().toISOString();
    const serialized = JSON.stringify(appData);
    let savedToFirestore = false;
    let savedToRtdb = false;

    // 1. Simpan ke Cloud Firestore (Dengan dukungan Auto-Chunking untuk foto tanpa kompresi)
    try {
        if (serialized.length <= CHUNK_SIZE_LIMIT) {
            await setDoc(FIRESTORE_MAIN_DOC, {
                isChunked: false,
                totalChunks: 1,
                payload: serialized,
                updatedAt: timestamp,
                updatedBy: actorUsername
            });
            savedToFirestore = true;
        } else {
            // Pecah string JSON besar menjadi beberapa chunk @ 700KB
            const chunks = [];
            for (let i = 0; i < serialized.length; i += CHUNK_SIZE_LIMIT) {
                chunks.push(serialized.slice(i, i + CHUNK_SIZE_LIMIT));
            }

            const chunkPromises = chunks.map((chunkStr, idx) => {
                const cRef = doc(db, ...FIRESTORE_CHUNKS_COL, `chunk_${idx}`);
                return setDoc(cRef, {
                    index: idx,
                    data: chunkStr,
                    updatedAt: timestamp
                });
            });
            await Promise.all(chunkPromises);

            // Update dokumen utama sebagai penunjuk chunk
            await setDoc(FIRESTORE_MAIN_DOC, {
                isChunked: true,
                totalChunks: chunks.length,
                payload: "",
                updatedAt: timestamp,
                updatedBy: actorUsername
            });
            savedToFirestore = true;
        }
    } catch (fsErr) {
        console.error("Firestore save error:", fsErr);
    }

    // 2. Simpan juga ke Firebase Realtime Database secara paralel
    try {
        await dbSet(dbRef(rtdb, RTDB_MAIN_PATH), {
            payload: serialized,
            updatedAt: timestamp,
            updatedBy: actorUsername
        });
        savedToRtdb = true;
    } catch (rtdbErr) {}

    return savedToFirestore || savedToRtdb;
}

/**
 * Menyimpan atau memperbarui akun pengurus langsung ke koleksi Firebase
 */
export async function saveAdminAccountToCloud(accountObj) {
    await ensureAuthReady();
    const cleanUser = String(accountObj.username).trim().toLowerCase();
    const safeKey = cleanUser.replace(/[.#$/[\]]/g, "_");

    try {
        await setDoc(doc(db, ...FIRESTORE_ADMINS_COL, cleanUser), accountObj);
    } catch (e) {}

    try {
        await setDoc(doc(db, "admins", cleanUser), accountObj);
    } catch (e) {}

    try {
        await dbSet(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`), accountObj);
    } catch (e) {}
}

/**
 * Menghapus akun pengurus secara permanen dari seluruh koleksi Firebase
 */
export async function deleteAdminAccountFromCloud(username) {
    await ensureAuthReady();
    const cleanUser = String(username).trim().toLowerCase();
    const safeKey = cleanUser.replace(/[.#$/[\]]/g, "_");

    try {
        await deleteDoc(doc(db, ...FIRESTORE_ADMINS_COL, cleanUser));
    } catch (e) {}

    for (const colName of ["admins", "admin", "users"]) {
        try {
            await deleteDoc(doc(db, colName, cleanUser));
        } catch (e) {}
    }

    try {
        await dbRemove(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`));
    } catch (e) {}
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