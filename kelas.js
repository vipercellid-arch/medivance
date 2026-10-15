// ============================================================================
// KELAS.JS — LOGIKA UTAMA PORTAL KELAS, RBAC, ID CARD, ABSENSI & KALENDER MINI
// ============================================================================

import {
    initCloudSynchronization,
    savePortalStateToCloud,
    saveAdminAccountToCloud,
    deleteAdminAccountFromCloud,
    fetchAllAdminsFromCloud,
    loginWithFirebaseAuth,
    logoutFirebaseSession
} from "./firebase.js";

const THEME_STORAGE_KEY = "medivance_theme_mode";
const ADMIN_SESSION_STORAGE_KEY = "medivance_admin_session_v4";
const DEFAULT_HERO_BG = "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1400&q=80";

function toLocalISODate(dateObj = new Date()) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function toLocalISOMonth(dateObj = new Date()) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
}

function getDefaultMondayRange() {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const firstMonday = new Date(now);
    firstMonday.setDate(now.getDate() + diffToMonday - 21);
    const endMonday = new Date(firstMonday);
    endMonday.setDate(firstMonday.getDate() + 7 * 11);
    return {
        start: toLocalISODate(firstMonday),
        end: toLocalISODate(endMonday)
    };
}

const defaultRange = getDefaultMondayRange();

// STATE DEFAULT AWAL
const DEFAULT_DATABASE_STATE = {
    config: {
        classCode: "MDV",
        className: "MEDIVANCE",
        schoolName: "SMA NEGERI 5 AMBON",
        classMotto: "Together We Grow, Together We Heal",
        websiteLogoUrl: "",
        classLogoUrl: "",
        schoolLogoUrl: "",
        heroBgUrl: DEFAULT_HERO_BG,
        welcomeTypingText: "SELAMAT DATANG DI MEDIVANCE",
        heroSubtitle: "Keluarga besar penuh semangat kolaborasi, kepedulian, dan prestasi akademik yang tumbuh bersama dalam satu kesatuan.",
        aboutClass: "MEDIVANCE merupakan ruang bertumbuh bagi setiap anggota kelas untuk saling mendukung dalam meraih keunggulan akademik, membangun karakter yang berempati tinggi, menjaga kekompakan, serta menciptakan kenangan masa sekolah yang bermakna.",
        waliKelas: "-",
        waliTitle: "Wali Kelas & Pembina Akademik",
        waliPhotoUrl: "",
        academicYear: "2026/2027",
        semesterName: "Semester Ganjil",
        weeklyFee: 5000,
        feeStartDate: defaultRange.start,
        feeEndDate: defaultRange.end,
        paymentInfo: "Pembayaran kas dilakukan setiap hari Senin melalui Bendahara Kelas.",
        marqueeText: "Selamat datang di Portal Resmi MEDIVANCE • Together We Grow, Together We Heal • Semangat belajar dan jaga kekompakan kelas!",
        socialIg: "@medivance.class",
        socialTiktok: "@medivance.official",
        socialEmail: "medivance@kelas.id",
        holidays: [] // [{ id, date: "YYYY-MM-DD", name: "Libur Nasional" }]
    },
    admins: [
        {
            id: 1,
            username: "admin@kelas.id",
            email: "admin@kelas.id",
            password: "admin123",
            name: "Admin Utama Medivance",
            role: "Super Admin",
            isSuperAdmin: true,
            permissions: ["beranda", "keuangan", "atur_periode_kas", "absensi", "siswa", "info", "jadwal", "album", "akun", "pengaturan"]
        }
    ],
    students: [],
    transactions: [],
    announcements: [],
    albums: [],
    stickyNotes: [],
    attendance: {},
    archives: [],
    schedule: {
        "Senin": [],
        "Selasa": [],
        "Rabu": [],
        "Kamis": [],
        "Jumat": [],
        "Sabtu": []
    }
};

// State Aplikasi Aktif
let appData = JSON.parse(JSON.stringify(DEFAULT_DATABASE_STATE));
let externalFirebaseAdmins = [];
let currentAdmin = null;

// Navigasi Workspace & Tab
let activeWorkspace = "user"; // 'user' | 'login' | 'admin' | 'preview'
let activeTabId = "dashboard";
let activeAdminSectionId = "adm-beranda";
let activeInfoCategory = "ALL";
let activeAlbumCategory = "ALL";
let activeScheduleDay = "ALL";

// State Filter Absensi Digital
let publicAttendanceMode = "DAILY";
let selectedPublicAttendanceDate = toLocalISODate(new Date());
let selectedPublicAttendanceWeek = toLocalISODate(new Date());
let selectedPublicAttendanceMonth = toLocalISOMonth(new Date());

let adminAttendanceMode = "DAILY";
let selectedAttendanceDate = toLocalISODate(new Date());
let selectedAttendanceWeek = toLocalISODate(new Date());
let selectedAttendanceMonth = toLocalISOMonth(new Date());

// State Kalender Mini Footer
let miniCalYear = new Date().getFullYear();
let miniCalMonth = new Date().getMonth(); // 0 - 11

let selectedStudentIdForCard = null;
let lastAddedStickyId = null;
let isDarkMode = false;
let isApplyingRemoteUpdate = false;

let secretTapCount = 0;
let secretTapTimer = null;
let currentTypedGoal = "";

// ============================================================================
// SINKRONISASI REAL-TIME FIREBASE & PEMBERSIHAN FOTO TUGAS LEWAT DEADLINE
// ============================================================================

function mergeWithDefaults(incoming) {
    if (!incoming || typeof incoming !== "object") {
        return JSON.parse(JSON.stringify(DEFAULT_DATABASE_STATE));
    }
    const mergedCfg = { ...DEFAULT_DATABASE_STATE.config, ...(incoming.config || {}) };
    if (!mergedCfg.heroBgUrl || !String(mergedCfg.heroBgUrl).trim()) {
        mergedCfg.heroBgUrl = DEFAULT_HERO_BG;
    }
    if (!Array.isArray(mergedCfg.holidays)) {
        mergedCfg.holidays = [];
    }

    const incomingAdmins = Array.isArray(incoming.admins) && incoming.admins.length > 0
        ? incoming.admins
        : DEFAULT_DATABASE_STATE.admins;

    return {
        config: mergedCfg,
        admins: incomingAdmins,
        students: Array.isArray(incoming.students) ? incoming.students : [],
        transactions: Array.isArray(incoming.transactions) ? incoming.transactions : [],
        announcements: Array.isArray(incoming.announcements) ? incoming.announcements : [],
        albums: Array.isArray(incoming.albums) ? incoming.albums : [],
        stickyNotes: Array.isArray(incoming.stickyNotes) ? incoming.stickyNotes : [],
        attendance: incoming.attendance && typeof incoming.attendance === "object" ? incoming.attendance : {},
        archives: Array.isArray(incoming.archives) ? incoming.archives : [],
        schedule: { ...DEFAULT_DATABASE_STATE.schedule, ...(incoming.schedule || {}) }
    };
}

function mergeAdminArrays(arr1, arr2) {
    const map = new Map();
    [...(arr1 || []), ...(arr2 || [])].forEach((item) => {
        if (item && item.username) {
            const key = String(item.username).trim().toLowerCase();
            map.set(key, {
                ...item,
                username: key,
                email: item.email || (key.includes("@") ? key : `${key}@kelas.id`)
            });
        }
    });
    return Array.from(map.values());
}

function getAllCombinedAdmins() {
    return mergeAdminArrays(externalFirebaseAdmins, appData.admins);
}

/**
 * Menyimpan seluruh perubahan langsung ke Cloud Firebase secara Real-Time
 */
async function saveToCloudDatabase(successMessage = "") {
    renderAllViews();
    if (isApplyingRemoteUpdate) return true;

    const statusBadge = document.getElementById("adminCloudLiveBadge");
    if (statusBadge) {
        statusBadge.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-neo-yellow"></i> Menyimpan...`;
    }

    const res = await savePortalStateToCloud(appData, currentAdmin ? currentAdmin.username : "visitor");

    if (statusBadge) {
        if (res && res.ok) {
            statusBadge.innerHTML = `<i class="fa-solid fa-cloud-check text-neo-mint"></i> Real-Time Tersimpan`;
        } else {
            statusBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-neo-coral"></i> Gagal Simpan`;
        }
    }

    if (res && res.ok) {
        if (successMessage) showToast(successMessage, "bg-neo-mint");
        return true;
    } else {
        showToast("Gagal menyimpan ke Firebase. Periksa koneksi internet Anda.", "bg-neo-coral");
        return false;
    }
}

/**
 * Otomatis menghapus lampiran foto pada tugas/pengumuman yang sudah melewati waktu deadline
 * agar menghemat ruang penyimpanan Firebase, sedangkan teks pengumuman tetap utuh.
 */
window.cleanExpiredTaskPhotos = async function (manualNotify = false) {
    const nowMs = Date.now();
    let cleanedCount = 0;

    if (Array.isArray(appData.announcements)) {
        appData.announcements.forEach((item) => {
            if (item.expireAt && item.photoUrl && String(item.photoUrl).trim().length > 0) {
                const expMs = new Date(item.expireAt).getTime();
                if (!isNaN(expMs) && nowMs >= expMs) {
                    item.photoUrl = "";
                    item.photoExpired = true;
                    cleanedCount++;
                }
            }
        });
    }

    if (cleanedCount > 0) {
        await saveToCloudDatabase(`${cleanedCount} foto tugas yang melewati deadline berhasil dibersihkan untuk menghemat penyimpanan!`);
    } else if (manualNotify) {
        showToast("Tidak ada foto tugas yang melewati waktu deadline saat ini.", "bg-neo-yellow");
    }
    return cleanedCount;
};

// ============================================================================
// SISTEM HAK AKSES BERTINGKAT (STRICT GRANULAR RBAC) & SESI PERSISTEN
// ============================================================================

function hasAdminPermission(permKey) {
    if (!currentAdmin) return false;
    if (permKey === "beranda") return true;
    if (currentAdmin.isSuperAdmin) return true;
    const perms = Array.isArray(currentAdmin.permissions) ? currentAdmin.permissions : [];
    if (perms.includes("akun")) return true;
    return perms.includes(permKey);
}

function canEditInCurrentView(permKey) {
    if (!currentAdmin) return false;
    if (activeWorkspace !== "admin") return false;
    return hasAdminPermission(permKey);
}

function canModifyMondayPeriod() {
    if (!currentAdmin || activeWorkspace !== "admin") return false;
    if (currentAdmin.isSuperAdmin) return true;
    const perms = Array.isArray(currentAdmin.permissions) ? currentAdmin.permissions : [];
    return perms.includes("atur_periode_kas") || perms.includes("pengaturan") || perms.includes("akun");
}

function saveAdminSessionToStorage() {
    if (!currentAdmin) {
        try { localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY); } catch (e) {}
        return;
    }
    try {
        localStorage.setItem(
            ADMIN_SESSION_STORAGE_KEY,
            JSON.stringify({
                username: currentAdmin.username,
                password: currentAdmin.password,
                activeAdminSectionId: activeAdminSectionId || "adm-beranda",
                activeWorkspace: activeWorkspace === "preview" ? "preview" : "admin",
                savedAt: Date.now()
            })
        );
    } catch (e) {}
}

function restoreAdminSessionFromStorage() {
    try {
        const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.username) return false;

        const allAdmins = getAllCombinedAdmins();
        const matched = allAdmins.find(
            (a) =>
                String(a.username).toLowerCase() === String(parsed.username).toLowerCase() &&
                String(a.password) === String(parsed.password)
        );

        if (matched) {
            currentAdmin = matched;
            activeAdminSectionId = parsed.activeAdminSectionId || "adm-beranda";
            activeWorkspace = parsed.activeWorkspace === "preview" ? "preview" : "admin";
            setupAdminSessionTabs(activeAdminSectionId);
            updateWorkspaceVisibility();
            return true;
        }
    } catch (e) {}
    return false;
}

// ============================================================================
// MODE GELAP (DARK MODE) SELARAS
// ============================================================================

function applyThemeState(dark) {
    isDarkMode = Boolean(dark);
    const htmlEl = document.documentElement;
    const iconEl = document.getElementById("themeToggleIcon");
    if (isDarkMode) {
        htmlEl.classList.add("dark");
        if (iconEl) iconEl.className = "fa-solid fa-sun text-neo-yellow";
    } else {
        htmlEl.classList.remove("dark");
        if (iconEl) iconEl.className = "fa-solid fa-moon";
    }
    try {
        localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? "1" : "0");
    } catch (e) {}
}

window.toggleDarkMode = function () {
    applyThemeState(!isDarkMode);
};

// ============================================================================
// NAVIGASI WORKSPACE: PUBLIK, LOGIN FULL LAYAR, PANEL ADMIN & PRATINJAU WEB
// ============================================================================

function updateWorkspaceVisibility() {
    const publicChrome = document.getElementById("publicChromeWrapper");
    const userMain = document.getElementById("workspace-user");
    const publicFooter = document.getElementById("publicFooter");
    const loginSection = document.getElementById("workspace-login");
    const adminMain = document.getElementById("workspace-admin");
    const previewBanner = document.getElementById("adminPreviewBanner");
    const btnReturnTop = document.getElementById("btnReturnToAdminTop");

    publicChrome?.classList.add("hidden");
    userMain?.classList.add("hidden");
    publicFooter?.classList.add("hidden");
    loginSection?.classList.add("hidden");
    adminMain?.classList.add("hidden");
    previewBanner?.classList.add("hidden");
    btnReturnTop?.classList.add("hidden");

    if (activeWorkspace === "login") {
        loginSection?.classList.remove("hidden");
        renderHeaderAndHeroIdentity();
    } else if (activeWorkspace === "admin" && currentAdmin) {
        adminMain?.classList.remove("hidden");
        saveAdminSessionToStorage();
        renderAdminWorkspace();
    } else if (activeWorkspace === "preview" && currentAdmin) {
        publicChrome?.classList.remove("hidden");
        userMain?.classList.remove("hidden");
        publicFooter?.classList.remove("hidden");
        previewBanner?.classList.remove("hidden");
        btnReturnTop?.classList.remove("hidden");
        saveAdminSessionToStorage();
        switchTab(activeTabId || "dashboard");
        renderAllViews();
    } else {
        activeWorkspace = "user";
        publicChrome?.classList.remove("hidden");
        userMain?.classList.remove("hidden");
        publicFooter?.classList.remove("hidden");
        switchTab(activeTabId || "dashboard");
        renderAllViews();
    }
}

window.openFullLoginScreen = function () {
    if (currentAdmin) {
        activeWorkspace = "admin";
        updateWorkspaceVisibility();
        return;
    }
    activeWorkspace = "login";
    updateWorkspaceVisibility();
    setTimeout(() => {
        document.getElementById("loginUsername")?.focus();
    }, 100);
};

window.closeFullLoginScreen = function () {
    activeWorkspace = currentAdmin ? "admin" : "user";
    updateWorkspaceVisibility();
};

window.enterAdminPreviewMode = function () {
    if (!currentAdmin) return;
    activeWorkspace = "preview";
    updateWorkspaceVisibility();
    showToast("Mode Pratinjau Web Publik aktif (Read-Only).", "bg-neo-sky");
};

window.exitAdminPreviewMode = function () {
    if (!currentAdmin) return;
    activeWorkspace = "admin";
    updateWorkspaceVisibility();
};

window.toggleDrawerMenu = function (open) {
    const backdrop = document.getElementById("navDrawerBackdrop");
    const panel = document.getElementById("navDrawerPanel");
    if (!backdrop || !panel) return;
    if (open) {
        backdrop.classList.remove("hidden");
        panel.classList.remove("-translate-x-full");
    } else {
        backdrop.classList.add("hidden");
        panel.classList.add("-translate-x-full");
    }
};

window.navigateFromDrawer = function (tabId) {
    toggleDrawerMenu(false);
    switchTab(tabId);
};

window.toggleAdminDrawer = function (open) {
    const backdrop = document.getElementById("adminDrawerBackdrop");
    const panel = document.getElementById("adminDrawerPanel");
    if (!backdrop || !panel) return;
    if (open) {
        backdrop.classList.remove("hidden");
        panel.classList.remove("-translate-x-full");
    } else {
        backdrop.classList.add("hidden");
        panel.classList.add("-translate-x-full");
    }
};

window.selectAdminTabFromDrawer = function (sectionId) {
    toggleAdminDrawer(false);
    switchAdminTab(sectionId);
};

window.handleSecretClassNameTap = function () {
    secretTapCount++;
    if (secretTapTimer) clearTimeout(secretTapTimer);
    if (secretTapCount >= 3) {
        secretTapCount = 0;
        openFullLoginScreen();
        return;
    }
    secretTapTimer = setTimeout(() => {
        secretTapCount = 0;
    }, 900);
};

// ============================================================================
// OTENTIKASI LOGIN PENGURUS & MANAJEMEN SESI PERSISTEN
// ============================================================================

window.togglePasswordVisibility = function () {
    const input = document.getElementById("loginPassword");
    const icon = document.getElementById("loginPassEyeIcon");
    if (!input || !icon) return;
    if (input.type === "password") {
        input.type = "text";
        icon.className = "fa-solid fa-eye-slash";
    } else {
        input.type = "password";
        icon.className = "fa-solid fa-eye";
    }
};

window.toggleAdminFormPassword = function () {
    const input = document.getElementById("admAccPassword");
    const icon = document.getElementById("admAccPassEye");
    if (!input || !icon) return;
    if (input.type === "password") {
        input.type = "text";
        icon.className = "fa-solid fa-eye-slash";
    } else {
        input.type = "password";
        icon.className = "fa-solid fa-eye";
    }
};

window.handleAdminLoginSubmit = async function (e) {
    e.preventDefault();
    const rawInput = (document.getElementById("loginUsername")?.value || "").trim().toLowerCase();
    const passwordInput = document.getElementById("loginPassword")?.value || "";
    const submitBtn = document.getElementById("btnSubmitAdminLogin");

    if (!rawInput || !passwordInput) return;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Memverifikasi di Cloud Firebase...`;
    }

    let authenticatedProfile = null;
    const emailCandidate = rawInput.includes("@") ? rawInput : `${rawInput}@kelas.id`;
    const inputNameOnly = rawInput.split("@")[0];

    try {
        const freshCloudAdmins = await fetchAllAdminsFromCloud();
        if (freshCloudAdmins.length > 0) {
            externalFirebaseAdmins = mergeAdminArrays(externalFirebaseAdmins, freshCloudAdmins);
        }
    } catch (err) {}

    const allAdmins = getAllCombinedAdmins();
    const matchedLocal = allAdmins.find((a) => {
        const u = String(a.username || "").trim().toLowerCase();
        const em = String(a.email || "").trim().toLowerCase();
        const unameOnly = u.split("@")[0];
        const usernameMatch = u === rawInput || em === rawInput || u === emailCandidate || unameOnly === inputNameOnly;
        return usernameMatch && String(a.password) === String(passwordInput);
    });

    if (matchedLocal) {
        authenticatedProfile = matchedLocal;
    }

    if (!authenticatedProfile) {
        try {
            const userCred = await loginWithFirebaseAuth(emailCandidate, passwordInput);
            if (userCred && userCred.user) {
                const loggedEmail = (userCred.user.email || emailCandidate).toLowerCase();
                const existingInList = allAdmins.find(
                    (a) =>
                        String(a.username).toLowerCase() === loggedEmail ||
                        String(a.email || "").toLowerCase() === loggedEmail ||
                        String(a.username).toLowerCase().split("@")[0] === inputNameOnly
                );

                authenticatedProfile = existingInList || {
                    id: userCred.user.uid,
                    username: loggedEmail,
                    email: loggedEmail,
                    password: passwordInput,
                    name: loggedEmail === "admin@kelas.id" ? "Admin Utama Kelas" : (userCred.user.displayName || inputNameOnly),
                    role: "Super Admin",
                    isSuperAdmin: true,
                    permissions: ["beranda", "keuangan", "atur_periode_kas", "absensi", "siswa", "info", "jadwal", "album", "akun", "pengaturan"]
                };
            }
        } catch (authErr) {}
    }

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Masuk ke Workspace Pengurus`;
    }

    if (!authenticatedProfile) {
        showToast("Username/Email atau Password tidak sesuai!", "bg-neo-coral");
        return;
    }

    currentAdmin = authenticatedProfile;
    e.target.reset();
    activeWorkspace = "admin";
    setupAdminSessionTabs("adm-beranda");
    saveAdminSessionToStorage();
    updateWorkspaceVisibility();
    showToast(`Selamat datang kembali, ${authenticatedProfile.name}!`, "bg-neo-mint");
};

window.logoutAdmin = async function () {
    currentAdmin = null;
    try { localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY); } catch (e) {}
    await logoutFirebaseSession();
    const loginText = document.getElementById("drawerAdminLoginText");
    if (loginText) loginText.textContent = "Login Pengurus Kelas";
    activeWorkspace = "user";
    updateWorkspaceVisibility();
    showToast("Anda telah keluar dari Workspace Pengurus.", "bg-neo-yellow");
};

function setupAdminSessionTabs(preferredTab = "adm-beranda") {
    if (!currentAdmin) return;

    const loginTxt = document.getElementById("drawerAdminLoginText");
    if (loginTxt) loginTxt.textContent = `Workspace (${currentAdmin.name.split(" ")[0]})`;

    const sessName = document.getElementById("adminSessionName");
    if (sessName) sessName.textContent = currentAdmin.name;

    const sessRole = document.getElementById("adminSessionRole");
    if (sessRole) sessRole.textContent = currentAdmin.role;

    const drawerTitle = document.getElementById("drawerAdminUserTitle");
    const drawerRole = document.getElementById("drawerAdminRoleBadge");
    if (drawerTitle) drawerTitle.textContent = currentAdmin.name;
    if (drawerRole) drawerRole.textContent = currentAdmin.role.toUpperCase();

    document.querySelectorAll("#adminDrawerNavList .admin-nav-btn").forEach((btn) => {
        const perm = btn.dataset.perm;
        if (hasAdminPermission(perm)) {
            btn.classList.remove("hidden");
        } else {
            btn.classList.add("hidden");
        }
    });

    switchAdminTab(preferredTab || "adm-beranda");
}

window.switchAdminTab = function (sectionId) {
    const permMap = {
        "adm-beranda": "beranda",
        "adm-keuangan": "keuangan",
        "adm-absensi": "absensi",
        "adm-siswa": "siswa",
        "adm-info": "info",
        "adm-jadwal": "jadwal",
        "adm-album": "album",
        "adm-akun": "akun",
        "adm-pengaturan": "pengaturan"
    };

    const tabTitles = {
        "adm-beranda": "BERANDA ADMIN",
        "adm-keuangan": "1. KAS, SENIN & SHEET",
        "adm-absensi": "2. ABSENSI DIGITAL",
        "adm-siswa": "3. MASTER ANGGOTA",
        "adm-info": "4. TUGAS, FOTO & MADING",
        "adm-jadwal": "5. JADWAL & PILIH JAM",
        "adm-album": "6. GALERI ALBUM",
        "adm-akun": "7. AKUN & HAK AKSES",
        "adm-pengaturan": "8. IDENTITAS, LIBUR & SEMESTER"
    };

    if (!hasAdminPermission(permMap[sectionId])) {
        showToast("Jabatan akun Anda tidak memiliki izin untuk membuka modul ini.", "bg-neo-coral");
        return;
    }

    activeAdminSectionId = sectionId;
    saveAdminSessionToStorage();

    document.querySelectorAll(".admin-section").forEach((sec) => sec.classList.add("hidden"));
    document.getElementById(sectionId)?.classList.remove("hidden");

    document.querySelectorAll("#adminDrawerNavList .admin-nav-btn").forEach((btn) => {
        if (btn.id === `admdrawer-${sectionId}`) btn.classList.add("active");
        else btn.classList.remove("active");
    });

    const indicator = document.getElementById("activeAdminTabIndicator");
    if (indicator) indicator.textContent = tabTitles[sectionId] || "MODUL AKTIF";

    renderAdminWorkspace();
    window.scrollTo({ top: 0, behavior: "smooth" });
};

// ============================================================================
// PEMBACAAN GAMBAR INSTAN & PRATINJAU LANGSUNG
// ============================================================================

function readImageFileInstantly(file, callback) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
        if (ev.target?.result) {
            callback(ev.target.result);
        }
    };
    reader.readAsDataURL(file);
}

function applyImageWithFallback(imgEl, fallbackEl, urlStr) {
    if (!imgEl) return;
    const cleanUrl = String(urlStr || "").trim();
    if (cleanUrl.length > 4) {
        imgEl.onload = () => {
            imgEl.classList.remove("hidden");
            if (fallbackEl) fallbackEl.classList.add("hidden");
        };
        imgEl.onerror = () => {
            imgEl.classList.add("hidden");
            if (fallbackEl) fallbackEl.classList.remove("hidden");
        };
        imgEl.src = cleanUrl;
        imgEl.classList.remove("hidden");
        if (fallbackEl) fallbackEl.classList.add("hidden");
    } else {
        imgEl.removeAttribute("src");
        imgEl.classList.add("hidden");
        if (fallbackEl) fallbackEl.classList.remove("hidden");
    }
}

