// ============================================================================
// FIREBASE.JS — FAST PARALLEL ANONYMOUS SYNC & MULTI-LAYER ADMIN AUTH
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

const APP_ID_SLUG = "portal-kelas-utama";

// Jalur Penyimpanan Cloud Firestore & Realtime Database
const FS_ROOT_MAIN_DOC = doc(db, "portal_kelas_store", "main_state");
const FS_ROOT_CHUNKS_COL = ["portal_kelas_chunks"];
const FS_ART_MAIN_DOC = doc(db, "artifacts", APP_ID_SLUG, "public", "data", "portal_kelas_store", "main_state");
const FS_ART_CHUNKS_COL = ["artifacts", APP_ID_SLUG, "public", "data", "portal_kelas_chunks"];
const FS_ART_ADMINS_COL = ["artifacts", APP_ID_SLUG, "public", "data", "admins"];

const RTDB_MAIN_PATH = `portal_kelas/${APP_ID_SLUG}/main_state`;
const RTDB_ADMINS_PATH = `portal_kelas/${APP_ID_SLUG}/admins`;

const CHUNK_SIZE_LIMIT = 650000;

let lastDeliveredRevision = "";
let hasLoadedNonEmptyData = false;
let anonymousAuthPromise = null;

/**
 * SINGLETON ANONYMOUS AUTH:
 * Berjalan otomatis di latar belakang untuk mempercepat baca/tulis data publik
 * tanpa memutus sesi jika pengurus sudah login dengan Email/Password.
 */
export function ensureAuthReady() {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    if (anonymousAuthPromise) return anonymousAuthPromise;

    anonymousAuthPromise = (async () => {
        try {
            if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
                const cred = await signInWithCustomToken(auth, __initial_auth_token);
                return cred.user;
            } else {
                const cred = await signInAnonymously(auth);
                return cred.user;
            }
        } catch (e) {
            return null;
        } finally {
            anonymousAuthPromise = null;
        }
    })();

    return anonymousAuthPromise;
}

// Picu koneksi sesi anonim sejak detik pertama file dimuat
ensureAuthReady();

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

