// ============================================================================
// FIREBASE.JS — MESIN CLOUD REAL-TIME & OTENTIKASI GANDA ADMIN (MEDIVANCE)
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

// Akun Cadangan Utama (Selalu dijamin ada jika belum diubah di Cloud)
const FALLBACK_SUPER_ADMIN = {
    id: 1,
    username: "admin@kelas.id",
    email: "admin@kelas.id",
    password: "admin123",
    name: "Admin Utama Medivance",
    role: "Super Admin",
    isSuperAdmin: true,
    permissions: [
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
    ]
};

let lastDeliveredRevision = "";
let hasLoadedNonEmptyData = false;
let anonymousAuthPromise = null;
let cachedCloudAdmins = [FALLBACK_SUPER_ADMIN];

/**
 * SINGLETON ANONYMOUS AUTH:
 * Memastikan sesi koneksi baca/tulis cepat selalu aktif di latar belakang.
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

// Aktifkan sesi anonim otomatis saat file dimuat
ensureAuthReady();

/**
 * Normalisasi data akun pengurus dari berbagai format dokumen Firebase
 */
export function parseAdminRecord(id, data) {
    if (!data || typeof data !== "object") return null;
    const rawUser = String(data.username || data.email || data.user || id || "").trim().toLowerCase();
    if (!rawUser) return null;

    const emailVal = rawUser.includes("@") ? rawUser : `${rawUser}@kelas.id`;
    const passVal = String(data.password ?? data.pass ?? data.pin ?? data.sandi ?? "");
    if (!passVal) return null;

    const isSuper = Boolean(
        data.isSuperAdmin ??
        (rawUser === "admin" || rawUser === "admin@kelas.id") ??
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

    let perms = Array.isArray(data.permissions) ? [...data.permissions] : (isSuper ? defaultSuperPerms : ["beranda", "keuangan"]);
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

/**
 * Menggabungkan daftar admin dan memastikan akun Super Admin tidak pernah hilang
 */
function ensureDefaultAdminPresent(adminList = []) {
    const map = new Map();
    map.set("admin@kelas.id", { ...FALLBACK_SUPER_ADMIN });

    [...cachedCloudAdmins, ...(Array.isArray(adminList) ? adminList : [])].forEach((item) => {
        const parsed = parseAdminRecord(item?.username || item?.id, item);
        if (parsed) {
            const key = parsed.username.toLowerCase();
            map.set(key, parsed);
            // Jika username adalah 'admin', sinkronkan juga ke key 'admin@kelas.id'
            if (key === "admin") {
                map.set("admin@kelas.id", { ...parsed, username: "admin@kelas.id", email: "admin@kelas.id" });
            }
        }
    });

    const merged = Array.from(map.values());
    cachedCloudAdmins = merged;
    return merged;
}

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
    const admCount = Array.isArray(stateObj.admins) ? stateObj.admins.length : 0;

    return (
        stuCount * 10 +
        txCount * 5 +
        annCount * 5 +
        albCount * 5 +
        noteCount * 2 +
        arcCount * 15 +
        attCount * 3 +
        holCount * 2 +
        admCount * 2
    );
}

function deliverRealtimeState(onStateReceived, stateObj, updatedAt, source) {
    if (!stateObj || typeof stateObj !== "object") return;

    // Pastikan daftar akun admin di dalam state selalu terisi dan tidak pernah kosong
    stateObj.admins = ensureDefaultAdminPresent(stateObj.admins);

    const incomingRichness = calculateDataRichness(stateObj);
    const revKey = `${updatedAt || "no-ts"}_${incomingRichness}`;

    if (hasLoadedNonEmptyData && incomingRichness <= 2 && !updatedAt) {
        return;
    }

    if (incomingRichness > 2) {
        hasLoadedNonEmptyData = true;
    }

    if (updatedAt && revKey === lastDeliveredRevision) {
        return;
    }

    lastDeliveredRevision = revKey;
    onStateReceived(stateObj, updatedAt || new Date().toISOString(), source);
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
 * PENGAMBILAN DATA AWAL SECARA PARALEL
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
        if (b.richness > 2 && a.richness <= 2) return 1;
        if (a.richness > 2 && b.richness <= 2) return -1;
        const timeCmp = String(b.updatedAt).localeCompare(String(a.updatedAt));
        if (timeCmp !== 0) return timeCmp;
        return b.richness - a.richness;
    });

    return candidates[0];
}