window.handleInstantConfigImage = function (e, targetInputId, previewImgId, fallbackId) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        const inputEl = document.getElementById(targetInputId);
        if (inputEl) inputEl.value = dataUrl;
        syncConfigPreview(targetInputId, previewImgId, fallbackId);
        showToast("Gambar dimuat! Klik Simpan Pengaturan untuk menyimpan ke Firebase.", "bg-neo-mint");
    });
};

window.syncConfigPreview = function (targetInputId, previewImgId, fallbackId) {
    const val = document.getElementById(targetInputId)?.value || "";
    const imgEl = document.getElementById(previewImgId);
    const fbEl = document.getElementById(fallbackId);
    applyImageWithFallback(imgEl, fbEl, val);
};

window.clearConfigImage = function (targetInputId, previewImgId, fallbackId) {
    const inputEl = document.getElementById(targetInputId);
    if (inputEl) inputEl.value = "";
    syncConfigPreview(targetInputId, previewImgId, fallbackId);
};

window.resetHeroBgToDefault = function () {
    const inputEl = document.getElementById("cfgHeroBgUrl");
    if (inputEl) inputEl.value = DEFAULT_HERO_BG;
    syncConfigPreview("cfgHeroBgUrl", "cfgHeroBgPreviewImg", "cfgHeroBgPreviewFallback");
    showToast("Foto latar dikembalikan ke default.", "bg-neo-yellow");
};

// ============================================================================
// PERHITUNGAN TANGGAL SENIN, MINGGU ABSENSI, BULAN ABSENSI & KEUANGAN KAS
// ============================================================================

function getMondayDatesList() {
    const startStr = appData.config.feeStartDate || defaultRange.start;
    const endStr = appData.config.feeEndDate || defaultRange.end;

    let start = new Date(startStr + "T00:00:00");
    let end = new Date(endStr + "T00:00:00");

    if (isNaN(start.getTime())) start = new Date(defaultRange.start + "T00:00:00");
    if (isNaN(end.getTime()) || end < start) {
        end = new Date(start);
        end.setDate(start.getDate() + 7 * 7);
    }

    const day = start.getDay();
    if (day !== 1) {
        const diff = (8 - day) % 7;
        start.setDate(start.getDate() + diff);
    }

    const mondays = [];
    const cursor = new Date(start);
    let safetyCounter = 0;
    while (cursor <= end && safetyCounter < 120) {
        mondays.push(toLocalISODate(cursor));
        cursor.setDate(cursor.getDate() + 7);
        safetyCounter++;
    }

    if (mondays.length === 0) {
        mondays.push(toLocalISODate(start));
    }

    return mondays;
}

function getSixSchoolDaysOfWeek(anyIsoDate) {
    let base = new Date(String(anyIsoDate || toLocalISODate()) + "T00:00:00");
    if (isNaN(base.getTime())) base = new Date();
    const day = base.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(base);
    monday.setDate(base.getDate() + diffToMonday);

    const dayLabels = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
    const result = [];
    for (let i = 0; i < 6; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const iso = toLocalISODate(d);
        result.push({
            iso,
            dayName: dayLabels[i],
            shortDate: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
        });
    }
    return result;
}

function formatShortMondayLabel(isoDate) {
    const parts = String(isoDate || "").split("-");
    if (parts.length !== 3) return isoDate;
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${parts[2]} ${months[mIdx] || parts[1]}`;
}

function formatMonthTitle(yyyyMm) {
    const parts = String(yyyyMm || "").split("-");
    if (parts.length !== 2) return yyyyMm;
    const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${months[mIdx] || parts[1]} ${parts[0]}`;
}

function ensureStudentPaidDatesMigrated(student, mondayDates) {
    if (!student.paidDates || typeof student.paidDates !== "object") {
        student.paidDates = {};
    }
    if (Array.isArray(student.weeks) && student.weeks.length > 0 && Object.keys(student.paidDates).length === 0) {
        student.weeks.forEach((isPaid, idx) => {
            if (isPaid && mondayDates[idx]) {
                student.paidDates[mondayDates[idx]] = true;
            }
        });
    }
}

function formatRupiah(num) {
    return "Rp " + Number(num || 0).toLocaleString("id-ID");
}

function calculateFinancialSummary() {
    const fee = Number(appData.config.weeklyFee) || 0;
    const mondayDates = getMondayDatesList();
    const totalMondays = mondayDates.length;
    let totalIuranPaid = 0;
    let totalPossibleWeeks = appData.students.length * totalMondays;
    let totalPaidWeeks = 0;

    appData.students.forEach((stu) => {
        ensureStudentPaidDatesMigrated(stu, mondayDates);
        mondayDates.forEach((dateKey) => {
            if (stu.paidDates[dateKey]) {
                totalPaidWeeks++;
                totalIuranPaid += fee;
            }
        });
    });

    let extraIncome = 0;
    let totalExpense = 0;
    let expenseCount = 0;

    appData.transactions.forEach((tx) => {
        if (tx.type === "MASUK") {
            extraIncome += Number(tx.amount) || 0;
        } else {
            totalExpense += Number(tx.amount) || 0;
            expenseCount++;
        }
    });

    const totalIncome = totalIuranPaid + extraIncome;
    const currentBalance = totalIncome - totalExpense;
    const complianceRatio = totalPossibleWeeks > 0 ? Math.round((totalPaidWeeks / totalPossibleWeeks) * 100) : 0;

    return {
        fee,
        mondayDates,
        totalMondays,
        totalIuranPaid,
        extraIncome,
        totalIncome,
        totalExpense,
        expenseCount,
        currentBalance,
        complianceRatio,
        totalPaidWeeks,
        totalPossibleWeeks
    };
}

function calculateStudentAttendanceStats(studentId, dateKeysFilter = null) {
    const attMap = appData.attendance || {};
    const keys = Array.isArray(dateKeysFilter) ? dateKeysFilter : Object.keys(attMap);
    let H = 0, I = 0, S = 0, A = 0;
    keys.forEach((dateKey) => {
        const dayRecord = attMap[dateKey]?.[studentId];
        if (dayRecord && dayRecord.status) {
            if (dayRecord.status === "H") H++;
            else if (dayRecord.status === "I") I++;
            else if (dayRecord.status === "S") S++;
            else if (dayRecord.status === "A") A++;
        }
    });
    const totalRecorded = H + I + S + A;
    const pct = totalRecorded > 0 ? Math.round((H / totalRecorded) * 100) : 100;
    return { H, I, S, A, totalRecorded, pct };
}

// ============================================================================
// KOMPONEN VISUAL AVATAR, ID CARD MODAL, KALENDER MINI & TOAST
// ============================================================================

function renderAvatarHtml(name, photoUrl, sizeClass = "w-11 h-11", textClass = "text-sm") {
    const cleanName = String(name || "Anggota").trim();
    const initials = cleanName
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0] || "")
        .join("")
        .toUpperCase() || "M";

    const cleanUrl = String(photoUrl || "").trim();
    if (cleanUrl.length > 4) {
        return `
            <div class="${sizeClass} rounded-xl border-2 border-neo-ink overflow-hidden bg-neo-yellow shrink-0 shadow-neo-sm flex items-center justify-center relative">
                <img
                    src="${cleanUrl}"
                    alt="${cleanName}"
                    onload="this.style.display='block'; if(this.nextElementSibling) this.nextElementSibling.style.display='none';"
                    onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';"
                    class="w-full h-full object-cover"
                >
                <span style="display:none" class="w-full h-full items-center justify-center font-display font-extrabold ${textClass} text-neo-ink">${initials}</span>
            </div>
        `;
    }
    return `
        <div class="${sizeClass} rounded-xl border-2 border-neo-ink bg-neo-yellow text-neo-ink shrink-0 shadow-neo-sm flex items-center justify-center font-display font-extrabold ${textClass}">
            ${initials}
        </div>
    `;
}

/**
 * Membuka Kartu Nama / ID Card Digital saat nama anggota diklik di tab Struktur & Anggota
 */
window.openStudentIdCardModal = function (studentId) {
    const stu = appData.students.find((s) => s.id === studentId);
    if (!stu) return;

    const cfg = appData.config;
    const code = cfg.classCode || "MDV";
    const paddedAbsen = String(stu.absen).padStart(2, "0");

    const badgeEl = document.getElementById("idCardClassBadge");
    if (badgeEl) badgeEl.innerHTML = `<i class="fa-solid fa-id-badge"></i> ${cfg.className || "MEDIVANCE"} ID CARD`;

    const photoBox = document.getElementById("idCardPhotoContainer");
    if (photoBox) {
        const cleanUrl = String(stu.photoUrl || "").trim();
        const initials = String(stu.name || "M").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
        if (cleanUrl.length > 4) {
            photoBox.innerHTML = `<img src="${cleanUrl}" alt="${stu.name}" class="w-full h-full object-cover">`;
        } else {
            photoBox.innerHTML = `<span class="font-display font-extrabold text-3xl text-neo-ink">${initials}</span>`;
        }
    }

    document.getElementById("idCardRolePill").textContent = (stu.role || "Anggota Kelas").toUpperCase();
    document.getElementById("idCardStudentName").textContent = stu.name;
    document.getElementById("idCardSchoolSubtitle").textContent = `${cfg.schoolName || "SMA NEGERI 5 AMBON"} • TA ${cfg.academicYear || "2026/2027"}`;
    document.getElementById("idCardAbsen").textContent = `#${paddedAbsen}`;
    document.getElementById("idCardGender").textContent = stu.gender === "P" ? "Perempuan" : "Laki-laki";
    document.getElementById("idCardPiket").textContent = stu.piket || "Senin";
    document.getElementById("idCardQuoteText").textContent = `"${stu.quote || cfg.classMotto || "Together We Grow, Together We Heal."}"`;
    document.getElementById("idCardSerialCode").textContent = `ID-${code}-${String(stu.absen).padStart(3, "0")}`;

    const btnSwitch = document.getElementById("btnSwitchIdToFeeCard");
    if (btnSwitch) {
        btnSwitch.onclick = () => {
            closeModal("modalStudentIdCard");
            openStudentCardModal(stu.id);
        };
    }

    openModal("modalStudentIdCard");
};

window.openModal = function (id) {
    document.getElementById(id)?.classList.remove("hidden");
};

window.closeModal = function (id) {
    document.getElementById(id)?.classList.add("hidden");
};

function showToast(message, bgColor = "bg-neo-yellow") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `neo-card ${bgColor} text-neo-ink p-3 pointer-events-auto flex items-center justify-between gap-2 transition-all duration-200`;
    toast.innerHTML = `
        <div class="flex items-center gap-2 text-xs font-extrabold text-neo-ink">
            <i class="fa-solid fa-bell"></i>
            <span>${message}</span>
        </div>
        <button type="button" onclick="this.parentElement.remove()" class="font-bold text-xs px-1.5 border border-neo-ink bg-white text-neo-ink rounded">✕</button>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast && toast.parentElement) toast.remove();
    }, 3500);
}

// ============================================================================
// KALENDER MINI INTERAKTIF DI POJOK KANAN BAWAH WEB & HARI LIBUR MERAH
// ============================================================================

window.changeMiniCalendarMonth = function (delta) {
    if (delta === 0) {
        const now = new Date();
        miniCalYear = now.getFullYear();
        miniCalMonth = now.getMonth();
    } else {
        miniCalMonth += delta;
        if (miniCalMonth < 0) {
            miniCalMonth = 11;
            miniCalYear--;
        } else if (miniCalMonth > 11) {
            miniCalMonth = 0;
            miniCalYear++;
        }
    }
    renderMiniCalendar();
};

function renderMiniCalendar() {
    const labelEl = document.getElementById("miniCalMonthYearLabel");
    const gridEl = document.getElementById("miniCalendarDaysGrid");
    const noteEl = document.getElementById("miniCalendarHolidaysNote");
    if (!labelEl || !gridEl) return;

    const monthNames = [
        "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
        "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"
    ];
    labelEl.textContent = `${monthNames[miniCalMonth]} ${miniCalYear}`;

    const firstDayObj = new Date(miniCalYear, miniCalMonth, 1);
    const totalDays = new Date(miniCalYear, miniCalMonth + 1, 0).getDate();

    // Konversi indeks hari (Senin = 0 ... Sabtu = 5, Minggu = 6)
    const startOffset = (firstDayObj.getDay() + 6) % 7;
    const todayIso = toLocalISODate(new Date());
    const holidaysList = Array.isArray(appData.config.holidays) ? appData.config.holidays : [];

    const monthPrefix = `${miniCalYear}-${String(miniCalMonth + 1).padStart(2, "0")}`;
    const holidaysThisMonth = holidaysList
        .filter((h) => h.date && h.date.startsWith(monthPrefix))
        .sort((a, b) => a.date.localeCompare(b.date));

    const holidayMap = {};
    holidaysThisMonth.forEach((h) => {
        holidayMap[h.date] = h.name;
    });

    let cellsHtml = "";
    for (let i = 0; i < startOffset; i++) {
        cellsHtml += `<div class="mini-cal-cell opacity-20"></div>`;
    }

    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
        const dd = String(dayNum).padStart(2, "0");
        const dateIso = `${monthPrefix}-${dd}`;
        const dayOfWeek = (startOffset + dayNum - 1) % 7; // 5 = Sabtu, 6 = Minggu
        const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
        const holidayName = holidayMap[dateIso] || "";
        const isToday = dateIso === todayIso;

        const classes = ["mini-cal-cell"];
        if (holidayName) classes.push("is-holiday");
        else if (isWeekend) classes.push("is-weekend");
        if (isToday) classes.push("is-today");

        const tooltip = holidayName
            ? `Libur: ${holidayName} (${dateIso})`
            : isWeekend
              ? `Akhir Pekan Libur (${dateIso})`
              : dateIso;

        cellsHtml += `
            <div title="${tooltip}" class="${classes.join(" ")} cursor-default">
                ${dayNum}
            </div>
        `;
    }

    gridEl.innerHTML = cellsHtml;

    if (noteEl) {
        if (holidaysThisMonth.length === 0) {
            noteEl.innerHTML = `<div class="text-muted-adaptive"><span class="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1"></span>Sabtu & Minggu Libur Rutin</div>`;
        } else {
            noteEl.innerHTML = holidaysThisMonth
                .map(
                    (h) => `
                    <div class="flex items-center justify-between text-rose-600">
                        <span class="truncate"><i class="fa-solid fa-calendar-xmark mr-1"></i>${h.name}</span>
                        <span class="font-mono text-[9px] bg-rose-100 text-rose-900 px-1 rounded border border-rose-300 shrink-0">${formatShortMondayLabel(h.date)}</span>
                    </div>
                `
                )
                .join("");
        }
    }
}

window.handleAddCustomHoliday = async function () {
    if (!canEditInCurrentView("pengaturan")) return;
    const dateVal = document.getElementById("admHolidayDateInput")?.value || "";
    const nameVal = (document.getElementById("admHolidayNameInput")?.value || "").trim();

    if (!dateVal || !nameVal) {
        showToast("Pilih tanggal libur dan isi keterangannya terlebih dahulu!", "bg-neo-coral");
        return;
    }

    if (!Array.isArray(appData.config.holidays)) appData.config.holidays = [];
    const existingIdx = appData.config.holidays.findIndex((h) => h.date === dateVal);
    if (existingIdx >= 0) {
        appData.config.holidays[existingIdx].name = nameVal;
    } else {
        appData.config.holidays.push({
            id: Date.now(),
            date: dateVal,
            name: nameVal
        });
    }

    appData.config.holidays.sort((a, b) => a.date.localeCompare(b.date));
    document.getElementById("admHolidayDateInput").value = "";
    document.getElementById("admHolidayNameInput").value = "";

    await saveToCloudDatabase(`Hari libur "${nameVal}" (${dateVal}) berhasil ditambahkan ke kalender!`);
    renderAdminWorkspace();
};

window.deleteCustomHoliday = async function (id) {
    if (!canEditInCurrentView("pengaturan")) return;
    appData.config.holidays = (appData.config.holidays || []).filter((h) => h.id !== id);
    await saveToCloudDatabase("Tanggal libur dihapus dari kalender.");
    renderAdminWorkspace();
};

// ============================================================================
// RENDER IDENTITAS, LOGO HEADER WEBSITE, MEDIA SOSIAL & BERANDA PUBLIK
// ============================================================================

window.switchTab = function (tabId) {
    activeTabId = tabId || "dashboard";
    const tabs = ["dashboard", "keuangan", "absensi", "mading", "info", "jadwal", "album", "siswa"];
    tabs.forEach((t) => {
        const viewEl = document.getElementById(`view-${t}`);
        const btnDrawer = document.getElementById(`drawertab-${t}`);
        if (t === activeTabId) {
            viewEl?.classList.remove("hidden");
            btnDrawer?.classList.add("active");
        } else {
            viewEl?.classList.add("hidden");
            btnDrawer?.classList.remove("active");
        }
    });
    if (activeTabId === "absensi") renderPublicAttendanceView();
    window.scrollTo({ top: 0, behavior: "smooth" });
};

function renderHeaderAndHeroIdentity() {
    const cfg = appData.config;
    const code = cfg.classCode || "MDV";
    const name = cfg.className || "MEDIVANCE";
    const school = cfg.schoolName || "SMA NEGERI 5 AMBON";
    const motto = cfg.classMotto || "Together We Grow, Together We Heal";
    const semLabel = cfg.semesterName || "Semester Ganjil";

    const webLogoUrl = (cfg.websiteLogoUrl || cfg.classLogoUrl || "").trim();
    const classLogoUrl = (cfg.classLogoUrl || cfg.websiteLogoUrl || "").trim();
    const bgUrl = (cfg.heroBgUrl || "").trim() || DEFAULT_HERO_BG;

    // Update Favicon jika ada Logo Header Website
    const favEl = document.getElementById("dynamicFavicon");
    if (favEl && webLogoUrl) {
        favEl.href = webLogoUrl;
    }

    ["headerClassCode", "drawerLogoCode", "heroSmallLogoCode", "loginFullLogoCode", "footerSmallLogoCode"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = code;
    });

    const elHeaderName = document.getElementById("headerClassName");
    if (elHeaderName) elHeaderName.textContent = name;
    const elSchoolBadge = document.getElementById("headerSchoolBadge");
    if (elSchoolBadge) elSchoolBadge.textContent = school;
    const elDrawerName = document.getElementById("drawerClassName");
    if (elDrawerName) elDrawerName.textContent = name;
    const elHeroTitle = document.getElementById("heroClassIdentityTitle");
    if (elHeroTitle) elHeroTitle.textContent = `KELAS ${name}`;
    const loginNameEl = document.getElementById("loginFullClassName");
    if (loginNameEl) loginNameEl.textContent = `KELAS ${name}`;

    const mottoBadge = document.getElementById("heroMottoBadge");
    if (mottoBadge) mottoBadge.textContent = `"${motto.toUpperCase()}"`;
    const loginMotto = document.getElementById("loginFullMotto");
    if (loginMotto) loginMotto.textContent = `"${motto.toUpperCase()}"`;
    const loginAcYear = document.getElementById("loginScreenAcYear");
    if (loginAcYear) loginAcYear.textContent = `${semLabel} • TA ${cfg.academicYear || "2026/2027"}`;

    const mottoSub = document.getElementById("heroMottoSubtext");
    if (mottoSub) mottoSub.textContent = motto;
    const aboutMotto = document.getElementById("aboutMottoPill");
    if (aboutMotto) aboutMotto.textContent = `"${motto}"`;

    const aboutTitle = document.getElementById("aboutClassTitle");
    if (aboutTitle) aboutTitle.textContent = `Mengenal Keluarga Besar ${name}`;
    const aboutDesc = document.getElementById("aboutClassDesc");
    if (aboutDesc) {
        aboutDesc.textContent =
            cfg.aboutClass ||
            "MEDIVANCE merupakan ruang bertumbuh bagi setiap anggota kelas untuk saling mendukung dalam meraih keunggulan akademik, membangun karakter yang berempati tinggi, menjaga kekompakan, serta menciptakan kenangan masa sekolah yang bermakna.";
    }

    // Logo Header Website di Navbar Atas & Drawer
    applyImageWithFallback(document.getElementById("headerClassLogoImg"), document.getElementById("headerClassCode"), webLogoUrl);
    applyImageWithFallback(document.getElementById("drawerLogoImg"), document.getElementById("drawerLogoCode"), webLogoUrl);

    // Logo Kelas di Hero, Login, & Footer
    applyImageWithFallback(document.getElementById("heroSmallLogoImg"), document.getElementById("heroSmallLogoCode"), classLogoUrl);
    applyImageWithFallback(document.getElementById("loginFullLogoImg"), document.getElementById("loginFullLogoCode"), classLogoUrl);
    applyImageWithFallback(document.getElementById("footerSmallLogoImg"), document.getElementById("footerSmallLogoCode"), classLogoUrl);

    ["heroBackgroundImg", "loginFullBgImg"].forEach((id) => {
        const imgEl = document.getElementById(id);
        if (imgEl) {
            imgEl.onerror = () => {
                if (imgEl.src !== DEFAULT_HERO_BG) imgEl.src = DEFAULT_HERO_BG;
            };
            if (imgEl.getAttribute("src") !== bgUrl) {
                imgEl.src = bgUrl;
            }
        }
    });

    const target = document.getElementById("typewriterTextTarget");
    if (target) target.textContent = (cfg.welcomeTypingText || `SELAMAT DATANG DI ${name}`).trim();

    const heroDesc = document.getElementById("heroWelcomeDesc");
    if (heroDesc) {
        heroDesc.textContent =
            cfg.heroSubtitle ||
            "Keluarga besar penuh semangat kolaborasi, kepedulian, dan prestasi akademik yang tumbuh bersama dalam satu kesatuan.";
    }

    const subEl = document.getElementById("headerClassSubtitle");
    if (subEl) subEl.textContent = `${motto} • ${semLabel} ${cfg.academicYear || "-"}`;
    const drwAc = document.getElementById("drawerAcademicYear");
    if (drwAc) drwAc.textContent = `${semLabel} ${cfg.academicYear || "-"}`;
    const drwWali = document.getElementById("drawerWaliKelas");
    if (drwWali) drwWali.textContent = `Wali Kelas: ${cfg.waliKelas || "-"}`;

    // Footer Tengah & Media Sosial Kiri Bawah
    const footEl = document.getElementById("footerClassIdentity");
    if (footEl) footEl.textContent = `${name} • ${school}`;
    const footMotto = document.getElementById("footerMottoText");
    if (footMotto) footMotto.textContent = `"${motto}"`;
    const footLegal = document.getElementById("footerLegalCopyright");
    if (footLegal) footLegal.textContent = `© ${new Date().getFullYear()} ${name} Official Class Portal • All Rights Reserved.`;

    const igRaw = (cfg.socialIg || "@medivance.class").trim();
    const ttRaw = (cfg.socialTiktok || "@medivance.official").trim();
    const emRaw = (cfg.socialEmail || "medivance@kelas.id").trim();

    const igLink = document.getElementById("footerSocialIg");
    const igTxt = document.getElementById("footerSocialIgText");
    if (igLink && igTxt) {
        igTxt.textContent = igRaw.startsWith("http") ? "Instagram" : igRaw;
        igLink.href = igRaw.startsWith("http") ? igRaw : `https://instagram.com/${igRaw.replace(/^@/, "")}`;
    }

    const ttLink = document.getElementById("footerSocialTiktok");
    const ttTxt = document.getElementById("footerSocialTiktokText");
    if (ttLink && ttTxt) {
        ttTxt.textContent = ttRaw.startsWith("http") ? "TikTok" : ttRaw;
        ttLink.href = ttRaw.startsWith("http") ? ttRaw : `https://tiktok.com/@${ttRaw.replace(/^@/, "")}`;
    }

    const emLink = document.getElementById("footerSocialEmail");
    const emTxt = document.getElementById("footerSocialEmailText");
    if (emLink && emTxt) {
        emTxt.textContent = emRaw;
        emLink.href = `mailto:${emRaw}`;
    }

    const madingBadge = document.getElementById("badgeMadingCount");
    if (madingBadge) madingBadge.textContent = (appData.stickyNotes || []).length;
    const siswaBadge = document.getElementById("badgeSiswaCount");
    if (siswaBadge) siswaBadge.textContent = (appData.students || []).length;

    const marqueeText = cfg.marqueeText || `Selamat datang di Portal Resmi ${name} • ${motto}`;
    const mqEl = document.getElementById("topMarqueeContent");
    if (mqEl) {
        mqEl.innerHTML = `
            <span class="mx-6 flex items-center gap-2"><span class="bg-neo-yellow text-neo-ink px-2 py-0.5 rounded-sm font-extrabold">${name}</span> ${marqueeText}</span>
            <span class="mx-6 flex items-center gap-2"><span class="bg-neo-mint text-neo-ink px-2 py-0.5 rounded-sm font-extrabold">${semLabel.toUpperCase()}</span> TA ${cfg.academicYear || "2026/2027"}</span>
            <span class="mx-6 flex items-center gap-2"><span class="bg-neo-yellow text-neo-ink px-2 py-0.5 rounded-sm font-extrabold">${school}</span> "${motto}"</span>
        `;
    }

    renderMiniCalendar();
}