function deliverRealtimeState(onStateReceived, stateObj, updatedAt, source) {
    if (!stateObj || typeof stateObj !== "object") return;

    const incomingRichness = calculateDataRichness(stateObj);
    const revKey = `${updatedAt || "no-ts"}_${incomingRichness}`;

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
 * Normalisasi objek akun pengurus dari database
 */
export function parseAdminRecord(id, data) {
    if (!data || typeof data !== "object") return null;
    const rawUser = String(data.username || data.email || id || "").trim().toLowerCase();
    if (!rawUser) return null;

    const emailVal = rawUser.includes("@") ? rawUser : `${rawUser}@kelas.id`;
    const passVal = String(data.password ?? data.pin ?? data.pass ?? "").trim();
    const isSuper = Boolean(
        data.isSuperAdmin ??
        (Array.isArray(data.permissions) && data.permissions.includes("akun")) ??
        rawUser === "admin@kelas.id" ??
        rawUser === "admin"
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
        name: data.name || data.nama || (rawUser.startsWith("admin") ? "Admin Utama Medivance" : rawUser),
        role: data.role || data.jabatan || (isSuper ? "Super Admin" : "Pengurus Kelas"),
        isSuperAdmin: isSuper,
        permissions: perms
    };
}

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
 * Mengambil state terbaru secara paralel dari RTDB & Firestore
 */
export async function fetchInitialPortalStateFromCloud() {
    ensureAuthReady();
    const candidates = [];

    const [rtResult, rootResult, artResult] = await Promise.allSettled([
        dbGet(dbRef(rtdb, RTDB_MAIN_PATH)),
        getDoc(FS_ROOT_MAIN_DOC),
        getDoc(FS_ART_MAIN_DOC)
    ]);

    if (rtResult.status === "fulfilled" && rtResult.value.exists()) {
        const val = rtResult.value.val();
        if (val && val.payload) {
            try {
                const parsed = typeof val.payload === "string" ? JSON.parse(val.payload) : val.payload;
                candidates.push({
                    state: parsed,
                    updatedAt: val.updatedAt || "1970-01-01T00:00:00.000Z",
                    richness: calculateDataRichness(parsed),
                    source: "rtdb-init"
                });
            } catch (e) {}
        }
    }

    if (rootResult.status === "fulfilled") {
        const res = await parseFirestoreSnapshot(rootResult.value, FS_ROOT_CHUNKS_COL);
        if (res && res.state) {
            candidates.push({
                state: res.state,
                updatedAt: res.updatedAt || "1970-01-01T00:00:00.000Z",
                richness: calculateDataRichness(res.state),
                source: "fs-root-init"
            });
        }
    }

    if (artResult.status === "fulfilled") {
        const res = await parseFirestoreSnapshot(artResult.value, FS_ART_CHUNKS_COL);
        if (res && res.state) {
            candidates.push({
                state: res.state,
                updatedAt: res.updatedAt || "1970-01-01T00:00:00.000Z",
                richness: calculateDataRichness(res.state),
                source: "fs-art-init"
            });
        }
    }

    if (candidates.length === 0) return null;

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
 * Mengambil seluruh daftar akun pengurus dari semua koleksi Cloud + main_state
 */
export async function fetchAllAdminsFromCloud() {
    ensureAuthReady();
    const collected = [];

    const [rtSnap, artSnap, rootAdminsSnap, rootAdminSnap, mainRtSnap] = await Promise.allSettled([
        dbGet(dbRef(rtdb, RTDB_ADMINS_PATH)),
        getDocs(collection(db, ...FS_ART_ADMINS_COL)),
        getDocs(collection(db, "admins")),
        getDocs(collection(db, "admin")),
        dbGet(dbRef(rtdb, RTDB_MAIN_PATH))
    ]);

    if (rtSnap.status === "fulfilled" && rtSnap.value.exists()) {
        const rawObj = rtSnap.value.val() || {};
        Object.keys(rawObj).forEach((k) => {
            const parsed = parseAdminRecord(k, rawObj[k]);
            if (parsed) collected.push(parsed);
        });
    }

    if (artSnap.status === "fulfilled") {
        artSnap.value.forEach((d) => {
            const parsed = parseAdminRecord(d.id, d.data());
            if (parsed) collected.push(parsed);
        });
    }

    if (rootAdminsSnap.status === "fulfilled") {
        rootAdminsSnap.value.forEach((d) => {
            const parsed = parseAdminRecord(d.id, d.data());
            if (parsed) collected.push(parsed);
        });
    }

    if (rootAdminSnap.status === "fulfilled") {
        rootAdminSnap.value.forEach((d) => {
            const parsed = parseAdminRecord(d.id, d.data());
            if (parsed) collected.push(parsed);
        });
    }

    // Periksa juga daftar admins yang tersimpan di dalam payload main_state RTDB
    if (mainRtSnap.status === "fulfilled" && mainRtSnap.value.exists()) {
        try {
            const val = mainRtSnap.value.val();
            const parsedState = typeof val.payload === "string" ? JSON.parse(val.payload) : val.payload;
            if (Array.isArray(parsedState?.admins)) {
                parsedState.admins.forEach((adm) => {
                    const parsed = parseAdminRecord(adm.username || adm.id, adm);
                    if (parsed) collected.push(parsed);
                });
            }
        } catch (e) {}
    }

    return collected;
}

/**
 * Listener Real-Time Lintas Perangkat
 */
export async function initCloudSynchronization({ onStateReceived, onAdminsReceived, onConnectionStatus }) {
    ensureAuthReady();

    // 1. Listener Realtime Database
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
            () => {}
        );
    } catch (e) {}

    // 2. Listener Firestore Root & Artifacts
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

    // 3. Listener Koleksi Akun Pengurus
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

    // 4. Tarik snapshot awal secara paralel
    fetchInitialPortalStateFromCloud()
        .then((initial) => {
            if (initial && initial.state) {
                if (onConnectionStatus) onConnectionStatus(true);
                deliverRealtimeState(onStateReceived, initial.state, initial.updatedAt, initial.source);
            }
        })
        .catch(() => {});
}

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

export async function savePortalStateToCloud(appData, actorUsername = "admin") {
    ensureAuthReady();
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

export async function saveAdminAccountToCloud(accountObj) {
    ensureAuthReady();
    const cleanUser = String(accountObj.username).trim().toLowerCase();
    const safeKey = cleanUser.replace(/[.#$/[\]]/g, "_");

    await Promise.allSettled([
        dbSet(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`), accountObj),
        setDoc(doc(db, ...FS_ART_ADMINS_COL, cleanUser), accountObj),
        setDoc(doc(db, "admins", cleanUser), accountObj)
    ]);
}

export async function deleteAdminAccountFromCloud(username) {
    ensureAuthReady();
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
 * Penting untuk memverifikasi akun yang dibuat langsung di Firebase Console Authentication
 */
export async function loginWithFirebaseAuth(email, password) {
    return await signInWithEmailAndPassword(auth, email, password);
}

/**
 * Logout dari sesi Admin lalu langsung aktifkan kembali sesi Anonim
 * agar pembacaan data publik tidak terputus
 */
export async function logoutFirebaseSession() {
    try {
        if (auth.currentUser && !auth.currentUser.isAnonymous) {
            await signOut(auth);
        }
    } catch (e) {}
    return await ensureAuthReady();
}