/**
 * PENGAMBILAN & VERIFIKASI AKUN ADMIN LENGKAP:
 * 1. Memeriksa Realtime Database (`admins` & `main_state.admins`)
 * 2. Memeriksa Firestore (`artifacts/.../admins`, `admins`, `admin`, `users`)
 * 3. Memverifikasi langsung ke Firebase Authentication (`signInWithEmailAndPassword`)
 *    jika pengguna sedang menekan tombol Login di layar!
 */
export async function fetchAllAdminsFromCloud() {
    await ensureAuthReady();
    const collected = [...cachedCloudAdmins];

    // Cek apakah form login sedang diisi oleh pengguna
    const loginUserEl = typeof document !== "undefined" ? document.getElementById("loginUsername") : null;
    const loginPassEl = typeof document !== "undefined" ? document.getElementById("loginPassword") : null;
    const activeInputUser = (loginUserEl?.value || "").trim().toLowerCase();
    const activeInputPass = loginPassEl?.value || "";

    const [rtSnap, rtMainSnap, artSnap, rootAdminsSnap, rootAdminSnap] = await Promise.allSettled([
        dbGet(dbRef(rtdb, RTDB_ADMINS_PATH)),
        dbGet(dbRef(rtdb, RTDB_MAIN_PATH)),
        getDocs(collection(db, ...FS_ART_ADMINS_COL)),
        getDocs(collection(db, "admins")),
        getDocs(collection(db, "admin"))
    ]);

    // 1. Dari RTDB Admins Collection
    if (rtSnap.status === "fulfilled" && rtSnap.value.exists()) {
        const rawObj = rtSnap.value.val() || {};
        Object.keys(rawObj).forEach((k) => {
            const parsed = parseAdminRecord(k, rawObj[k]);
            if (parsed) collected.push(parsed);
        });
    }

    // 2. Dari RTDB Main State Payload
    if (rtMainSnap.status === "fulfilled" && rtMainSnap.value.exists()) {
        try {
            const val = rtMainSnap.value.val();
            const parsedState = typeof val.payload === "string" ? JSON.parse(val.payload) : val.payload;
            if (Array.isArray(parsedState?.admins)) {
                parsedState.admins.forEach((a) => {
                    const parsed = parseAdminRecord(a.username || a.id, a);
                    if (parsed) collected.push(parsed);
                });
            }
        } catch (e) {}
    }

    // 3. Dari Firestore Artifacts Admins
    if (artSnap.status === "fulfilled") {
        artSnap.value.forEach((d) => {
            const parsed = parseAdminRecord(d.id, d.data());
            if (parsed) collected.push(parsed);
        });
    }

    // 4. Dari Firestore Root `admins` & `admin`
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

    // 5. Jembatan Otomatis Firebase Authentication (Email & Password):
    //    Jika pengguna sedang mencoba login dengan akun yang terdaftar di Firebase Console Auth
    //    (misal: admin@kelas.id), verifikasi langsung ke Firebase Auth!
    if (activeInputUser && activeInputPass) {
        const emailCandidate = activeInputUser.includes("@") ? activeInputUser : `${activeInputUser}@kelas.id`;
        const unameOnly = activeInputUser.split("@")[0];

        const alreadyMatched = collected.some((a) => {
            const u = String(a.username || "").toLowerCase();
            const em = String(a.email || "").toLowerCase();
            return (u === activeInputUser || em === activeInputUser || u === emailCandidate || u.split("@")[0] === unameOnly) &&
                   String(a.password) === String(activeInputPass);
        });

        if (!alreadyMatched) {
            try {
                const cred = await signInWithEmailAndPassword(auth, emailCandidate, activeInputPass);
                if (cred && cred.user) {
                    const verifiedEmail = (cred.user.email || emailCandidate).toLowerCase();
                    const existingMeta = collected.find(
                        (a) => String(a.username).toLowerCase() === verifiedEmail || String(a.email).toLowerCase() === verifiedEmail
                    );

                    const verifiedAdminObj = {
                        id: existingMeta?.id || cred.user.uid || Date.now(),
                        username: verifiedEmail,
                        email: verifiedEmail,
                        password: activeInputPass,
                        name: existingMeta?.name || cred.user.displayName || (verifiedEmail === "admin@kelas.id" ? "Admin Utama Medivance" : unameOnly.toUpperCase()),
                        role: existingMeta?.role || "Super Admin",
                        isSuperAdmin: existingMeta ? Boolean(existingMeta.isSuperAdmin) : true,
                        permissions: existingMeta?.permissions || [...FALLBACK_SUPER_ADMIN.permissions]
                    };

                    collected.push(verifiedAdminObj);
                    // Simpan ke koleksi Cloud agar login berikutnya instan (<0.05 detik)
                    saveAdminAccountToCloud(verifiedAdminObj);
                }
            } catch (authErr) {
                // Pastikan sesi anonim tetap hidup jika email/password tidak cocok di Firebase Auth
                ensureAuthReady();
            }
        }
    }

    return ensureDefaultAdminPresent(collected);
}