function renderDashboard() {
    const stats = calculateFinancialSummary();
    const cfg = appData.config;

    const heroAc = document.getElementById("heroAcademicYear");
    if (heroAc) heroAc.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${cfg.semesterName || "Semester Ganjil"} • TA ${cfg.academicYear || "-"}`;
    const heroWali = document.getElementById("heroWaliKelas");
    if (heroWali) heroWali.innerHTML = `<i class="fa-solid fa-user-tie"></i> Wali Kelas: ${cfg.waliKelas || "-"}`;
    const qcFee = document.getElementById("quickCheckFeeLabel");
    if (qcFee) qcFee.textContent = `${formatRupiah(stats.fee)} / Senin`;

    const dashWaliBox = document.getElementById("dashboardWaliCard");
    if (dashWaliBox) {
        dashWaliBox.innerHTML = `
            ${renderAvatarHtml(cfg.waliKelas || "Wali Kelas", cfg.waliPhotoUrl, "w-14 h-14", "text-base")}
            <div class="min-w-0">
                <span class="neo-badge bg-neo-yellow text-neo-ink text-[10px]">WALI KELAS</span>
                <h4 class="font-display font-extrabold text-sm sm:text-base truncate mt-1">${cfg.waliKelas || "Belum Ditentukan"}</h4>
                <p class="text-xs font-semibold text-muted-adaptive truncate">${cfg.waliTitle || "Pembina & Wali Kelas"}</p>
            </div>
        `;
    }

    const officersCount = appData.students.filter((s) => s.role !== "Anggota Kelas").length;
    document.getElementById("statCountStudents").textContent = appData.students.length;
    document.getElementById("statCountOfficers").textContent = officersCount;
    document.getElementById("statCountAlbums").textContent = appData.albums.length;

    document.getElementById("kpiSaldoAkhir").textContent = formatRupiah(stats.currentBalance);
    document.getElementById("kpiTotalMasuk").textContent = formatRupiah(stats.totalIncome);
    document.getElementById("kpiPersenLunas").textContent = `Iuran: ${formatRupiah(stats.totalIuranPaid)} • Kas Lain: ${formatRupiah(stats.extraIncome)}`;
    document.getElementById("kpiTotalKeluar").textContent = formatRupiah(stats.totalExpense);
    document.getElementById("kpiJumlahTransaksiKeluar").textContent = `${stats.expenseCount} transaksi pengeluaran`;
    document.getElementById("kpiRasioLunas").textContent = `${stats.complianceRatio}%`;
    document.getElementById("kpiProgressBar").style.width = `${stats.complianceRatio}%`;

    // Pengumuman Terbaru di Beranda
    const annContainer = document.getElementById("dashboardAnnouncementsList");
    if (annContainer) {
        if (appData.announcements.length === 0) {
            annContainer.innerHTML = `
                <div class="border-2 border-dashed border-neo-ink/40 rounded-lg p-6 text-center text-xs font-bold text-muted-adaptive">
                    Belum ada pengumuman atau tugas kelas saat ini.
                </div>
            `;
        } else {
            const badgeColors = {
                TUGAS: "bg-neo-yellow text-neo-ink",
                KAS: "bg-neo-mint text-neo-ink",
                PENTING: "bg-neo-coral text-white",
                EVENT: "bg-neo-sky text-neo-ink"
            };
            annContainer.innerHTML = appData.announcements
                .slice(0, 3)
                .map(
                    (item) => `
                    <div onclick="switchTab('info')" class="cursor-pointer border-2.5 border-neo-ink rounded-lg p-3 bg-neo-bg hover:bg-neo-surface transition flex items-start justify-between gap-3">
                        <div class="space-y-1 min-w-0 flex-1">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="neo-badge ${badgeColors[item.category] || "bg-white text-neo-ink"} text-[10px]">${item.category}</span>
                                <span class="font-mono text-[11px] font-bold text-muted-adaptive"><i class="fa-regular fa-clock"></i> ${item.deadline}</span>
                            </div>
                            <h4 class="font-display font-extrabold text-sm truncate">${item.title}</h4>
                            <p class="text-xs font-medium text-muted-adaptive line-clamp-2">${item.body}</p>
                        </div>
                        ${
                            item.photoUrl
                                ? `<img src="${item.photoUrl}" alt="Lampiran" class="w-14 h-14 rounded-lg border-2 border-neo-ink object-cover shrink-0">`
                                : ""
                        }
                    </div>
                `
                )
                .join("");
        }
    }

    // Regu Piket Hari Ini
    const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const todayIdx = new Date().getDay();
    const currentDay = todayIdx >= 1 && todayIdx <= 6 ? dayNames[todayIdx] : "Senin";
    const piketDayEl = document.getElementById("dashboardPiketDay");
    if (piketDayEl) piketDayEl.textContent = `Hari ${currentDay}`;

    const piketMembers = appData.students.filter((s) => s.piket === currentDay);
    const piketBox = document.getElementById("dashboardPiketMembers");
    if (piketBox) {
        if (piketMembers.length === 0) {
            piketBox.innerHTML = `<span class="text-xs font-bold text-muted-adaptive">Tidak ada jadwal piket tercatat.</span>`;
        } else {
            piketBox.innerHTML = piketMembers
                .map(
                    (m) => `
                    <button type="button" onclick="openStudentIdCardModal(${m.id})" class="bg-white text-neo-ink border-2 border-neo-ink shadow-neo-sm px-2.5 py-1 rounded-md text-xs font-extrabold flex items-center gap-1.5 hover:bg-neo-yellow transition">
                        <span class="font-mono bg-neo-ink text-white px-1.5 py-0.5 rounded text-[10px]">#${m.absen}</span>
                        <span>${m.name}</span>
                    </button>
                `
                )
                .join("");
        }
    }

    // Sorotan Album Kenangan di Beranda Utama (4 Foto Terbaru)
    const albumShowcase = document.getElementById("dashboardAlbumShowcaseGrid");
    if (albumShowcase) {
        if (!Array.isArray(appData.albums) || appData.albums.length === 0) {
            albumShowcase.innerHTML = `
                <div class="col-span-full border-2 border-dashed border-neo-ink/40 rounded-xl p-6 text-center text-xs font-bold text-muted-adaptive">
                    Belum ada dokumentasi di Album Kenangan Kelas.
                </div>
            `;
        } else {
            albumShowcase.innerHTML = appData.albums
                .slice(0, 4)
                .map(
                    (alb) => `
                    <div onclick="openAlbumLightbox(${alb.id})" class="cursor-pointer neo-card neo-card-hover bg-neo-bg overflow-hidden flex flex-col">
                        <div class="h-36 bg-neo-surface border-b-2 border-neo-ink relative overflow-hidden">
                            <img src="${alb.url}" alt="${alb.title}" onerror="this.src='https://placehold.co/600x400/FFE600/111111?text=Momen+Kelas'" class="w-full h-full object-cover">
                            <span class="neo-badge bg-neo-yellow text-neo-ink absolute top-2 left-2 text-[9px]">${alb.category}</span>
                        </div>
                        <div class="p-3">
                            <div class="font-mono text-[10px] font-bold text-muted-adaptive">${alb.date}</div>
                            <h4 class="font-display font-extrabold text-xs sm:text-sm truncate mt-0.5">${alb.title}</h4>
                        </div>
                    </div>
                `
                )
                .join("");
        }
    }

    handleQuickCheck(document.getElementById("quickCheckInput")?.value || "");
    renderStickyNotesWall();
}

// ============================================================================
// ABSENSI DIGITAL MULTI-MODE (DENGAN FITUR HAPUS PILIHAN ✕)
// ============================================================================

const STATUS_BADGE_MAP = {
    H: `<span class="neo-badge bg-neo-lime text-neo-ink">✓ H</span>`,
    I: `<span class="neo-badge bg-neo-sky text-neo-ink">✉ I</span>`,
    S: `<span class="neo-badge bg-neo-yellow text-neo-ink">✚ S</span>`,
    A: `<span class="neo-badge bg-neo-coral text-white">✕ A</span>`
};

window.switchPublicAttendanceMode = function (mode) {
    publicAttendanceMode = mode;
    ["DAILY", "WEEKLY", "MONTHLY"].forEach((m) => {
        const btn = document.getElementById(`pubAttMode-${m}`);
        if (btn) btn.classList.toggle("active", m === mode);
    });

    document.getElementById("pubAttFilterDailyWrap")?.classList.toggle("hidden", mode !== "DAILY");
    document.getElementById("pubAttFilterWeeklyWrap")?.classList.toggle("hidden", mode !== "WEEKLY");
    document.getElementById("pubAttFilterMonthlyWrap")?.classList.toggle("hidden", mode !== "MONTHLY");

    renderPublicAttendanceView();
};

window.handlePublicAttendanceDateChange = function (val) {
    if (!val) return;
    selectedPublicAttendanceDate = val;
    renderPublicAttendanceView();
};

window.handlePublicAttendanceWeekChange = function (val) {
    if (!val) return;
    selectedPublicAttendanceWeek = val;
    renderPublicAttendanceView();
};

window.handlePublicAttendanceMonthChange = function (val) {
    if (!val) return;
    selectedPublicAttendanceMonth = val;
    renderPublicAttendanceView();
};

window.renderPublicAttendanceView = function () {
    const thead = document.getElementById("pubAttTableHead");
    const tbody = document.getElementById("pubAttTableBody");
    if (!thead || !tbody) return;

    const semBadge = document.getElementById("publicAbsensiSemesterBadge");
    if (semBadge) {
        semBadge.textContent = `${appData.config.semesterName || "Semester Ganjil"} • TA ${appData.config.academicYear || "2026/2027"}`;
    }

    const q = (document.getElementById("pubAttSearchInput")?.value || "").toLowerCase();
    const filteredStudents = appData.students.filter(
        (s) => s.name.toLowerCase().includes(q) || String(s.absen).includes(q)
    );

    const subEl = document.getElementById("pubAttDateSubtitle");
    let totalH = 0, totalI = 0, totalS = 0, totalA = 0;

    if (publicAttendanceMode === "DAILY") {
        if (subEl) subEl.textContent = `Harian: ${selectedPublicAttendanceDate}`;
        const dayMap = appData.attendance?.[selectedPublicAttendanceDate] || {};

        appData.students.forEach((s) => {
            const st = dayMap[s.id]?.status || "";
            if (st === "H") totalH++;
            else if (st === "I") totalI++;
            else if (st === "S") totalS++;
            else if (st === "A") totalA++;
        });

        thead.innerHTML = `
            <tr>
                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center w-10">No</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[180px]">Anggota Kelas</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 text-center">Status (${selectedPublicAttendanceDate})</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700">Catatan / Keterangan</th>
                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center">Total Semester (H/I/S/A)</th>
                <th class="py-2.5 px-3 text-right">% Kehadiran</th>
            </tr>
        `;

        if (filteredStudents.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada data anggota kelas.</td></tr>`;
        } else {
            tbody.innerHTML = filteredStudents
                .map((stu) => {
                    const rec = dayMap[stu.id] || {};
                    const st = rec.status || "";
                    const note = rec.note || "-";
                    const cum = calculateStudentAttendanceStats(stu.id);
                    return `
                        <tr>
                            <td class="py-2.5 px-2.5 border-r-2 border-neo-ink text-center font-mono font-extrabold">${String(stu.absen).padStart(2, "0")}</td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink">
                                <button type="button" onclick="openStudentIdCardModal(${stu.id})" class="flex items-center gap-2.5 text-left group">
                                    ${renderAvatarHtml(stu.name, stu.photoUrl, "w-8 h-8", "text-[10px]")}
                                    <div>
                                        <div class="font-extrabold group-hover:underline">${stu.name}</div>
                                        <div class="text-[10px] font-mono text-muted-adaptive">${stu.role}</div>
                                    </div>
                                </button>
                            </td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink text-center">
                                ${STATUS_BADGE_MAP[st] || `<span class="font-mono text-[10px] text-muted-adaptive">Belum Diabsen</span>`}
                            </td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink text-xs text-muted-adaptive">${note}</td>
                            <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono text-[11px]">
                                <span class="text-emerald-600 font-extrabold">${cum.H}H</span> /
                                <span class="text-sky-600 font-bold">${cum.I}I</span> /
                                <span class="text-amber-600 font-bold">${cum.S}S</span> /
                                <span class="text-rose-600 font-bold">${cum.A}A</span>
                            </td>
                            <td class="py-2 px-3 text-right font-mono font-extrabold ${cum.pct >= 80 ? "text-emerald-500" : "text-rose-500"}">${cum.pct}%</td>
                        </tr>
                    `;
                })
                .join("");
        }
    } else if (publicAttendanceMode === "WEEKLY") {
        const weekDays = getSixSchoolDaysOfWeek(selectedPublicAttendanceWeek);
        const weekIsoKeys = weekDays.map((d) => d.iso);
        if (subEl) subEl.textContent = `Mingguan: ${weekDays[0].shortDate} s/d ${weekDays[5].shortDate}`;

        appData.students.forEach((s) => {
            const st = calculateStudentAttendanceStats(s.id, weekIsoKeys);
            totalH += st.H;
            totalI += st.I;
            totalS += st.S;
            totalA += st.A;
        });

        thead.innerHTML = `
            <tr>
                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center w-10">No</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[170px]">Anggota Kelas</th>
                ${weekDays.map((d) => `<th class="py-2 px-2 border-r-2 border-neutral-700 text-center min-w-[64px]"><div class="text-[9px] text-neo-yellow">${d.dayName.toUpperCase()}</div><div>${d.shortDate}</div></th>`).join("")}
                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center">Rekap Minggu</th>
                <th class="py-2.5 px-3 text-right">% Minggu</th>
            </tr>
        `;

        tbody.innerHTML = filteredStudents.length === 0
            ? `<tr><td colspan="10" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada data anggota kelas.</td></tr>`
            : filteredStudents
                .map((stu) => {
                    const wkStats = calculateStudentAttendanceStats(stu.id, weekIsoKeys);
                    return `
                        <tr>
                            <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono font-extrabold">${String(stu.absen).padStart(2, "0")}</td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink font-extrabold">${stu.name}</td>
                            ${weekDays.map((d) => `<td class="py-2 px-1.5 border-r-2 border-neo-ink text-center">${STATUS_BADGE_MAP[appData.attendance?.[d.iso]?.[stu.id]?.status || ""] || `<span class="font-mono text-[10px] text-muted-adaptive">-</span>`}</td>`).join("")}
                            <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono text-[11px]"><span class="text-emerald-600 font-extrabold">${wkStats.H}H</span>/${wkStats.I}I/${wkStats.S}S/<span class="text-rose-600 font-bold">${wkStats.A}A</span></td>
                            <td class="py-2 px-3 text-right font-mono font-extrabold ${wkStats.pct >= 80 ? "text-emerald-500" : "text-rose-500"}">${wkStats.pct}%</td>
                        </tr>
                    `;
                })
                .join("");
    } else {
        const monthPrefix = selectedPublicAttendanceMonth || toLocalISOMonth();
        const monthDates = Object.keys(appData.attendance || {}).filter((d) => d.startsWith(monthPrefix)).sort();
        if (subEl) subEl.textContent = `Bulanan: ${formatMonthTitle(monthPrefix)} (${monthDates.length} Hari Tercatat)`;

        appData.students.forEach((s) => {
            const st = calculateStudentAttendanceStats(s.id, monthDates);
            totalH += st.H;
            totalI += st.I;
            totalS += st.S;
            totalA += st.A;
        });

        thead.innerHTML = `
            <tr>
                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center w-10">No</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[180px]">Anggota Kelas</th>
                ${monthDates.map((d) => `<th class="py-2 px-1.5 border-r-2 border-neutral-700 text-center min-w-[46px]"><div class="text-[9px] text-neo-yellow">TGL</div><div>${d.split("-")[2]}</div></th>`).join("")}
                <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center">H</th>
                <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center">I</th>
                <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center">S</th>
                <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center">A</th>
                <th class="py-2.5 px-3 text-right">% Bulan</th>
            </tr>
        `;

        tbody.innerHTML = filteredStudents.length === 0
            ? `<tr><td colspan="${monthDates.length + 7}" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada data anggota kelas.</td></tr>`
            : filteredStudents
                .map((stu) => {
                    const mStats = calculateStudentAttendanceStats(stu.id, monthDates);
                    return `
                        <tr>
                            <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono font-extrabold">${String(stu.absen).padStart(2, "0")}</td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink font-extrabold">${stu.name}</td>
                            ${monthDates.map((d) => {
                                const st = appData.attendance?.[d]?.[stu.id]?.status || "-";
                                const bg = st === "H" ? "bg-neo-lime text-neo-ink" : st === "I" ? "bg-neo-sky text-neo-ink" : st === "S" ? "bg-neo-yellow text-neo-ink" : st === "A" ? "bg-neo-coral text-white" : "";
                                return `<td class="py-1.5 px-1 border-r-2 border-neo-ink text-center font-mono text-[10px] font-extrabold"><span class="px-1.5 py-0.5 rounded ${bg}">${st}</span></td>`;
                            }).join("")}
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-extrabold text-emerald-500">${mStats.H}</td>
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-bold text-sky-500">${mStats.I}</td>
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-bold text-amber-500">${mStats.S}</td>
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-extrabold text-rose-500">${mStats.A}</td>
                            <td class="py-2 px-3 text-right font-mono font-extrabold ${mStats.pct >= 80 ? "text-emerald-500" : "text-rose-500"}">${mStats.pct}%</td>
                        </tr>
                    `;
                })
                .join("");
    }

    document.getElementById("pubAttCountH").textContent = totalH;
    document.getElementById("pubAttCountI").textContent = totalI;
    document.getElementById("pubAttCountS").textContent = totalS;
    document.getElementById("pubAttCountA").textContent = totalA;
};

window.switchAdminAttendanceMode = function (mode) {
    adminAttendanceMode = mode;
    ["DAILY", "WEEKLY", "MONTHLY"].forEach((m) => {
        const btn = document.getElementById(`admAttMode-${m}`);
        if (btn) btn.classList.toggle("active", m === mode);
    });

    document.getElementById("admAttDailyWrap")?.classList.toggle("hidden", mode !== "DAILY");
    document.getElementById("admAttWeeklyWrap")?.classList.toggle("hidden", mode !== "WEEKLY");
    document.getElementById("admAttMonthlyWrap")?.classList.toggle("hidden", mode !== "MONTHLY");
    document.getElementById("btnMarkAllPresentAdmin")?.classList.toggle("hidden", mode !== "DAILY");
    document.getElementById("btnClearAllAttendanceAdmin")?.classList.toggle("hidden", mode !== "DAILY");

    renderAdminAttendanceSection();
};

window.handleAdminAttendanceDateChange = function (val) {
    if (!val) return;
    selectedAttendanceDate = val;
    renderAdminAttendanceSection();
};

window.handleAdminAttendanceWeekChange = function (val) {
    if (!val) return;
    selectedAttendanceWeek = val;
    renderAdminAttendanceSection();
};

window.handleAdminAttendanceMonthChange = function (val) {
    if (!val) return;
    selectedAttendanceMonth = val;
    renderAdminAttendanceSection();
};

