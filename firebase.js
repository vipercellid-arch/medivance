// ============================================================================
// FIREBASE.JS — MESIN SINKRONISASI CLOUD REAL-TIME MULTI-DEVICE (MEDIVANCE)
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

// Inisialisasi Layanan Utama Firebase
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

// Kunci ID Seragam agar seluruh perangkat (HP/Tablet/Laptop) membaca & menulis ke titik yang sama
const APP_ID_SLUG = "portal-kelas-utama";

// Jalur Penyimpanan Cloud Firestore (Root & Artifacts)
const FS_ROOT_MAIN_DOC = doc(db, "portal_kelas_store", "main_state");
const FS_ROOT_CHUNKS_COL = ["portal_kelas_chunks"];
const FS_ART_MAIN_DOC = doc(db, "artifacts", APP_ID_SLUG, "public", "data", "portal_kelas_store", "main_state");
const FS_ART_CHUNKS_COL = ["artifacts", APP_ID_SLUG, "public", "data", "portal_kelas_chunks"];
const FS_ART_ADMINS_COL = ["artifacts", APP_ID_SLUG, "public", "data", "admins"];

// Jalur Penyimpanan Firebase Realtime Database (Asia-Southeast1)
const RTDB_MAIN_PATH = `portal_kelas/${APP_ID_SLUG}/main_state`;
const RTDB_ADMINS_PATH = `portal_kelas/${APP_ID_SLUG}/admins`;

// Batas aman per chunk dokumen Firestore (650 KB agar di bawah batas 1 MB Firestore)
const CHUNK_SIZE_LIMIT = 650000;

// Pelacak revisi terakhir agar tidak terjadi duplikasi render di perangkat yang sama
let lastDeliveredRevision = "";
let hasLoadedNonEmptyData = false;

/**
 * Menghitung kelengkapan isi data untuk mencegah state kosong menimpa state yang sudah berisi data
 */
export function calculateDataRichness(stateObj) {
    if (!stateObj || typeof stateObj !== "object") return 0;
    const stuCount = Array.isArray(stateObj.students) ? stateObj.students.length : 0;
    const txCount = Array.isArray(stateObj.transactions) ? stateObj.transactions.length : 0;
    const annCount = Array.isArray(stateObj.announcements) ? stateObj.announcements.length : 0;
    const albCount = Array.isArray(stateObj.albums) ? stateObj.albums.length : 0;
    const noteCount = Array.isArray(stateObj.stickyNotes) ? stateObj.stickyNotes.length : 0;
    const arcCount = Array.isArray(stateObj.archives) ? stateObj.archives.length : 0;
    const attCount = stateObj.attendance && typeof stateObj.attendance === "object"
        ? Object.keys(stateObj.attendance).length
        : 0;
    const holCount = Array.isArray(stateObj.config?.holidays) ? stateObj.config.holidays.length : 0;

    return (
        stuCount * 10 +
        txCount * 5 +
        annCount * 5 +
        albCount * 5 +
        noteCount * 2 +
        arcCount * 15 +
        attCount * 3 +
        holCount * 2
    );
}

/**
 * Meneruskan pembaruan state ke tampilan web secara real-time
 */
function deliverRealtimeState(onStateReceived, stateObj, updatedAt, source) {
    if (!stateObj || typeof stateObj !== "object") return;

    const incomingRichness = calculateDataRichness(stateObj);
    const revKey = `${updatedAt || "no-ts"}_${incomingRichness}`;

    // Cegah jalur yang masih kosong menimpa data yang sudah terisi di layar
    if (hasLoadedNonEmptyData && incomingRichness === 0 && !updatedAt) {
        return;
    }

    if (incomingRichness > 0) {
        hasLoadedNonEmptyData = true;
    }

    if (updatedAt && revKey === lastDeliveredRevision) {
        return;
    }

    lastDeliveredRevision = revKey;
    onStateReceived(stateObj, updatedAt || new Date().toISOString(), source);
}

/**
 * Normalisasi data akun pengurus beserta Hak Akses Bertingkat (Granular RBAC)
 */