/**
 * LISTENER REAL-TIME INSTAN LINTAS PERANGKAT
 */
export async function initCloudSynchronization({ onStateReceived, onAdminsReceived, onConnectionStatus }) {
    ensureAuthReady();

    // Segera kirim daftar admin awal (termasuk fallback Super Admin) agar bisa langsung login
    if (onAdminsReceived) {
        onAdminsReceived(ensureDefaultAdminPresent([]), "init-default");
    }

    // 1. Listener Realtime Database Main State
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

    // 3. Listener Koleksi Akun Admin (RTDB & Firestore)
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
                if (onAdminsReceived) onAdminsReceived(ensureDefaultAdminPresent(list), "rtdb-admins");
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
                if (onAdminsReceived) onAdminsReceived(ensureDefaultAdminPresent(list), "fs-art-admins");
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
                    if (list.length > 0 && onAdminsReceived) {
                        onAdminsReceived(ensureDefaultAdminPresent(list), `fs-${colName}`);
                    }
                },
                () => {}
            );
        } catch (e) {}
    });

    // 4. Tarik snapshot awal terbaik secara paralel
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
    await ensureAuthReady();
    appData.admins = ensureDefaultAdminPresent(appData.admins);

    const timestamp = new Date().toISOString();
    const richness = calculateDataRichness(appData);
    lastDeliveredRevision = `${timestamp}_${richness}`;
    if (richness > 2) hasLoadedNonEmptyData = true;

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
    await ensureAuthReady();
    const parsed = parseAdminRecord(accountObj?.username, accountObj);
    if (!parsed) return;

    const cleanUser = parsed.username.toLowerCase();
    const safeKey = cleanUser.replace(/[.#$/[\]]/g, "_");

    ensureDefaultAdminPresent([parsed]);

    await Promise.allSettled([
        dbSet(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`), parsed),
        setDoc(doc(db, ...FS_ART_ADMINS_COL, cleanUser), parsed),
        setDoc(doc(db, "admins", cleanUser), parsed)
    ]);
}

export async function deleteAdminAccountFromCloud(username) {
    await ensureAuthReady();
    const cleanUser = String(username).trim().toLowerCase();
    const safeKey = cleanUser.replace(/[.#$/[\]]/g, "_");

    cachedCloudAdmins = cachedCloudAdmins.filter(
        (a) => String(a.username).toLowerCase() !== cleanUser
    );

    await Promise.allSettled([
        dbRemove(dbRef(rtdb, `${RTDB_ADMINS_PATH}/${safeKey}`)),
        deleteDoc(doc(db, ...FS_ART_ADMINS_COL, cleanUser)),
        deleteDoc(doc(db, "admins", cleanUser)),
        deleteDoc(doc(db, "admin", cleanUser))
    ]);
}

/**
 * Mendukung pemanggilan login baik dengan (email, password) maupun sesi anonim
 */
export async function loginWithFirebaseAuth(email, password) {
    if (email && password) {
        return await signInWithEmailAndPassword(auth, email, password);
    }
    const user = await ensureAuthReady();
    return { user };
}

/**
 * Keluar dari sesi admin dan langsung mengaktifkan kembali sesi baca anonim
 */
export async function logoutFirebaseSession() {
    try {
        if (auth.currentUser && !auth.currentUser.isAnonymous) {
            await signOut(auth);
        }
    } catch (e) {}
    return await ensureAuthReady();
}