function renderAdminAttendanceSection() {
    const thead = document.getElementById("admAttendanceTableHead");
    const tbody = document.getElementById("admAttendanceTableBody");
    if (!thead || !tbody) return;

    const dInput = document.getElementById("admAttendanceDateInput");
    if (dInput && dInput.value !== selectedAttendanceDate) dInput.value = selectedAttendanceDate;
    const wInput = document.getElementById("admAttendanceWeekInput");
    if (wInput && wInput.value !== selectedAttendanceWeek) wInput.value = selectedAttendanceWeek;
    const mInput = document.getElementById("admAttendanceMonthInput");
    if (mInput && mInput.value !== selectedAttendanceMonth) mInput.value = selectedAttendanceMonth;

    const titleEl = document.getElementById("admAttendanceTableTitle");
    const q = (document.getElementById("admAttSearchInput")?.value || "").toLowerCase();
    const filteredStudents = appData.students.filter(
        (s) => s.name.toLowerCase().includes(q) || String(s.absen).includes(q)
    );

    let totalH = 0, totalI = 0, totalS = 0, totalA = 0;

    if (adminAttendanceMode === "DAILY") {
        if (titleEl) titleEl.textContent = `Input Presensi Harian — Tanggal: ${selectedAttendanceDate}`;
        const dayMap = appData.attendance?.[selectedAttendanceDate] || {};

        appData.students.forEach((s) => {
            const st = dayMap[s.id]?.status || "";
            if (st === "H") totalH++;
            else if (st === "I") totalI++;
            else if (st === "S") totalS++;
            else if (st === "A") totalA++;
        });

        thead.innerHTML = `
            <tr>
                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center w-10">No</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[170px]">Nama Anggota</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 text-center min-w-[240px]">Pilih Status / Hapus (✕)</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[180px]">Catatan (Surat/Alasan)</th>
                <th class="py-2.5 px-2.5 text-center">Rekap Semester</th>
            </tr>
        `;

        if (filteredStudents.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada anggota kelas terdaftar.</td></tr>`;
        } else {
            tbody.innerHTML = filteredStudents
                .map((stu) => {
                    const rec = dayMap[stu.id] || { status: "", note: "" };
                    const curSt = rec.status || "";
                    const cum = calculateStudentAttendanceStats(stu.id);

                    const btnClass = (code, activeBg) =>
                        curSt === code
                            ? `${activeBg} text-neo-ink font-extrabold ring-2 ring-neo-ink scale-105`
                            : `bg-neo-surface text-muted-adaptive opacity-75 hover:opacity-100`;

                    return `
                        <tr>
                            <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono font-extrabold">#${String(stu.absen).padStart(2, "0")}</td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink font-extrabold">${stu.name}</td>
                            <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center">
                                <div class="inline-flex items-center gap-1.5">
                                    <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'H', '${selectedAttendanceDate}')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("H", "bg-neo-lime")}">H</button>
                                    <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'I', '${selectedAttendanceDate}')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("I", "bg-neo-sky")}">I</button>
                                    <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'S', '${selectedAttendanceDate}')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("S", "bg-neo-yellow")}">S</button>
                                    <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'A', '${selectedAttendanceDate}')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("A", "bg-neo-coral text-white")}">A</button>
                                    <button type="button" onclick="clearStudentAttendanceStatus(${stu.id}, '${selectedAttendanceDate}')" title="Hapus pilihan absensi siswa ini" class="px-2 py-1 rounded border-2 border-neo-ink bg-white text-rose-600 hover:bg-rose-100 font-mono text-xs font-extrabold transition">✕</button>
                                </div>
                            </td>
                            <td class="py-1.5 px-2.5 border-r-2 border-neo-ink">
                                <input
                                    type="text"
                                    value="${(rec.note || "").replace(/"/g, "&quot;")}"
                                    onchange="setStudentAttendanceNote(${stu.id}, this.value, '${selectedAttendanceDate}')"
                                    placeholder="Ketik alasan / keterangan..."
                                    class="neo-input w-full px-2.5 py-1 text-xs"
                                >
                            </td>
                            <td class="py-2 px-2.5 text-center font-mono text-[11px]">
                                <span class="text-emerald-600 font-extrabold">${cum.H}H</span>•${cum.I}I•${cum.S}S•<span class="text-rose-600 font-bold">${cum.A}A</span>
                            </td>
                        </tr>
                    `;
                })
                .join("");
        }
    } else if (adminAttendanceMode === "WEEKLY") {
        const weekDays = getSixSchoolDaysOfWeek(selectedAttendanceWeek);
        const weekIsoKeys = weekDays.map((d) => d.iso);
        if (titleEl) titleEl.textContent = `Matriks Mingguan (${weekDays[0].shortDate} - ${weekDays[5].shortDate}) — Klik untuk Ganti / Kosongkan`;

        appData.students.forEach((s) => {
            const st = calculateStudentAttendanceStats(s.id, weekIsoKeys);
            totalH += st.H;
            totalI += st.I;
            totalS += st.S;
            totalA += st.A;
        });

        thead.innerHTML = `
            <tr>
                <th class="py-2 px-2 border-r-2 border-neutral-700 text-center w-10">No</th>
                <th class="py-2 px-3 border-r-2 border-neutral-700 min-w-[165px]">Nama Anggota</th>
                ${weekDays.map((d) => `<th class="py-2 px-1.5 border-r-2 border-neutral-700 text-center min-w-[64px]"><div class="text-[9px] text-neo-yellow">${d.dayName.toUpperCase()}</div><div>${d.shortDate}</div></th>`).join("")}
                <th class="py-2 px-2.5 text-center">Total Minggu Ini</th>
            </tr>
        `;

        tbody.innerHTML = filteredStudents.length === 0
            ? `<tr><td colspan="9" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada anggota kelas.</td></tr>`
            : filteredStudents
                .map((stu) => {
                    const wkStats = calculateStudentAttendanceStats(stu.id, weekIsoKeys);
                    return `
                        <tr>
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-bold">#${stu.absen}</td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink font-extrabold">${stu.name}</td>
                            ${weekDays
                                .map((d) => {
                                    const st = appData.attendance?.[d.iso]?.[stu.id]?.status || "";
                                    const bg = st === "H" ? "bg-neo-lime text-neo-ink" : st === "I" ? "bg-neo-sky text-neo-ink" : st === "S" ? "bg-neo-yellow text-neo-ink" : st === "A" ? "bg-neo-coral text-white" : "bg-neo-surface text-muted-adaptive";
                                    return `<td class="p-1 border-r-2 border-neo-ink text-center"><button type="button" onclick="cycleStudentAttendanceStatus(${stu.id}, '${d.iso}')" class="w-full py-1 px-1 rounded border border-neo-ink font-mono text-[10px] font-extrabold ${bg}">${st || "-"}</button></td>`;
                                })
                                .join("")}
                            <td class="py-2 px-2.5 text-center font-mono text-[11px]"><span class="text-emerald-600 font-extrabold">${wkStats.H}H</span>/${wkStats.I}I/${wkStats.S}S/<span class="text-rose-600 font-bold">${wkStats.A}A</span></td>
                        </tr>
                    `;
                })
                .join("");
    } else {
        const monthPrefix = selectedAttendanceMonth || toLocalISOMonth();
        const monthDates = Object.keys(appData.attendance || {}).filter((d) => d.startsWith(monthPrefix)).sort();
        if (titleEl) titleEl.textContent = `Rekapitulasi Bulan ${formatMonthTitle(monthPrefix)} (${monthDates.length} Hari Tercatat)`;

        appData.students.forEach((s) => {
            const st = calculateStudentAttendanceStats(s.id, monthDates);
            totalH += st.H;
            totalI += st.I;
            totalS += st.S;
            totalA += st.A;
        });

        thead.innerHTML = `
            <tr>
                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center w-10">No</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[175px]">Nama Anggota</th>
                ${monthDates.map((d) => `<th class="py-2 px-1.5 border-r-2 border-neutral-700 text-center min-w-[46px]"><div class="text-[9px] text-neo-yellow">TGL</div><div>${d.split("-")[2]}</div></th>`).join("")}
                <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center">H</th>
                <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center">I</th>
                <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center">S</th>
                <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center">A</th>
                <th class="py-2.5 px-3 text-right">% Bulan</th>
            </tr>
        `;

        tbody.innerHTML = filteredStudents.length === 0
            ? `<tr><td colspan="${monthDates.length + 7}" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada anggota kelas.</td></tr>`
            : filteredStudents
                .map((stu) => {
                    const mStats = calculateStudentAttendanceStats(stu.id, monthDates);
                    return `
                        <tr>
                            <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono font-extrabold">#${String(stu.absen).padStart(2, "0")}</td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink font-extrabold">${stu.name}</td>
                            ${monthDates.map((d) => {
                                const st = appData.attendance?.[d]?.[stu.id]?.status || "-";
                                const bg = st === "H" ? "bg-neo-lime text-neo-ink" : st === "I" ? "bg-neo-sky text-neo-ink" : st === "S" ? "bg-neo-yellow text-neo-ink" : st === "A" ? "bg-neo-coral text-white" : "bg-neo-surface";
                                return `<td class="p-1 border-r-2 border-neo-ink text-center"><button type="button" onclick="cycleStudentAttendanceStatus(${stu.id}, '${d}')" class="w-full py-0.5 px-1 rounded border border-neo-ink font-mono text-[10px] font-extrabold ${bg}">${st}</button></td>`;
                            }).join("")}
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-extrabold text-emerald-500">${mStats.H}</td>
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-bold text-sky-500">${mStats.I}</td>
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-bold text-amber-500">${mStats.S}</td>
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-extrabold text-rose-500">${mStats.A}</td>
                            <td class="py-2 px-3 text-right font-mono font-extrabold ${mStats.pct >= 80 ? "text-emerald-500" : "text-rose-500"}">${mStats.pct}%</td>
                        </tr>
                    `;
                })
                .join("");
    }

    document.getElementById("admAttCountH").textContent = totalH;
    document.getElementById("admAttCountI").textContent = totalI;
    document.getElementById("admAttCountS").textContent = totalS;
    document.getElementById("admAttCountA").textContent = totalA;
}

window.setStudentAttendanceStatus = async function (studentId, status, targetDate = selectedAttendanceDate) {
    if (!canEditInCurrentView("absensi")) return;
    if (!appData.attendance) appData.attendance = {};
    if (!appData.attendance[targetDate]) appData.attendance[targetDate] = {};

    const existing = appData.attendance[targetDate][studentId] || { status: "", note: "" };
    // Jika diklik ulang pada tombol status yang sama, otomatis kosongkan pilihan
    existing.status = existing.status === status ? "" : status;
    if (!existing.status && !existing.note) {
        delete appData.attendance[targetDate][studentId];
    } else {
        appData.attendance[targetDate][studentId] = existing;
    }

    await saveToCloudDatabase();
    renderAdminAttendanceSection();
};

window.clearStudentAttendanceStatus = async function (studentId, targetDate = selectedAttendanceDate) {
    if (!canEditInCurrentView("absensi")) return;
    if (appData.attendance?.[targetDate]?.[studentId]) {
        delete appData.attendance[targetDate][studentId];
        if (Object.keys(appData.attendance[targetDate]).length === 0) {
            delete appData.attendance[targetDate];
        }
        await saveToCloudDatabase("Pilihan absensi siswa telah dikosongkan.");
        renderAdminAttendanceSection();
    }
};

window.clearAllAttendanceForSelectedDate = async function () {
    if (!canEditInCurrentView("absensi")) return;
    if (appData.attendance?.[selectedAttendanceDate]) {
        delete appData.attendance[selectedAttendanceDate];
        await saveToCloudDatabase(`Seluruh pilihan absen pada tanggal ${selectedAttendanceDate} telah direset!`);
        renderAdminAttendanceSection();
    } else {
        showToast("Tanggal ini memang belum memiliki data absen.", "bg-neo-yellow");
    }
};

window.cycleStudentAttendanceStatus = async function (studentId, targetDate) {
    if (!canEditInCurrentView("absensi")) return;
    const order = ["H", "I", "S", "A", ""];
    const cur = appData.attendance?.[targetDate]?.[studentId]?.status || "";
    const nextStatus = order[(order.indexOf(cur) + 1) % order.length];
    if (!nextStatus) {
        await window.clearStudentAttendanceStatus(studentId, targetDate);
    } else {
        if (!appData.attendance) appData.attendance = {};
        if (!appData.attendance[targetDate]) appData.attendance[targetDate] = {};
        const prevNote = appData.attendance[targetDate][studentId]?.note || "";
        appData.attendance[targetDate][studentId] = { status: nextStatus, note: prevNote };
        await saveToCloudDatabase();
        renderAdminAttendanceSection();
    }
};

window.setStudentAttendanceNote = async function (studentId, noteText, targetDate = selectedAttendanceDate) {
    if (!canEditInCurrentView("absensi")) return;
    if (!appData.attendance) appData.attendance = {};
    if (!appData.attendance[targetDate]) appData.attendance[targetDate] = {};

    const existing = appData.attendance[targetDate][studentId] || { status: "H", note: "" };
    existing.note = noteText.trim();
    appData.attendance[targetDate][studentId] = existing;
    await saveToCloudDatabase();
};

window.markAllAttendancePresent = async function () {
    if (!canEditInCurrentView("absensi")) return;
    if (!appData.attendance) appData.attendance = {};
    if (!appData.attendance[selectedAttendanceDate]) {
        appData.attendance[selectedAttendanceDate] = {};
    }
    appData.students.forEach((stu) => {
        const prevNote = appData.attendance[selectedAttendanceDate][stu.id]?.note || "";
        appData.attendance[selectedAttendanceDate][stu.id] = {
            status: "H",
            note: prevNote
        };
    });
    await saveToCloudDatabase(`Seluruh anggota ditandai HADIR untuk ${selectedAttendanceDate}!`);
    renderAdminAttendanceSection();
};

window.saveCurrentDayAttendance = async function () {
    if (!canEditInCurrentView("absensi")) return;
    await saveToCloudDatabase(`Data absensi berhasil disimpan secara real-time ke Firebase!`);
};

window.downloadAttendanceExcelSheet = function () {
    const cfg = appData.config;
    const attDates = Object.keys(appData.attendance || {}).sort();
    const totalCols = attDates.length + 8;

    const rowsHtml = appData.students
        .map((s) => {
            const cum = calculateStudentAttendanceStats(s.id);
            const dateCells = attDates
                .map((d) => {
                    const st = appData.attendance[d]?.[s.id]?.status || "-";
                    const bg = st === "H" ? "#D9F99D" : st === "I" ? "#BAE6FD" : st === "S" ? "#FEF08A" : st === "A" ? "#FECDD3" : "#FFFFFF";
                    return `<td style="border:1px solid #111;padding:5px;text-align:center;font-weight:bold;background-color:${bg};">${st}</td>`;
                })
                .join("");

            return `
                <tr>
                    <td style="border:1px solid #111;padding:6px;text-align:center;font-weight:bold;">${s.absen}</td>
                    <td style="border:1px solid #111;padding:6px;font-weight:bold;">${s.name}</td>
                    <td style="border:1px solid #111;padding:6px;text-align:center;">${s.gender || "L"}</td>
                    ${dateCells}
                    <td style="border:1px solid #111;padding:6px;text-align:center;font-weight:bold;color:#047857;">${cum.H}</td>
                    <td style="border:1px solid #111;padding:6px;text-align:center;">${cum.I}</td>
                    <td style="border:1px solid #111;padding:6px;text-align:center;">${cum.S}</td>
                    <td style="border:1px solid #111;padding:6px;text-align:center;font-weight:bold;color:#BE123C;">${cum.A}</td>
                    <td style="border:1px solid #111;padding:6px;text-align:right;font-weight:bold;">${cum.pct}%</td>
                </tr>
            `;
        })
        .join("");

    const html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:Arial,sans-serif;font-size:11pt;">
            <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
                <tr>
                    <td colspan="${totalCols}" style="background-color:#111111;color:#FFE600;font-size:15pt;font-weight:bold;padding:12px;text-align:center;border:2px solid #111;">
                        ${(cfg.schoolName || "SMA NEGERI 5 AMBON").toUpperCase()} — REKAPITULASI ABSENSI DIGITAL KELAS ${cfg.className || "MEDIVANCE"} (${cfg.semesterName || "Semester Ganjil"} TA ${cfg.academicYear || "2026/2027"})
                    </td>
                </tr>
            </table>
            <table style="border-collapse:collapse;width:100%;">
                <thead>
                    <tr style="background-color:#111111;color:#FFFFFF;font-weight:bold;">
                        <th style="border:1px solid #111;padding:7px;">No</th>
                        <th style="border:1px solid #111;padding:7px;">Nama Anggota</th>
                        <th style="border:1px solid #111;padding:7px;">L/P</th>
                        ${attDates.map((d) => `<th style="border:1px solid #111;padding:7px;">${d}</th>`).join("")}
                        <th style="border:1px solid #111;padding:7px;">Hadir</th>
                        <th style="border:1px solid #111;padding:7px;">Izin</th>
                        <th style="border:1px solid #111;padding:7px;">Sakit</th>
                        <th style="border:1px solid #111;padding:7px;">Alfa</th>
                        <th style="border:1px solid #111;padding:7px;">% Hadir</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </body>
        </html>
    `;

    const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Rekap_Absensi_${(cfg.className || "MEDIVANCE").replace(/\s+/g, "_")}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("File Sheet Rekap Absensi (.xls) berhasil diunduh!", "bg-neo-lime");
};

// ============================================================================
// MULAI SEMESTER BARU & BRANKAS ARSIP SEMESTER
// ============================================================================

function renderSemesterArchivesSection() {
    const cfg = appData.config;
    const pill = document.getElementById("currentActiveSemesterPill");
    if (pill) pill.textContent = `${cfg.semesterName || "Semester Ganjil"} • TA ${cfg.academicYear || "2026/2027"}`;

    const labelInput = document.getElementById("archiveCurrentLabelInput");
    if (labelInput && !labelInput.value) labelInput.value = `${cfg.semesterName || "Semester Ganjil"} TA ${cfg.academicYear || "2026/2027"}`;

    const acInput = document.getElementById("newSemesterAcYearInput");
    if (acInput && !acInput.value) acInput.value = cfg.academicYear || "2026/2027";

    const feeInput = document.getElementById("newSemesterWeeklyFee");
    if (feeInput && !feeInput.value) feeInput.value = cfg.weeklyFee || 5000;

    const startInput = document.getElementById("newSemesterStartDate");
    const endInput = document.getElementById("newSemesterEndDate");
    if (startInput && !startInput.value) startInput.value = defaultRange.start;
    if (endInput && !endInput.value) endInput.value = defaultRange.end;

    const archives = appData.archives || [];
    const countBadge = document.getElementById("archiveTotalCountBadge");
    if (countBadge) countBadge.textContent = `${archives.length} Arsip`;

    const listBox = document.getElementById("semesterArchivesListContainer");
    if (!listBox) return;

    if (archives.length === 0) {
        listBox.innerHTML = `
            <div class="border-2.5 border-dashed border-neo-ink/40 rounded-xl p-6 text-center text-xs font-bold text-muted-adaptive">
                Brankas arsip masih kosong. Saat Anda memulai semester baru, seluruh data kas, matriks iuran Senin, dan rekap absensi semester lalu akan tersimpan utuh di sini.
            </div>
        `;
        return;
    }

    listBox.innerHTML = archives
        .map(
            (arc) => `
            <div class="neo-card bg-neo-bg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="neo-badge bg-neo-yellow text-neo-ink text-[10px]"><i class="fa-solid fa-folder-closed"></i> ${arc.label}</span>
                        <span class="font-mono text-[10px] font-bold text-muted-adaptive">Diarsipkan: ${arc.archivedAt}</span>
                    </div>
                    <div class="text-xs font-extrabold">
                        Saldo Akhir: <span class="font-mono text-emerald-500">${formatRupiah(arc.summary?.currentBalance || 0)}</span> •
                        Masuk: <span class="font-mono">${formatRupiah(arc.summary?.totalIncome || 0)}</span> •
                        Keluar: <span class="font-mono text-rose-500">${formatRupiah(arc.summary?.totalExpense || 0)}</span>
                    </div>
                    <div class="text-[11px] font-mono text-muted-adaptive">
                        ${(arc.students || []).length} Anggota • ${(arc.transactions || []).length} Transaksi Kas • ${Object.keys(arc.attendance || {}).length} Hari Absensi
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button type="button" onclick="downloadArchivedSemesterExcel(${arc.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2.5 py-1.5 text-[11px]">
                        <i class="fa-solid fa-file-excel"></i> Sheet (.xls)
                    </button>
                    <button type="button" onclick="restoreArchivedSemester(${arc.id})" class="neo-btn bg-neo-sky text-neo-ink px-2.5 py-1.5 text-[11px]">
                        <i class="fa-solid fa-rotate-left"></i> Pulihkan
                    </button>
                    <button type="button" onclick="deleteArchivedSemester(${arc.id})" class="neo-btn bg-rose-200 text-rose-900 px-2.5 py-1.5 text-[11px]">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `
        )
        .join("");
}

window.handleStartNewSemester = async function () {
    if (!canEditInCurrentView("pengaturan")) return;

    const archiveLabel =
        (document.getElementById("archiveCurrentLabelInput")?.value || "").trim() ||
        `${appData.config.semesterName || "Semester Ganjil"} TA ${appData.config.academicYear || "2026/2027"}`;
    const newSemName = document.getElementById("newSemesterNameSelect")?.value || "Semester Genap";
    const newAcYear = (document.getElementById("newSemesterAcYearInput")?.value || "").trim() || appData.config.academicYear;
    const newStart = document.getElementById("newSemesterStartDate")?.value || defaultRange.start;
    const newEnd = document.getElementById("newSemesterEndDate")?.value || defaultRange.end;
    const newFee = Number(document.getElementById("newSemesterWeeklyFee")?.value) || appData.config.weeklyFee || 5000;

    const keepStructure = document.getElementById("newSemesterKeepStructure")?.checked ?? true;
    const keepSchedule = document.getElementById("newSemesterKeepSchedule")?.checked ?? true;
    const carryBalance = document.getElementById("newSemesterCarryBalance")?.checked ?? false;

    if (new Date(newEnd) < new Date(newStart)) {
        showToast("Tanggal Akhir Kas Semester Baru harus setelah Tanggal Awal!", "bg-neo-coral");
        return;
    }

    const stats = calculateFinancialSummary();

    if (!Array.isArray(appData.archives)) appData.archives = [];
    appData.archives.unshift({
        id: Date.now(),
        label: archiveLabel,
        archivedAt: new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }),
        configSnapshot: JSON.parse(JSON.stringify(appData.config)),
        summary: stats,
        students: JSON.parse(JSON.stringify(appData.students)),
        transactions: JSON.parse(JSON.stringify(appData.transactions)),
        announcements: JSON.parse(JSON.stringify(appData.announcements)),
        attendance: JSON.parse(JSON.stringify(appData.attendance || {})),
        schedule: JSON.parse(JSON.stringify(appData.schedule || {}))
    });

    appData.students.forEach((s) => {
        s.paidDates = {};
        delete s.weeks;
        if (!keepStructure) s.role = "Anggota Kelas";
    });

    appData.transactions = [];
    if (carryBalance && stats.currentBalance > 0) {
        appData.transactions.push({
            id: Date.now() + 1,
            type: "MASUK",
            date: newStart,
            category: "Dana Usaha / Kas Masuk",
            amount: stats.currentBalance,
            desc: `Saldo Awal Kas (Pindahan Sisa Saldo ${archiveLabel})`,
            pic: currentAdmin ? currentAdmin.name : "Bendahara Kelas"
        });
    }

    appData.announcements = [];
    appData.attendance = {};

    if (!keepSchedule) {
        appData.schedule = { Senin: [], Selasa: [], Rabu: [], Kamis: [], Jumat: [], Sabtu: [] };
    }

    appData.config.semesterName = newSemName;
    appData.config.academicYear = newAcYear;
    appData.config.feeStartDate = newStart;
    appData.config.feeEndDate = newEnd;
    appData.config.weeklyFee = newFee;

    const labelEl = document.getElementById("archiveCurrentLabelInput");
    if (labelEl) labelEl.value = `${newSemName} TA ${newAcYear}`;

    await saveToCloudDatabase(`Semester "${archiveLabel}" berhasil diarsipkan! Sekarang aktif: ${newSemName} TA ${newAcYear}.`);
    renderAdminWorkspace();
};

window.restoreArchivedSemester = async function (archiveId) {
    if (!canEditInCurrentView("pengaturan")) return;
    const arc = (appData.archives || []).find((a) => a.id === archiveId);
    if (!arc) return;

    appData.config = { ...appData.config, ...(arc.configSnapshot || {}) };
    appData.students = JSON.parse(JSON.stringify(arc.students || appData.students));
    appData.transactions = JSON.parse(JSON.stringify(arc.transactions || []));
    appData.announcements = JSON.parse(JSON.stringify(arc.announcements || []));
    appData.attendance = JSON.parse(JSON.stringify(arc.attendance || {}));
    if (arc.schedule) appData.schedule = JSON.parse(JSON.stringify(arc.schedule));

    await saveToCloudDatabase(`Data arsip "${arc.label}" berhasil dipulihkan menjadi semester aktif!`);
    renderAdminWorkspace();
};

window.deleteArchivedSemester = async function (archiveId) {
    if (!canEditInCurrentView("pengaturan")) return;
    appData.archives = (appData.archives || []).filter((a) => a.id !== archiveId);
    await saveToCloudDatabase("Arsip semester dihapus dari brankas.");
    renderAdminWorkspace();
};

window.downloadArchivedSemesterExcel = function (archiveId) {
    const arc = (appData.archives || []).find((a) => a.id === archiveId);
    if (!arc) return;
    const backupCurrent = JSON.parse(JSON.stringify(appData));
    appData.config = { ...appData.config, ...(arc.configSnapshot || {}) };
    appData.students = arc.students || [];
    appData.transactions = arc.transactions || [];
    window.downloadOfficialExcelSheet();
    appData = backupCurrent;
};

// ============================================================================
// PAPAN TEMPEL, KEUANGAN, PENGUMUMAN BERFOTO & DIREKTORI ID CARD
// ============================================================================

window.renderStickyNotesWall = function () {
    const dashGrid = document.getElementById("dashboardStickyWallGrid");
    const fullGrid = document.getElementById("fullStickyWallGrid");
    const notes = appData.stickyNotes || [];

    const emptyHtml = `
        <div class="col-span-full bg-white/90 text-neo-ink border-2.5 border-dashed border-neo-ink rounded-xl p-8 text-center space-y-2">
            <div class="w-12 h-12 mx-auto bg-neo-yellow border-2 border-neo-ink rounded-full flex items-center justify-center text-lg">
                <i class="fa-solid fa-note-sticky"></i>
            </div>
            <h4 class="font-display font-extrabold text-sm uppercase">Belum Ada Kertas Tempel</h4>
            <p class="text-xs font-semibold text-neutral-600 max-w-md mx-auto">
                Jadilah yang pertama menempelkan pesan semangat untuk teman-teman kelas!
            </p>
        </div>
    `;

    const buildNoteHtml = (note) => {
        const isJustAdded = note.id === lastAddedStickyId;
        return `
            <div
                style="background-color: ${note.color || "#FFE600"}"
                class="sticky-note-card ${isJustAdded ? "sticky-just-added" : ""} rounded-lg p-4 flex flex-col justify-between min-h-[155px] relative"
            >
                <div class="w-4 h-4 rounded-full bg-neo-coral border-2 border-neo-ink shadow-neo-sm mx-auto -mt-6 mb-2 flex items-center justify-center">
                    <span class="w-1.5 h-1.5 rounded-full bg-white"></span>
                </div>

                <div class="space-y-2">
                    <div class="flex items-center justify-between gap-1">
                        <span class="font-mono text-[10px] font-extrabold bg-white/90 text-neo-ink border border-neo-ink px-2 py-0.5 rounded">${note.tag || "Pesan"}</span>
                        <span class="font-mono text-[10px] font-bold text-neo-ink/75">${note.date || ""}</span>
                    </div>
                    <p class="font-sans font-bold text-xs sm:text-sm text-neo-ink leading-relaxed break-words">
                        "${note.message}"
                    </p>
                </div>

                <div class="pt-2.5 mt-2 border-t border-neo-ink/25 flex items-center justify-between text-[11px] font-extrabold text-neo-ink">
                    <span class="truncate"><i class="fa-solid fa-pen-nib mr-1"></i> ${note.author}</span>
                </div>
            </div>
        `;
    };

    if (dashGrid) dashGrid.innerHTML = notes.length === 0 ? emptyHtml : notes.slice(0, 8).map(buildNoteHtml).join("");
    if (fullGrid) fullGrid.innerHTML = notes.length === 0 ? emptyHtml : notes.map(buildNoteHtml).join("");

    if (lastAddedStickyId) {
        setTimeout(() => { lastAddedStickyId = null; }, 600);
    }
};

window.handleVisitorAddStickyNote = async function (e) {
    e.preventDefault();
    const author = document.getElementById("stickyAuthorInput").value.trim();
    const tag = document.getElementById("stickyTagInput").value;
    const message = document.getElementById("stickyMessageInput").value.trim();
    const colorEl = document.querySelector('input[name="stickyColor"]:checked');
    const color = colorEl ? colorEl.value : "#FFE600";

    if (!author || !message) return;

    const now = new Date();
    const dateLabel = now.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    const newId = Date.now();
    lastAddedStickyId = newId;

    if (!Array.isArray(appData.stickyNotes)) appData.stickyNotes = [];
    appData.stickyNotes.unshift({
        id: newId,
        author,
        tag,
        message,
        color,
        date: dateLabel
    });

    e.target.reset();
    closeModal("modalStickyNoteForm");
    await saveToCloudDatabase("Pesan berhasil ditempelkan di Papan Kelas!");
};

window.deleteStickyNote = async function (id) {
    if (!canEditInCurrentView("info")) return;
    appData.stickyNotes = (appData.stickyNotes || []).filter((n) => n.id !== id);
    await saveToCloudDatabase("Kertas tempelan berhasil dihapus.");
    renderAdminWorkspace();
};

window.handleQuickCheck = function (query) {
    const box = document.getElementById("quickCheckResult");
    if (!box) return;

    if (appData.students.length === 0) {
        box.innerHTML = `<div class="text-center py-2 text-xs font-bold text-muted-adaptive">Belum ada data anggota kelas yang terdaftar.</div>`;
        return;
    }

    const stats = calculateFinancialSummary();
    const q = (query || "").trim().toLowerCase();
    let target = appData.students[0];

    if (q) {
        const found = appData.students.find((s) => s.name.toLowerCase().includes(q) || String(s.absen) === q);
        if (!found) {
            box.innerHTML = `<div class="text-center py-2 text-xs font-bold text-rose-500">Anggota "${query}" tidak ditemukan.</div>`;
            return;
        }
        target = found;
    }

    ensureStudentPaidDatesMigrated(target, stats.mondayDates);
    const paidCount = stats.mondayDates.filter((d) => target.paidDates[d]).length;
    const unpaidCount = stats.totalMondays - paidCount;

    box.innerHTML = `
        <div class="flex items-center justify-between gap-2.5 pb-2.5 mb-2 border-b-2 border-neo-ink">
            <div class="flex items-center gap-2.5 min-w-0">
                ${renderAvatarHtml(target.name, target.photoUrl, "w-11 h-11", "text-xs")}
                <div class="min-w-0">
                    <span class="font-mono text-[10px] font-extrabold bg-neo-ink text-white px-1.5 py-0.5 rounded">ABSEN #${String(target.absen).padStart(2, "0")}</span>
                    <h4 class="font-display font-extrabold text-sm sm:text-base truncate mt-0.5">${target.name}</h4>
                </div>
            </div>
            <span class="neo-badge shrink-0 ${unpaidCount === 0 ? "bg-neo-lime text-neo-ink" : "bg-neo-coral text-white"}">
                ${unpaidCount === 0 ? "LUNAS PENUH" : `KURANG ${unpaidCount} SENIN`}
            </span>
        </div>
        <div class="flex items-center justify-between text-xs font-bold pt-1">
            <span>Terbayar: <strong class="font-mono text-emerald-500">${formatRupiah(paidCount * stats.fee)}</strong></span>
            <button type="button" onclick="openStudentCardModal(${target.id})" class="underline font-extrabold hover:text-neo-violet">
                Rincian Kartu Kas →
            </button>
        </div>
    `;
};