export function parseAdminRecord(id, data) {
    if (!data || typeof data !== "object") return null;
    const rawUser = String(data.username || data.email || id || "").trim().toLowerCase();
    if (!rawUser) return null;

    const emailVal = rawUser.includes("@") ? rawUser : `${rawUser}@kelas.id`;
    const passVal = String(data.password ?? data.pin ?? data.pass ?? "");
    const isSuper = Boolean(
        data.isSuperAdmin ??
        (Array.isArray(data.permissions) && data.permissions.includes("akun"))
    );

    const defaultSuperPerms = [
        "beranda",
        "keuangan",
        "atur_periode_kas",
        "absensi",
        "siswa",
        "info",
        "jadwal",
        "album",
        "akun",
        "pengaturan"
    ];

    let perms = Array.isArray(data.permissions) ? [...data.permissions] : (isSuper ? defaultSuperPerms : ["beranda"]);
    if (!perms.includes("beranda")) perms.unshift("beranda");
    if (isSuper) perms = defaultSuperPerms;

    return {
        id: data.id || id || Date.now(),
        username: rawUser,
        email: emailVal,
        password: passVal,
        name: data.name || data.nama || (rawUser.startsWith("admin") ? "Administrator Utama" : rawUser),
        role: data.role || data.jabatan || (isSuper ? "Super Admin" : "Pengurus Kelas"),
        isSuperAdmin: isSuper,
        permissions: perms
    };
}

/**
 * Mencoba mengaktifkan sesi anonim jika tersedia di Firebase Auth,
 * namun TIDAK menghalangi pengunjung publik apabila Anonymous Auth dimatikan
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
    } catch (e) {
        // Tetap lanjutkan akses publik tanpa sesi login
    }
}

/**
 * Menyatukan kembali dokumen pecahan (chunks) dari Cloud Firestore
 */
async function assembleChunksFromPath(colPathArray, totalChunks) {
    try {
        const promises = [];
        for (let i = 0; i < totalChunks; i++) {
            promises.push(getDoc(doc(db, ...colPathArray, `chunk_${i}`)));
        }
        const snaps = await Promise.all(promises);
        let fullStr = "";
        for (let i = 0; i < snaps.length; i++) {
            if (!snaps[i].exists()) return null;
            fullStr += snaps[i].data().data || "";
        }
        return JSON.parse(fullStr);
    } catch (e) {
        return null;
    }
}

/**
 * Mengurai snapshot dokumen utama Firestore (baik mode tunggal maupun multi-chunk)
 */
async function parseFirestoreSnapshot(snapshot, chunkColPath) {
    if (!snapshot || !snapshot.exists()) return null;
    const data = snapshot.data();
    if (!data) return null;
    try {
        if (data.isChunked && data.totalChunks > 0) {
            const parsed = await assembleChunksFromPath(chunkColPath, data.totalChunks);
            if (parsed) return { state: parsed, updatedAt: data.updatedAt || "" };
        } else if (data.payload) {
            const parsed = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
            if (parsed) return { state: parsed, updatedAt: data.updatedAt || "" };
        }
    } catch (e) {}
    return null;
}

/**
 * Menarik data paling mutakhir dari seluruh jalur Firebase saat perangkat baru membuka web
 */
export async function fetchInitialPortalStateFromCloud() {
    await ensureAuthReady();
    const candidates = [];

    // 1. Tarik dari Firebase Realtime Database
    try {
        const rtSnap = await dbGet(dbRef(rtdb, RTDB_MAIN_PATH));
        if (rtSnap.exists()) {
            const val = rtSnap.val();
            if (val && val.payload) {
                const parsed = typeof val.payload === "string" ? JSON.parse(val.payload) : val.payload;
                candidates.push({
                    state: parsed,
                    updatedAt: val.updatedAt || "1970-01-01T00:00:00.000Z",
                    richness: calculateDataRichness(parsed),
                    source: "rtdb-init"
                });
            }
        }
    } catch (e) {}

    // 2. Tarik dari Firestore Root Collection
    try {
        const rootSnap = await getDoc(FS_ROOT_MAIN_DOC);
        const res = await parseFirestoreSnapshot(rootSnap, FS_ROOT_CHUNKS_COL);
        if (res && res.state) {
            candidates.push({
                state: res.state,
                updatedAt: res.updatedAt || "1970-01-01T00:00:00.000Z",
                richness: calculateDataRichness(res.state),
                source: "fs-root-init"
            });
        }
    } catch (e) {}

    // 3. Tarik dari Firestore Artifacts Collection
    try {
        const artSnap = await getDoc(FS_ART_MAIN_DOC);
        const res = await parseFirestoreSnapshot(artSnap, FS_ART_CHUNKS_COL);
        if (res && res.state) {
            candidates.push({
                state: res.state,
                updatedAt: res.updatedAt || "1970-01-01T00:00:00.000Z",
                richness: calculateDataRichness(res.state),
                source: "fs-art-init"
            });
        }
    } catch (e) {}

    if (candidates.length === 0) return null;

    // Utamakan yang memiliki timestamp terbaru; jika sama, pilih yang datanya paling lengkap
    candidates.sort((a, b) => {
        if (b.richness > 0 && a.richness === 0) return 1;
        if (a.richness > 0 && b.richness === 0) return -1;
        const timeCmp = String(b.updatedAt).localeCompare(String(a.updatedAt));
        if (timeCmp !== 0) return timeCmp;
        return b.richness - a.richness;
    });

    return candidates[0];
}

