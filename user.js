// ============================================================================
// USER.JS — MESIN UTAMA PORTAL PUBLIK, NGL 24 JAM, SLIDESHOW & KALENDER MINI
// ============================================================================

import {
    initCloudSynchronization,
    savePortalStateToCloud
} from "./firebase.js";

export const THEME_STORAGE_KEY = "medivance_theme_mode";
export const ADMIN_SESSION_STORAGE_KEY = "medivance_admin_session_v4";
export const DEFAULT_HERO_BG = "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1400&q=80";

/**
 * Utilitas Format Tanggal Lokal (YYYY-MM-DD) & Bulan Lokal (YYYY-MM)
 */
export function toLocalISODate(dateObj = new Date()) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export function toLocalISOMonth(dateObj = new Date()) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
}

export function getDefaultMondayRange() {
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

export const defaultRange = getDefaultMondayRange();

// STATE DEFAULT AWAL DATABASE
export const DEFAULT_DATABASE_STATE = {
    config: {
        classCode: "MDV",
        className: "MEDIVANCE",
        schoolName: "SMA NEGERI 5 AMBON",
        classMotto: "Together We Grow, Together We Heal",
        websiteLogoUrl: "",
        classLogoUrl: "",
        schoolLogoUrl: "",
        heroBgUrl: DEFAULT_HERO_BG,
        heroBgUrl2: "",
        heroBgUrl3: "",
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
        waChannelUrl: "",
        holidays: []
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

// ============================================================================
// SHARED STATE OBJEK (DAPAT DIAKSES OLEH USER.JS & ADMIN.JS)
// ============================================================================

export const portalState = {
    appData: JSON.parse(JSON.stringify(DEFAULT_DATABASE_STATE)),
    externalFirebaseAdmins: [],
    currentAdmin: null,
    activeWorkspace: "user", // 'user' | 'login' | 'admin' | 'preview'
    activeTabId: "dashboard",
    activeAdminSectionId: "adm-beranda",
    activeInfoCategory: "ALL",
    activeAlbumCategory: "ALL",
    activeScheduleDay: "ALL",
    publicAttendanceMode: "DAILY",
    selectedPublicAttendanceDate: toLocalISODate(new Date()),
    selectedPublicAttendanceWeek: toLocalISODate(new Date()),
    selectedPublicAttendanceMonth: toLocalISOMonth(new Date()),
    adminAttendanceMode: "DAILY",
    selectedAttendanceDate: toLocalISODate(new Date()),
    selectedAttendanceWeek: toLocalISODate(new Date()),
    selectedAttendanceMonth: toLocalISOMonth(new Date()),
    selectedStudentIdForCard: null,
    lastAddedStickyId: null,
    isDarkMode: false,
    isApplyingRemoteUpdate: false
};

window.portalState = portalState;

// State Internal Slideshow Hero, Typewriter & Kalender Mini
let heroSlideIndex = 0;
let heroSlideInterval = null;
let typewriterTimer = null;
let twPhraseIndex = 0;
let twCharIndex = 0;
let twIsDeleting = false;
let lastTypewriterKey = "";

let miniCalYear = new Date().getFullYear();
let miniCalMonth = new Date().getMonth();
let secretTapCount = 0;
let secretTapTimer = null;

// ============================================================================
// SINKRONISASI DATA FIREBASE & PEMBERSIH OTOMATIS (FOTO TUGAS & NGL 24 JAM)
// ============================================================================

export function mergeWithDefaults(incoming) {
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

export function mergeAdminArrays(arr1, arr2) {
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

export function getAllCombinedAdmins() {
    return mergeAdminArrays(portalState.externalFirebaseAdmins, portalState.appData.admins);
}

export function hasAdminPermission(permKey) {
    const adm = portalState.currentAdmin;
    if (!adm) return false;
    if (permKey === "beranda") return true;
    if (adm.isSuperAdmin) return true;
    const perms = Array.isArray(adm.permissions) ? adm.permissions : [];
    if (perms.includes("akun")) return true;
    return perms.includes(permKey);
}

export function canEditInCurrentView(permKey) {
    if (!portalState.currentAdmin) return false;
    if (portalState.activeWorkspace !== "admin") return false;
    return hasAdminPermission(permKey);
}

/**
 * Menyimpan seluruh perubahan langsung ke Cloud Firebase secara Real-Time
 */
export async function saveToCloudDatabase(successMessage = "") {
    renderAllViews();
    if (portalState.isApplyingRemoteUpdate) return true;

    const statusBadge = document.getElementById("adminCloudLiveBadge");
    if (statusBadge) {
        statusBadge.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-neo-yellow"></i> Menyimpan...`;
    }

    const actor = portalState.currentAdmin ? portalState.currentAdmin.username : "visitor";
    const res = await savePortalStateToCloud(portalState.appData, actor);

    if (statusBadge) {
        if (res && res.ok) {
            statusBadge.innerHTML = `<i class="fa-solid fa-cloud-check text-neo-mint"></i> Real-Time Aktif`;
        } else {
            statusBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-neo-coral"></i> Cek Koneksi`;
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

window.saveToCloudDatabase = saveToCloudDatabase;

/**
 * Pembersih Otomatis:
 * 1. Menghapus lampiran foto tugas yang sudah lewat waktu deadline (teks tugas tetap ada).
 * 2. Menghapus pesan anonim NGL yang sudah melewati batas 24 jam.
 */
export async function cleanExpiredTaskPhotos(manualNotify = false) {
    const nowMs = Date.now();
    let cleanedPhotos = 0;
    let cleanedNgl = 0;

    if (Array.isArray(portalState.appData.announcements)) {
        portalState.appData.announcements.forEach((item) => {
            if (item.expireAt && item.photoUrl && String(item.photoUrl).trim().length > 0) {
                const expMs = new Date(item.expireAt).getTime();
                if (!isNaN(expMs) && nowMs >= expMs) {
                    item.photoUrl = "";
                    item.photoExpired = true;
                    cleanedPhotos++;
                }
            }
        });
    }

    if (Array.isArray(portalState.appData.stickyNotes)) {
        const beforeCount = portalState.appData.stickyNotes.length;
        portalState.appData.stickyNotes = portalState.appData.stickyNotes.filter((note) => {
            if (note.isNgl && note.expiresAt) {
                return nowMs < Number(note.expiresAt);
            }
            return true;
        });
        cleanedNgl = beforeCount - portalState.appData.stickyNotes.length;
    }

    if (cleanedPhotos > 0 || cleanedNgl > 0) {
        await saveToCloudDatabase(
            `Pembersihan otomatis: ${cleanedPhotos} foto tugas lewat deadline & ${cleanedNgl} NGL >24 jam dibersihkan!`
        );
    } else if (manualNotify) {
        showToast("Penyimpanan bersih! Tidak ada foto lewat deadline atau NGL kadaluarsa.", "bg-neo-yellow");
    }
    return cleanedPhotos + cleanedNgl;
}

window.cleanExpiredTaskPhotos = cleanExpiredTaskPhotos;

// ============================================================================
// MODE GELAP (DARK MODE) & NAVIGASI UMUM
// ============================================================================

export function applyThemeState(dark) {
    portalState.isDarkMode = Boolean(dark);
    const htmlEl = document.documentElement;
    const iconEl = document.getElementById("themeToggleIcon");
    if (portalState.isDarkMode) {
        htmlEl.classList.add("dark");
        if (iconEl) iconEl.className = "fa-solid fa-sun text-neo-yellow";
    } else {
        htmlEl.classList.remove("dark");
        if (iconEl) iconEl.className = "fa-solid fa-moon";
    }
    try {
        localStorage.setItem(THEME_STORAGE_KEY, portalState.isDarkMode ? "1" : "0");
    } catch (e) {}
}

window.toggleDarkMode = function () {
    applyThemeState(!portalState.isDarkMode);
};

export function updateWorkspaceVisibility() {
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

    if (portalState.activeWorkspace === "login") {
        loginSection?.classList.remove("hidden");
        renderHeaderAndHeroIdentity();
    } else if (portalState.activeWorkspace === "admin" && portalState.currentAdmin) {
        adminMain?.classList.remove("hidden");
        if (typeof window.saveAdminSessionToStorage === "function") window.saveAdminSessionToStorage();
        if (typeof window.renderAdminWorkspace === "function") window.renderAdminWorkspace();
    } else if (portalState.activeWorkspace === "preview" && portalState.currentAdmin) {
        publicChrome?.classList.remove("hidden");
        userMain?.classList.remove("hidden");
        publicFooter?.classList.remove("hidden");
        previewBanner?.classList.remove("hidden");
        btnReturnTop?.classList.remove("hidden");
        if (typeof window.saveAdminSessionToStorage === "function") window.saveAdminSessionToStorage();
        switchTab(portalState.activeTabId || "dashboard");
        renderAllViews();
    } else {
        portalState.activeWorkspace = "user";
        publicChrome?.classList.remove("hidden");
        userMain?.classList.remove("hidden");
        publicFooter?.classList.remove("hidden");
        switchTab(portalState.activeTabId || "dashboard");
        renderAllViews();
    }
}

window.updateWorkspaceVisibility = updateWorkspaceVisibility;

window.openFullLoginScreen = function () {
    if (portalState.currentAdmin) {
        portalState.activeWorkspace = "admin";
        updateWorkspaceVisibility();
        return;
    }
    portalState.activeWorkspace = "login";
    updateWorkspaceVisibility();
    setTimeout(() => {
        document.getElementById("loginUsername")?.focus();
    }, 100);
};

window.closeFullLoginScreen = function () {
    portalState.activeWorkspace = portalState.currentAdmin ? "admin" : "user";
    updateWorkspaceVisibility();
};

window.enterAdminPreviewMode = function () {
    if (!portalState.currentAdmin) return;
    portalState.activeWorkspace = "preview";
    updateWorkspaceVisibility();
    showToast("Mode Pratinjau Web Publik aktif (Read-Only).", "bg-neo-sky");
};

window.exitAdminPreviewMode = function () {
    if (!portalState.currentAdmin) return;
    portalState.activeWorkspace = "admin";
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
    window.toggleDrawerMenu(false);
    switchTab(tabId);
};

window.handleSecretClassNameTap = function () {
    secretTapCount++;
    if (secretTapTimer) clearTimeout(secretTapTimer);
    if (secretTapCount >= 3) {
        secretTapCount = 0;
        window.openFullLoginScreen();
        return;
    }
    secretTapTimer = setTimeout(() => {
        secretTapCount = 0;
    }, 900);
};

window.switchTab = function (tabId) {
    portalState.activeTabId = tabId || "dashboard";
    const tabs = ["dashboard", "keuangan", "absensi", "mading", "info", "jadwal", "album", "siswa"];
    tabs.forEach((t) => {
        const viewEl = document.getElementById(`view-${t}`);
        const btnDrawer = document.getElementById(`drawertab-${t}`);
        if (t === portalState.activeTabId) {
            viewEl?.classList.remove("hidden");
            btnDrawer?.classList.add("active");
        } else {
            viewEl?.classList.add("hidden");
            btnDrawer?.classList.remove("active");
        }
    });
    if (portalState.activeTabId === "absensi") renderPublicAttendanceView();
    window.scrollTo({ top: 0, behavior: "smooth" });
};

// ============================================================================
// SLIDESHOW FOTO LATAR BELAKANG OTOMATIS (TIAP 1 MENIT) & LOOPING TYPEWRITER
// ============================================================================

export function getHeroSlideUrls() {
    const cfg = portalState.appData.config || {};
    const list = [cfg.heroBgUrl, cfg.heroBgUrl2, cfg.heroBgUrl3]
        .map((u) => String(u || "").trim())
        .filter((u) => u.length > 4);
    if (list.length === 0) list.push(DEFAULT_HERO_BG);
    return list;
}

export function renderHeroSlideshowUI() {
    const slides = getHeroSlideUrls();
    if (heroSlideIndex >= slides.length) heroSlideIndex = 0;
    if (heroSlideIndex < 0) heroSlideIndex = slides.length - 1;

    const currentUrl = slides[heroSlideIndex] || DEFAULT_HERO_BG;
    const heroImg = document.getElementById("heroBackgroundImg");
    if (heroImg) {
        heroImg.onerror = () => {
            if (heroImg.src !== DEFAULT_HERO_BG) heroImg.src = DEFAULT_HERO_BG;
        };
        if (heroImg.getAttribute("src") !== currentUrl) {
            heroImg.classList.remove("hero-slide-fade");
            void heroImg.offsetWidth; // Reflow trigger
            heroImg.src = currentUrl;
            heroImg.classList.add("hero-slide-fade");
        }
    }

    const loginImg = document.getElementById("loginFullBgImg");
    if (loginImg && loginImg.getAttribute("src") !== slides[0]) {
        loginImg.src = slides[0];
    }

    const counterEl = document.getElementById("heroSlideCounterText");
    if (counterEl) {
        counterEl.textContent = `SLIDE ${heroSlideIndex + 1}/${slides.length}`;
    }

    const dotsEl = document.getElementById("heroSlideDots");
    if (dotsEl) {
        dotsEl.innerHTML = slides
            .map(
                (_, idx) => `
                <button
                    type="button"
                    onclick="goToHeroSlide(${idx})"
                    class="w-2.5 h-2.5 rounded-full border border-neo-ink transition-all ${
                        idx === heroSlideIndex ? "bg-neo-yellow w-5" : "bg-white/70"
                    }"
                ></button>
            `
            )
            .join("");
    }

    const ctrlWrap = document.getElementById("heroSlideshowControls");
    if (ctrlWrap) {
        ctrlWrap.classList.toggle("hidden", slides.length <= 1);
    }
}

window.stepHeroSlide = function (delta) {
    const slides = getHeroSlideUrls();
    heroSlideIndex = (heroSlideIndex + delta + slides.length) % slides.length;
    renderHeroSlideshowUI();
    restartHeroSlideshowTimer();
};

window.goToHeroSlide = function (idx) {
    heroSlideIndex = Number(idx) || 0;
    renderHeroSlideshowUI();
    restartHeroSlideshowTimer();
};

function restartHeroSlideshowTimer() {
    if (heroSlideInterval) clearInterval(heroSlideInterval);
    heroSlideInterval = setInterval(() => {
        const slides = getHeroSlideUrls();
        if (slides.length > 1) {
            heroSlideIndex = (heroSlideIndex + 1) % slides.length;
            renderHeroSlideshowUI();
        }
    }, 60000); // Berganti otomatis setiap 1 menit (60.000 ms)
}

function startLoopingTypewriter() {
    const cfg = portalState.appData.config || {};
    const phrases = [
        (cfg.welcomeTypingText || `SELAMAT DATANG DI ${cfg.className || "MEDIVANCE"}`).trim(),
        `"${(cfg.classMotto || "TOGETHER WE GROW, TOGETHER WE HEAL").toUpperCase()}"`,
        `${(cfg.schoolName || "SMA NEGERI 5 AMBON").toUpperCase()} • TA ${cfg.academicYear || "2026/2027"}`
    ].filter(Boolean);

    const keyCheck = phrases.join("|");
    if (keyCheck === lastTypewriterKey && typewriterTimer) return;
    lastTypewriterKey = keyCheck;

    if (typewriterTimer) clearTimeout(typewriterTimer);
    twPhraseIndex = 0;
    twCharIndex = 0;
    twIsDeleting = false;

    function tick() {
        const target = document.getElementById("typewriterTextTarget");
        if (!target) return;

        const currentPhrase = phrases[twPhraseIndex % phrases.length] || "MEDIVANCE";
        if (!twIsDeleting) {
            twCharIndex++;
            target.textContent = currentPhrase.slice(0, twCharIndex);
            if (twCharIndex >= currentPhrase.length) {
                twIsDeleting = true;
                typewriterTimer = setTimeout(tick, 2400);
                return;
            }
            typewriterTimer = setTimeout(tick, 55);
        } else {
            twCharIndex--;
            target.textContent = currentPhrase.slice(0, Math.max(0, twCharIndex));
            if (twCharIndex <= 0) {
                twIsDeleting = false;
                twPhraseIndex = (twPhraseIndex + 1) % phrases.length;
                typewriterTimer = setTimeout(tick, 350);
                return;
            }
            typewriterTimer = setTimeout(tick, 28);
        }
    }

    tick();
}

// ============================================================================
// UTILITAS GAMBAR, PERHITUNGAN TANGGAL SENIN, KEUANGAN & ABSENSI
// ============================================================================

export function readImageFileInstantly(file, callback) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
        if (ev.target?.result) callback(ev.target.result);
    };
    reader.readAsDataURL(file);
}

export function applyImageWithFallback(imgEl, fallbackEl, urlStr) {
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

export function getMondayDatesList() {
    const cfg = portalState.appData.config;
    const startStr = cfg.feeStartDate || defaultRange.start;
    const endStr = cfg.feeEndDate || defaultRange.end;

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

    if (mondays.length === 0) mondays.push(toLocalISODate(start));
    return mondays;
}

export function getSixSchoolDaysOfWeek(anyIsoDate) {
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

export function formatShortMondayLabel(isoDate) {
    const parts = String(isoDate || "").split("-");
    if (parts.length !== 3) return isoDate;
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${parts[2]} ${months[mIdx] || parts[1]}`;
}

export function formatMonthTitle(yyyyMm) {
    const parts = String(yyyyMm || "").split("-");
    if (parts.length !== 2) return yyyyMm;
    const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${months[mIdx] || parts[1]} ${parts[0]}`;
}

export function ensureStudentPaidDatesMigrated(student, mondayDates) {
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

export function formatRupiah(num) {
    return "Rp " + Number(num || 0).toLocaleString("id-ID");
}

export function calculateFinancialSummary() {
    const appData = portalState.appData;
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

export function calculateStudentAttendanceStats(studentId, dateKeysFilter = null) {
    const attMap = portalState.appData.attendance || {};
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

export function renderAvatarHtml(name, photoUrl, sizeClass = "w-11 h-11", textClass = "text-sm") {
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

export function showToast(message, bgColor = "bg-neo-yellow") {
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

window.showToast = showToast;
window.openModal = (id) => document.getElementById(id)?.classList.remove("hidden");
window.closeModal = (id) => document.getElementById(id)?.classList.add("hidden");

// ============================================================================
// MINIMALIST STUDENT ID CARD MODAL & KALENDER MINI FOOTER
// ============================================================================

window.openStudentIdCardModal = function (studentId) {
    const stu = portalState.appData.students.find((s) => s.id === studentId);
    if (!stu) return;

    const cfg = portalState.appData.config;
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
            window.closeModal("modalStudentIdCard");
            window.openStudentCardModal(stu.id);
        };
    }

    window.openModal("modalStudentIdCard");
};

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

export function renderMiniCalendar() {
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
    const startOffset = (firstDayObj.getDay() + 6) % 7; // Senin = 0 ... Sabtu = 5, Minggu = 6
    const todayIso = toLocalISODate(new Date());
    const holidaysList = Array.isArray(portalState.appData.config.holidays) ? portalState.appData.config.holidays : [];

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
        const dayOfWeek = (startOffset + dayNum - 1) % 7;
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

        cellsHtml += `<div title="${tooltip}" class="${classes.join(" ")} cursor-default">${dayNum}</div>`;
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

// ============================================================================
// RENDER HEADER, SALURAN WA MEDIVANCE INFO, HERO & DASHBOARD PUBLIK
// ============================================================================

export function renderHeaderAndHeroIdentity() {
    const appData = portalState.appData;
    const cfg = appData.config;
    const code = cfg.classCode || "MDV";
    const name = cfg.className || "MEDIVANCE";
    const school = cfg.schoolName || "SMA NEGERI 5 AMBON";
    const motto = cfg.classMotto || "Together We Grow, Together We Heal";
    const semLabel = cfg.semesterName || "Semester Ganjil";

    const webLogoUrl = (cfg.websiteLogoUrl || cfg.classLogoUrl || "").trim();
    const classLogoUrl = (cfg.classLogoUrl || cfg.websiteLogoUrl || "").trim();

    const favEl = document.getElementById("dynamicFavicon");
    if (favEl && webLogoUrl) favEl.href = webLogoUrl;

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

    applyImageWithFallback(document.getElementById("headerClassLogoImg"), document.getElementById("headerClassCode"), webLogoUrl);
    applyImageWithFallback(document.getElementById("drawerLogoImg"), document.getElementById("drawerLogoCode"), webLogoUrl);
    applyImageWithFallback(document.getElementById("heroSmallLogoImg"), document.getElementById("heroSmallLogoCode"), classLogoUrl);
    applyImageWithFallback(document.getElementById("loginFullLogoImg"), document.getElementById("loginFullLogoCode"), classLogoUrl);
    applyImageWithFallback(document.getElementById("footerSmallLogoImg"), document.getElementById("footerSmallLogoCode"), classLogoUrl);

    renderHeroSlideshowUI();
    startLoopingTypewriter();

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

    // Tautan Saluran WhatsApp Resmi (MEDIVANCE INFO)
    const waUrl = (cfg.waChannelUrl || "").trim();
    ["dashboardWaChannelBtn", "infoHeaderWaChannelBtn", "footerWaChannelBtn"].forEach((btnId) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            if (waUrl.length > 5) {
                btn.href = waUrl;
                btn.classList.remove("hidden");
            } else {
                btn.classList.add("hidden");
            }
        }
    });

    // Footer & Media Sosial
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

export function renderDashboard() {
    const appData = portalState.appData;
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
                    <button type="button" onclick="openStudentIdCardModal(${m.id})" class="surface-card border-2 border-neo-ink shadow-neo-sm px-2.5 py-1 rounded-md text-xs font-extrabold flex items-center gap-1.5 hover:bg-neo-yellow hover:text-neo-ink transition">
                        <span class="font-mono bg-neo-ink text-white px-1.5 py-0.5 rounded text-[10px]">#${m.absen}</span>
                        <span>${m.name}</span>
                    </button>
                `
                )
                .join("");
        }
    }

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

    window.handleQuickCheck(document.getElementById("quickCheckInput")?.value || "");
    window.renderStickyNotesWall();
}

// ============================================================================
// PAPAN TEMPEL KERTAS & FITUR PESAN ANONIM NGL 24 JAM + SHARE IG STORY
// ============================================================================

function getRemainingNglHours(expiresAt) {
    if (!expiresAt) return "24j";
    const diffMs = Number(expiresAt) - Date.now();
    if (diffMs <= 0) return "Habis";
    const hrs = Math.ceil(diffMs / (1000 * 60 * 60));
    return `${hrs} jam lagi`;
}

window.renderStickyNotesWall = function () {
    const dashGrid = document.getElementById("dashboardStickyWallGrid");
    const fullGrid = document.getElementById("fullStickyWallGrid");
    const nowMs = Date.now();

    const notes = (portalState.appData.stickyNotes || []).filter((n) => {
        if (n.isNgl && n.expiresAt) return nowMs < Number(n.expiresAt);
        return true;
    });

    const emptyHtml = `
        <div class="col-span-full surface-card border-2.5 border-dashed border-neo-ink rounded-xl p-8 text-center space-y-2">
            <div class="w-12 h-12 mx-auto bg-neo-yellow text-neo-ink border-2 border-neo-ink rounded-full flex items-center justify-center text-lg">
                <i class="fa-solid fa-note-sticky"></i>
            </div>
            <h4 class="font-display font-extrabold text-sm uppercase">Belum Ada Kertas Tempel atau Pesan NGL</h4>
            <p class="text-xs font-semibold text-muted-adaptive max-w-md mx-auto">
                Jadilah yang pertama menempelkan pesan semangat atau mengirim pesan rahasia NGL untuk kelas!
            </p>
        </div>
    `;

    const buildNoteHtml = (note) => {
        const isJustAdded = note.id === portalState.lastAddedStickyId;
        if (note.isNgl) {
            const remLabel = getRemainingNglHours(note.expiresAt);
            return `
                <div class="sticky-note-card ngl-note-card ${isJustAdded ? "sticky-just-added" : ""} rounded-xl p-4 flex flex-col justify-between min-h-[165px] relative">
                    <div class="w-4 h-4 rounded-full bg-neo-yellow border-2 border-neo-ink shadow-neo-sm mx-auto -mt-6 mb-2 flex items-center justify-center">
                        <span class="w-1.5 h-1.5 rounded-full bg-neo-ink"></span>
                    </div>

                    <div class="space-y-2">
                        <div class="flex items-center justify-between gap-1">
                            <span class="font-mono text-[10px] font-extrabold bg-neo-yellow text-neo-ink border border-neo-ink px-2 py-0.5 rounded">
                                <i class="fa-solid fa-user-secret"></i> NGL ANONIM
                            </span>
                            <span class="font-mono text-[10px] font-bold bg-black/35 text-white px-1.5 py-0.5 rounded">
                                ⏳ ${remLabel}
                            </span>
                        </div>
                        <div class="text-[10px] font-mono font-bold text-white/90 uppercase tracking-wide">${note.tag || "Pesan Rahasia"}</div>
                        <p class="font-sans font-extrabold text-xs sm:text-sm text-white leading-relaxed break-words">
                            "${note.message}"
                        </p>
                    </div>

                    <div class="pt-2.5 mt-2 border-t border-white/30 flex items-center justify-between text-[11px] font-extrabold text-white">
                        <span><i class="fa-solid fa-mask mr-1"></i> Pengirim Rahasia</span>
                        <button type="button" onclick="downloadNglStoryImage(${note.id})" class="bg-white text-neo-ink border border-neo-ink px-2 py-0.5 rounded text-[10px] font-extrabold hover:bg-neo-yellow transition" title="Unduh Kartu Story IG">
                            <i class="fa-brands fa-instagram"></i> Story IG
                        </button>
                    </div>
                </div>
            `;
        }

        return `
            <div
                style="background-color: ${note.color || "#FFE600"}"
                class="sticky-note-card ${isJustAdded ? "sticky-just-added" : ""} rounded-lg p-4 flex flex-col justify-between min-h-[165px] relative"
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

    if (portalState.lastAddedStickyId) {
        setTimeout(() => { portalState.lastAddedStickyId = null; }, 600);
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
    portalState.lastAddedStickyId = newId;

    if (!Array.isArray(portalState.appData.stickyNotes)) portalState.appData.stickyNotes = [];
    portalState.appData.stickyNotes.unshift({
        id: newId,
        isNgl: false,
        author,
        tag,
        message,
        color,
        date: dateLabel
    });

    e.target.reset();
    window.closeModal("modalStickyNoteForm");
    await saveToCloudDatabase("Kertas pesan berhasil ditempelkan di Papan Kelas!");
};

window.handleVisitorSendNgl = async function (e) {
    e.preventDefault();
    const promptTopic = document.getElementById("nglPromptSelect")?.value || "Pesan Rahasia NGL";
    const message = (document.getElementById("nglMessageInput")?.value || "").trim();
    if (!message) return;

    const nowMs = Date.now();
    const expiresMs = nowMs + 24 * 60 * 60 * 1000; // Aktif tepat 24 Jam
    const dateLabel = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short" });

    portalState.lastAddedStickyId = nowMs;
    if (!Array.isArray(portalState.appData.stickyNotes)) portalState.appData.stickyNotes = [];
    portalState.appData.stickyNotes.unshift({
        id: nowMs,
        isNgl: true,
        author: "Anonim (NGL)",
        tag: promptTopic,
        message,
        color: "#9B5DE5",
        date: dateLabel,
        createdAt: nowMs,
        expiresAt: expiresMs
    });

    e.target.reset();
    window.closeModal("modalNglForm");
    await saveToCloudDatabase("Pesan rahasia NGL berhasil dikirim (aktif selama 24 jam)!");
};

/**
 * Generator Gambar Kartu Story Instagram (1080x1920) untuk Pesan NGL Anonim
 */
window.downloadNglStoryImage = function (noteId) {
    const note = (portalState.appData.stickyNotes || []).find((n) => n.id === noteId);
    if (!note) return;

    const cfg = portalState.appData.config;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d");

    // Background Gradient Neo-Brutalist
    const grad = ctx.createLinearGradient(0, 0, 1080, 1920);
    grad.addColorStop(0, "#111111");
    grad.addColorStop(0.5, "#2E1065");
    grad.addColorStop(1, "#111111");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1920);

    // Card Shadow
    ctx.fillStyle = "#FFE600";
    ctx.fillRect(115, 515, 870, 890);

    // Main Card Container
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 12;
    ctx.fillRect(95, 495, 870, 890);
    ctx.strokeRect(95, 495, 870, 890);

    // Top Header Banner inside Card
    const topGrad = ctx.createLinearGradient(95, 495, 965, 680);
    topGrad.addColorStop(0, "#9B5DE5");
    topGrad.addColorStop(0.5, "#EC4899");
    topGrad.addColorStop(1, "#FF9F1C");
    ctx.fillStyle = topGrad;
    ctx.fillRect(101, 501, 858, 190);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 34px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`NGL ANONIM • ${cfg.className || "MEDIVANCE"}`, 530, 575);

    ctx.font = "700 28px monospace";
    ctx.fillStyle = "#FFE600";
    ctx.fillText(note.tag || "Kirim pesan anonim untuk kelas kita!", 530, 635);

    // Message Body Wrapping
    ctx.fillStyle = "#111111";
    ctx.font = "800 44px sans-serif";
    const words = `"${note.message}"`.split(" ");
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const testLine = currentLine + " " + words[i];
        if (ctx.measureText(testLine).width < 740) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = words[i];
        }
    }
    lines.push(currentLine);

    let startY = 880 - ((lines.length - 1) * 32);
    lines.forEach((line) => {
        ctx.fillText(line, 530, startY);
        startY += 66;
    });

    // Footer inside Card
    ctx.fillStyle = "#525252";
    ctx.font = "700 26px monospace";
    ctx.fillText(`${cfg.schoolName || "SMA NEGERI 5 AMBON"} • "${cfg.classMotto || "Together We Grow"}"`, 530, 1320);

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `NGL_Story_${cfg.className || "MEDIVANCE"}_${note.id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Kartu Story IG untuk pesan NGL berhasil diunduh!", "bg-neo-pink");
};

// ============================================================================
// TABEL IURAN KAS, PASSBOOK MODAL, ABSENSI PUBLIK, INFO, JADWAL, ALBUM & SISWA
// ============================================================================

window.handleQuickCheck = function (query) {
    const box = document.getElementById("quickCheckResult");
    if (!box) return;
    const students = portalState.appData.students;

    if (students.length === 0) {
        box.innerHTML = `<div class="text-center py-2 text-xs font-bold text-muted-adaptive">Belum ada data anggota kelas yang terdaftar.</div>`;
        return;
    }

    const stats = calculateFinancialSummary();
    const q = (query || "").trim().toLowerCase();
    let target = students[0];

    if (q) {
        const found = students.find((s) => s.name.toLowerCase().includes(q) || String(s.absen) === q);
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
                Buka Passbook Kas →
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
    document.getElementById("keuanganPaymentInfo").textContent = portalState.appData.config.paymentInfo || "";

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

    const filtered = portalState.appData.students.filter((stu) => {
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

window.openStudentCardModal = function (studentId) {
    portalState.selectedStudentIdForCard = studentId;
    const student = portalState.appData.students.find((s) => s.id === studentId);
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

    window.openModal("modalStudentCard");
};

window.copyWhatsAppReminder = function () {
    const student = portalState.appData.students.find((s) => s.id === portalState.selectedStudentIdForCard);
    if (!student) return;
    const stats = calculateFinancialSummary();
    const unpaidDates = [];
    stats.mondayDates.forEach((d) => {
        if (!student.paidDates?.[d]) unpaidDates.push(`Senin ${formatShortMondayLabel(d)}`);
    });

    let text = "";
    if (unpaidDates.length === 0) {
        text = `Halo *${student.name}*, terima kasih! Iuran kas *${portalState.appData.config.className}* kamu sudah *LUNAS PENUH* untuk seluruh ${stats.totalMondays} hari Senin (${formatRupiah(stats.totalMondays * stats.fee)}).`;
    } else {
        const arrears = unpaidDates.length * stats.fee;
        text = `Halo *${student.name}* (Absen #${student.absen}) 👋\nMengingatkan info kas *${portalState.appData.config.className}*, tercatat iuran untuk tanggal: *${unpaidDates.join(", ")}* sejumlah *${formatRupiah(arrears)}* belum lunas.\n\n${portalState.appData.config.paymentInfo || "Pembayaran dapat dilakukan ke Bendahara Kelas."} Terima kasih! 🙏`;
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

    const filteredTx = [...portalState.appData.transactions].reverse().filter((tx) => filterType === "ALL" || tx.type === filterType);

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

// --- Absensi Publik (Harian, Mingguan, Bulanan) ---
const STATUS_BADGE_MAP = {
    H: `<span class="neo-badge bg-neo-lime text-neo-ink">✓ H</span>`,
    I: `<span class="neo-badge bg-neo-sky text-neo-ink">✉ I</span>`,
    S: `<span class="neo-badge bg-neo-yellow text-neo-ink">✚ S</span>`,
    A: `<span class="neo-badge bg-neo-coral text-white">✕ A</span>`
};

window.switchPublicAttendanceMode = function (mode) {
    portalState.publicAttendanceMode = mode;
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
    portalState.selectedPublicAttendanceDate = val;
    renderPublicAttendanceView();
};

window.handlePublicAttendanceWeekChange = function (val) {
    if (!val) return;
    portalState.selectedPublicAttendanceWeek = val;
    renderPublicAttendanceView();
};

window.handlePublicAttendanceMonthChange = function (val) {
    if (!val) return;
    portalState.selectedPublicAttendanceMonth = val;
    renderPublicAttendanceView();
};

export function renderPublicAttendanceView() {
    const thead = document.getElementById("pubAttTableHead");
    const tbody = document.getElementById("pubAttTableBody");
    if (!thead || !tbody) return;

    const appData = portalState.appData;
    const mode = portalState.publicAttendanceMode;
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

    if (mode === "DAILY") {
        const selDate = portalState.selectedPublicAttendanceDate;
        if (subEl) subEl.textContent = `Harian: ${selDate}`;
        const dayMap = appData.attendance?.[selDate] || {};

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
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 text-center">Status (${selDate})</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700">Catatan / Keterangan</th>
                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center">Total Semester (H/I/S/A)</th>
                <th class="py-2.5 px-3 text-right">% Kehadiran</th>
            </tr>
        `;

        tbody.innerHTML = filteredStudents.length === 0
            ? `<tr><td colspan="6" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada data anggota kelas.</td></tr>`
            : filteredStudents
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
                                <span class="text-emerald-600 font-extrabold">${cum.H}H</span>/${cum.I}I/${cum.S}S/<span class="text-rose-600 font-bold">${cum.A}A</span>
                            </td>
                            <td class="py-2 px-3 text-right font-mono font-extrabold ${cum.pct >= 80 ? "text-emerald-500" : "text-rose-500"}">${cum.pct}%</td>
                        </tr>
                    `;
                })
                .join("");
    } else if (mode === "WEEKLY") {
        const weekDays = getSixSchoolDaysOfWeek(portalState.selectedPublicAttendanceWeek);
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
        const monthPrefix = portalState.selectedPublicAttendanceMonth || toLocalISOMonth();
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
}

window.renderPublicAttendanceView = renderPublicAttendanceView;

// --- Papan Informasi, Jadwal, Album & Direktori Siswa ---
window.filterInfoCategory = function (cat) {
    portalState.activeInfoCategory = cat;
    ["ALL", "TUGAS", "PENTING", "EVENT", "KAS"].forEach((c) => {
        const btn = document.getElementById(`infoCat-${c}`);
        if (btn) btn.classList.toggle("active", c === cat);
    });
    renderInfoBoard();
};

export function renderInfoBoard() {
    const grid = document.getElementById("infoCardsGrid");
    const badge = document.getElementById("badgeInfoCount");
    const announcements = portalState.appData.announcements || [];
    if (badge) badge.textContent = announcements.length;
    if (!grid) return;

    const items = announcements.filter(
        (a) => portalState.activeInfoCategory === "ALL" || a.category === portalState.activeInfoCategory
    );
    if (items.length === 0) {
        grid.innerHTML = `<div class="col-span-full neo-card surface-card p-8 text-center text-xs font-bold text-muted-adaptive">Belum ada informasi atau tugas pada kategori ini.</div>`;
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
            <article class="neo-card surface-card p-5 flex flex-col justify-between space-y-3">
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
    const item = portalState.appData.announcements.find((a) => a.id === infoId);
    if (!item || !item.photoUrl) return;
    document.getElementById("lightboxCategory").textContent = item.category;
    document.getElementById("lightboxImage").src = item.photoUrl;
    document.getElementById("lightboxDate").textContent = `Tenggat: ${item.deadline}`;
    document.getElementById("lightboxAuthor").textContent = item.author || "Pengurus Kelas";
    document.getElementById("lightboxTitle").textContent = item.title;
    document.getElementById("lightboxCaption").textContent = item.body || "";
    window.openModal("modalAlbumLightbox");
};

window.selectScheduleDay = function (day) {
    portalState.activeScheduleDay = day;
    document.querySelectorAll(".day-filter-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.day === day);
    });
    renderScheduleAndPiket();
};

export function renderScheduleAndPiket() {
    const container = document.getElementById("scheduleContainer");
    if (!container) return;
    const daysOrder = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const daysToRender = portalState.activeScheduleDay === "ALL" ? daysOrder : [portalState.activeScheduleDay];

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
            const lessons = portalState.appData.schedule[day] || [];
            return `
                <div class="neo-card surface-card overflow-hidden flex flex-col">
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
                const members = portalState.appData.students.filter((s) => s.piket === day);
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
                                    <li onclick="openStudentIdCardModal(${m.id})" class="cursor-pointer surface-card border-2 border-neo-ink rounded px-2 py-1 flex items-center justify-between hover:bg-neo-yellow hover:text-neo-ink transition">
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
    portalState.activeAlbumCategory = cat;
    ["ALL", "Kegiatan Kelas", "Praktikum", "Classmeeting", "Acara Sekolah"].forEach((c) => {
        const btn = document.getElementById(`albumCat-${c}`);
        if (btn) btn.classList.toggle("active", c === cat);
    });
    window.renderAlbumGallery();
};

window.renderAlbumGallery = function () {
    const grid = document.getElementById("albumGalleryGrid");
    const badge = document.getElementById("badgeAlbumCount");
    const albums = portalState.appData.albums || [];
    if (badge) badge.textContent = albums.length;
    if (!grid) return;

    const q = (document.getElementById("albumSearchInput")?.value || "").toLowerCase();
    const filtered = albums.filter((item) => {
        const matchCat = portalState.activeAlbumCategory === "ALL" || item.category === portalState.activeAlbumCategory;
        const matchQ = item.title.toLowerCase().includes(q) || (item.caption || "").toLowerCase().includes(q);
        return matchCat && matchQ;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full neo-card surface-card p-8 text-center text-xs font-bold text-muted-adaptive">Belum ada foto dokumentasi pada album kelas.</div>`;
        return;
    }

    grid.innerHTML = filtered
        .map(
            (item) => `
            <div onclick="openAlbumLightbox(${item.id})" class="cursor-pointer neo-card neo-card-hover surface-card overflow-hidden flex flex-col">
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
    const item = portalState.appData.albums.find((a) => a.id === albumId);
    if (!item) return;
    document.getElementById("lightboxCategory").textContent = item.category;
    document.getElementById("lightboxImage").src = item.url;
    document.getElementById("lightboxDate").textContent = item.date;
    document.getElementById("lightboxAuthor").textContent = `Dokumentasi: ${item.author || "Kelas"}`;
    document.getElementById("lightboxTitle").textContent = item.title;
    document.getElementById("lightboxCaption").textContent = item.caption || "";
    window.openModal("modalAlbumLightbox");
};

window.renderStudentDirectory = function () {
    const appData = portalState.appData;
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
                    <div onclick="openStudentIdCardModal(${o.id})" class="cursor-pointer neo-card neo-card-hover surface-card p-4 flex items-center gap-3.5">
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
// EKSPOR LAPORAN SHEET RESMI (.XLS & .CSV) DENGAN KOP 2 LOGO (SEKOLAH & KELAS)
// ============================================================================

window.downloadOfficialExcelSheet = function () {
    const appData = portalState.appData;
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
    const appData = portalState.appData;
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
    const appData = portalState.appData;
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

window.downloadAttendanceExcelSheet = function () {
    const appData = portalState.appData;
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
// RENDER KESELURUHAN & INISIALISASI PORTAL PUBLIK
// ============================================================================

export function renderAllViews() {
    try { renderHeaderAndHeroIdentity(); } catch (e) { console.error(e); }
    try { renderDashboard(); } catch (e) { console.error(e); }
    try { window.renderIuranMatrix(); } catch (e) { console.error(e); }
    try { window.renderLedgerTable(); } catch (e) { console.error(e); }
    try { renderPublicAttendanceView(); } catch (e) { console.error(e); }
    try { window.renderStickyNotesWall(); } catch (e) { console.error(e); }
    try { renderInfoBoard(); } catch (e) { console.error(e); }
    try { renderScheduleAndPiket(); } catch (e) { console.error(e); }
    try { window.renderAlbumGallery(); } catch (e) { console.error(e); }
    try { window.renderStudentDirectory(); } catch (e) { console.error(e); }

    if (portalState.activeWorkspace === "admin" && portalState.currentAdmin && typeof window.renderAdminWorkspace === "function") {
        try { window.renderAdminWorkspace(); } catch (e) { console.error(e); }
    }
}

window.renderAllViews = renderAllViews;

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
    try {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === "1") applyThemeState(true);
    } catch (e) {}

    const todayIso = toLocalISODate(new Date());
    const monthIso = toLocalISOMonth(new Date());
    ["publicAttendanceDateInput", "publicAttendanceWeekInput"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = todayIso;
    });
    const pubMonthEl = document.getElementById("publicAttendanceMonthInput");
    if (pubMonthEl) pubMonthEl.value = monthIso;

    updateClock();
    setInterval(updateClock, 30000);
    setInterval(() => { cleanExpiredTaskPhotos(false); }, 60000);
    restartHeroSlideshowTimer();

    const restored = typeof window.restoreAdminSessionFromStorage === "function"
        ? window.restoreAdminSessionFromStorage()
        : false;

    if (!restored) {
        portalState.activeWorkspace = "user";
        portalState.activeTabId = "dashboard";
        updateWorkspaceVisibility();
    }

    initCloudSynchronization({
        onStateReceived: (incomingState) => {
            portalState.isApplyingRemoteUpdate = true;
            portalState.appData = mergeWithDefaults(incomingState);
            cleanExpiredTaskPhotos(false);

            if (!portalState.currentAdmin && typeof window.restoreAdminSessionFromStorage === "function") {
                window.restoreAdminSessionFromStorage();
            } else if (portalState.currentAdmin) {
                const updatedMe = getAllCombinedAdmins().find(
                    (a) => String(a.username).toLowerCase() === String(portalState.currentAdmin.username).toLowerCase()
                );
                if (updatedMe) portalState.currentAdmin = updatedMe;
            }

            renderAllViews();
            portalState.isApplyingRemoteUpdate = false;
        },
        onAdminsReceived: (adminList) => {
            portalState.externalFirebaseAdmins = mergeAdminArrays(portalState.externalFirebaseAdmins, adminList);
            if (!portalState.currentAdmin && typeof window.restoreAdminSessionFromStorage === "function") {
                window.restoreAdminSessionFromStorage();
            }
            if (portalState.activeWorkspace === "admin" && typeof window.renderAdminWorkspace === "function") {
                window.renderAdminWorkspace();
            }
        },
        onConnectionStatus: (isOnline) => {
            const dot = document.getElementById("publicCloudDot");
            const txt = document.getElementById("publicCloudText");
            if (dot && txt && isOnline) {
                dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
                txt.textContent = "FAST SYNC";
            }
        }
    });
});