window.renderIuranMatrix = function () {
    const thead = document.getElementById("iuranMatrixHead");
    const tbody = document.getElementById("iuranMatrixBody");
    if (!thead || !tbody) return;

    const stats = calculateFinancialSummary();
    const mondays = stats.mondayDates;

    document.getElementById("keuanganFeeBadge").textContent = `IURAN: ${formatRupiah(stats.fee)} / SENIN`;
    document.getElementById("keuanganPeriodBadge").textContent = `${formatShortMondayLabel(mondays[0])} - ${formatShortMondayLabel(mondays[mondays.length - 1])} (${mondays.length} Pekan)`;
    document.getElementById("keuanganPaymentInfo").textContent = appData.config.paymentInfo || "";

    const dateColsHtml = mondays
        .map((dateStr) => `<th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center min-w-[66px]"><div class="text-[9px] text-neo-yellow font-normal">SENIN</div><div>${formatShortMondayLabel(dateStr)}</div></th>`)
        .join("");

    thead.innerHTML = `
        <tr>
            <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center w-10">No</th>
            <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[180px]">Anggota Kelas</th>
            ${dateColsHtml}
            <th class="py-2.5 px-3 border-r-2 border-neutral-700 text-right min-w-[105px]">Terbayar</th>
            <th class="py-2.5 px-3 text-right min-w-[105px]">Tunggakan</th>
        </tr>
    `;

    const searchVal = (document.getElementById("iuranSearchInput")?.value || "").toLowerCase();
    const filterStatus = document.getElementById("iuranFilterSelect")?.value || "ALL";

    const filtered = appData.students.filter((stu) => {
        ensureStudentPaidDatesMigrated(stu, mondays);
        const matchSearch = stu.name.toLowerCase().includes(searchVal) || String(stu.absen).includes(searchVal);
        const isLunas = mondays.every((d) => Boolean(stu.paidDates[d]));
        if (filterStatus === "LUNAS" && !isLunas) return false;
        if (filterStatus === "TUNGGAKAN" && isLunas) return false;
        return matchSearch;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${mondays.length + 4}" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada data anggota yang ditampilkan.</td></tr>`;
    } else {
        tbody.innerHTML = filtered
            .map((stu) => {
                const paidCount = mondays.filter((d) => Boolean(stu.paidDates[d])).length;
                const unpaidCount = mondays.length - paidCount;
                const totalPaid = paidCount * stats.fee;
                const totalArrears = unpaidCount * stats.fee;

                return `
                    <tr class="transition">
                        <td class="py-2.5 px-2.5 border-r-2 border-neo-ink text-center font-mono font-extrabold">${String(stu.absen).padStart(2, "0")}</td>
                        <td class="py-2 px-3 border-r-2 border-neo-ink">
                            <button type="button" onclick="openStudentCardModal(${stu.id})" class="text-left group flex items-center gap-2.5">
                                ${renderAvatarHtml(stu.name, stu.photoUrl, "w-8 h-8", "text-[10px]")}
                                <div>
                                    <div class="font-extrabold group-hover:underline">${stu.name}</div>
                                    <div class="text-[10px] font-mono text-muted-adaptive">${stu.role}</div>
                                </div>
                            </button>
                        </td>
                        ${mondays
                            .map((dateStr) => {
                                const paid = Boolean(stu.paidDates[dateStr]);
                                return `
                                    <td class="py-1.5 px-1.5 border-r-2 border-neo-ink text-center">
                                        <span
                                            onclick="openStudentCardModal(${stu.id})"
                                            class="cursor-pointer inline-block w-full py-1 px-1.5 rounded border-2 border-neo-ink font-mono text-[10px] font-extrabold ${paid ? "bg-neo-lime text-neo-ink" : "bg-rose-200 text-rose-900"}"
                                        >
                                            ${paid ? "✓" : "✕"}
                                        </span>
                                    </td>
                                `;
                            })
                            .join("")}
                        <td class="py-2.5 px-3 border-r-2 border-neo-ink text-right font-mono font-extrabold text-emerald-500">${formatRupiah(totalPaid)}</td>
                        <td class="py-2.5 px-3 text-right font-mono font-extrabold ${totalArrears > 0 ? "text-rose-500" : "text-muted-adaptive"}">${formatRupiah(totalArrears)}</td>
                    </tr>
                `;
            })
            .join("");
    }

    document.getElementById("iuranSummaryFooter").textContent =
        `Total Terkumpul dari Iuran: ${formatRupiah(stats.totalIuranPaid)} (${stats.totalPaidWeeks}/${stats.totalPossibleWeeks} Senin lunas)`;
};

window.toggleStudentMondayDate = async function (studentId, dateStr) {
    if (!canEditInCurrentView("keuangan")) {
        showToast("Perubahan status kas hanya dapat dilakukan di dalam Panel Admin!", "bg-neo-coral");
        return;
    }
    const student = appData.students.find((s) => s.id === studentId);
    if (!student) return;
    if (!student.paidDates || typeof student.paidDates !== "object") {
        student.paidDates = {};
    }
    student.paidDates[dateStr] = !student.paidDates[dateStr];
    await saveToCloudDatabase();
    renderAdminWorkspace();
    if (selectedStudentIdForCard === studentId) {
        openStudentCardModal(studentId);
    }
};

window.openStudentCardModal = function (studentId) {
    selectedStudentIdForCard = studentId;
    const student = appData.students.find((s) => s.id === studentId);
    if (!student) return;

    const stats = calculateFinancialSummary();
    const mondays = stats.mondayDates;
    ensureStudentPaidDatesMigrated(student, mondays);

    const paidCount = mondays.filter((d) => Boolean(student.paidDates[d])).length;
    const unpaidCount = mondays.length - paidCount;

    const avatarBox = document.getElementById("cardStudentAvatarBox");
    if (avatarBox) {
        avatarBox.outerHTML = renderAvatarHtml(student.name, student.photoUrl, "w-14 h-14", "text-base")
            .replace('<div class="', '<div id="cardStudentAvatarBox" class="');
    }

    document.getElementById("cardStudentName").textContent = student.name;
    document.getElementById("cardStudentMeta").textContent =
        `Absen #${String(student.absen).padStart(2, "0")} (${student.gender || "L"}) • ${student.role} • Piket ${student.piket}`;
    document.getElementById("cardTotalPaid").textContent = formatRupiah(paidCount * stats.fee);
    document.getElementById("cardTotalArrears").textContent = formatRupiah(unpaidCount * stats.fee);

    const canEdit = canEditInCurrentView("keuangan");
    const btnMarkAll = document.getElementById("btnModalMarkAllPaid");
    if (canEdit) btnMarkAll?.classList.remove("hidden");
    else btnMarkAll?.classList.add("hidden");

    document.getElementById("cardWeekGrid").innerHTML = mondays
        .map((dateStr) => {
            const paid = Boolean(student.paidDates[dateStr]);
            return `
                <button
                    type="button"
                    onclick="${canEdit ? `toggleStudentMondayDate(${student.id}, '${dateStr}')` : ""}"
                    class="border-2.5 border-neo-ink rounded-lg p-2.5 text-center shadow-neo-sm ${canEdit ? "cursor-pointer" : "cursor-default"} ${paid ? "bg-neo-lime text-neo-ink" : "bg-rose-200 text-rose-900"}"
                >
                    <span class="font-mono text-[10px] font-extrabold block">SENIN, ${formatShortMondayLabel(dateStr)}</span>
                    <span class="font-display font-extrabold text-xs mt-0.5 block">${paid ? "✓ LUNAS" : "✕ BELUM"}</span>
                </button>
            `;
        })
        .join("");

    openModal("modalStudentCard");
};

window.markAllWeeksPaidCurrentStudent = async function () {
    if (!canEditInCurrentView("keuangan")) return;
    const student = appData.students.find((s) => s.id === selectedStudentIdForCard);
    if (!student) return;
    const mondays = getMondayDatesList();
    if (!student.paidDates) student.paidDates = {};
    mondays.forEach((d) => { student.paidDates[d] = true; });
    await saveToCloudDatabase(`Seluruh tanggal Senin untuk ${student.name} ditandai LUNAS!`);
    renderAdminWorkspace();
    openStudentCardModal(student.id);
};

window.copyWhatsAppReminder = function () {
    const student = appData.students.find((s) => s.id === selectedStudentIdForCard);
    if (!student) return;
    const stats = calculateFinancialSummary();
    const unpaidDates = [];
    stats.mondayDates.forEach((d) => {
        if (!student.paidDates?.[d]) unpaidDates.push(`Senin ${formatShortMondayLabel(d)}`);
    });

    let text = "";
    if (unpaidDates.length === 0) {
        text = `Halo *${student.name}*, terima kasih! Iuran kas *${appData.config.className}* kamu sudah *LUNAS PENUH* untuk seluruh ${stats.totalMondays} hari Senin (${formatRupiah(stats.totalMondays * stats.fee)}).`;
    } else {
        const arrears = unpaidDates.length * stats.fee;
        text = `Halo *${student.name}* (Absen #${student.absen}) 👋\nMengingatkan info kas *${appData.config.className}*, tercatat iuran untuk tanggal: *${unpaidDates.join(", ")}* sejumlah *${formatRupiah(arrears)}* belum lunas.\n\n${appData.config.paymentInfo || "Pembayaran dapat dilakukan ke Bendahara Kelas."} Terima kasih! 🙏`;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast("Pesan pengingat WhatsApp berhasil disalin!", "bg-neo-mint"));
    } else {
        const temp = document.createElement("textarea");
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
        showToast("Pesan pengingat WhatsApp berhasil disalin!", "bg-neo-mint");
    }
};

window.renderLedgerTable = function () {
    const tbody = document.getElementById("ledgerTableBody");
    if (!tbody) return;
    const filterType = document.getElementById("mutasiFilterType")?.value || "ALL";
    const stats = calculateFinancialSummary();

    let rowsHtml = "";
    if ((filterType === "ALL" || filterType === "MASUK") && stats.totalIuranPaid > 0) {
        rowsHtml += `
            <tr class="bg-neo-mint/15">
                <td class="py-2.5 px-3 border-r-2 border-neo-ink font-mono text-xs">AKUMULASI</td>
                <td class="py-2.5 px-3 border-r-2 border-neo-ink"><span class="neo-badge bg-neo-lime text-neo-ink">Iuran Senin</span></td>
                <td class="py-2.5 px-3 border-r-2 border-neo-ink font-extrabold">Total Iuran Hari Senin Siswa (${stats.totalPaidWeeks} Senin terbayar)</td>
                <td class="py-2.5 px-3 border-r-2 border-neo-ink text-xs">Bendahara</td>
                <td class="py-2.5 px-3 text-right font-mono font-extrabold text-emerald-500">+${formatRupiah(stats.totalIuranPaid)}</td>
            </tr>
        `;
    }

    const filteredTx = [...appData.transactions].reverse().filter((tx) => filterType === "ALL" || tx.type === filterType);

    if (filteredTx.length === 0 && !rowsHtml) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada transaksi buku kas yang tercatat.</td></tr>`;
        return;
    }

    rowsHtml += filteredTx
        .map(
            (tx) => `
            <tr class="transition">
                <td class="py-2.5 px-3 border-r-2 border-neo-ink font-mono text-xs">${tx.date}</td>
                <td class="py-2.5 px-3 border-r-2 border-neo-ink"><span class="neo-badge ${tx.type === "MASUK" ? "bg-neo-lime text-neo-ink" : "bg-neo-yellow text-neo-ink"}">${tx.category}</span></td>
                <td class="py-2.5 px-3 border-r-2 border-neo-ink font-bold">${tx.desc}</td>
                <td class="py-2.5 px-3 border-r-2 border-neo-ink text-xs">${tx.pic}</td>
                <td class="py-2.5 px-3 text-right font-mono font-extrabold ${tx.type === "MASUK" ? "text-emerald-500" : "text-rose-500"}">
                    ${tx.type === "MASUK" ? "+" : "-"}${formatRupiah(tx.amount)}
                </td>
            </tr>
        `
        )
        .join("");

    tbody.innerHTML = rowsHtml;
};

window.filterInfoCategory = function (cat) {
    activeInfoCategory = cat;
    ["ALL", "TUGAS", "PENTING", "EVENT", "KAS"].forEach((c) => {
        const btn = document.getElementById(`infoCat-${c}`);
        if (btn) btn.classList.toggle("active", c === cat);
    });
    renderInfoBoard();
};

function renderInfoBoard() {
    const grid = document.getElementById("infoCardsGrid");
    const badge = document.getElementById("badgeInfoCount");
    if (badge) badge.textContent = appData.announcements.length;
    if (!grid) return;

    const items = appData.announcements.filter((a) => activeInfoCategory === "ALL" || a.category === activeInfoCategory);
    if (items.length === 0) {
        grid.innerHTML = `<div class="col-span-full neo-card bg-white p-8 text-center text-xs font-bold text-muted-adaptive">Belum ada informasi atau tugas pada kategori ini.</div>`;
        return;
    }

    const headerColors = {
        TUGAS: "bg-neo-yellow text-neo-ink",
        PENTING: "bg-neo-coral text-white",
        EVENT: "bg-neo-sky text-neo-ink",
        KAS: "bg-neo-mint text-neo-ink"
    };

    grid.innerHTML = items
        .map(
            (item) => `
            <article class="neo-card bg-white p-5 flex flex-col justify-between space-y-3">
                <div class="space-y-3">
                    <div class="flex items-center justify-between gap-2">
                        <span class="neo-badge ${headerColors[item.category] || "bg-neo-surface text-neo-ink"}">${item.category}</span>
                        <span class="font-mono text-xs font-extrabold bg-neo-surface border-2 border-neo-ink px-2 py-0.5 rounded">
                            <i class="fa-regular fa-clock mr-1"></i>${item.deadline}
                        </span>
                    </div>
                    <h3 class="font-display font-extrabold text-base sm:text-lg leading-snug">${item.title}</h3>
                    <p class="text-xs sm:text-sm font-medium text-muted-adaptive leading-relaxed whitespace-pre-line">${item.body}</p>
                    ${
                        item.photoUrl
                            ? `
                        <div onclick="openInfoImagePreview(${item.id})" class="cursor-pointer rounded-xl border-2.5 border-neo-ink overflow-hidden bg-black max-h-56 relative group">
                            <img src="${item.photoUrl}" alt="${item.title}" class="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300">
                            <span class="neo-badge bg-neo-yellow text-neo-ink absolute bottom-2 right-2 text-[10px]"><i class="fa-solid fa-magnifying-glass-plus"></i> Perbesar Lampiran</span>
                        </div>
                    `
                            : item.photoExpired
                              ? `<div class="bg-neo-surface border border-dashed border-neo-ink/40 rounded-lg px-3 py-2 text-[11px] font-mono font-bold text-muted-adaptive"><i class="fa-solid fa-clock-rotate-left mr-1"></i> Lampiran foto tugas telah dihapus otomatis karena melewati batas waktu deadline.</div>`
                              : ""
                    }
                </div>
                <div class="pt-2.5 border-t-2 border-neo-ink flex items-center justify-between text-xs font-bold text-muted-adaptive">
                    <span><i class="fa-solid fa-user-pen mr-1"></i> ${item.author}</span>
                    ${item.expireAt && item.photoUrl ? `<span class="font-mono text-[10px] text-rose-500">Foto Aktif s/d: ${item.expireAt.replace("T", " ")}</span>` : ""}
                </div>
            </article>
        `
        )
        .join("");
}

window.openInfoImagePreview = function (infoId) {
    const item = appData.announcements.find((a) => a.id === infoId);
    if (!item || !item.photoUrl) return;
    document.getElementById("lightboxCategory").textContent = item.category;
    document.getElementById("lightboxImage").src = item.photoUrl;
    document.getElementById("lightboxDate").textContent = `Tenggat: ${item.deadline}`;
    document.getElementById("lightboxAuthor").textContent = item.author || "Pengurus Kelas";
    document.getElementById("lightboxTitle").textContent = item.title;
    document.getElementById("lightboxCaption").textContent = item.body || "";
    openModal("modalAlbumLightbox");
};

window.selectScheduleDay = function (day) {
    activeScheduleDay = day;
    document.querySelectorAll(".day-filter-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.day === day);
    });
    renderScheduleAndPiket();
};

function renderScheduleAndPiket() {
    const container = document.getElementById("scheduleContainer");
    if (!container) return;
    const daysOrder = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const daysToRender = activeScheduleDay === "ALL" ? daysOrder : [activeScheduleDay];

    const dayColors = {
        Senin: "bg-neo-yellow text-neo-ink",
        Selasa: "bg-neo-mint text-neo-ink",
        Rabu: "bg-neo-sky text-neo-ink",
        Kamis: "bg-neo-orange text-neo-ink",
        Jumat: "bg-neo-lime text-neo-ink",
        Sabtu: "bg-neo-pink text-neo-ink"
    };

    container.innerHTML = daysToRender
        .map((day) => {
            const lessons = appData.schedule[day] || [];
            return `
                <div class="neo-card bg-white overflow-hidden flex flex-col">
                    <div class="${dayColors[day] || "bg-neo-yellow text-neo-ink"} border-b-3 border-neo-ink px-4 py-2.5 flex items-center justify-between">
                        <h3 class="font-display font-extrabold text-base uppercase">HARI ${day}</h3>
                        <span class="font-mono text-[11px] font-bold bg-white text-neo-ink border-2 border-neo-ink px-2 py-0.5 rounded">${lessons.length} Mapel</span>
                    </div>
                    <div class="p-4 divide-y-2 divide-neo-ink flex-1">
                        ${
                            lessons.length === 0
                                ? `<div class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada jadwal pelajaran.</div>`
                                : lessons
                                      .map(
                                          (item) => `
                                <div class="py-2.5 first:pt-0 last:pb-0 space-y-0.5">
                                    <div class="flex items-center justify-between">
                                        <span class="font-mono text-xs font-extrabold text-neo-violet"><i class="fa-regular fa-clock mr-1"></i>${item.time}</span>
                                        <span class="font-mono text-[10px] font-bold bg-neo-surface border border-neo-ink px-1.5 py-0.5 rounded">${item.room}</span>
                                    </div>
                                    <div class="font-display font-extrabold text-sm">${item.subject}</div>
                                    <div class="text-xs font-semibold text-muted-adaptive">${item.teacher}</div>
                                </div>
                            `
                                      )
                                      .join("")
                        }
                    </div>
                </div>
            `;
        })
        .join("");

    const piketGrid = document.getElementById("piketGridContainer");
    if (piketGrid) {
        piketGrid.innerHTML = daysOrder
            .map((day) => {
                const members = appData.students.filter((s) => s.piket === day);
                return `
                    <div class="border-2.5 border-neo-ink rounded-lg bg-neo-surface p-3.5 space-y-2">
                        <div class="font-display font-extrabold text-xs uppercase border-b-2 border-neo-ink pb-1 flex items-center justify-between">
                            <span>${day}</span>
                            <i class="fa-solid fa-broom"></i>
                        </div>
                        ${
                            members.length === 0
                                ? `<p class="text-[11px] font-semibold text-muted-adaptive">Belum ada anggota.</p>`
                                : `
                            <ul class="space-y-1 text-xs font-bold">
                                ${members
                                    .map(
                                        (m) => `
                                    <li onclick="openStudentIdCardModal(${m.id})" class="cursor-pointer bg-white text-neo-ink border-2 border-neo-ink rounded px-2 py-1 flex items-center justify-between hover:bg-neo-yellow transition">
                                        <span class="truncate pr-1">${m.name}</span>
                                        <span class="font-mono text-[10px] opacity-75">#${m.absen}</span>
                                    </li>
                                `
                                    )
                                    .join("")}
                            </ul>
                        `
                        }
                    </div>
                `;
            })
            .join("");
    }
}

window.filterAlbumCategory = function (cat) {
    activeAlbumCategory = cat;
    ["ALL", "Kegiatan Kelas", "Praktikum", "Classmeeting", "Acara Sekolah"].forEach((c) => {
        const btn = document.getElementById(`albumCat-${c}`);
        if (btn) btn.classList.toggle("active", c === cat);
    });
    renderAlbumGallery();
};

window.renderAlbumGallery = function () {
    const grid = document.getElementById("albumGalleryGrid");
    const badge = document.getElementById("badgeAlbumCount");
    if (badge) badge.textContent = appData.albums.length;
    if (!grid) return;

    const q = (document.getElementById("albumSearchInput")?.value || "").toLowerCase();
    const filtered = appData.albums.filter((item) => {
        const matchCat = activeAlbumCategory === "ALL" || item.category === activeAlbumCategory;
        const matchQ = item.title.toLowerCase().includes(q) || (item.caption || "").toLowerCase().includes(q);
        return matchCat && matchQ;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full neo-card bg-white p-8 text-center text-xs font-bold text-muted-adaptive">Belum ada foto dokumentasi pada album kelas.</div>`;
        return;
    }

    grid.innerHTML = filtered
        .map(
            (item) => `
            <div onclick="openAlbumLightbox(${item.id})" class="cursor-pointer neo-card neo-card-hover bg-white overflow-hidden flex flex-col">
                <div class="h-48 sm:h-52 bg-neo-surface border-b-3 border-neo-ink relative overflow-hidden">
                    <img
                        src="${item.url}"
                        alt="${item.title}"
                        onerror="this.src='https://placehold.co/600x400/FFE600/111111?text=Dokumentasi+Kelas'"
                        class="w-full h-full object-cover"
                    >
                    <span class="neo-badge bg-neo-yellow text-neo-ink absolute top-2.5 left-2.5">${item.category}</span>
                </div>
                <div class="p-4 flex-1 flex flex-col justify-between space-y-2">
                    <div>
                        <div class="font-mono text-[10px] font-bold text-muted-adaptive">${item.date}</div>
                        <h3 class="font-display font-extrabold text-base leading-snug mt-0.5">${item.title}</h3>
                        <p class="text-xs font-medium text-muted-adaptive line-clamp-2 mt-1">${item.caption || ""}</p>
                    </div>
                    <div class="pt-2 border-t-2 border-neo-ink/20 flex items-center justify-between text-[11px] font-bold">
                        <span><i class="fa-solid fa-camera mr-1"></i> ${item.author || "Dokumentasi"}</span>
                        <span class="underline">Perbesar →</span>
                    </div>
                </div>
            </div>
        `
        )
        .join("");
};

window.openAlbumLightbox = function (albumId) {
    const item = appData.albums.find((a) => a.id === albumId);
    if (!item) return;
    document.getElementById("lightboxCategory").textContent = item.category;
    document.getElementById("lightboxImage").src = item.url;
    document.getElementById("lightboxDate").textContent = item.date;
    document.getElementById("lightboxAuthor").textContent = `Dokumentasi: ${item.author || "Kelas"}`;
    document.getElementById("lightboxTitle").textContent = item.title;
    document.getElementById("lightboxCaption").textContent = item.caption || "";
    openModal("modalAlbumLightbox");
};