/**
 * Mengambil seluruh daftar akun pengurus langsung dari server Firebase
 */
export async function fetchAllAdminsFromCloud() {
    await ensureAuthReady();
    const collected = [];

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

    try {
        const snap = await getDocs(collection(db, ...FS_ART_ADMINS_COL));
        snap.forEach((d) => {
            const parsed = parseAdminRecord(d.id, d.data());
            if (parsed) collected.push(parsed);
        });
    } catch (e) {}

    for (const colName of ["admins", "admin", "users"]) {
        try {
            const snap = await getDocs(collection(db, colName));
            snap.forEach((d) => {
                const parsed = parseAdminRecord(d.id, d.data());
                if (parsed) collected.push(parsed);
            });
        } catch (e) {}
    }

    return collected;
}

/**
 * Mengaktifkan Listener Real-Time agar setiap perubahan di Panel Admin
 * langsung mengubah tampilan di semua HP/Perangkat tanpa perlu refresh
 */
export async function initCloudSynchronization({ onStateReceived, onAdminsReceived, onConnectionStatus }) {
    await ensureAuthReady();

    // 1. Ambil state awal yang paling lengkap terlebih dahulu
    try {
        const initial = await fetchInitialPortalStateFromCloud();
        if (initial && initial.state) {
            if (onConnectionStatus) onConnectionStatus(true);
            deliverRealtimeState(onStateReceived, initial.state, initial.updatedAt, initial.source);
        }
    } catch (e) {}

    // 2. Listener Real-Time: Firebase Realtime Database
    try {
        onValue(
            dbRef(rtdb, RTDB_MAIN_PATH),
            (snapshot) => {
                if (!snapshot.exists()) return;
                if (onConnectionStatus) onConnectionStatus(true);
                const val = snapshot.val();
                if (val && val.payload) {
                    try {
                        const parsed = typeof val.payload === "string" ? JSON.parse(val.payload) : val.payload;
                        deliverRealtimeState(onStateReceived, parsed, val.updatedAt || "", "rtdb-live");
                    } catch (err) {}
                }
            },
            (err) => {
                console.warn("RTDB Live Listener:", err?.message || err);
            }
        );
    } catch (e) {}

    // 3. Listener Real-Time: Firestore Root Document
    try {
        onSnapshot(
            FS_ROOT_MAIN_DOC,
            async (snap) => {
                const res = await parseFirestoreSnapshot(snap, FS_ROOT_CHUNKS_COL);
                if (res && res.state) {
                    if (onConnectionStatus) onConnectionStatus(true);
                    deliverRealtimeState(onStateReceived, res.state, res.updatedAt, "fs-root-live");
                }
            },
            () => {}
        );
    } catch (e) {}

    // 4. Listener Real-Time: Firestore Artifacts Document
    try {
        onSnapshot(
            FS_ART_MAIN_DOC,
            async (snap) => {
                const res = await parseFirestoreSnapshot(snap, FS_ART_CHUNKS_COL);
                if (res && res.state) {
                    if (onConnectionStatus) onConnectionStatus(true);
                    deliverRealtimeState(onStateReceived, res.state, res.updatedAt, "fs-art-live");
                }
            },
            () => {}
        );
    } catch (e) {}

    // 5. Listener Real-Time: Koleksi Akun Pengurus
    try {
        onValue(
            dbRef(rtdb, RTDB_ADMINS_PATH),
            (snapshot) => {
                if (!snapshot.exists()) return;
                const rawObj = snapshot.val() || {};
                const list = [];
                Object.keys(rawObj).forEach((k) => {
                    const parsed = parseAdminRecord(k, rawObj[k]);
                    if (parsed) list.push(parsed);
                });
                onAdminsReceived(list, "rtdb-admins");
            },
            () => {}
        );
    } catch (e) {}

    try {
        onSnapshot(
            collection(db, ...FS_ART_ADMINS_COL),
            (snap) => {
                const list = [];
                snap.forEach((d) => {
                    const parsed = parseAdminRecord(d.id, d.data());
                    if (parsed) list.push(parsed);
                });
                onAdminsReceived(list, "fs-art-admins");
            },
            () => {}
        );
    } catch (e) {}

    ["admins", "admin"].forEach((colName) => {
        try {
            onSnapshot(
                collection(db, colName),
                (snap) => {
                    const list = [];
                    snap.forEach((d) => {
                        const parsed = parseAdminRecord(d.id, d.data());
                        if (parsed) list.push(parsed);
                    });
                    if (list.length > 0) onAdminsReceived(list, `fs-${colName}`);
                },
                () => {}
            );
        } catch (e) {}
    });
}