// Render Struktur & Direktori Anggota (Klik Nama -> Buka Kartu Nama / ID Card Digital)
window.renderStudentDirectory = function () {
    const cfg = appData.config;
    const totalBadge = document.getElementById("totalStudentsCountBadge");
    if (totalBadge) totalBadge.textContent = `${appData.students.length} Anggota`;

    const waliTopBox = document.getElementById("waliKelasTopStructureBox");
    if (waliTopBox) {
        waliTopBox.innerHTML = `
            <div class="neo-card bg-neo-yellow text-neo-ink p-4 sm:p-5 flex items-center gap-4">
                ${renderAvatarHtml(cfg.waliKelas || "Wali Kelas", cfg.waliPhotoUrl, "w-16 h-16 sm:w-20 sm:h-20", "text-lg")}
                <div class="min-w-0 flex-1">
                    <span class="neo-badge bg-neo-ink text-white text-[10px] mb-1">
                        <i class="fa-solid fa-crown text-neo-yellow"></i> WALI KELAS
                    </span>
                    <h3 class="font-display font-extrabold text-base sm:text-xl uppercase truncate">
                        ${cfg.waliKelas || "Wali Kelas Belum Diatur"}
                    </h3>
                    <p class="text-xs font-bold opacity-85 truncate">
                        ${cfg.waliTitle || "Pembina & Pembimbing Akademik Kelas"}
                    </p>
                </div>
            </div>
        `;
    }

    const officers = appData.students.filter((s) => s.role !== "Anggota Kelas");
    const orgGrid = document.getElementById("strukturOrganisasiGrid");
    if (orgGrid) {
        if (officers.length === 0) {
            orgGrid.innerHTML = `<div class="col-span-full text-xs font-bold text-muted-adaptive py-4 text-center">Belum ada pengurus kelas yang terdaftar.</div>`;
        } else {
            orgGrid.innerHTML = officers
                .map(
                    (o) => `
                    <div onclick="openStudentIdCardModal(${o.id})" class="cursor-pointer neo-card neo-card-hover bg-white p-4 flex items-center gap-3.5">
                        ${renderAvatarHtml(o.name, o.photoUrl, "w-14 h-14", "text-sm")}
                        <div class="min-w-0 flex-1">
                            <span class="neo-badge bg-neo-mint text-neo-ink text-[10px] mb-1">${o.role}</span>
                            <h4 class="font-display font-extrabold text-sm sm:text-base truncate">${o.name}</h4>
                            <p class="text-[11px] font-mono font-bold text-muted-adaptive">Absen #${String(o.absen).padStart(2, "0")} • Klik lihat ID Card</p>
                        </div>
                    </div>
                `
                )
                .join("");
        }
    }

    const dirGrid = document.getElementById("studentDirectoryGrid");
    if (dirGrid) {
        const q = (document.getElementById("directorySearchInput")?.value || "").toLowerCase();
        const filtered = appData.students.filter(
            (s) => s.name.toLowerCase().includes(q) || s.role.toLowerCase().includes(q) || String(s.absen).includes(q)
        );

        if (filtered.length === 0) {
            dirGrid.innerHTML = `<div class="col-span-full text-xs font-bold text-muted-adaptive py-6 text-center">Belum ada data anggota kelas terdaftar.</div>`;
        } else {
            dirGrid.innerHTML = filtered
                .map(
                    (s) => `
                    <div onclick="openStudentIdCardModal(${s.id})" class="cursor-pointer neo-card neo-card-hover p-4 bg-neo-bg flex flex-col justify-between space-y-3">
                        <div class="flex items-start gap-3">
                            ${renderAvatarHtml(s.name, s.photoUrl, "w-14 h-14", "text-sm")}
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center justify-between gap-1 mb-1">
                                    <span class="font-mono text-[10px] font-extrabold bg-neo-yellow text-neo-ink border border-neo-ink px-1.5 py-0.5 rounded">#${String(s.absen).padStart(2, "0")} • ${s.gender || "L"}</span>
                                    <span class="text-[10px] font-mono font-extrabold px-1.5 py-0.5 rounded border border-neo-ink bg-neo-sky text-neo-ink">ID CARD</span>
                                </div>
                                <h4 class="font-display font-extrabold text-sm sm:text-base truncate">${s.name}</h4>
                                <p class="text-xs font-bold text-neo-violet truncate">${s.role}</p>
                            </div>
                        </div>
                        <div class="pt-2 border-t border-dashed border-neo-ink/30 flex items-center justify-between text-[11px] font-bold text-muted-adaptive">
                            <span><i class="fa-solid fa-broom mr-1"></i>Piket ${s.piket}</span>
                            <span class="italic truncate max-w-[135px]">"${s.quote || "Klik lihat profil"}"</span>
                        </div>
                    </div>
                `
                )
                .join("");
        }
    }
};

// ============================================================================
// RENDER WORKSPACE PANEL ADMIN (BERANDA ADMIN + 8 MODUL PER TAB)
// ============================================================================

function renderAdminHomeSection(stats) {
    const cfg = appData.config;
    const semBadge = document.getElementById("admHomeSemesterBadge");
    if (semBadge) semBadge.textContent = `${cfg.semesterName || "Semester Ganjil"} • TA ${cfg.academicYear || "2026/2027"}`;

    const welcomeEl = document.getElementById("admHomeWelcomeTitle");
    if (welcomeEl && currentAdmin) {
        welcomeEl.textContent = `Halo, ${currentAdmin.name} (${currentAdmin.role})!`;
    }

    const allModules = [
        { id: "adm-keuangan", perm: "keuangan", icon: "fa-coins", bg: "bg-neo-mint", title: "1. Kas & Pelunasan Senin", desc: `Saldo: ${formatRupiah(stats.currentBalance)} • Kepatuhan ${stats.complianceRatio}%` },
        { id: "adm-absensi", perm: "absensi", icon: "fa-clipboard-user", bg: "bg-neo-lime", title: "2. Absensi Digital (H/M/B)", desc: `${Object.keys(appData.attendance || {}).length} Hari Kehadiran Tercatat` },
        { id: "adm-siswa", perm: "siswa", icon: "fa-user-graduate", bg: "bg-neo-sky", title: "3. Master Data Anggota", desc: `${appData.students.length} Anggota & ID Card` },
        { id: "adm-info", perm: "info", icon: "fa-bullhorn", bg: "bg-neo-yellow", title: "4. Tugas, Foto & Mading", desc: `${appData.announcements.length} Tugas • ${(appData.stickyNotes || []).length} Kertas Mading` },
        { id: "adm-jadwal", perm: "jadwal", icon: "fa-calendar-days", bg: "bg-neo-pink", title: "5. Jadwal & Pilih Jam", desc: "Susunan Mapel Senin s/d Sabtu" },
        { id: "adm-album", perm: "album", icon: "fa-camera-retro", bg: "bg-neo-orange", title: "6. Galeri Album Kelas", desc: `${appData.albums.length} Dokumentasi Tersimpan` },
        { id: "adm-akun", perm: "akun", icon: "fa-users-gear", bg: "bg-white", title: "7. Akun & Hak Akses RBAC", desc: `${getAllCombinedAdmins().length} Akun Pengurus Terdaftar` },
        { id: "adm-pengaturan", perm: "pengaturan", icon: "fa-sliders", bg: "bg-neo-surface", title: "8. Identitas, Libur & Semester", desc: `${(cfg.holidays || []).length} Hari Libur • ${(appData.archives || []).length} Arsip Semester` }
    ];

    const quickGrid = document.getElementById("admHomeQuickModulesGrid");
    if (quickGrid) {
        const accessible = allModules.filter((m) => hasAdminPermission(m.perm));
        quickGrid.innerHTML = accessible
            .map(
                (m) => `
                <div onclick="switchAdminTab('${m.id}')" class="cursor-pointer neo-card neo-card-hover ${m.bg} text-neo-ink p-4 flex flex-col justify-between space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="w-10 h-10 rounded-xl bg-white text-neo-ink border-2 border-neo-ink flex items-center justify-center font-extrabold text-base shadow-neo-sm">
                            <i class="fa-solid ${m.icon}"></i>
                        </span>
                        <span class="font-mono text-[10px] font-extrabold bg-white/90 text-neo-ink border border-neo-ink px-2 py-0.5 rounded">BUKA MODUL →</span>
                    </div>
                    <div>
                        <h5 class="font-display font-extrabold text-sm uppercase">${m.title}</h5>
                        <p class="text-[11px] font-bold opacity-85 mt-0.5">${m.desc}</p>
                    </div>
                </div>
            `
            )
            .join("");
    }

    // Ringkasan Absensi Hari Ini
    const todayIso = toLocalISODate(new Date());
    const todayAtt = appData.attendance?.[todayIso] || {};
    let tH = 0, tI = 0, tS = 0, tA = 0;
    appData.students.forEach((s) => {
        const st = todayAtt[s.id]?.status || "";
        if (st === "H") tH++;
        else if (st === "I") tI++;
        else if (st === "S") tS++;
        else if (st === "A") tA++;
    });

    const todayAttBox = document.getElementById("admHomeTodayAttendanceBox");
    if (todayAttBox) {
        todayAttBox.innerHTML = `
            <div class="bg-neo-lime text-neo-ink border-2 border-neo-ink rounded-lg p-2.5">
                <div class="font-mono font-extrabold text-lg">${tH}</div>
                <div class="text-[10px] font-extrabold uppercase">Hadir</div>
            </div>
            <div class="bg-neo-sky text-neo-ink border-2 border-neo-ink rounded-lg p-2.5">
                <div class="font-mono font-extrabold text-lg">${tI}</div>
                <div class="text-[10px] font-extrabold uppercase">Izin</div>
            </div>
            <div class="bg-neo-yellow text-neo-ink border-2 border-neo-ink rounded-lg p-2.5">
                <div class="font-mono font-extrabold text-lg">${tS}</div>
                <div class="text-[10px] font-extrabold uppercase">Sakit</div>
            </div>
            <div class="bg-neo-coral text-white border-2 border-neo-ink rounded-lg p-2.5">
                <div class="font-mono font-extrabold text-lg">${tA}</div>
                <div class="text-[10px] font-extrabold uppercase">Alfa</div>
            </div>
        `;
    }

    const activeTaskPhotos = appData.announcements.filter((a) => a.photoUrl && a.photoUrl.length > 5).length;
    const storageBox = document.getElementById("admHomeStorageAndHolidayBox");
    if (storageBox) {
        storageBox.innerHTML = `
            <div class="flex items-center justify-between bg-neo-surface border-2 border-neo-ink rounded-lg p-2.5">
                <span><i class="fa-solid fa-image text-neo-violet mr-1.5"></i> Lampiran Foto Tugas Aktif:</span>
                <strong class="font-mono">${activeTaskPhotos} Foto</strong>
            </div>
            <div class="flex items-center justify-between bg-neo-surface border-2 border-neo-ink rounded-lg p-2.5">
                <span><i class="fa-solid fa-calendar-xmark text-rose-500 mr-1.5"></i> Tanggal Merah Terdaftar:</span>
                <strong class="font-mono">${(cfg.holidays || []).length} Hari Libur</strong>
            </div>
        `;
    }
}

window.renderAdminWorkspace = function () {
    if (!currentAdmin) return;
    const stats = calculateFinancialSummary();
    const mondays = stats.mondayDates;

    document.getElementById("admStatBalance").textContent = formatRupiah(stats.currentBalance);
    document.getElementById("admStatStudents").textContent = `${appData.students.length} Anggota`;
    document.getElementById("admStatCompliance").textContent = `${stats.complianceRatio}%`;
    document.getElementById("admStatMondays").textContent = `${mondays.length} Senin`;
    document.getElementById("admStatInfo").textContent = `${appData.announcements.length} Info`;
    document.getElementById("admStatSticky").textContent = `${(appData.config.holidays || []).length} Libur`;

    // Render Tab 0: Beranda Admin
    renderAdminHomeSection(stats);

    // Pengaturan Kunci Rentang Tanggal Senin untuk Bendahara Biasa vs Admin Utama
    const canChangePeriod = canModifyMondayPeriod();
    const qStart = document.getElementById("quickCfgStartDate");
    const qEnd = document.getElementById("quickCfgEndDate");
    const qFee = document.getElementById("quickCfgFee");
    const btnQuickPeriod = document.getElementById("btnSubmitQuickMondayRange");
    const lockBadge = document.getElementById("admMondayLockStatusBadge");
    const lockNotice = document.getElementById("admMondayLockNotice");

    if (qStart) {
        qStart.value = appData.config.feeStartDate || defaultRange.start;
        qStart.disabled = !canChangePeriod;
    }
    if (qEnd) {
        qEnd.value = appData.config.feeEndDate || defaultRange.end;
        qEnd.disabled = !canChangePeriod;
    }
    if (qFee) {
        qFee.value = appData.config.weeklyFee || 5000;
        qFee.disabled = !canChangePeriod;
    }
    if (btnQuickPeriod) {
        btnQuickPeriod.disabled = !canChangePeriod;
        btnQuickPeriod.classList.toggle("hidden", !canChangePeriod);
    }
    if (lockBadge) {
        lockBadge.textContent = canChangePeriod ? "DAPAT DIATUR (ADMIN)" : "DIKUNCI OLEH ADMIN UTAMA";
        lockBadge.className = canChangePeriod ? "neo-badge bg-neo-mint text-neo-ink text-[10px]" : "neo-badge bg-neo-coral text-white text-[10px]";
    }
    if (lockNotice) {
        lockNotice.textContent = canChangePeriod
            ? "Anda memiliki hak akses untuk mengubah periode tanggal Senin dan tarif kas mingguan."
            : "Periode minggu Senin & tarif kas telah dikunci oleh Admin Utama. Anda dapat mencentang pelunasan siswa pada tabel di bawah.";
    }
    document.getElementById("admTotalMondaysBadge").textContent = `${mondays.length} Kolom Senin`;

    // 1. Matriks Kontrol Pelunasan Kas Siswa
    const admHead = document.getElementById("admIuranMatrixHead");
    const admBody = document.getElementById("admIuranMatrixBody");
    const admSearch = (document.getElementById("admIuranSearchInput")?.value || "").toLowerCase();

    if (admHead && admBody) {
        const weekCols = mondays
            .map((d) => `<th class="py-2 px-1.5 border-r-2 border-neutral-700 text-center min-w-[64px]"><div class="text-[9px] text-neo-yellow">SEN</div><div>${formatShortMondayLabel(d)}</div></th>`)
            .join("");
        admHead.innerHTML = `
            <tr>
                <th class="py-2 px-2 border-r-2 border-neutral-700 text-center">No</th>
                <th class="py-2 px-3 border-r-2 border-neutral-700 min-w-[160px]">Nama Anggota</th>
                ${weekCols}
            </tr>
        `;

        const filteredStu = appData.students.filter(
            (s) => s.name.toLowerCase().includes(admSearch) || String(s.absen).includes(admSearch)
        );

        if (filteredStu.length === 0) {
            admBody.innerHTML = `<tr><td colspan="${mondays.length + 2}" class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada anggota terdaftar.</td></tr>`;
        } else {
            admBody.innerHTML = filteredStu
                .map((stu) => {
                    ensureStudentPaidDatesMigrated(stu, mondays);
                    return `
                        <tr class="transition">
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-bold">${stu.absen}</td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink font-extrabold">
                                <button type="button" onclick="openStudentCardModal(${stu.id})" class="hover:underline text-left">${stu.name}</button>
                            </td>
                            ${mondays
                                .map((dateStr) => {
                                    const paid = Boolean(stu.paidDates[dateStr]);
                                    return `
                                        <td class="p-1 border-r-2 border-neo-ink text-center">
                                            <button
                                                type="button"
                                                onclick="toggleStudentMondayDate(${stu.id}, '${dateStr}')"
                                                class="w-full py-1 px-1 rounded border border-neo-ink font-mono text-[10px] font-extrabold ${paid ? "bg-neo-lime text-neo-ink" : "bg-rose-200 text-rose-900"}"
                                            >
                                                ${paid ? "LUNAS" : "BELUM"}
                                            </button>
                                        </td>
                                    `;
                                })
                                .join("")}
                        </tr>
                    `;
                })
                .join("");
        }
    }

    // Tabel Riwayat Transaksi Kas
    const admLedger = document.getElementById("admLedgerTableBody");
    document.getElementById("admTxCountBadge").textContent = `${appData.transactions.length} Transaksi`;
    if (admLedger) {
        if (appData.transactions.length === 0) {
            admLedger.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada transaksi kas.</td></tr>`;
        } else {
            admLedger.innerHTML = [...appData.transactions]
                .reverse()
                .map(
                    (tx) => `
                    <tr>
                        <td class="py-2 px-3 border-r-2 border-neo-ink font-mono text-xs">${tx.date}</td>
                        <td class="py-2 px-3 border-r-2 border-neo-ink">
                            <div class="font-extrabold">${tx.desc}</div>
                            <div class="text-[10px] text-muted-adaptive">${tx.category} • PJ: ${tx.pic}</div>
                        </td>
                        <td class="py-2 px-3 border-r-2 border-neo-ink text-right font-mono font-extrabold ${tx.type === "MASUK" ? "text-emerald-500" : "text-rose-500"}">
                            ${tx.type === "MASUK" ? "+" : "-"}${formatRupiah(tx.amount)}
                        </td>
                        <td class="py-2 px-3 text-center space-x-1">
                            <button type="button" onclick="editTransaction(${tx.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1 text-[10px]"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" onclick="deleteTransaction(${tx.id})" class="neo-btn bg-rose-200 text-rose-900 px-2 py-1 text-[10px]"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `
                )
                .join("");
        }
    }

    // 2. Render Absensi Digital Admin
    renderAdminAttendanceSection();

    // 3. Tabel Daftar Master Anggota
    document.getElementById("admStuTotalBadge").textContent = `${appData.students.length} Anggota`;
    const stuBody = document.getElementById("admStudentListBody");
    if (stuBody) {
        if (appData.students.length === 0) {
            stuBody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada anggota terdaftar.</td></tr>`;
        } else {
            stuBody.innerHTML = appData.students
                .map(
                    (s) => `
                    <tr>
                        <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono font-extrabold">#${String(s.absen).padStart(2, "0")}</td>
                        <td class="py-2 px-3 border-r-2 border-neo-ink">
                            <div class="flex items-center gap-2.5">
                                ${renderAvatarHtml(s.name, s.photoUrl, "w-9 h-9", "text-[10px]")}
                                <div>
                                    <div class="font-extrabold">${s.name}</div>
                                    ${s.quote ? `<div class="text-[10px] text-muted-adaptive italic truncate max-w-[170px]">"${s.quote}"</div>` : ""}
                                </div>
                            </div>
                        </td>
                        <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono font-bold">${s.gender || "L"}</td>
                        <td class="py-2 px-3 border-r-2 border-neo-ink text-xs">${s.role}</td>
                        <td class="py-2 px-2.5 border-r-2 border-neo-ink text-xs">${s.piket}</td>
                        <td class="py-2 px-3 text-center space-x-1">
                            <button type="button" onclick="editStudentInAdmin(${s.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1 text-[10px]"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" onclick="deleteStudentInAdmin(${s.id})" class="neo-btn bg-rose-200 text-rose-900 px-2 py-1 text-[10px]"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `
                )
                .join("");
        }
    }

    // 4. Pengumuman Berfoto & Moderasi Papan Tempel
    const admInfoBox = document.getElementById("admInfoListContainer");
    if (admInfoBox) {
        if (appData.announcements.length === 0) {
            admInfoBox.innerHTML = `<div class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada pengumuman aktif.</div>`;
        } else {
            admInfoBox.innerHTML = appData.announcements
                .map(
                    (a) => `
                    <div class="border-2 border-neo-ink rounded-lg p-3 flex items-center justify-between gap-3 bg-neo-bg">
                        <div class="flex items-center gap-3 min-w-0">
                            ${a.photoUrl ? `<img src="${a.photoUrl}" alt="Foto" class="w-12 h-12 rounded border border-neo-ink object-cover shrink-0">` : ""}
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="neo-badge bg-neo-yellow text-neo-ink text-[10px]">${a.category} • ${a.deadline}</span>
                                    ${a.expireAt ? `<span class="font-mono text-[9px] bg-white border border-neo-ink px-1.5 py-0.5 rounded text-rose-600">Hapus Foto: ${a.expireAt.replace("T", " ")}</span>` : ""}
                                </div>
                                <h4 class="font-display font-extrabold text-sm mt-1 truncate">${a.title}</h4>
                                <p class="text-xs text-muted-adaptive line-clamp-1">${a.body}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            <button type="button" onclick="editAnnouncement(${a.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2.5 py-1.5 text-xs"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" onclick="deleteAnnouncement(${a.id})" class="neo-btn bg-rose-200 text-rose-900 px-2.5 py-1.5 text-xs"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `
                )
                .join("");
        }
    }

    const admStickyBox = document.getElementById("admStickyListContainer");
    const stickyBadge = document.getElementById("admStickyCountBadge");
    if (stickyBadge) stickyBadge.textContent = `${(appData.stickyNotes || []).length} Kertas`;
    if (admStickyBox) {
        const notes = appData.stickyNotes || [];
        admStickyBox.innerHTML = notes.length === 0
            ? `<div class="col-span-full py-4 text-center text-xs font-bold text-muted-adaptive">Belum ada tempelan kertas.</div>`
            : notes
                .map(
                    (n) => `
                    <div style="background-color: ${n.color || "#FFE600"}" class="border-2 border-neo-ink rounded-lg p-3 flex items-start justify-between gap-2 text-xs text-neo-ink">
                        <div class="min-w-0">
                            <span class="font-mono text-[10px] font-extrabold bg-white/85 text-neo-ink px-1.5 py-0.5 rounded border border-neo-ink">${n.author} • ${n.date || ""}</span>
                            <p class="font-bold mt-1 break-words">"${n.message}"</p>
                        </div>
                        <button type="button" onclick="deleteStickyNote(${n.id})" class="neo-btn bg-white text-rose-700 px-2 py-1 text-[10px] shrink-0">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `
                )
                .join("");
    }

    // 5. Jadwal Pelajaran
    const admSchBox = document.getElementById("admScheduleListContainer");
    if (admSchBox) {
        const days = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
        admSchBox.innerHTML = days
            .map((d) => {
                const list = appData.schedule[d] || [];
                return `
                    <div class="border-2 border-neo-ink rounded-lg p-3 bg-neo-bg space-y-2">
                        <div class="font-display font-extrabold text-xs uppercase border-b-2 border-neo-ink pb-1 flex justify-between">
                            <span>HARI ${d}</span>
                            <span>${list.length} Mapel</span>
                        </div>
                        ${
                            list.length === 0
                                ? `<p class="text-[11px] text-muted-adaptive">Belum ada jadwal</p>`
                                : list
                                      .map(
                                          (item, idx) => `
                                <div class="bg-white border border-neo-ink rounded p-2.5 flex items-center justify-between gap-2 text-xs">
                                    <div class="min-w-0">
                                        <span class="font-mono text-[10px] font-bold text-neo-violet block"><i class="fa-regular fa-clock mr-1"></i>${item.time} • ${item.room}</span>
                                        <strong class="block truncate">${item.subject}</strong>
                                        <span class="text-[10px] text-muted-adaptive">${item.teacher}</span>
                                    </div>
                                    <div class="flex items-center gap-1 shrink-0">
                                        <button type="button" onclick="editScheduleItem('${d}', ${idx})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1 text-[10px]"><i class="fa-solid fa-pen"></i></button>
                                        <button type="button" onclick="deleteScheduleItem('${d}', ${idx})" class="neo-btn bg-rose-200 text-rose-900 px-2 py-1 text-[10px]"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </div>
                            `
                                      )
                                      .join("")
                        }
                    </div>
                `;
            })
            .join("");
    }

    // 6. Koleksi Album
    const admAlbumGrid = document.getElementById("admAlbumListGrid");
    document.getElementById("admAlbumCountBadge").textContent = `${appData.albums.length} Foto`;
    if (admAlbumGrid) {
        admAlbumGrid.innerHTML = appData.albums.length === 0
            ? `<div class="col-span-full py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada foto di album.</div>`
            : appData.albums
                .map(
                    (alb) => `
                    <div class="border-2 border-neo-ink rounded-lg overflow-hidden bg-neo-bg flex items-center gap-3 p-2.5">
                        <img src="${alb.url}" alt="${alb.title}" onerror="this.src='https://placehold.co/200x200/FFE600/111111?text=Foto'" class="w-16 h-16 object-cover rounded border border-neo-ink shrink-0">
                        <div class="min-w-0 flex-1">
                            <span class="text-[10px] font-mono font-bold text-muted-adaptive">${alb.category} • ${alb.date}</span>
                            <h4 class="font-display font-extrabold text-xs truncate">${alb.title}</h4>
                            <p class="text-[10px] text-muted-adaptive truncate">${alb.caption || ""}</p>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            <button type="button" onclick="editAlbumItem(${alb.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1.5 text-xs"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" onclick="deleteAlbumItem(${alb.id})" class="neo-btn bg-rose-200 text-rose-900 px-2 py-1.5 text-xs"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `
                )
                .join("");
    }

    // 7. Daftar Akun Pengurus & RBAC
    const accBox = document.getElementById("admAccountsList");
    if (accBox) {
        const allAdmins = getAllCombinedAdmins();
        accBox.innerHTML = allAdmins
            .map(
                (acc) => `
                <div class="border-2.5 border-neo-ink rounded-lg p-3.5 bg-neo-bg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-mono text-xs font-extrabold bg-neo-ink text-white px-2 py-0.5 rounded">${acc.username}</span>
                            <strong class="font-display text-sm">${acc.name}</strong>
                            <span class="neo-badge bg-neo-yellow text-neo-ink text-[10px]">${acc.role}</span>
                            ${String(acc.username).toLowerCase() === String(currentAdmin.username).toLowerCase() ? `<span class="neo-badge bg-neo-mint text-neo-ink text-[10px]">Sedang Login</span>` : ""}
                        </div>
                        <div class="text-[11px] font-mono text-muted-adaptive mt-1.5 flex flex-wrap items-center gap-2">
                            <span>Sandi: <strong class="bg-neo-surface px-1.5 py-0.5 rounded border border-neo-ink text-neo-ink">${acc.password || "(Kosong)"}</strong></span>
                            <span>•</span>
                            <span>Akses: ${acc.isSuperAdmin ? "SUPER ADMIN (PENUH)" : (acc.permissions || []).filter((p) => p !== "beranda").join(", ")}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button type="button" onclick="editAdminAccount('${acc.username}')" class="neo-btn bg-neo-yellow text-neo-ink px-2.5 py-1.5 text-xs">
                            <i class="fa-solid fa-key"></i> Edit / Hak Akses
                        </button>
                        ${
                            String(acc.username).toLowerCase() !== String(currentAdmin.username).toLowerCase()
                                ? `<button type="button" onclick="deleteAdminAccount('${acc.username}')" class="neo-btn bg-rose-200 text-rose-900 px-2.5 py-1.5 text-xs"><i class="fa-solid fa-trash"></i></button>`
                                : ""
                        }
                    </div>
                </div>
            `
            )
            .join("");
    }

    // 8. Isi Form Pengaturan Kelas, 4 Gambar, Medsos & Hari Libur
    const cfg = appData.config;
    document.getElementById("cfgClassCode").value = cfg.classCode || "MDV";
    document.getElementById("cfgClassName").value = cfg.className || "MEDIVANCE";
    const schNameEl = document.getElementById("cfgSchoolName");
    if (schNameEl) schNameEl.value = cfg.schoolName || "SMA NEGERI 5 AMBON";
    document.getElementById("cfgClassMotto").value = cfg.classMotto || "Together We Grow, Together We Heal";
    const semSel = document.getElementById("cfgSemesterName");
    if (semSel) semSel.value = cfg.semesterName || "Semester Ganjil";
    document.getElementById("cfgAcademicYear").value = cfg.academicYear || "2026/2027";

    const webLogoInput = document.getElementById("cfgWebsiteLogoUrl");
    if (webLogoInput) webLogoInput.value = cfg.websiteLogoUrl || "";
    document.getElementById("cfgClassLogoUrl").value = cfg.classLogoUrl || "";
    const schLogoInput = document.getElementById("cfgSchoolLogoUrl");
    if (schLogoInput) schLogoInput.value = cfg.schoolLogoUrl || "";
    document.getElementById("cfgHeroBgUrl").value = cfg.heroBgUrl || DEFAULT_HERO_BG;

    document.getElementById("cfgWelcomeTypingText").value = cfg.welcomeTypingText || "SELAMAT DATANG DI MEDIVANCE";
    document.getElementById("cfgHeroSubtitle").value = cfg.heroSubtitle || "";
    document.getElementById("cfgAboutClass").value = cfg.aboutClass || "";
    document.getElementById("cfgMarqueeText").value = cfg.marqueeText || "";

    const igEl = document.getElementById("cfgSocialIg");
    const ttEl = document.getElementById("cfgSocialTiktok");
    const emEl = document.getElementById("cfgSocialEmail");
    if (igEl) igEl.value = cfg.socialIg || "@medivance.class";
    if (ttEl) ttEl.value = cfg.socialTiktok || "@medivance.official";
    if (emEl) emEl.value = cfg.socialEmail || "medivance@kelas.id";

    document.getElementById("cfgWaliKelas").value = cfg.waliKelas || "";
    document.getElementById("cfgWaliTitle").value = cfg.waliTitle || "";
    document.getElementById("cfgWaliPhotoUrl").value = cfg.waliPhotoUrl || "";
    document.getElementById("cfgWeeklyFee").value = cfg.weeklyFee || 5000;
    document.getElementById("cfgFeeStartDate").value = cfg.feeStartDate || defaultRange.start;
    document.getElementById("cfgFeeEndDate").value = cfg.feeEndDate || defaultRange.end;
    document.getElementById("cfgPaymentInfo").value = cfg.paymentInfo || "";

    syncConfigPreview("cfgWebsiteLogoUrl", "cfgWebLogoPreviewImg", "cfgWebLogoPreviewFallback");
    syncConfigPreview("cfgClassLogoUrl", "cfgLogoPreviewImg", "cfgLogoPreviewFallback");
    syncConfigPreview("cfgSchoolLogoUrl", "cfgSchoolLogoPreviewImg", "cfgSchoolLogoPreviewFallback");
    syncConfigPreview("cfgHeroBgUrl", "cfgHeroBgPreviewImg", "cfgHeroBgPreviewFallback");
    syncConfigPreview("cfgWaliPhotoUrl", "cfgWaliPreviewImg", "cfgWaliPreviewFallback");

    // Daftar Hari Libur di Admin
    const holBox = document.getElementById("admHolidaysListContainer");
    if (holBox) {
        const hols = cfg.holidays || [];
        holBox.innerHTML = hols.length === 0
            ? `<div class="text-[11px] font-bold text-muted-adaptive py-2 text-center">Belum ada tanggal merah tambahan (Sabtu & Minggu otomatis merah).</div>`
            : hols
                .map(
                    (h) => `
                    <div class="flex items-center justify-between bg-neo-surface border border-neo-ink rounded px-2.5 py-1.5 text-xs font-bold">
                        <div>
                            <span class="font-mono text-[10px] bg-neo-coral text-white px-1.5 py-0.5 rounded mr-1.5">${h.date}</span>
                            <span>${h.name}</span>
                        </div>
                        <button type="button" onclick="deleteCustomHoliday(${h.id})" class="text-rose-600 hover:underline text-[11px] font-extrabold">Hapus</button>
                    </div>
                `
                )
                .join("");
    }

    renderSemesterArchivesSection();
};

// ============================================================================
// HANDLER CRUD TIAP TAB ADMIN (DENGAN PROTEKSI GRANULAR RBAC)
// ============================================================================

window.handleQuickMondayRangeUpdate = async function (e) {
    e.preventDefault();
    if (!canModifyMondayPeriod()) {
        showToast("Akses Ditolak: Hanya Admin Utama yang dapat mengubah rentang tanggal Senin & tarif kas!", "bg-neo-coral");
        return;
    }
    const start = document.getElementById("quickCfgStartDate").value;
    const end = document.getElementById("quickCfgEndDate").value;
    const fee = Number(document.getElementById("quickCfgFee").value) || 0;

    if (new Date(end) < new Date(start)) {
        showToast("Tanggal Akhir harus setelah Tanggal Awal!", "bg-neo-coral");
        return;
    }

    appData.config.feeStartDate = start;
    appData.config.feeEndDate = end;
    appData.config.weeklyFee = fee;

    const count = getMondayDatesList().length;
    await saveToCloudDatabase(`Periode ${count} pekan hari Senin berhasil disimpan ke Firebase!`);
    renderAdminWorkspace();
};

window.handleAdminSaveTransaction = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("keuangan")) return;

    const editId = document.getElementById("admTxEditId").value;
    const txPayload = {
        id: editId ? Number(editId) : Date.now(),
        type: document.getElementById("admTxType").value,
        date: document.getElementById("admTxDate").value,
        category: document.getElementById("admTxCategory").value,
        amount: Number(document.getElementById("admTxAmount").value),
        desc: document.getElementById("admTxDesc").value.trim(),
        pic: document.getElementById("admTxPic").value.trim()
    };

    if (editId) {
        const idx = appData.transactions.findIndex((t) => String(t.id) === String(editId));
        if (idx >= 0) appData.transactions[idx] = txPayload;
    } else {
        appData.transactions.push(txPayload);
    }

    resetTransactionForm();
    await saveToCloudDatabase("Transaksi buku kas berhasil disimpan ke Firebase!");
    renderAdminWorkspace();
};

window.editTransaction = function (id) {
    const tx = appData.transactions.find((t) => t.id === id);
    if (!tx) return;
    document.getElementById("admTxEditId").value = tx.id;
    document.getElementById("admTxType").value = tx.type;
    document.getElementById("admTxDate").value = tx.date;
    document.getElementById("admTxCategory").value = tx.category;
    document.getElementById("admTxAmount").value = tx.amount;
    document.getElementById("admTxDesc").value = tx.desc;
    document.getElementById("admTxPic").value = tx.pic;
    document.getElementById("admTxFormTitle").textContent = "Edit Transaksi Kas";
    document.getElementById("btnCancelEditTx").classList.remove("hidden");
};

window.resetTransactionForm = function () {
    document.getElementById("admTxEditId").value = "";
    document.getElementById("admTxAmount").value = "";
    document.getElementById("admTxDesc").value = "";
    document.getElementById("admTxPic").value = "";
    document.getElementById("admTxDate").value = toLocalISODate(new Date());
    document.getElementById("admTxFormTitle").textContent = "Catat Transaksi Kas";
    document.getElementById("btnCancelEditTx").classList.add("hidden");
};

window.deleteTransaction = async function (txId) {
    if (!canEditInCurrentView("keuangan")) return;
    appData.transactions = appData.transactions.filter((t) => t.id !== txId);
    await saveToCloudDatabase("Transaksi dihapus dari buku kas.");
    renderAdminWorkspace();
};

// --- CRUD Master Anggota Kelas ---
window.handleStudentPhotoUpload = function (e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        document.getElementById("admStuPhotoUrl").value = dataUrl;
        updateStudentPhotoPreview(dataUrl);
        showToast("Foto ID Card anggota berhasil dimuat!", "bg-neo-mint");
    });
};

window.updateStudentPhotoPreview = function (url) {
    const img = document.getElementById("admStuPhotoPreview");
    const ph = document.getElementById("admStuPhotoPlaceholder");
    applyImageWithFallback(img, ph, url);
};

window.clearStudentPhotoInput = function () {
    const urlInput = document.getElementById("admStuPhotoUrl");
    if (urlInput) urlInput.value = "";
    const fileEl = document.getElementById("admStuPhotoFile");
    if (fileEl) fileEl.value = "";
    updateStudentPhotoPreview("");
};

window.handleAdminSaveStudent = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("siswa")) {
        showToast("Akses Ditolak: Hanya pemegang izin Master Data Anggota yang dapat mengubah daftar siswa!", "bg-neo-coral");
        return;
    }

    const editId = document.getElementById("admStuEditId")?.value || "";
    const absen = Number(document.getElementById("admStuAbsen")?.value || 1);
    const name = (document.getElementById("admStuName")?.value || "").trim();
    const gender = document.getElementById("admStuGender")?.value || "L";
    const role = document.getElementById("admStuRole")?.value || "Anggota Kelas";
    const piket = document.getElementById("admStuPiket")?.value || "Senin";
    const quote = (document.getElementById("admStuQuote")?.value || "").trim();
    const photoUrl = (document.getElementById("admStuPhotoUrl")?.value || "").trim();

    if (!name) return;

    if (editId) {
        const target = appData.students.find((s) => String(s.id) === String(editId));
        if (target) {
            target.absen = absen;
            target.name = name;
            target.gender = gender;
            target.role = role;
            target.piket = piket;
            target.quote = quote;
            target.photoUrl = photoUrl;
            if (!target.paidDates || typeof target.paidDates !== "object") target.paidDates = {};
        }
    } else {
        appData.students.push({
            id: Date.now(),
            absen,
            name,
            gender,
            role,
            piket,
            quote,
            photoUrl,
            paidDates: {}
        });
    }

    appData.students.sort((a, b) => Number(a.absen) - Number(b.absen));
    resetStudentForm();
    await saveToCloudDatabase(`Data anggota "${name}" berhasil disimpan ke Firebase!`);
    renderAdminWorkspace();
};

window.editStudentInAdmin = function (id) {
    if (!canEditInCurrentView("siswa")) return;
    const s = appData.students.find((stu) => stu.id === id);
    if (!s) return;
    document.getElementById("admStuEditId").value = s.id;
    document.getElementById("admStuAbsen").value = s.absen;
    document.getElementById("admStuName").value = s.name;
    document.getElementById("admStuGender").value = s.gender || "L";
    document.getElementById("admStuRole").value = s.role || "Anggota Kelas";
    document.getElementById("admStuPiket").value = s.piket || "Senin";
    document.getElementById("admStuQuote").value = s.quote || "";
    document.getElementById("admStuPhotoUrl").value = s.photoUrl || "";
    updateStudentPhotoPreview(s.photoUrl || "");
    document.getElementById("admStudentFormTitle").textContent = `Edit Anggota #${s.absen}`;
    document.getElementById("btnCancelEditStudent")?.classList.remove("hidden");
};

window.resetStudentForm = function () {
    document.getElementById("admStuEditId").value = "";
    document.getElementById("admStuAbsen").value = "";
    document.getElementById("admStuName").value = "";
    document.getElementById("admStuQuote").value = "";
    clearStudentPhotoInput();
    document.getElementById("admStudentFormTitle").textContent = "Form Master Anggota & Perangkat";
    document.getElementById("btnCancelEditStudent")?.classList.add("hidden");
};

window.deleteStudentInAdmin = async function (id) {
    if (!canEditInCurrentView("siswa")) return;
    appData.students = appData.students.filter((s) => s.id !== id);
    await saveToCloudDatabase("Data anggota telah dihapus dari Firebase.");
    renderAdminWorkspace();
};

// --- CRUD Pengumuman / Tugas + Upload Foto + Auto-Expire Deadline ---
window.handleInfoPhotoUpload = function (e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        document.getElementById("admInfoPhotoUrl").value = dataUrl;
        updateInfoPhotoPreview(dataUrl);
        showToast("Lampiran foto tugas siap dipublikasikan!", "bg-neo-mint");
    });
};

window.updateInfoPhotoPreview = function (url) {
    const wrap = document.getElementById("admInfoPhotoPreviewWrap");
    const img = document.getElementById("admInfoPhotoPreviewImg");
    if (!wrap || !img) return;
    const clean = String(url || "").trim();
    if (clean.length > 4) {
        img.src = clean;
        wrap.classList.remove("hidden");
    } else {
        img.removeAttribute("src");
        wrap.classList.add("hidden");
    }
};

window.clearInfoPhotoInput = function () {
    const urlInput = document.getElementById("admInfoPhotoUrl");
    if (urlInput) urlInput.value = "";
    const fileEl = document.getElementById("admInfoPhotoFile");
    if (fileEl) fileEl.value = "";
    updateInfoPhotoPreview("");
};

window.handleAdminSaveInfo = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("info")) return;

    const editId = document.getElementById("admInfoEditId").value;
    const photoUrl = (document.getElementById("admInfoPhotoUrl")?.value || "").trim();
    const expireAt = (document.getElementById("admInfoExpireAt")?.value || "").trim();

    const payload = {
        id: editId ? Number(editId) : Date.now(),
        category: document.getElementById("admInfoCat").value,
        deadline: document.getElementById("admInfoDeadline").value.trim(),
        expireAt,
        photoUrl,
        photoExpired: false,
        title: document.getElementById("admInfoTitle").value.trim(),
        body: document.getElementById("admInfoBody").value.trim(),
        author: `${currentAdmin.name} (${currentAdmin.role})`
    };

    if (editId) {
        const idx = appData.announcements.findIndex((a) => String(a.id) === String(editId));
        if (idx >= 0) appData.announcements[idx] = payload;
    } else {
        appData.announcements.unshift(payload);
    }

    resetInfoForm();
    await cleanExpiredTaskPhotos(false);
    await saveToCloudDatabase("Pengumuman/Tugas berhasil dipublikasikan ke Firebase!");
    renderAdminWorkspace();
};

window.editAnnouncement = function (id) {
    const a = appData.announcements.find((item) => item.id === id);
    if (!a) return;
    document.getElementById("admInfoEditId").value = a.id;
    document.getElementById("admInfoCat").value = a.category;
    document.getElementById("admInfoDeadline").value = a.deadline;
    const expEl = document.getElementById("admInfoExpireAt");
    if (expEl) expEl.value = a.expireAt || "";
    const pUrl = document.getElementById("admInfoPhotoUrl");
    if (pUrl) pUrl.value = a.photoUrl || "";
    updateInfoPhotoPreview(a.photoUrl || "");
    document.getElementById("admInfoTitle").value = a.title;
    document.getElementById("admInfoBody").value = a.body;
    document.getElementById("admInfoFormTitle").textContent = "Edit Pengumuman / Tugas";
    document.getElementById("btnCancelEditInfo").classList.remove("hidden");
};

window.resetInfoForm = function () {
    document.getElementById("admInfoEditId").value = "";
    document.getElementById("admInfoDeadline").value = "";
    const expEl = document.getElementById("admInfoExpireAt");
    if (expEl) expEl.value = "";
    clearInfoPhotoInput();
    document.getElementById("admInfoTitle").value = "";
    document.getElementById("admInfoBody").value = "";
    document.getElementById("admInfoFormTitle").textContent = "Buat Pengumuman / Tugas + Foto";
    document.getElementById("btnCancelEditInfo").classList.add("hidden");
};

window.deleteAnnouncement = async function (id) {
    if (!canEditInCurrentView("info")) return;
    appData.announcements = appData.announcements.filter((a) => a.id !== id);
    await saveToCloudDatabase("Pengumuman dihapus.");
    renderAdminWorkspace();
};

// --- CRUD Jadwal Pelajaran ---
window.syncScheduleTimeRange = function () {
    const start = document.getElementById("admSchStartTime")?.value || "07:30";
    const end = document.getElementById("admSchEndTime")?.value || "09:00";
    const combined = `${start} - ${end}`;
    const hiddenInput = document.getElementById("admSchTime");
    const badge = document.getElementById("admSchTimePreviewBadge");
    if (hiddenInput) hiddenInput.value = combined;
    if (badge) badge.textContent = combined;
};

window.applySchedulePreset = function (start, end) {
    const sEl = document.getElementById("admSchStartTime");
    const eEl = document.getElementById("admSchEndTime");
    if (sEl) sEl.value = start;
    if (eEl) eEl.value = end;
    syncScheduleTimeRange();
};

window.handleAdminSaveSchedule = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("jadwal")) return;

    syncScheduleTimeRange();
    const day = document.getElementById("admSchDay").value;
    const editDay = document.getElementById("admSchEditDay").value;
    const editIdx = document.getElementById("admSchEditIdx").value;

    const lessonObj = {
        time: document.getElementById("admSchTime").value.trim(),
        subject: document.getElementById("admSchSubject").value.trim(),
        teacher: document.getElementById("admSchTeacher").value.trim(),
        room: document.getElementById("admSchRoom").value.trim()
    };

    if (!Array.isArray(appData.schedule[day])) appData.schedule[day] = [];

    if (editDay && editIdx !== "") {
        const idxNum = Number(editIdx);
        if (editDay === day && appData.schedule[day][idxNum]) {
            appData.schedule[day][idxNum] = lessonObj;
        } else {
            if (Array.isArray(appData.schedule[editDay])) appData.schedule[editDay].splice(idxNum, 1);
            appData.schedule[day].push(lessonObj);
        }
    } else {
        appData.schedule[day].push(lessonObj);
    }

    resetScheduleForm();
    await saveToCloudDatabase(`Jadwal hari ${day} berhasil disimpan ke Firebase!`);
    renderAdminWorkspace();
};

window.editScheduleItem = function (day, idx) {
    const item = appData.schedule[day]?.[idx];
    if (!item) return;
    document.getElementById("admSchEditDay").value = day;
    document.getElementById("admSchEditIdx").value = idx;
    document.getElementById("admSchDay").value = day;

    const parts = String(item.time || "").split("-").map((s) => s.trim());
    if (parts.length === 2 && parts[0].includes(":") && parts[1].includes(":")) {
        document.getElementById("admSchStartTime").value = parts[0];
        document.getElementById("admSchEndTime").value = parts[1];
    }
    syncScheduleTimeRange();

    document.getElementById("admSchSubject").value = item.subject;
    document.getElementById("admSchTeacher").value = item.teacher;
    document.getElementById("admSchRoom").value = item.room;
    document.getElementById("admScheduleFormTitle").textContent = `Edit Mapel Hari ${day}`;
    document.getElementById("btnCancelEditSchedule").classList.remove("hidden");
};

window.resetScheduleForm = function () {
    document.getElementById("admSchEditDay").value = "";
    document.getElementById("admSchEditIdx").value = "";
    document.getElementById("admSchSubject").value = "";
    document.getElementById("admSchTeacher").value = "";
    document.getElementById("admSchRoom").value = "";
    applySchedulePreset("07:30", "09:00");
    document.getElementById("admScheduleFormTitle").textContent = "Atur Jadwal Mata Pelajaran";
    document.getElementById("btnCancelEditSchedule").classList.add("hidden");
};

window.deleteScheduleItem = async function (day, index) {
    if (!canEditInCurrentView("jadwal")) return;
    if (Array.isArray(appData.schedule[day])) {
        appData.schedule[day].splice(index, 1);
        await saveToCloudDatabase("Mata pelajaran dihapus dari jadwal.");
        renderAdminWorkspace();
    }
};

// --- CRUD Album Kenangan ---
window.handleAlbumImageUpload = function (e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        document.getElementById("admAlbumUrl").value = dataUrl;
        updateAlbumPhotoPreview(dataUrl);
        showToast("Foto dokumentasi berhasil dimuat!", "bg-neo-mint");
    });
};

window.updateAlbumPhotoPreview = function (url) {
    const wrapper = document.getElementById("admAlbumPreviewWrapper");
    const img = document.getElementById("admAlbumPreviewImg");
    if (!wrapper || !img) return;
    const clean = String(url || "").trim();
    if (clean.length > 4) {
        img.src = clean;
        wrapper.classList.remove("hidden");
    } else {
        img.removeAttribute("src");
        wrapper.classList.add("hidden");
    }
};

window.clearAlbumPhotoInput = function () {
    document.getElementById("admAlbumUrl").value = "";
    const fileEl = document.getElementById("admAlbumFile");
    if (fileEl) fileEl.value = "";
    updateAlbumPhotoPreview("");
};

window.handleAdminSaveAlbum = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("album")) return;

    const editId = document.getElementById("admAlbumEditId").value;
    const rawUrl = document.getElementById("admAlbumUrl").value.trim();
    if (!rawUrl) {
        showToast("Pilih file foto atau tempel URL gambar terlebih dahulu!", "bg-neo-coral");
        return;
    }

    const payload = {
        id: editId ? Number(editId) : Date.now(),
        title: document.getElementById("admAlbumTitle").value.trim(),
        category: document.getElementById("admAlbumCategory").value,
        date: document.getElementById("admAlbumDate").value,
        url: rawUrl,
        caption: document.getElementById("admAlbumCaption").value.trim(),
        author: currentAdmin.name
    };

    if (editId) {
        const idx = appData.albums.findIndex((a) => String(a.id) === String(editId));
        if (idx >= 0) appData.albums[idx] = payload;
    } else {
        appData.albums.unshift(payload);
    }

    resetAlbumForm();
    await saveToCloudDatabase("Foto berhasil disimpan ke Album Firebase!");
    renderAdminWorkspace();
};

window.editAlbumItem = function (id) {
    const alb = appData.albums.find((a) => a.id === id);
    if (!alb) return;
    document.getElementById("admAlbumEditId").value = alb.id;
    document.getElementById("admAlbumTitle").value = alb.title;
    document.getElementById("admAlbumCategory").value = alb.category;
    document.getElementById("admAlbumDate").value = alb.date;
    document.getElementById("admAlbumUrl").value = alb.url;
    document.getElementById("admAlbumCaption").value = alb.caption || "";
    updateAlbumPhotoPreview(alb.url);
    document.getElementById("admAlbumFormTitle").textContent = "Edit Foto Album";
    document.getElementById("btnCancelEditAlbum").classList.remove("hidden");
};

window.resetAlbumForm = function () {
    document.getElementById("admAlbumEditId").value = "";
    document.getElementById("admAlbumTitle").value = "";
    document.getElementById("admAlbumCaption").value = "";
    document.getElementById("admAlbumDate").value = toLocalISODate(new Date());
    clearAlbumPhotoInput();
    document.getElementById("admAlbumFormTitle").textContent = "Unggah Dokumentasi Album";
    document.getElementById("btnCancelEditAlbum").classList.add("hidden");
};

window.deleteAlbumItem = async function (id) {
    if (!canEditInCurrentView("album")) return;
    appData.albums = appData.albums.filter((a) => a.id !== id);
    await saveToCloudDatabase("Foto dihapus dari album.");
    renderAdminWorkspace();
};

// --- CRUD Akun Pengurus & Preset Peran Ketat (Strict RBAC) ---
window.applyRolePermissionPreset = function (presetType) {
    const map = {
        BENDAHARA: ["keuangan"], // Hanya isi kas & centang Senin, TIDAK BISA ubah periode Senin / nama siswa
        SEKRETARIS: ["absensi", "info", "jadwal"], // Hanya isi absen, tugas & jadwal, TIDAK BISA ubah nama siswa
        DOKUMENTASI: ["album", "info"]
    };
    const allowed = map[presetType] || ["keuangan"];
    document.querySelectorAll('input[name="admPerm"]').forEach((cb) => {
        cb.checked = allowed.includes(cb.value);
    });
    const roleInput = document.getElementById("admAccRole");
    if (roleInput && !roleInput.value) {
        roleInput.value = presetType === "BENDAHARA" ? "Bendahara Kelas" : presetType === "SEKRETARIS" ? "Sekretaris Kelas" : "Seksi Dokumentasi";
    }
    showToast(`Preset hak akses ${presetType} diterapkan!`, "bg-neo-yellow");
};

window.editAdminAccount = function (username) {
    const cleanUser = String(username).trim().toLowerCase();
    const allAdmins = getAllCombinedAdmins();
    const target = allAdmins.find((a) => String(a.username).toLowerCase() === cleanUser);
    if (!target) return;

    const origInput = document.getElementById("admAccEditOriginalUser");
    if (origInput) origInput.value = cleanUser;

    document.getElementById("admAccUsername").value = target.username;
    document.getElementById("admAccPassword").value = target.password || "";
    document.getElementById("admAccName").value = target.name || "";
    document.getElementById("admAccRole").value = target.role || "";

    const perms = target.isSuperAdmin
        ? ["keuangan", "atur_periode_kas", "absensi", "siswa", "info", "jadwal", "album", "pengaturan", "akun"]
        : (target.permissions || []);

    document.querySelectorAll('input[name="admPerm"]').forEach((cb) => {
        cb.checked = perms.includes(cb.value);
    });

    const titleEl = document.getElementById("admAccFormTitle");
    if (titleEl) titleEl.textContent = `Edit Akun: ${target.username}`;
    document.getElementById("btnCancelEditAcc")?.classList.remove("hidden");
    document.getElementById("admAccPassword")?.focus();
};