/**
 * Helper menulis ke satu jalur Firestore (otomatis memecah dokumen menjadi chunks jika > 650 KB)
 */
async function writeToFirestorePath(mainDocRef, chunkColPath, serialized, timestamp, actorUsername) {
    if (serialized.length <= CHUNK_SIZE_LIMIT) {
        await setDoc(mainDocRef, {
            isChunked: false,
            totalChunks: 1,
            payload: serialized,
            updatedAt: timestamp,
            updatedBy: actorUsername
        });
    } else {
        const chunks = [];
        for (let i = 0; i < serialized.length; i += CHUNK_SIZE_LIMIT) {
            chunks.push(serialized.slice(i, i + CHUNK_SIZE_LIMIT));
        }
        await Promise.all(
            chunks.map((chunkStr, idx) =>
                setDoc(doc(db, ...chunkColPath, `chunk_${idx}`), {
                    index: idx,
                    data: chunkStr,
                    updatedAt: timestamp
                })
            )
        );
        await setDoc(mainDocRef, {
            isChunked: true,
            totalChunks: chunks.length,
            payload: "",
            updatedAt: timestamp,
            updatedBy: actorUsername
        });
    }
}

/**
 * Menyimpan seluruh state aplikasi secara paralel ke Realtime Database & Cloud Firestore
 */
export async function savePortalStateToCloud(appData, actorUsername = "admin") {
    await ensureAuthReady();
    const timestamp = new Date().toISOString();
    const richness = calculateDataRichness(appData);
    lastDeliveredRevision = `${timestamp}_${richness}`;
    if (richness > 0) hasLoadedNonEmptyData = true;

    const serialized = JSON.stringify(appData);

    const results = await Promise.allSettled([
        dbSet(dbRef(rtdb, RTDB_MAIN_PATH), {
            payload: serialized,
            updatedAt: timestamp,
            updatedBy: actorUsername
        }),
        writeToFirestorePath(FS_ROOT_MAIN_DOC, FS_ROOT_CHUNKS_COL, serialized, timestamp, actorUsername),
        writeToFirestorePath(FS_ART_MAIN_DOC, FS_ART_CHUNKS_COL, serialized, timestamp, actorUsername)
    ]);

    const anySucceeded = results.some((r) => r.status === "fulfilled");
    return { ok: anySucceeded, updatedAt: timestamp };
}

/**
 * Menyimpan atau memperbarui akun pengurus langsung ke seluruh jalur Firebase
 */
export async function saveAdminAccountToCloud(accountObj) {
    await ensureAuthReady();
    const cleanUser = String(accountObj.username).trim().toLowerCase();
    const safeKey = cleanUser.replace(/[.#$/[\]]/g, "_");

    await Promise.allSettled([
        dbSet(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`), accountObj),
        setDoc(doc(db, ...FS_ART_ADMINS_COL, cleanUser), accountObj),
        setDoc(doc(db, "admins", cleanUser), accountObj)
    ]);
}

/**
 * Menghapus akun pengurus secara permanen dari seluruh jalur Firebase
 */
export async function deleteAdminAccountFromCloud(username) {
    await ensureAuthReady();
    const cleanUser = String(username).trim().toLowerCase();
    const safeKey = cleanUser.replace(/[.#$/[\]]/g, "_");

    await Promise.allSettled([
        dbRemove(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`)),
        deleteDoc(doc(db, ...FS_ART_ADMINS_COL, cleanUser)),
        deleteDoc(doc(db, "admins", cleanUser)),
        deleteDoc(doc(db, "admin", cleanUser))
    ]);
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