window.resetAdminAccountForm = function () {
    const origInput = document.getElementById("admAccEditOriginalUser");
    if (origInput) origInput.value = "";
    document.getElementById("admAccUsername").value = "";
    document.getElementById("admAccPassword").value = "";
    document.getElementById("admAccName").value = "";
    document.getElementById("admAccRole").value = "";
    const titleEl = document.getElementById("admAccFormTitle");
    if (titleEl) titleEl.textContent = "Buat / Atur Hak Akses Akun Pengurus";
    document.getElementById("btnCancelEditAcc")?.classList.add("hidden");
};

window.handleAdminSaveAccount = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("akun")) return;

    const origUser = (document.getElementById("admAccEditOriginalUser")?.value || "").trim().toLowerCase();
    const username = (document.getElementById("admAccUsername")?.value || "").trim().toLowerCase();
    const password = document.getElementById("admAccPassword")?.value || "";
    const name = (document.getElementById("admAccName")?.value || "").trim();
    const role = (document.getElementById("admAccRole")?.value || "").trim();

    if (!username || !password) return;

    const checkedPerms = Array.from(document.querySelectorAll('input[name="admPerm"]:checked')).map((cb) => cb.value);
    if (checkedPerms.length === 0) {
        showToast("Pilih minimal 1 modul hak akses!", "bg-neo-coral");
        return;
    }

    if (!checkedPerms.includes("beranda")) checkedPerms.unshift("beranda");
    const isSuper = checkedPerms.includes("akun");

    if (origUser && origUser !== username) {
        appData.admins = appData.admins.filter((a) => String(a.username).toLowerCase() !== origUser);
        externalFirebaseAdmins = externalFirebaseAdmins.filter((a) => String(a.username).toLowerCase() !== origUser);
        await deleteAdminAccountFromCloud(origUser);
    }

    const existingIdx = appData.admins.findIndex((a) => String(a.username).toLowerCase() === username);

    const accountObj = {
        id: existingIdx >= 0 ? appData.admins[existingIdx].id : Date.now(),
        username,
        email: username.includes("@") ? username : `${username}@kelas.id`,
        password,
        name,
        role,
        isSuperAdmin: isSuper,
        permissions: checkedPerms
    };

    if (existingIdx >= 0) appData.admins[existingIdx] = accountObj;
    else appData.admins.push(accountObj);

    externalFirebaseAdmins = mergeAdminArrays(externalFirebaseAdmins, [accountObj]);

    if (currentAdmin && (String(currentAdmin.username).toLowerCase() === username || String(currentAdmin.username).toLowerCase() === origUser)) {
        currentAdmin = accountObj;
        saveAdminSessionToStorage();
    }

    await saveAdminAccountToCloud(accountObj);
    resetAdminAccountForm();
    await saveToCloudDatabase(`Akun pengurus "${username}" (${role}) berhasil disimpan ke Firebase!`);
    renderAdminWorkspace();
};

window.deleteAdminAccount = async function (username) {
    if (!canEditInCurrentView("akun")) return;
    const targetUser = String(username).trim().toLowerCase();
    if (currentAdmin && String(currentAdmin.username).toLowerCase() === targetUser) {
        showToast("Tidak dapat menghapus akun yang sedang Anda gunakan!", "bg-neo-coral");
        return;
    }

    appData.admins = appData.admins.filter((a) => String(a.username).toLowerCase() !== targetUser);
    externalFirebaseAdmins = externalFirebaseAdmins.filter((a) => String(a.username).toLowerCase() !== targetUser);

    await deleteAdminAccountFromCloud(targetUser);
    await saveToCloudDatabase(`Akun ${targetUser} telah dihapus permanen dari Firebase.`);
    renderAdminWorkspace();
};

window.handleAdminSaveConfig = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("pengaturan")) return;

    const start = document.getElementById("cfgFeeStartDate").value;
    const end = document.getElementById("cfgFeeEndDate").value;
    if (new Date(end) < new Date(start)) {
        showToast("Tanggal Akhir Kas harus setelah Tanggal Awal Kas!", "bg-neo-coral");
        return;
    }

    appData.config.classCode = document.getElementById("cfgClassCode").value.trim() || "MDV";
    appData.config.className = document.getElementById("cfgClassName").value.trim() || "MEDIVANCE";
    const schEl = document.getElementById("cfgSchoolName");
    if (schEl) appData.config.schoolName = schEl.value.trim() || "SMA NEGERI 5 AMBON";
    appData.config.classMotto = document.getElementById("cfgClassMotto").value.trim() || "Together We Grow, Together We Heal";
    const semSel = document.getElementById("cfgSemesterName");
    if (semSel) appData.config.semesterName = semSel.value;
    appData.config.academicYear = document.getElementById("cfgAcademicYear").value.trim();

    const webLogoEl = document.getElementById("cfgWebsiteLogoUrl");
    if (webLogoEl) appData.config.websiteLogoUrl = webLogoEl.value.trim();
    appData.config.classLogoUrl = document.getElementById("cfgClassLogoUrl").value.trim();
    const schLogoEl = document.getElementById("cfgSchoolLogoUrl");
    if (schLogoEl) appData.config.schoolLogoUrl = schLogoEl.value.trim();
    appData.config.heroBgUrl = document.getElementById("cfgHeroBgUrl").value.trim() || DEFAULT_HERO_BG;

    appData.config.welcomeTypingText = document.getElementById("cfgWelcomeTypingText").value.trim();
    appData.config.heroSubtitle = document.getElementById("cfgHeroSubtitle").value.trim();
    appData.config.aboutClass = document.getElementById("cfgAboutClass").value.trim();
    appData.config.marqueeText = document.getElementById("cfgMarqueeText").value.trim();

    const igEl = document.getElementById("cfgSocialIg");
    const ttEl = document.getElementById("cfgSocialTiktok");
    const emEl = document.getElementById("cfgSocialEmail");
    if (igEl) appData.config.socialIg = igEl.value.trim();
    if (ttEl) appData.config.socialTiktok = ttEl.value.trim();
    if (emEl) appData.config.socialEmail = emEl.value.trim();

    appData.config.waliKelas = document.getElementById("cfgWaliKelas").value.trim();
    appData.config.waliTitle = document.getElementById("cfgWaliTitle").value.trim();
    appData.config.waliPhotoUrl = document.getElementById("cfgWaliPhotoUrl").value.trim();
    appData.config.weeklyFee = Number(document.getElementById("cfgWeeklyFee").value) || 0;
    appData.config.feeStartDate = start;
    appData.config.feeEndDate = end;
    appData.config.paymentInfo = document.getElementById("cfgPaymentInfo").value.trim();

    await saveToCloudDatabase("Seluruh Pengaturan Identitas, Logo Kop Sheet, Medsos & Wali Kelas berhasil disimpan!");
    renderAdminWorkspace();
};

// ============================================================================
// EKSPOR LAPORAN SHEET RESMI (.XLS) ESTETIK DENGAN KOP 2 LOGO (SEKOLAH & KELAS)
// ============================================================================

window.downloadOfficialExcelSheet = function () {
    const cfg = appData.config;
    const stats = calculateFinancialSummary();
    const mondays = stats.mondayDates;
    const nowStr = new Date().toLocaleDateString("id-ID", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
    const totalColumns = mondays.length + 7;

    const schoolLogoHtml = cfg.schoolLogoUrl
        ? `<img src="${cfg.schoolLogoUrl}" width="70" height="70" style="object-fit:contain;">`
        : `<div style="font-weight:bold;font-size:10pt;color:#FFE600;">[${cfg.schoolName || "SEKOLAH"}]</div>`;

    const classLogoHtml = cfg.classLogoUrl || cfg.websiteLogoUrl
        ? `<img src="${cfg.classLogoUrl || cfg.websiteLogoUrl}" width="70" height="70" style="object-fit:contain;">`
        : `<div style="font-weight:bold;font-size:12pt;color:#00F5D4;">[${cfg.classCode || "MDV"}]</div>`;

    const studentRowsHtml = appData.students
        .map((s) => {
            ensureStudentPaidDatesMigrated(s, mondays);
            const statuses = mondays.map((d) => Boolean(s.paidDates[d]));
            const paidCount = statuses.filter(Boolean).length;
            const unpaidCount = mondays.length - paidCount;
            const paidRp = paidCount * stats.fee;
            const unpaidRp = unpaidCount * stats.fee;

            return `
                <tr>
                    <td style="border:1px solid #111;padding:6px;text-align:center;font-weight:bold;">${s.absen}</td>
                    <td style="border:1px solid #111;padding:6px;font-weight:bold;">${s.name}</td>
                    <td style="border:1px solid #111;padding:6px;text-align:center;">${s.gender || "L"}</td>
                    <td style="border:1px solid #111;padding:6px;">${s.role}</td>
                    <td style="border:1px solid #111;padding:6px;text-align:center;">${s.piket}</td>
                    ${statuses
                        .map(
                            (st) => `
                        <td style="border:1px solid #111;padding:6px;text-align:center;font-weight:bold;background-color:${st ? "#D9F99D" : "#FECDD3"};color:${st ? "#14532D" : "#881337"};">
                            ${st ? "LUNAS" : "BELUM"}
                        </td>
                    `
                        )
                        .join("")}
                    <td style="border:1px solid #111;padding:6px;text-align:right;font-weight:bold;color:#047857;">${formatRupiah(paidRp)}</td>
                    <td style="border:1px solid #111;padding:6px;text-align:right;font-weight:bold;color:${unpaidRp > 0 ? "#BE123C" : "#64748B"};">${formatRupiah(unpaidRp)}</td>
                </tr>
            `;
        })
        .join("");

    const txRowsHtml = appData.transactions
        .map(
            (t, i) => `
            <tr>
                <td style="border:1px solid #111;padding:6px;text-align:center;">${i + 1}</td>
                <td style="border:1px solid #111;padding:6px;text-align:center;">${t.date}</td>
                <td style="border:1px solid #111;padding:6px;text-align:center;font-weight:bold;background-color:${t.type === "MASUK" ? "#D9F99D" : "#FEF08A"};">${t.type}</td>
                <td style="border:1px solid #111;padding:6px;">${t.category}</td>
                <td style="border:1px solid #111;padding:6px;">${t.desc}</td>
                <td style="border:1px solid #111;padding:6px;">${t.pic}</td>
                <td style="border:1px solid #111;padding:6px;text-align:right;font-weight:bold;color:${t.type === "MASUK" ? "#047857" : "#BE123C"};">
                    ${t.type === "MASUK" ? "+" : "-"}${formatRupiah(t.amount)}
                </td>
            </tr>
        `
        )
        .join("");

    const centerColSpan = Math.max(3, totalColumns - 4);

    const excelHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:Arial,sans-serif;font-size:11pt;">
            <!-- KOP SURAT ESTETIK DENGAN 2 LOGO (LOGO SEKOLAH KIRI & LOGO KELAS KANAN) -->
            <table style="border-collapse:collapse;width:100%;margin-bottom:18px;">
                <tr>
                    <td colspan="2" rowspan="2" style="background-color:#111111;color:#FFFFFF;text-align:center;vertical-align:middle;padding:10px;border:2px solid #111111;">
                        ${schoolLogoHtml}
                    </td>
                    <td colspan="${centerColSpan}" style="background-color:#111111;color:#FFE600;font-size:15pt;font-weight:bold;padding:10px;text-align:center;border-top:2px solid #111111;">
                        ${(cfg.schoolName || "SMA NEGERI 5 AMBON").toUpperCase()}<br>
                        <span style="font-size:13pt;color:#FFFFFF;">LAPORAN RESMI BUKU KAS & IURAN KELAS ${(cfg.className || "MEDIVANCE").toUpperCase()}</span>
                    </td>
                    <td colspan="2" rowspan="2" style="background-color:#111111;color:#FFFFFF;text-align:center;vertical-align:middle;padding:10px;border:2px solid #111111;">
                        ${classLogoHtml}
                    </td>
                </tr>
                <tr>
                    <td colspan="${centerColSpan}" style="background-color:#FFE600;color:#111111;font-size:10pt;font-weight:bold;padding:6px;text-align:center;border:2px solid #111111;">
                        MOTTO RESMI: "${cfg.classMotto || "Together We Grow, Together We Heal"}" • ${(cfg.semesterName || "SEMESTER GANJIL").toUpperCase()} TA ${cfg.academicYear || "2026/2027"}
                    </td>
                </tr>
                <tr>
                    <td colspan="3" style="padding:6px;border:1px solid #111;font-weight:bold;background-color:#F4EFE6;">Wali Kelas & Pembina</td>
                    <td colspan="${Math.max(2, totalColumns - 3)}" style="padding:6px;border:1px solid #111;">${cfg.waliKelas || "-"} (${cfg.waliTitle || "Wali Kelas"})</td>
                </tr>
                <tr>
                    <td colspan="3" style="padding:6px;border:1px solid #111;font-weight:bold;background-color:#F4EFE6;">Rentang Periode Kas Senin</td>
                    <td colspan="${Math.max(2, totalColumns - 3)}" style="padding:6px;border:1px solid #111;">${mondays[0]} s/d ${mondays[mondays.length - 1]} (${mondays.length} Pekan Hari Senin @ ${formatRupiah(stats.fee)})</td>
                </tr>
                <tr>
                    <td colspan="3" style="padding:6px;border:1px solid #111;font-weight:bold;background-color:#F4EFE6;">Ringkasan Saldo Kas Aktif</td>
                    <td colspan="${Math.max(2, totalColumns - 3)}" style="padding:6px;border:1px solid #111;font-weight:bold;background-color:#CCFBF1;">
                        SALDO AKTIF: ${formatRupiah(stats.currentBalance)} &nbsp;|&nbsp; TOTAL MASUK: ${formatRupiah(stats.totalIncome)} &nbsp;|&nbsp; TOTAL KELUAR: ${formatRupiah(stats.totalExpense)} &nbsp;|&nbsp; KEPATUHAN: ${stats.complianceRatio}%
                    </td>
                </tr>
                <tr>
                    <td colspan="3" style="padding:6px;border:1px solid #111;font-weight:bold;background-color:#F4EFE6;">Waktu Cetak / Unduh</td>
                    <td colspan="${Math.max(2, totalColumns - 3)}" style="padding:6px;border:1px solid #111;">${nowStr}</td>
                </tr>
            </table>

            <h3 style="margin-bottom:6px;font-size:13pt;">I. TABEL PELUNASAN IURAN WAJIB HARI SENIN</h3>
            <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
                <thead>
                    <tr style="background-color:#111111;color:#FFFFFF;font-weight:bold;">
                        <th style="border:1px solid #111;padding:8px;">No. Absen</th>
                        <th style="border:1px solid #111;padding:8px;">Nama Lengkap Anggota</th>
                        <th style="border:1px solid #111;padding:8px;">L/P</th>
                        <th style="border:1px solid #111;padding:8px;">Jabatan</th>
                        <th style="border:1px solid #111;padding:8px;">Piket</th>
                        ${mondays.map((d) => `<th style="border:1px solid #111;padding:8px;text-align:center;">Senin<br>${formatShortMondayLabel(d)}</th>`).join("")}
                        <th style="border:1px solid #111;padding:8px;text-align:right;">Total Terbayar</th>
                        <th style="border:1px solid #111;padding:8px;text-align:right;">Tunggakan</th>
                    </tr>
                </thead>
                <tbody>
                    ${studentRowsHtml || `<tr><td colspan="${totalColumns}" style="padding:10px;text-align:center;border:1px solid #111;">Belum ada data anggota.</td></tr>`}
                </tbody>
            </table>

            <h3 style="margin-bottom:6px;font-size:13pt;">II. BUKU MUTASI KAS UMUM (PEMASUKAN & PENGELUARAN)</h3>
            <table style="border-collapse:collapse;width:100%;">
                <thead>
                    <tr style="background-color:#111111;color:#FFFFFF;font-weight:bold;">
                        <th style="border:1px solid #111;padding:8px;">No</th>
                        <th style="border:1px solid #111;padding:8px;">Tanggal</th>
                        <th style="border:1px solid #111;padding:8px;">Jenis</th>
                        <th style="border:1px solid #111;padding:8px;">Kategori</th>
                        <th style="border:1px solid #111;padding:8px;">Rincian Keperluan</th>
                        <th style="border:1px solid #111;padding:8px;">Penanggung Jawab</th>
                        <th style="border:1px solid #111;padding:8px;text-align:right;">Nominal</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border:1px solid #111;padding:6px;text-align:center;font-weight:bold;">-</td>
                        <td style="border:1px solid #111;padding:6px;text-align:center;">AKUMULASI</td>
                        <td style="border:1px solid #111;padding:6px;text-align:center;font-weight:bold;background-color:#D9F99D;">MASUK</td>
                        <td style="border:1px solid #111;padding:6px;">Iuran Hari Senin</td>
                        <td style="border:1px solid #111;padding:6px;font-weight:bold;">Total Akumulasi Iuran Kas Mingguan Anggota (${stats.totalPaidWeeks} Senin Lunas)</td>
                        <td style="border:1px solid #111;padding:6px;">Bendahara Kelas</td>
                        <td style="border:1px solid #111;padding:6px;text-align:right;font-weight:bold;color:#047857;">+${formatRupiah(stats.totalIuranPaid)}</td>
                    </tr>
                    ${txRowsHtml}
                </tbody>
            </table>
        </body>
        </html>
    `;

    const blob = new Blob(["\ufeff", excelHtml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Laporan_Resmi_Kas_${(cfg.className || "MEDIVANCE").replace(/\s+/g, "_")}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("File Sheet Resmi (.xls) dengan Kop 2 Logo berhasil diunduh!", "bg-neo-yellow");
};

window.exportIuranCSV = function () {
    const cfg = appData.config;
    const stats = calculateFinancialSummary();
    const mondays = stats.mondayDates;
    const nowStr = new Date().toLocaleDateString("id-ID");

    const topHeaderRows = [
        `"${(cfg.schoolName || "SMA NEGERI 5 AMBON").toUpperCase()} - LAPORAN IURAN KAS KELAS ${(cfg.className || "MEDIVANCE").toUpperCase()}"`,
        `"Motto Kelas:","${cfg.classMotto || "Together We Grow, Together We Heal"}"`,
        `"Wali Kelas:","${cfg.waliKelas || "-"}","Periode:","${cfg.semesterName || "Semester Ganjil"} TA ${cfg.academicYear || "-"}"`,
        `"Saldo Kas Aktif:","${formatRupiah(stats.currentBalance)}","Total Iuran Masuk:","${formatRupiah(stats.totalIuranPaid)}","Tanggal Unduh:","${nowStr}"`,
        `""`
    ];

    const headers = ["No_Absen", "Nama_Anggota", "L/P", "Jabatan", "Piket", ...mondays.map((d) => `Senin_${d}`), "Total_Bayar", "Tunggakan"];
    const rows = appData.students.map((s) => {
        ensureStudentPaidDatesMigrated(s, mondays);
        const statuses = mondays.map((d) => (s.paidDates[d] ? "LUNAS" : "BELUM"));
        const paidCount = statuses.filter((st) => st === "LUNAS").length;
        return [
            s.absen,
            `"${s.name}"`,
            `"${s.gender || "L"}"`,
            `"${s.role}"`,
            `"${s.piket}"`,
            ...statuses,
            paidCount * stats.fee,
            (mondays.length - paidCount) * stats.fee
        ].join(",");
    });

    const csvBody = [...topHeaderRows, headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\ufeff", csvBody], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Sheet_Iuran_${(cfg.className || "MEDIVANCE").replace(/\s+/g, "_")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("File CSV Rekap Iuran berhasil diunduh!", "bg-neo-mint");
};

window.exportMutasiCSV = function () {
    const cfg = appData.config;
    const stats = calculateFinancialSummary();
    const nowStr = new Date().toLocaleDateString("id-ID");

    const topHeaderRows = [
        `"${(cfg.schoolName || "SMA NEGERI 5 AMBON").toUpperCase()} - BUKU MUTASI KAS KELAS ${(cfg.className || "MEDIVANCE").toUpperCase()}"`,
        `"Wali Kelas:","${cfg.waliKelas || "-"}","Periode:","${cfg.semesterName || "Semester Ganjil"} TA ${cfg.academicYear || "-"}"`,
        `"Saldo Aktif:","${formatRupiah(stats.currentBalance)}","Total Pemasukan:","${formatRupiah(stats.totalIncome)}","Total Pengeluaran:","${formatRupiah(stats.totalExpense)}","Tanggal Unduh:","${nowStr}"`,
        `""`
    ];

    const headers = ["Tanggal", "Jenis", "Kategori", "Keterangan", "Penanggung_Jawab", "Nominal"];
    const rows = [
        `"AKUMULASI","MASUK","Iuran Hari Senin","Akumulasi Iuran Mingguan Anggota (${stats.totalPaidWeeks} Senin Lunas)","Bendahara Kelas",${stats.totalIuranPaid}`,
        ...appData.transactions.map((t) => [t.date, t.type, `"${t.category}"`, `"${t.desc}"`, `"${t.pic}"`, t.amount].join(","))
    ];

    const csvBody = [...topHeaderRows, headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\ufeff", csvBody], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Buku_Kas_${(cfg.className || "MEDIVANCE").replace(/\s+/g, "_")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("File CSV Buku Kas berhasil diunduh!", "bg-neo-mint");
};

// ============================================================================
// RENDER KESELURUHAN & INISIALISASI APLIKASI
// ============================================================================

function renderAllViews() {
    try { renderHeaderAndHeroIdentity(); } catch (e) { console.error(e); }
    try { renderDashboard(); } catch (e) { console.error(e); }
    try { renderIuranMatrix(); } catch (e) { console.error(e); }
    try { renderLedgerTable(); } catch (e) { console.error(e); }
    try { renderPublicAttendanceView(); } catch (e) { console.error(e); }
    try { renderStickyNotesWall(); } catch (e) { console.error(e); }
    try { renderInfoBoard(); } catch (e) { console.error(e); }
    try { renderScheduleAndPiket(); } catch (e) { console.error(e); }
    try { renderAlbumGallery(); } catch (e) { console.error(e); }
    try { renderStudentDirectory(); } catch (e) { console.error(e); }

    if (activeWorkspace === "admin" && currentAdmin) {
        try { renderAdminWorkspace(); } catch (e) { console.error(e); }
    }
}

function updateClock() {
    const el = document.getElementById("liveClockDisplay");
    if (!el) return;
    const now = new Date();
    el.textContent =
        now.toLocaleDateString("id-ID", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric"
        }) +
        " • " +
        now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

window.addEventListener("DOMContentLoaded", () => {
    // 1. Terapkan preferensi tema Gelap/Terang
    try {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === "1") applyThemeState(true);
    } catch (e) {}

    // 2. Set tanggal & bulan lokal hari ini pada seluruh input tanggal
    const todayIso = toLocalISODate(new Date());
    const monthIso = toLocalISOMonth(new Date());
    ["admTxDate", "admAlbumDate", "admAttendanceDateInput", "admAttendanceWeekInput", "publicAttendanceDateInput", "publicAttendanceWeekInput"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = todayIso;
    });
    ["admAttendanceMonthInput", "publicAttendanceMonthInput"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = monthIso;
    });

    // 3. Jalankan Jam, Kalender Mini & Pulihkan Sesi Pengurus jika sebelumnya sudah login
    syncScheduleTimeRange();
    updateClock();
    setInterval(updateClock, 30000);
    setInterval(() => { cleanExpiredTaskPhotos(false); }, 60000);

    const restored = restoreAdminSessionFromStorage();
    if (!restored) {
        activeWorkspace = "user";
        activeTabId = "dashboard";
        updateWorkspaceVisibility();
    }

    // 4. Hubungkan secara real-time ke Cloud Firebase Lintas Perangkat
    initCloudSynchronization({
        onStateReceived: (incomingState) => {
            isApplyingRemoteUpdate = true;
            appData = mergeWithDefaults(incomingState);
            cleanExpiredTaskPhotos(false);

            // Jika belum login saat baru muat halaman, coba pulihkan sesi menggunakan daftar akun terbaru dari Cloud
            if (!currentAdmin) {
                restoreAdminSessionFromStorage();
            } else {
                // Segarkan hak akses akun yang sedang aktif jika baru diperbarui
                const updatedMe = getAllCombinedAdmins().find(
                    (a) => String(a.username).toLowerCase() === String(currentAdmin.username).toLowerCase()
                );
                if (updatedMe) currentAdmin = updatedMe;
            }

            renderAllViews();
            isApplyingRemoteUpdate = false;
        },
        onAdminsReceived: (adminList) => {
            externalFirebaseAdmins = mergeAdminArrays(externalFirebaseAdmins, adminList);
            if (!currentAdmin) {
                restoreAdminSessionFromStorage();
            }
            if (activeWorkspace === "admin") renderAdminWorkspace();
        },
        onConnectionStatus: (isOnline) => {
            const dot = document.getElementById("publicCloudDot");
            const txt = document.getElementById("publicCloudText");
            if (dot && txt && isOnline) {
                dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
                txt.textContent = "LIVE CLOUD";
            }
        }
    });
});