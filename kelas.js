// ============================================================================
// KELAS.JS — LOGIKA UTAMA PORTAL KELAS, ABSENSI DIGITAL & ARSIP SEMESTER BARU
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
const DEFAULT_HERO_BG = "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1400&q=80";

/**
 * Format Tanggal Lokal (YYYY-MM-DD) bebas bug pergeseran zona waktu
 */
function toLocalISODate(dateObj = new Date()) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
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

// STATE AWAL DEFAULT (MURNI CLOUD — TIDAK DISIMPAN DI LOCALSTORAGE)
const DEFAULT_DATABASE_STATE = {
    config: {
        classCode: "MDV",
        className: "MEDIVANCE",
        classMotto: "Together We Grow, Together We Heal",
        classLogoUrl: "",
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
        marqueeText: "Selamat datang di Portal Resmi MEDIVANCE • Together We Grow, Together We Heal • Semangat belajar dan jaga kekompakan kelas!"
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
            permissions: ["keuangan", "absensi", "siswa", "info", "jadwal", "album", "akun", "pengaturan"]
        }
    ],
    students: [],
    transactions: [],
    announcements: [],
    albums: [],
    stickyNotes: [],
    attendance: {}, // { "YYYY-MM-DD": { [studentId]: { status: "H"|"I"|"S"|"A", note: "" } } }
    archives: [],   // Daftar arsip semester lalu
    schedule: {
        "Senin": [],
        "Selasa": [],
        "Rabu": [],
        "Kamis": [],
        "Jumat": [],
        "Sabtu": []
    }
};

// State Aktif di Memori (100% disinkronkan dari Firebase)
let appData = JSON.parse(JSON.stringify(DEFAULT_DATABASE_STATE));
let externalFirebaseAdmins = [];
let currentAdmin = null;

// Mode Tampilan: 'user' | 'login' | 'admin' | 'preview'
let activeWorkspace = "user";
let activeTabId = "dashboard";
let activeAdminSectionId = "adm-keuangan";
let activeInfoCategory = "ALL";
let activeAlbumCategory = "ALL";
let activeScheduleDay = "ALL";

let selectedAttendanceDate = toLocalISODate(new Date());
let selectedPublicAttendanceDate = toLocalISODate(new Date());

let selectedStudentIdForCard = null;
let lastAddedStickyId = null;
let isDarkMode = false;
let isApplyingRemoteUpdate = false;
let lastAppliedTimestamp = "";

let secretTapCount = 0;
let secretTapTimer = null;
let typewriterTimer = null;
let currentTypedGoal = "";
let scrollObserver = null;

// ============================================================================
// SINKRONISASI DATA LANGSUNG KE FIREBASE (TANPA LOCALSTORAGE DATA)
// ============================================================================

function mergeWithDefaults(incoming) {
    if (!incoming || typeof incoming !== "object") {
        return JSON.parse(JSON.stringify(DEFAULT_DATABASE_STATE));
    }
    const mergedCfg = { ...DEFAULT_DATABASE_STATE.config, ...(incoming.config || {}) };
    if (!mergedCfg.heroBgUrl || !mergedCfg.heroBgUrl.trim()) {
        mergedCfg.heroBgUrl = DEFAULT_HERO_BG;
    }
    return {
        config: mergedCfg,
        admins: Array.isArray(incoming.admins) && incoming.admins.length > 0
            ? incoming.admins
            : DEFAULT_DATABASE_STATE.admins,
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
            map.set(String(item.username).toLowerCase(), item);
        }
    });
    return Array.from(map.values());
}

function getAllCombinedAdmins() {
    return mergeAdminArrays(appData.admins, externalFirebaseAdmins);
}

/**
 * Fungsi Utama Simpan Otomatis ke Firebase setiap kali tombol Simpan ditekan
 */
async function saveToCloudDatabase(customSuccessMsg = "") {
    // Hapus sisa localStorage lama jika pernah ada agar murni 100% Cloud
    try {
        localStorage.removeItem("medivance_portal_state_v3");
    } catch (e) {}

    renderAllViews();
    if (isApplyingRemoteUpdate) return true;

    const statusBadge = document.getElementById("adminCloudLiveBadge");
    if (statusBadge) {
        statusBadge.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-neo-yellow"></i> Menyimpan ke Firebase...`;
    }

    const ok = await savePortalStateToCloud(appData, currentAdmin ? currentAdmin.username : "visitor");

    if (statusBadge) {
        if (ok) {
            statusBadge.innerHTML = `<i class="fa-solid fa-cloud-check text-neo-mint"></i> Tersimpan di Firebase`;
        } else {
            statusBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-neo-coral"></i> Gagal Simpan Cloud`;
        }
    }

    if (!ok) {
        showToast("Peringatan: Koneksi ke Firebase terganggu, periksa jaringan internet Anda.", "bg-neo-coral");
    } else if (customSuccessMsg) {
        showToast(customSuccessMsg, "bg-neo-mint");
    }
    return ok;
}

// ============================================================================
// PROTEKSI HAK AKSES: EDIT HANYA BISA DI DALAM WORKSPACE PANEL ADMIN
// ============================================================================

function canEditInCurrentView(permKey) {
    if (!currentAdmin) return false;
    if (activeWorkspace !== "admin") return false;
    if (currentAdmin.isSuperAdmin) return true;
    const perms = currentAdmin.permissions || [];
    if (permKey === "absensi" && (perms.includes("absensi") || perms.includes("siswa") || perms.includes("jadwal"))) {
        return true;
    }
    return perms.includes(permKey);
}

function hasAdminPermission(permKey) {
    if (!currentAdmin) return false;
    if (currentAdmin.isSuperAdmin) return true;
    const perms = currentAdmin.permissions || [];
    if (permKey === "absensi" && (perms.includes("absensi") || perms.includes("siswa") || perms.includes("jadwal"))) {
        return true;
    }
    return perms.includes(permKey);
}

// ============================================================================
// UPGRADE STRUKTUR DOM OTOMATIS (ABSENSI DIGITAL, DRAWER ADMIN & SEMESTER BARU)
// ============================================================================

function upgradeDOMStructure() {
    // 1. Tambahkan tombol "Absensi Digital" di Drawer Publik
    const publicNav = document.querySelector("#navDrawerPanel nav");
    if (publicNav && !document.getElementById("drawertab-absensi")) {
        const jadwalBtn = document.getElementById("drawertab-jadwal");
        const absenBtn = document.createElement("button");
        absenBtn.type = "button";
        absenBtn.id = "drawertab-absensi";
        absenBtn.className = "drawer-nav-item neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm";
        absenBtn.setAttribute("onclick", "navigateFromDrawer('absensi')");
        absenBtn.innerHTML = `
            <span class="w-6 text-center"><i class="fa-solid fa-user-check text-emerald-500"></i></span>
            <span class="flex-1 text-left">Absensi Digital</span>
            <span id="badgeAbsensiCount" class="bg-neo-lime text-neo-ink border border-neo-ink rounded px-1.5 text-[10px]">HARI INI</span>
        `;
        if (jadwalBtn) {
            publicNav.insertBefore(absenBtn, jadwalBtn);
        } else {
            publicNav.appendChild(absenBtn);
        }
    }

    // 2. Buat View Publik `#view-absensi` di `#workspace-user`
    const userWorkspace = document.getElementById("workspace-user");
    if (userWorkspace && !document.getElementById("view-absensi")) {
        const absensiSec = document.createElement("section");
        absensiSec.id = "view-absensi";
        absensiSec.className = "hidden space-y-6";
        absensiSec.innerHTML = `
            <div class="neo-card kpi-accent-card bg-neo-lime text-neo-ink p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 reveal-on-scroll">
                <div>
                    <div class="flex flex-wrap items-center gap-2 mb-1.5">
                        <span class="neo-badge bg-white text-neo-ink"><i class="fa-solid fa-clipboard-user"></i> KEHADIRAN HARIAN SISWA</span>
                        <span id="publicAbsensiSemesterBadge" class="neo-badge bg-neo-ink text-white font-mono">SEMESTER AKTIF</span>
                    </div>
                    <h2 class="font-display font-extrabold text-xl sm:text-2xl uppercase">Absensi Digital & Rekap Kehadiran Kelas</h2>
                    <p class="text-xs sm:text-sm font-semibold opacity-90 mt-0.5">
                        Pantau kehadiran harian anggota kelas beserta persentase kumulatif kehadiran semester berjalan.
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        id="publicAttendanceDateInput"
                        onchange="handlePublicAttendanceDateChange(this.value)"
                        class="neo-input px-3 py-2 text-xs font-mono bg-white text-neo-ink"
                    >
                    <button onclick="downloadAttendanceExcelSheet()" class="neo-btn bg-neo-yellow text-neo-ink px-3.5 py-2 text-xs">
                        <i class="fa-solid fa-file-excel"></i> Unduh Rekap Absen (.xls)
                    </button>
                </div>
            </div>

            <!-- 4 KPI Kehadiran Hari Terpilih -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                <div class="neo-card bg-neo-lime p-4 text-neo-ink">
                    <span class="font-mono text-[10px] font-extrabold uppercase bg-white px-2 py-0.5 rounded border border-neo-ink">HADIR (H)</span>
                    <div id="pubAttCountH" class="font-mono font-extrabold text-2xl sm:text-3xl mt-1">0</div>
                    <p class="text-[11px] font-bold opacity-80">Anggota hadir</p>
                </div>
                <div class="neo-card bg-neo-sky p-4 text-neo-ink">
                    <span class="font-mono text-[10px] font-extrabold uppercase bg-white px-2 py-0.5 rounded border border-neo-ink">IZIN (I)</span>
                    <div id="pubAttCountI" class="font-mono font-extrabold text-2xl sm:text-3xl mt-1">0</div>
                    <p class="text-[11px] font-bold opacity-80">Izin tertulis</p>
                </div>
                <div class="neo-card bg-neo-yellow p-4 text-neo-ink">
                    <span class="font-mono text-[10px] font-extrabold uppercase bg-white px-2 py-0.5 rounded border border-neo-ink">SAKIT (S)</span>
                    <div id="pubAttCountS" class="font-mono font-extrabold text-2xl sm:text-3xl mt-1">0</div>
                    <p class="text-[11px] font-bold opacity-80">Istirahat sakit</p>
                </div>
                <div class="neo-card bg-neo-coral p-4 text-white">
                    <span class="font-mono text-[10px] font-extrabold uppercase bg-white text-neo-ink px-2 py-0.5 rounded border border-neo-ink">ALFA (A)</span>
                    <div id="pubAttCountA" class="font-mono font-extrabold text-2xl sm:text-3xl mt-1">0</div>
                    <p class="text-[11px] font-bold opacity-90">Tanpa keterangan</p>
                </div>
            </div>

            <!-- Tabel Absensi Harian & Kumulatif (Read-Only di Publik) -->
            <div class="neo-card bg-white p-4 sm:p-6 space-y-4">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b-3 border-neo-ink">
                    <div>
                        <h3 class="font-display font-extrabold text-lg uppercase">Daftar Kehadiran Anggota Kelas</h3>
                        <p id="pubAttDateSubtitle" class="text-xs font-semibold text-muted-adaptive">Status kehadiran pada tanggal terpilih & total kumulatif semester.</p>
                    </div>
                    <input
                        type="text"
                        id="pubAttSearchInput"
                        oninput="renderPublicAttendanceView()"
                        placeholder="Cari nama / no. absen..."
                        class="neo-input px-3 py-2 text-xs w-full sm:w-60"
                    >
                </div>
                <div class="overflow-x-auto border-3 border-neo-ink rounded-lg">
                    <table class="w-full text-left border-collapse neo-table">
                        <thead>
                            <tr class="bg-neo-ink text-white font-mono text-[11px] uppercase">
                                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center w-10">No</th>
                                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[180px]">Anggota Kelas</th>
                                <th class="py-2.5 px-3 border-r-2 border-neutral-700 text-center">Status Hari Ini</th>
                                <th class="py-2.5 px-3 border-r-2 border-neutral-700">Catatan / Keterangan</th>
                                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center">Total H/I/S/A</th>
                                <th class="py-2.5 px-3 text-right">Persentase</th>
                            </tr>
                        </thead>
                        <tbody id="pubAttTableBody" class="divide-y-2 divide-neo-ink text-xs font-semibold"></tbody>
                    </table>
                </div>
            </div>
        `;
        userWorkspace.appendChild(absensiSec);
    }

    // 3. Perbarui Top Bar & Navigasi Panel Admin menjadi Menu Titik Tiga (Drawer Rapi Mobile-First) & Hapus Tombol Sync Manual
    const adminWorkspace = document.getElementById("workspace-admin");
    if (adminWorkspace && !document.getElementById("adminDrawerPanel")) {
        // Sembunyikan bar tab lama yang menumpuk di layar HP
        const oldNavCard = document.getElementById("adminNavTabsContainer")?.parentElement;
        if (oldNavCard) oldNavCard.classList.add("hidden");

        // Rombak Sticky Header Admin agar memiliki Tombol Titik Tiga (⋮) di Kiri + Indikator Tab Aktif + Pratinjau Web
        const adminStickyBar = adminWorkspace.querySelector(".sticky.top-0");
        if (adminStickyBar) {
            adminStickyBar.innerHTML = `
                <div class="max-w-7xl mx-auto flex items-center justify-between gap-2.5">
                    <!-- Kiri: Tombol Titik Tiga Menu Admin + Info Tab Aktif -->
                    <div class="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
                        <button
                            type="button"
                            onclick="toggleAdminDrawer(true)"
                            aria-label="Menu Modul Admin"
                            class="neo-btn bg-neo-yellow text-neo-ink w-10 h-10 sm:w-11 sm:h-11 shrink-0 text-base sm:text-lg"
                        >
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>

                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-1.5">
                                <span id="activeAdminTabIndicator" class="font-mono text-[10px] font-extrabold bg-neo-mint text-neo-ink px-2 py-0.5 rounded border border-neo-ink uppercase truncate">
                                    1. KAS & SHEET
                                </span>
                                <span id="adminCloudLiveBadge" class="hidden sm:inline-flex items-center gap-1 font-mono text-[10px] text-neutral-300 bg-white/10 px-2 py-0.5 rounded">
                                    <i class="fa-solid fa-cloud text-neo-mint"></i> Cloud Aktif
                                </span>
                            </div>
                            <h2 id="adminSessionName" class="font-display font-extrabold text-sm sm:text-lg uppercase text-white truncate mt-0.5">
                                Panel Pengurus Kelas
                            </h2>
                            <p id="adminSessionPerms" class="hidden">{{perms}}</p>
                            <span id="adminSessionRole" class="hidden">Super Admin</span>
                        </div>
                    </div>

                    <!-- Kanan: Pratinjau Web, Tema & Keluar (Bersih di Mobile & Desktop) -->
                    <div class="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onclick="toggleDarkMode()"
                            class="neo-btn bg-neo-surface text-neo-ink w-9 h-9 sm:w-10 sm:h-10 text-xs"
                            title="Ganti Tema Gelap / Terang"
                        >
                            <i class="fa-solid fa-circle-half-stroke"></i>
                        </button>

                        <button
                            type="button"
                            onclick="enterAdminPreviewMode()"
                            class="neo-btn bg-neo-sky text-neo-ink px-2.5 sm:px-3.5 py-2 text-xs"
                        >
                            <i class="fa-solid fa-eye"></i>
                            <span class="hidden sm:inline">Pratinjau Web</span>
                        </button>

                        <button
                            type="button"
                            onclick="logoutAdmin()"
                            class="neo-btn bg-neo-coral text-white px-2.5 sm:px-3.5 py-2 text-xs"
                            title="Keluar dari Panel Admin"
                        >
                            <i class="fa-solid fa-right-from-bracket"></i>
                            <span class="hidden sm:inline">Keluar</span>
                        </button>
                    </div>
                </div>
            `;
        }

        // Buat Slide-Out Drawer Khusus Modul Admin (Diakses dari Titik Tiga)
        const drawerHtml = document.createElement("div");
        drawerHtml.innerHTML = `
            <div id="adminDrawerBackdrop" onclick="toggleAdminDrawer(false)" class="fixed inset-0 z-50 hidden bg-black/70 backdrop-blur-xs transition-opacity"></div>
            <aside id="adminDrawerPanel" class="fixed top-0 left-0 bottom-0 z-50 w-72 sm:w-80 bg-neo-bg border-r-4 border-neo-ink shadow-neo-xl transform -translate-x-full transition-transform duration-200 flex flex-col justify-between p-4 sm:p-5 overflow-y-auto">
                <div class="space-y-4">
                    <div class="flex items-center justify-between pb-3 border-b-3 border-neo-ink">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <div class="w-10 h-10 bg-neo-mint text-neo-ink border-2 border-neo-ink rounded-xl flex items-center justify-center font-bold text-base shrink-0 shadow-neo-sm">
                                <i class="fa-solid fa-user-shield"></i>
                            </div>
                            <div class="min-w-0">
                                <div id="drawerAdminUserTitle" class="font-display font-extrabold text-sm uppercase truncate">PENGURUS KELAS</div>
                                <div id="drawerAdminRoleBadge" class="font-mono text-[10px] font-bold text-neo-violet">SUPER ADMIN</div>
                            </div>
                        </div>
                        <button type="button" onclick="toggleAdminDrawer(false)" class="neo-btn bg-neo-coral text-white w-8 h-8 text-xs shrink-0">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div class="font-mono text-[10px] font-extrabold uppercase text-muted-adaptive px-1">
                        PILIH TAB MODUL ADMIN:
                    </div>

                    <nav id="adminDrawerNavList" class="space-y-2">
                        <button type="button" onclick="selectAdminTabFromDrawer('adm-keuangan')" id="admdrawer-adm-keuangan" data-perm="keuangan" class="admin-nav-btn active neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm">
                            <span class="w-6 text-center"><i class="fa-solid fa-coins text-amber-500"></i></span>
                            <span class="flex-1 text-left">1. Kas, Senin & Sheet</span>
                        </button>

                        <button type="button" onclick="selectAdminTabFromDrawer('adm-absensi')" id="admdrawer-adm-absensi" data-perm="absensi" class="admin-nav-btn neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm">
                            <span class="w-6 text-center"><i class="fa-solid fa-clipboard-user text-emerald-500"></i></span>
                            <span class="flex-1 text-left">2. Absensi Digital</span>
                            <span class="bg-neo-lime text-neo-ink border border-neo-ink rounded px-1.5 text-[9px] font-mono">BARU</span>
                        </button>

                        <button type="button" onclick="selectAdminTabFromDrawer('adm-siswa')" id="admdrawer-adm-siswa" data-perm="siswa" class="admin-nav-btn neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm">
                            <span class="w-6 text-center"><i class="fa-solid fa-user-graduate text-sky-500"></i></span>
                            <span class="flex-1 text-left">3. Anggota & Struktur</span>
                        </button>

                        <button type="button" onclick="selectAdminTabFromDrawer('adm-info')" id="admdrawer-adm-info" data-perm="info" class="admin-nav-btn neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm">
                            <span class="w-6 text-center"><i class="fa-solid fa-bullhorn text-rose-500"></i></span>
                            <span class="flex-1 text-left">4. Tugas & Mading</span>
                        </button>

                        <button type="button" onclick="selectAdminTabFromDrawer('adm-jadwal')" id="admdrawer-adm-jadwal" data-perm="jadwal" class="admin-nav-btn neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm">
                            <span class="w-6 text-center"><i class="fa-solid fa-calendar-days text-purple-500"></i></span>
                            <span class="flex-1 text-left">5. Jadwal & Pilih Jam</span>
                        </button>

                        <button type="button" onclick="selectAdminTabFromDrawer('adm-album')" id="admdrawer-adm-album" data-perm="album" class="admin-nav-btn neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm">
                            <span class="w-6 text-center"><i class="fa-solid fa-camera text-orange-500"></i></span>
                            <span class="flex-1 text-left">6. Galeri Album</span>
                        </button>

                        <button type="button" onclick="selectAdminTabFromDrawer('adm-akun')" id="admdrawer-adm-akun" data-perm="akun" class="admin-nav-btn neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm">
                            <span class="w-6 text-center"><i class="fa-solid fa-users-gear text-pink-500"></i></span>
                            <span class="flex-1 text-left">7. Akun & Sandi Admin</span>
                        </button>

                        <button type="button" onclick="selectAdminTabFromDrawer('adm-pengaturan')" id="admdrawer-adm-pengaturan" data-perm="pengaturan" class="admin-nav-btn neo-btn bg-white text-neo-ink w-full justify-start px-3.5 py-2.5 text-xs sm:text-sm">
                            <span class="w-6 text-center"><i class="fa-solid fa-sliders text-indigo-500"></i></span>
                            <span class="flex-1 text-left">8. Identitas & Semester</span>
                        </button>
                    </nav>
                </div>

                <div class="pt-4 border-t-3 border-neo-ink space-y-2">
                    <button type="button" onclick="toggleAdminDrawer(false); enterAdminPreviewMode();" class="neo-btn bg-neo-sky text-neo-ink w-full py-2.5 px-3.5 text-xs justify-between">
                        <span class="flex items-center gap-2"><i class="fa-solid fa-eye"></i> Pratinjau Web Publik</span>
                        <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                    </button>
                    <button type="button" onclick="toggleAdminDrawer(false); logoutAdmin();" class="neo-btn bg-neo-coral text-white w-full py-2.5 px-3.5 text-xs justify-between">
                        <span class="flex items-center gap-2"><i class="fa-solid fa-right-from-bracket"></i> Keluar Workspace</span>
                        <i class="fa-solid fa-power-off text-[10px]"></i>
                    </button>
                </div>
            </aside>
        `;
        adminWorkspace.appendChild(drawerHtml);
    }

    // 4. Suntikkan Section Admin Baru: `#adm-absensi` (Kelola Absensi Digital)
    const adminContainer = adminWorkspace?.querySelector(".max-w-7xl.mx-auto.px-3");
    if (adminContainer && !document.getElementById("adm-absensi")) {
        const admAbsenSec = document.createElement("section");
        admAbsenSec.id = "adm-absensi";
        admAbsenSec.className = "admin-section hidden space-y-6";
        admAbsenSec.innerHTML = `
            <div class="neo-card bg-neo-lime text-neo-ink p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <span class="neo-badge bg-white text-neo-ink mb-1"><i class="fa-solid fa-user-check"></i> MODUL PRESENSI HARIAN</span>
                    <h3 class="font-display font-extrabold text-lg sm:text-xl uppercase">Kelola Absensi Digital Kelas</h3>
                    <p class="text-xs font-semibold opacity-90">Pilih tanggal, klik status kehadiran (Hadir/Izin/Sakit/Alfa), lalu tekan Simpan Absensi.</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        id="admAttendanceDateInput"
                        onchange="handleAdminAttendanceDateChange(this.value)"
                        class="neo-input px-3 py-2 text-xs font-mono bg-white text-neo-ink"
                    >
                    <button type="button" onclick="markAllAttendancePresent()" class="neo-btn bg-white text-neo-ink px-3 py-2 text-xs">
                        <i class="fa-solid fa-check-double text-emerald-600"></i> Semua Hadir (H)
                    </button>
                    <button type="button" onclick="downloadAttendanceExcelSheet()" class="neo-btn bg-neo-yellow text-neo-ink px-3.5 py-2 text-xs">
                        <i class="fa-solid fa-file-excel"></i> Unduh Sheet Absen (.xls)
                    </button>
                </div>
            </div>

            <div class="neo-card bg-white p-4 sm:p-6 space-y-4">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b-3 border-neo-ink">
                    <div>
                        <h4 id="admAttendanceTableTitle" class="font-display font-extrabold text-base uppercase">Lembar Presensi Anggota</h4>
                        <p class="text-xs font-semibold text-muted-adaptive">Setiap perubahan atau klik tombol Simpan akan langsung masuk ke Firebase.</p>
                    </div>
                    <button type="button" onclick="saveCurrentDayAttendance()" class="neo-btn bg-neo-mint text-neo-ink px-4 py-2.5 text-xs">
                        <i class="fa-solid fa-floppy-disk"></i> Simpan Absensi Tanggal Ini
                    </button>
                </div>

                <div class="overflow-x-auto border-3 border-neo-ink rounded-lg">
                    <table class="w-full text-left border-collapse neo-table">
                        <thead>
                            <tr class="bg-neo-ink text-white font-mono text-[11px] uppercase">
                                <th class="py-2.5 px-2.5 border-r-2 border-neutral-700 text-center w-10">No</th>
                                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[170px]">Nama Anggota</th>
                                <th class="py-2.5 px-3 border-r-2 border-neutral-700 text-center min-w-[210px]">Pilih Status Kehadiran</th>
                                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[180px]">Catatan (Surat/Alasan)</th>
                                <th class="py-2.5 px-2.5 text-center">Rekap H/I/S/A</th>
                            </tr>
                        </thead>
                        <tbody id="admAttendanceTableBody" class="divide-y-2 divide-neo-ink text-xs font-semibold"></tbody>
                    </table>
                </div>
            </div>
        `;
        adminContainer.appendChild(admAbsenSec);
    }

    // 5. Tingkatkan Form Akun Pengurus (`#adm-akun`) agar Mendukung Edit & Ganti Sandi
    const admAkunSection = document.getElementById("adm-akun");
    if (admAkunSection && !document.getElementById("admAccEditOriginalUser")) {
        const formEl = admAkunSection.querySelector("form");
        const headingEl = admAkunSection.querySelector("h3");
        if (headingEl) {
            headingEl.outerHTML = `
                <div class="border-b-3 border-neo-ink pb-2.5 flex items-center justify-between">
                    <h3 id="admAccFormTitle" class="font-display font-extrabold text-base uppercase">Buat / Ganti Sandi Akun Pengurus</h3>
                    <button type="button" onclick="resetAdminAccountForm()" id="btnCancelEditAcc" class="hidden text-xs font-bold text-rose-500 underline">Batal Edit</button>
                </div>
            `;
        }
        if (formEl) {
            const hiddenInput = document.createElement("input");
            hiddenInput.type = "hidden";
            hiddenInput.id = "admAccEditOriginalUser";
            hiddenInput.value = "";
            formEl.prepend(hiddenInput);

            const passInput = document.getElementById("admAccPassword");
            if (passInput) {
                const wrapper = document.createElement("div");
                wrapper.className = "relative";
                passInput.parentNode.insertBefore(wrapper, passInput);
                wrapper.appendChild(passInput);
                passInput.classList.add("pr-9");
                const toggleBtn = document.createElement("button");
                toggleBtn.type = "button";
                toggleBtn.className = "absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neo-ink text-xs";
                toggleBtn.setAttribute("onclick", "toggleAdminFormPassword()");
                toggleBtn.innerHTML = `<i id="admAccPassEye" class="fa-solid fa-eye"></i>`;
                wrapper.appendChild(toggleBtn);
            }
        }
    }

    // 6. Tambahkan Panel "Mulai Semester Baru & Arsip Semester" di `#adm-pengaturan`
    const admPengaturanSec = document.getElementById("adm-pengaturan");
    if (admPengaturanSec && !document.getElementById("semesterArchiveManagerCard")) {
        const archiveCard = document.createElement("div");
        archiveCard.id = "semesterArchiveManagerCard";
        archiveCard.className = "neo-card bg-white p-5 sm:p-6 space-y-5 border-4 border-neo-ink";
        archiveCard.innerHTML = `
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b-3 border-neo-ink">
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <span class="neo-badge bg-neo-violet text-white"><i class="fa-solid fa-box-archive"></i> MANAJEMEN PERIODE & ARSIP SEMESTER</span>
                        <span id="currentActiveSemesterPill" class="neo-badge bg-neo-yellow text-neo-ink font-mono">Semester Ganjil • TA 2026/2027</span>
                    </div>
                    <h3 class="font-display font-extrabold text-lg sm:text-xl uppercase">Mulai Semester Baru Tanpa Hapus Data Lama</h3>
                    <p class="text-xs font-semibold text-muted-adaptive mt-0.5">
                        Arsipkan seluruh buku kas, pelunasan iuran Senin, absensi, dan pengumuman semester ini ke brankas riwayat, lalu mulai semester baru dengan daftar siswa yang tetap utuh.
                    </p>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <!-- Form Mulai Semester Baru (5 Cols) -->
                <div class="lg:col-span-5 bg-neo-surface border-2.5 border-neo-ink rounded-xl p-4 space-y-3">
                    <h4 class="font-display font-extrabold text-sm uppercase flex items-center gap-2">
                        <i class="fa-solid fa-rocket text-neo-coral"></i> Buat & Mulai Semester Baru
                    </h4>
                    <div>
                        <label class="block font-display font-extrabold text-[11px] uppercase mb-1">Nama Label Arsip Semester Saat Ini</label>
                        <input type="text" id="archiveCurrentLabelInput" placeholder="Contoh: Semester Ganjil 2026/2027" class="neo-input w-full px-3 py-2 text-xs">
                    </div>
                    <div class="grid grid-cols-2 gap-2.5">
                        <div>
                            <label class="block font-display font-extrabold text-[11px] uppercase mb-1">Semester Baru</label>
                            <select id="newSemesterNameSelect" class="neo-input w-full px-2.5 py-2 text-xs">
                                <option value="Semester Genap">Semester Genap</option>
                                <option value="Semester Ganjil">Semester Ganjil</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-display font-extrabold text-[11px] uppercase mb-1">Tahun Ajaran Baru</label>
                            <input type="text" id="newSemesterAcYearInput" placeholder="2026/2027" class="neo-input w-full px-2.5 py-2 text-xs font-mono">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2.5">
                        <div>
                            <label class="block font-display font-extrabold text-[10px] uppercase mb-1">Tgl Awal Kas Baru</label>
                            <input type="date" id="newSemesterStartDate" class="neo-input w-full px-2.5 py-2 text-xs font-mono">
                        </div>
                        <div>
                            <label class="block font-display font-extrabold text-[10px] uppercase mb-1">Tgl Akhir Kas Baru</label>
                            <input type="date" id="newSemesterEndDate" class="neo-input w-full px-2.5 py-2 text-xs font-mono">
                        </div>
                    </div>
                    <button type="button" onclick="handleStartNewSemester()" class="neo-btn bg-neo-mint text-neo-ink w-full py-3 text-xs">
                        <i class="fa-solid fa-box-archive"></i> Arsipkan Semester Ini & Mulai Baru
                    </button>
                </div>

                <!-- Daftar Arsip Semester Terdahulu (7 Cols) -->
                <div class="lg:col-span-7 space-y-3">
                    <div class="flex items-center justify-between">
                        <h4 class="font-display font-extrabold text-sm uppercase">Daftar Brankas Arsip Semester Lalu</h4>
                        <span id="archiveTotalCountBadge" class="neo-badge bg-neo-yellow text-neo-ink">0 Arsip</span>
                    </div>
                    <div id="semesterArchivesListContainer" class="space-y-2.5"></div>
                </div>
            </div>
        `;
        admPengaturanSec.appendChild(archiveCard);
    }
}

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
        renderAdminWorkspace();
    } else if (activeWorkspace === "preview" && currentAdmin) {
        publicChrome?.classList.remove("hidden");
        userMain?.classList.remove("hidden");
        publicFooter?.classList.remove("hidden");
        previewBanner?.classList.remove("hidden");
        btnReturnTop?.classList.remove("hidden");
        renderAllViews();
    } else {
        activeWorkspace = "user";
        publicChrome?.classList.remove("hidden");
        userMain?.classList.remove("hidden");
        publicFooter?.classList.remove("hidden");
        renderAllViews();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(initScrollRevealObserver, 70);
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
    }, 120);
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
// OTENTIKASI LOGIN PENGURUS (MEMBACA LANGSUNG AKUN DARI CLOUD FIREBASE)
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
    const rawInput = document.getElementById("loginUsername").value.trim().toLowerCase();
    const passwordInput = document.getElementById("loginPassword").value;
    const submitBtn = document.getElementById("btnSubmitAdminLogin");

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Memverifikasi di Cloud Firebase...`;
    }

    let authenticatedProfile = null;
    const emailCandidate = rawInput.includes("@") ? rawInput : `${rawInput}@kelas.id`;

    // 1. Segarkan daftar akun terbaru langsung dari server Firebase agar akun yang baru dibuat di HP lain langsung terbaca
    try {
        const freshCloudAdmins = await fetchAllAdminsFromCloud();
        if (freshCloudAdmins.length > 0) {
            externalFirebaseAdmins = mergeAdminArrays(externalFirebaseAdmins, freshCloudAdmins);
        }
    } catch (e) {}

    // 2. Cek kecocokan di database akun pengurus (appData.admins + koleksi Firebase) terlebih dahulu
    //    (Agar jika sandi baru saja diubah di Panel Admin, sandi baru langsung berlaku!)
    const allAdmins = getAllCombinedAdmins();
    const foundInCloudList = allAdmins.find((a) => {
        const u = String(a.username || "").toLowerCase();
        const em = String(a.email || "").toLowerCase();
        const unameOnly = u.split("@")[0];
        const inputNameOnly = rawInput.split("@")[0];
        return (
            (u === rawInput || em === rawInput || u === emailCandidate || unameOnly === inputNameOnly) &&
            String(a.password) === String(passwordInput)
        );
    });

    if (foundInCloudList) {
        authenticatedProfile = foundInCloudList;
    }

    // 3. Jika belum ditemukan di koleksi, coba via Firebase Authentication (Email & Password)
    if (!authenticatedProfile) {
        try {
            const userCred = await loginWithFirebaseAuth(emailCandidate, passwordInput);
            if (userCred && userCred.user) {
                const loggedEmail = (userCred.user.email || emailCandidate).toLowerCase();
                const matchedInDb = allAdmins.find(
                    (a) =>
                        String(a.username).toLowerCase() === loggedEmail ||
                        String(a.email || "").toLowerCase() === loggedEmail ||
                        String(a.username).toLowerCase() === rawInput
                );

                authenticatedProfile = matchedInDb || {
                    id: userCred.user.uid,
                    username: loggedEmail,
                    email: loggedEmail,
                    password: passwordInput,
                    name: loggedEmail === "admin@kelas.id" ? "Admin Utama Kelas" : (userCred.user.displayName || loggedEmail.split("@")[0]),
                    role: "Super Admin",
                    isSuperAdmin: true,
                    permissions: ["keuangan", "absensi", "siswa", "info", "jadwal", "album", "akun", "pengaturan"]
                };
            }
        } catch (firebaseAuthErr) {}
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
    setupAdminSessionTabs();
    activeWorkspace = "admin";
    updateWorkspaceVisibility();
    showToast(`Selamat datang kembali, ${authenticatedProfile.name}!`, "bg-neo-mint");
};

window.logoutAdmin = async function () {
    currentAdmin = null;
    await logoutFirebaseSession();
    document.getElementById("drawerAdminLoginText").textContent = "Login Pengurus Kelas";
    activeWorkspace = "user";
    updateWorkspaceVisibility();
    showToast("Anda telah keluar dari Workspace Pengurus.", "bg-neo-yellow");
};

function setupAdminSessionTabs() {
    if (!currentAdmin) return;

    document.getElementById("drawerAdminLoginText").textContent = `Workspace (${currentAdmin.name.split(" ")[0]})`;
    document.getElementById("adminSessionName").textContent = `${currentAdmin.name} • ${currentAdmin.role}`;

    const drawerTitle = document.getElementById("drawerAdminUserTitle");
    const drawerRole = document.getElementById("drawerAdminRoleBadge");
    if (drawerTitle) drawerTitle.textContent = currentAdmin.name;
    if (drawerRole) drawerRole.textContent = currentAdmin.role.toUpperCase();

    let firstAllowedTab = null;
    document.querySelectorAll("#adminDrawerNavList .admin-nav-btn").forEach((btn) => {
        const perm = btn.dataset.perm;
        if (hasAdminPermission(perm)) {
            btn.classList.remove("hidden");
            if (!firstAllowedTab) firstAllowedTab = btn.id.replace("admdrawer-", "");
        } else {
            btn.classList.add("hidden");
        }
    });

    if (firstAllowedTab) {
        switchAdminTab(firstAllowedTab);
    }
}

window.switchAdminTab = function (sectionId) {
    const permMap = {
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
        "adm-keuangan": "1. KAS, SENIN & SHEET",
        "adm-absensi": "2. ABSENSI DIGITAL",
        "adm-siswa": "3. ANGGOTA & STRUKTUR",
        "adm-info": "4. TUGAS & MADING",
        "adm-jadwal": "5. JADWAL & PILIH JAM",
        "adm-album": "6. GALERI ALBUM",
        "adm-akun": "7. AKUN & SANDI ADMIN",
        "adm-pengaturan": "8. IDENTITAS & SEMESTER"
    };

    if (!hasAdminPermission(permMap[sectionId])) {
        showToast("Akun Anda tidak memiliki akses ke modul ini.", "bg-neo-coral");
        return;
    }

    activeAdminSectionId = sectionId;
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
// PEMBACAAN GAMBAR INSTAN TANPA KOMPRESI & PRATINJAU LANGSUNG
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
        showToast("Gambar berhasil dimuat! Klik Simpan Pengaturan untuk menyimpan ke Firebase.", "bg-neo-mint");
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
// PERHITUNGAN TANGGAL SENIN, KEUANGAN & STATISTIK ABSENSI
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

function formatShortMondayLabel(isoDate) {
    const parts = String(isoDate || "").split("-");
    if (parts.length !== 3) return isoDate;
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${parts[2]} ${months[mIdx] || parts[1]}`;
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

/**
 * Menghitung akumulasi kehadiran per siswa sepanjang semester aktif
 */
function calculateStudentAttendanceStats(studentId) {
    const attMap = appData.attendance || {};
    let H = 0, I = 0, S = 0, A = 0;
    Object.keys(attMap).forEach((dateKey) => {
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
// KOMPONEN VISUAL AVATAR, TYPEWRITER, SCROLL REVEAL & TOAST
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

function runHeroTypewriter(text) {
    const target = document.getElementById("typewriterTextTarget");
    if (!target) return;
    const cleanText = (text || "SELAMAT DATANG DI MEDIVANCE").trim();
    if (currentTypedGoal === cleanText && target.textContent.length > 0) return;
    currentTypedGoal = cleanText;

    if (typewriterTimer) clearTimeout(typewriterTimer);
    target.textContent = "";
    let idx = 0;

    function step() {
        if (idx <= cleanText.length) {
            target.textContent = cleanText.slice(0, idx);
            idx++;
            typewriterTimer = setTimeout(step, 48);
        }
    }
    step();
}

function initScrollRevealObserver() {
    const elements = document.querySelectorAll(".reveal-on-scroll");
    if (!("IntersectionObserver" in window)) {
        elements.forEach((el) => el.classList.add("is-visible"));
        return;
    }
    if (!scrollObserver) {
        scrollObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                    }
                });
            },
            { threshold: 0.08, rootMargin: "0px 0px -20px 0px" }
        );
    }
    elements.forEach((el) => scrollObserver.observe(el));
}

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
        <button onclick="this.parentElement.remove()" class="font-bold text-xs px-1.5 border border-neo-ink bg-white text-neo-ink rounded">✕</button>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast && toast.parentElement) toast.remove();
    }, 3500);
}

// ============================================================================
// RENDER IDENTITAS, LOGO KELAS, LATAR BELAKANG & BERANDA PUBLIK
// ============================================================================

window.switchTab = function (tabId) {
    activeTabId = tabId;
    const tabs = ["dashboard", "keuangan", "absensi", "mading", "info", "jadwal", "album", "siswa"];
    tabs.forEach((t) => {
        const viewEl = document.getElementById(`view-${t}`);
        const btnDrawer = document.getElementById(`drawertab-${t}`);
        if (t === tabId) {
            viewEl?.classList.remove("hidden");
            btnDrawer?.classList.add("active");
        } else {
            viewEl?.classList.add("hidden");
            btnDrawer?.classList.remove("active");
        }
    });
    if (tabId === "absensi") renderPublicAttendanceView();
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(initScrollRevealObserver, 60);
};

function renderHeaderAndHeroIdentity() {
    const cfg = appData.config;
    const code = cfg.classCode || "MDV";
    const name = cfg.className || "MEDIVANCE";
    const motto = cfg.classMotto || "Together We Grow, Together We Heal";
    const semLabel = cfg.semesterName || "Semester Ganjil";
    const logoUrl = (cfg.classLogoUrl || "").trim();
    const bgUrl = (cfg.heroBgUrl || "").trim() || DEFAULT_HERO_BG;

    ["headerClassCode", "drawerLogoCode", "heroSmallLogoCode", "loginFullLogoCode"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = code;
    });

    document.getElementById("headerClassName").textContent = name;
    document.getElementById("drawerClassName").textContent = name;
    document.getElementById("heroClassIdentityTitle").textContent = `KELAS ${name}`;
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

    const logoTargets = [
        { img: "headerClassLogoImg", txt: "headerClassCode" },
        { img: "drawerLogoImg", txt: "drawerLogoCode" },
        { img: "heroSmallLogoImg", txt: "heroSmallLogoCode" },
        { img: "loginFullLogoImg", txt: "loginFullLogoCode" }
    ];
    logoTargets.forEach((pair) => {
        const imgEl = document.getElementById(pair.img);
        const txtEl = document.getElementById(pair.txt);
        applyImageWithFallback(imgEl, txtEl, logoUrl);
    });

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

    runHeroTypewriter(cfg.welcomeTypingText || `SELAMAT DATANG DI ${name}`);

    document.getElementById("heroWelcomeDesc").textContent =
        cfg.heroSubtitle ||
        "Keluarga besar penuh semangat kolaborasi, kepedulian, dan prestasi akademik yang tumbuh bersama dalam satu kesatuan.";

    document.getElementById("headerClassSubtitle").textContent = `${motto} • ${semLabel} ${cfg.academicYear || "-"}`;
    document.getElementById("drawerAcademicYear").textContent = `${semLabel} ${cfg.academicYear || "-"}`;
    document.getElementById("drawerWaliKelas").textContent = `Wali Kelas: ${cfg.waliKelas || "-"}`;
    document.getElementById("footerClassIdentity").textContent = `${name} • "${motto}" • ${semLabel} TA ${cfg.academicYear || "-"}`;

    const madingBadge = document.getElementById("badgeMadingCount");
    if (madingBadge) madingBadge.textContent = (appData.stickyNotes || []).length;
    const siswaBadge = document.getElementById("badgeSiswaCount");
    if (siswaBadge) siswaBadge.textContent = (appData.students || []).length;

    const marqueeText = cfg.marqueeText || `Selamat datang di Portal Resmi ${name} • ${motto}`;
    document.getElementById("topMarqueeContent").innerHTML = `
        <span class="mx-6 flex items-center gap-2"><span class="bg-neo-yellow text-neo-ink px-2 py-0.5 rounded-sm font-extrabold">${name}</span> ${marqueeText}</span>
        <span class="mx-6 flex items-center gap-2"><span class="bg-neo-mint text-neo-ink px-2 py-0.5 rounded-sm font-extrabold">${semLabel.toUpperCase()}</span> TA ${cfg.academicYear || "2026/2027"}</span>
        <span class="mx-6 flex items-center gap-2"><span class="bg-neo-yellow text-neo-ink px-2 py-0.5 rounded-sm font-extrabold">${name}</span> ${marqueeText}</span>
        <span class="mx-6 flex items-center gap-2"><span class="bg-neo-mint text-neo-ink px-2 py-0.5 rounded-sm font-extrabold">MOTTO</span> "${motto}"</span>
    `;
}

function renderDashboard() {
    const stats = calculateFinancialSummary();
    const cfg = appData.config;

    document.getElementById("heroAcademicYear").innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${cfg.semesterName || "Semester Ganjil"} • TA ${cfg.academicYear || "-"}`;
    document.getElementById("heroWaliKelas").innerHTML = `<i class="fa-solid fa-user-tie"></i> Wali Kelas: ${cfg.waliKelas || "-"}`;
    document.getElementById("quickCheckFeeLabel").textContent = `${formatRupiah(stats.fee)} / Senin`;

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
                <div class="border-2.5 border-neo-ink rounded-lg p-3 bg-neo-bg hover:bg-neo-surface transition space-y-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="neo-badge ${badgeColors[item.category] || "bg-white text-neo-ink"} text-[10px]">${item.category}</span>
                        <span class="font-mono text-[11px] font-bold text-muted-adaptive"><i class="fa-regular fa-clock"></i> ${item.deadline}</span>
                    </div>
                    <h4 class="font-display font-extrabold text-sm">${item.title}</h4>
                    <p class="text-xs font-medium text-muted-adaptive line-clamp-2">${item.body}</p>
                </div>
            `
            )
            .join("");
    }

    const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const todayIdx = new Date().getDay();
    const currentDay = todayIdx >= 1 && todayIdx <= 6 ? dayNames[todayIdx] : "Senin";
    document.getElementById("dashboardPiketDay").textContent = `Hari ${currentDay}`;

    const piketMembers = appData.students.filter((s) => s.piket === currentDay);
    const piketBox = document.getElementById("dashboardPiketMembers");
    if (piketMembers.length === 0) {
        piketBox.innerHTML = `<span class="text-xs font-bold text-muted-adaptive">Tidak ada jadwal piket tercatat.</span>`;
    } else {
        piketBox.innerHTML = piketMembers
            .map(
                (m) => `
                <button onclick="openStudentCardModal(${m.id})" class="bg-white text-neo-ink border-2 border-neo-ink shadow-neo-sm px-2.5 py-1 rounded-md text-xs font-extrabold flex items-center gap-1.5 hover:bg-neo-yellow transition">
                    <span class="font-mono bg-neo-ink text-white px-1.5 py-0.5 rounded text-[10px]">#${m.absen}</span>
                    <span>${m.name}</span>
                </button>
            `
            )
            .join("");
    }

    handleQuickCheck(document.getElementById("quickCheckInput")?.value || "");
    renderStickyNotesWall();
}

// ============================================================================
// FITUR BARU: ABSENSI DIGITAL (PUBLIK & ADMIN)
// ============================================================================

window.handlePublicAttendanceDateChange = function (val) {
    if (!val) return;
    selectedPublicAttendanceDate = val;
    renderPublicAttendanceView();
};

window.renderPublicAttendanceView = function () {
    const dateInput = document.getElementById("publicAttendanceDateInput");
    if (dateInput && dateInput.value !== selectedPublicAttendanceDate) {
        dateInput.value = selectedPublicAttendanceDate;
    }

    const semBadge = document.getElementById("publicAbsensiSemesterBadge");
    if (semBadge) {
        semBadge.textContent = `${appData.config.semesterName || "Semester Ganjil"} • TA ${appData.config.academicYear || "2026/2027"}`;
    }

    const dayMap = appData.attendance?.[selectedPublicAttendanceDate] || {};
    let cH = 0, cI = 0, cS = 0, cA = 0;

    appData.students.forEach((s) => {
        const st = dayMap[s.id]?.status || "";
        if (st === "H") cH++;
        else if (st === "I") cI++;
        else if (st === "S") cS++;
        else if (st === "A") cA++;
    });

    const elH = document.getElementById("pubAttCountH");
    const elI = document.getElementById("pubAttCountI");
    const elS = document.getElementById("pubAttCountS");
    const elA = document.getElementById("pubAttCountA");
    if (elH) elH.textContent = cH;
    if (elI) elI.textContent = cI;
    if (elS) elS.textContent = cS;
    if (elA) elA.textContent = cA;

    const subEl = document.getElementById("pubAttDateSubtitle");
    if (subEl) subEl.textContent = `Menampilkan presensi tanggal: ${selectedPublicAttendanceDate}`;

    const tbody = document.getElementById("pubAttTableBody");
    if (!tbody) return;

    const q = (document.getElementById("pubAttSearchInput")?.value || "").toLowerCase();
    const filtered = appData.students.filter(
        (s) => s.name.toLowerCase().includes(q) || String(s.absen).includes(q)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada data anggota kelas.</td></tr>`;
        return;
    }

    const statusBadgeMap = {
        H: `<span class="neo-badge bg-neo-lime text-neo-ink">✓ HADIR</span>`,
        I: `<span class="neo-badge bg-neo-sky text-neo-ink">✉ IZIN</span>`,
        S: `<span class="neo-badge bg-neo-yellow text-neo-ink">✚ SAKIT</span>`,
        A: `<span class="neo-badge bg-neo-coral text-white">✕ ALFA</span>`
    };

    tbody.innerHTML = filtered
        .map((stu) => {
            const rec = dayMap[stu.id] || {};
            const st = rec.status || "";
            const note = rec.note || "-";
            const cum = calculateStudentAttendanceStats(stu.id);

            return `
                <tr>
                    <td class="py-2.5 px-2.5 border-r-2 border-neo-ink text-center font-mono font-extrabold">${String(stu.absen).padStart(2, "0")}</td>
                    <td class="py-2 px-3 border-r-2 border-neo-ink">
                        <div class="flex items-center gap-2.5">
                            ${renderAvatarHtml(stu.name, stu.photoUrl, "w-8 h-8", "text-[10px]")}
                            <div>
                                <div class="font-extrabold">${stu.name}</div>
                                <div class="text-[10px] font-mono text-muted-adaptive">${stu.role}</div>
                            </div>
                        </div>
                    </td>
                    <td class="py-2 px-3 border-r-2 border-neo-ink text-center">
                        ${statusBadgeMap[st] || `<span class="font-mono text-[10px] text-muted-adaptive">Belum Diabsen</span>`}
                    </td>
                    <td class="py-2 px-3 border-r-2 border-neo-ink text-xs text-muted-adaptive">${note}</td>
                    <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono text-[11px]">
                        <span class="text-emerald-600 font-extrabold">${cum.H}H</span> /
                        <span class="text-sky-600 font-bold">${cum.I}I</span> /
                        <span class="text-amber-600 font-bold">${cum.S}S</span> /
                        <span class="text-rose-600 font-bold">${cum.A}A</span>
                    </td>
                    <td class="py-2 px-3 text-right font-mono font-extrabold ${cum.pct >= 80 ? "text-emerald-500" : "text-rose-500"}">
                        ${cum.pct}%
                    </td>
                </tr>
            `;
        })
        .join("");
};

window.handleAdminAttendanceDateChange = function (val) {
    if (!val) return;
    selectedAttendanceDate = val;
    renderAdminAttendanceSection();
};

function renderAdminAttendanceSection() {
    const dateInput = document.getElementById("admAttendanceDateInput");
    if (dateInput && dateInput.value !== selectedAttendanceDate) {
        dateInput.value = selectedAttendanceDate;
    }

    const titleEl = document.getElementById("admAttendanceTableTitle");
    if (titleEl) titleEl.textContent = `Lembar Presensi Tanggal: ${selectedAttendanceDate}`;

    const tbody = document.getElementById("admAttendanceTableBody");
    if (!tbody) return;

    if (appData.students.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-xs font-bold text-muted-adaptive">Tambahkan anggota kelas terlebih dahulu di modul Anggota & Struktur.</td></tr>`;
        return;
    }

    if (!appData.attendance) appData.attendance = {};
    const dayMap = appData.attendance[selectedAttendanceDate] || {};

    tbody.innerHTML = appData.students
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
                            <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'H')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("H", "bg-neo-lime")}">H</button>
                            <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'I')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("I", "bg-neo-sky")}">I</button>
                            <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'S')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("S", "bg-neo-yellow")}">S</button>
                            <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'A')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("A", "bg-neo-coral text-white")}">A</button>
                        </div>
                    </td>
                    <td class="py-1.5 px-2.5 border-r-2 border-neo-ink">
                        <input
                            type="text"
                            value="${(rec.note || "").replace(/"/g, "&quot;")}"
                            onchange="setStudentAttendanceNote(${stu.id}, this.value)"
                            placeholder="Ketik alasan / keterangan..."
                            class="neo-input w-full px-2.5 py-1 text-xs"
                        >
                    </td>
                    <td class="py-2 px-2.5 text-center font-mono text-[11px]">
                        <span class="text-emerald-600 font-extrabold">${cum.H}H</span> •
                        <span>${cum.I}I</span> •
                        <span>${cum.S}S</span> •
                        <span class="text-rose-600 font-bold">${cum.A}A</span>
                    </td>
                </tr>
            `;
        })
        .join("");
}

window.setStudentAttendanceStatus = async function (studentId, status) {
    if (!canEditInCurrentView("absensi")) return;
    if (!appData.attendance) appData.attendance = {};
    if (!appData.attendance[selectedAttendanceDate]) {
        appData.attendance[selectedAttendanceDate] = {};
    }
    const existing = appData.attendance[selectedAttendanceDate][studentId] || { status: "", note: "" };
    existing.status = status;
    appData.attendance[selectedAttendanceDate][studentId] = existing;
    await saveToCloudDatabase();
    renderAdminAttendanceSection();
};

window.setStudentAttendanceNote = async function (studentId, noteText) {
    if (!canEditInCurrentView("absensi")) return;
    if (!appData.attendance) appData.attendance = {};
    if (!appData.attendance[selectedAttendanceDate]) {
        appData.attendance[selectedAttendanceDate] = {};
    }
    const existing = appData.attendance[selectedAttendanceDate][studentId] || { status: "H", note: "" };
    existing.note = noteText.trim();
    appData.attendance[selectedAttendanceDate][studentId] = existing;
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
    await saveToCloudDatabase(`Data absensi tanggal ${selectedAttendanceDate} berhasil disimpan ke Firebase!`);
};

window.downloadAttendanceExcelSheet = function () {
    const cfg = appData.config;
    const attDates = Object.keys(appData.attendance || {}).sort();
    const totalCols = attDates.length + 7;

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
                        REKAPITULASI ABSENSI DIGITAL KELAS ${cfg.className || "MEDIVANCE"} (${cfg.semesterName || "Semester Ganjil"} - TA ${cfg.academicYear || "2026/2027"})
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
// FITUR BARU: MULAI SEMESTER BARU & ARSIP SEMESTER LALU
// ============================================================================

function renderSemesterArchivesSection() {
    const cfg = appData.config;
    const pill = document.getElementById("currentActiveSemesterPill");
    if (pill) {
        pill.textContent = `${cfg.semesterName || "Semester Ganjil"} • TA ${cfg.academicYear || "2026/2027"}`;
    }

    const labelInput = document.getElementById("archiveCurrentLabelInput");
    if (labelInput && !labelInput.value) {
        labelInput.value = `${cfg.semesterName || "Semester Ganjil"} TA ${cfg.academicYear || "2026/2027"}`;
    }

    const acInput = document.getElementById("newSemesterAcYearInput");
    if (acInput && !acInput.value) {
        acInput.value = cfg.academicYear || "2026/2027";
    }

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
            <div class="border-2 border-dashed border-neo-ink/40 rounded-xl p-6 text-center text-xs font-bold text-muted-adaptive">
                Belum ada arsip semester terdahulu. Saat Anda menekan tombol "Arsipkan Semester Ini & Mulai Baru", seluruh rekaman kas & absensi semester berjalan akan tersimpan aman di sini.
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
                        <span class="neo-badge bg-neo-yellow text-neo-ink text-[10px]">${arc.label}</span>
                        <span class="font-mono text-[10px] font-bold text-muted-adaptive">Diarsipkan: ${arc.archivedAt}</span>
                    </div>
                    <div class="text-xs font-extrabold">
                        Saldo Akhir: <span class="font-mono text-emerald-600">${formatRupiah(arc.summary?.currentBalance || 0)}</span> •
                        Masuk: <span class="font-mono">${formatRupiah(arc.summary?.totalIncome || 0)}</span> •
                        Keluar: <span class="font-mono text-rose-500">${formatRupiah(arc.summary?.totalExpense || 0)}</span>
                    </div>
                    <div class="text-[11px] font-mono text-muted-adaptive">
                        ${(arc.students || []).length} Anggota • ${(arc.transactions || []).length} Transaksi Kas • ${Object.keys(arc.attendance || {}).length} Hari Absensi
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button type="button" onclick="downloadArchivedSemesterExcel(${arc.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2.5 py-1.5 text-[11px]" title="Unduh Laporan Sheet Arsip Ini">
                        <i class="fa-solid fa-file-excel"></i> Sheet (.xls)
                    </button>
                    <button type="button" onclick="restoreArchivedSemester(${arc.id})" class="neo-btn bg-neo-sky text-neo-ink px-2.5 py-1.5 text-[11px]" title="Buka / Pulihkan Data Semester Ini">
                        <i class="fa-solid fa-rotate-left"></i> Pulihkan
                    </button>
                    <button type="button" onclick="deleteArchivedSemester(${arc.id})" class="neo-btn bg-rose-200 text-rose-900 px-2.5 py-1.5 text-[11px]" title="Hapus Arsip">
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

    const archiveLabel = (document.getElementById("archiveCurrentLabelInput")?.value || "").trim() ||
        `${appData.config.semesterName || "Semester Ganjil"} ${appData.config.academicYear || "2026/2027"}`;
    const newSemName = document.getElementById("newSemesterNameSelect")?.value || "Semester Genap";
    const newAcYear = (document.getElementById("newSemesterAcYearInput")?.value || "").trim() || appData.config.academicYear;
    const newStart = document.getElementById("newSemesterStartDate")?.value || defaultRange.start;
    const newEnd = document.getElementById("newSemesterEndDate")?.value || defaultRange.end;

    if (new Date(newEnd) < new Date(newStart)) {
        showToast("Tanggal Akhir Kas Semester Baru harus setelah Tanggal Awal!", "bg-neo-coral");
        return;
    }

    const stats = calculateFinancialSummary();

    // 1. Simpan snapshot lengkap semester saat ini ke dalam `appData.archives`
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

    // 2. Reset pelunasan kas mingguan, transaksi kas, absensi harian & tugas untuk semester baru
    //    (Daftar nama anggota, foto profil, jabatan, dan album kenangan tetap utuh!)
    appData.students.forEach((s) => {
        s.paidDates = {};
        delete s.weeks;
    });
    appData.transactions = [];
    appData.announcements = [];
    appData.attendance = {};

    // 3. Perbarui konfigurasi ke semester baru
    appData.config.semesterName = newSemName;
    appData.config.academicYear = newAcYear;
    appData.config.feeStartDate = newStart;
    appData.config.feeEndDate = newEnd;

    await saveToCloudDatabase(`Semester "${archiveLabel}" berhasil diarsipkan! Selamat datang di ${newSemName} TA ${newAcYear}.`);
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
    await saveToCloudDatabase("Arsip semester dihapus.");
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
// PAPAN TEMPEL, KEUANGAN & DIREKTORI (PUBLIK & ADMIN)
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

    if (dashGrid) {
        dashGrid.innerHTML = notes.length === 0 ? emptyHtml : notes.slice(0, 8).map(buildNoteHtml).join("");
    }
    if (fullGrid) {
        fullGrid.innerHTML = notes.length === 0 ? emptyHtml : notes.map(buildNoteHtml).join("");
    }

    if (lastAddedStickyId) {
        setTimeout(() => {
            lastAddedStickyId = null;
        }, 600);
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
        box.innerHTML = `
            <div class="text-center py-2 text-xs font-bold text-muted-adaptive">
                Belum ada data anggota kelas yang terdaftar.
            </div>
        `;
        return;
    }

    const stats = calculateFinancialSummary();
    const q = (query || "").trim().toLowerCase();
    let target = appData.students[0];

    if (q) {
        const found = appData.students.find(
            (s) => s.name.toLowerCase().includes(q) || String(s.absen) === q
        );
        if (!found) {
            box.innerHTML = `
                <div class="text-center py-2 text-xs font-bold text-rose-500">
                    Anggota "${query}" tidak ditemukan.
                </div>
            `;
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
            <button onclick="openStudentCardModal(${target.id})" class="underline font-extrabold hover:text-neo-violet">
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
        .map(
            (dateStr) => `
            <th class="py-2.5 px-2 border-r-2 border-neutral-700 text-center min-w-[66px]">
                <div class="text-[9px] text-neo-yellow font-normal">SENIN</div>
                <div>${formatShortMondayLabel(dateStr)}</div>
            </th>
        `
        )
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
        tbody.innerHTML = `
            <tr>
                <td colspan="${mondays.length + 4}" class="py-8 text-center text-xs font-bold text-muted-adaptive">
                    Belum ada data anggota yang ditampilkan.
                </td>
            </tr>
        `;
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
                            <button onclick="openStudentCardModal(${stu.id})" class="text-left group flex items-center gap-2.5">
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
                                            title="Senin, ${dateStr} (${paid ? "Lunas" : "Belum Bayar"})"
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
    if (canEdit) btnMarkAll.classList.remove("hidden");
    else btnMarkAll.classList.add("hidden");

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
    mondays.forEach((d) => {
        student.paidDates[d] = true;
    });
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
        navigator.clipboard.writeText(text).then(() => {
            showToast("Pesan pengingat WhatsApp berhasil disalin!", "bg-neo-mint");
        });
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

    const filteredTx = [...appData.transactions]
        .reverse()
        .filter((tx) => filterType === "ALL" || tx.type === filterType);

    if (filteredTx.length === 0 && !rowsHtml) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada transaksi buku kas yang tercatat.</td>
            </tr>
        `;
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
        if (btn) {
            if (c === cat) btn.classList.add("active");
            else btn.classList.remove("active");
        }
    });
    renderInfoBoard();
};

function renderInfoBoard() {
    const grid = document.getElementById("infoCardsGrid");
    const badge = document.getElementById("badgeInfoCount");
    if (badge) badge.textContent = appData.announcements.length;
    if (!grid) return;

    const items = appData.announcements.filter(
        (a) => activeInfoCategory === "ALL" || a.category === activeInfoCategory
    );
    if (items.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full neo-card bg-white p-8 text-center text-xs font-bold text-muted-adaptive">
                Belum ada informasi atau tugas pada kategori ini.
            </div>
        `;
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
                <div class="space-y-2.5">
                    <div class="flex items-center justify-between gap-2">
                        <span class="neo-badge ${headerColors[item.category] || "bg-neo-surface text-neo-ink"}">${item.category}</span>
                        <span class="font-mono text-xs font-extrabold bg-neo-surface border-2 border-neo-ink px-2 py-0.5 rounded">
                            <i class="fa-regular fa-clock mr-1"></i>${item.deadline}
                        </span>
                    </div>
                    <h3 class="font-display font-extrabold text-base sm:text-lg leading-snug">${item.title}</h3>
                    <p class="text-xs sm:text-sm font-medium text-muted-adaptive leading-relaxed whitespace-pre-line">${item.body}</p>
                </div>
                <div class="pt-2.5 border-t-2 border-neo-ink flex items-center justify-between text-xs font-bold text-muted-adaptive">
                    <span><i class="fa-solid fa-user-pen mr-1"></i> ${item.author}</span>
                </div>
            </article>
        `
        )
        .join("");
}

window.selectScheduleDay = function (day) {
    activeScheduleDay = day;
    document.querySelectorAll(".day-filter-btn").forEach((btn) => {
        if (btn.dataset.day === day) btn.classList.add("active");
        else btn.classList.remove("active");
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
                                    <li onclick="openStudentCardModal(${m.id})" class="cursor-pointer bg-white text-neo-ink border-2 border-neo-ink rounded px-2 py-1 flex items-center justify-between hover:bg-neo-yellow transition">
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
        if (btn) {
            if (c === cat) btn.classList.add("active");
            else btn.classList.remove("active");
        }
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
        grid.innerHTML = `
            <div class="col-span-full neo-card bg-white p-8 text-center text-xs font-bold text-muted-adaptive">
                Belum ada foto dokumentasi pada album kelas.
            </div>
        `;
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
                    <div onclick="openStudentCardModal(${o.id})" class="cursor-pointer neo-card neo-card-hover bg-white p-4 flex items-center gap-3.5">
                        ${renderAvatarHtml(o.name, o.photoUrl, "w-14 h-14", "text-sm")}
                        <div class="min-w-0 flex-1">
                            <span class="neo-badge bg-neo-mint text-neo-ink text-[10px] mb-1">${o.role}</span>
                            <h4 class="font-display font-extrabold text-sm sm:text-base truncate">${o.name}</h4>
                            <p class="text-[11px] font-mono font-bold text-muted-adaptive">Absen #${String(o.absen).padStart(2, "0")} • Piket ${o.piket}</p>
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
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.role.toLowerCase().includes(q) ||
                String(s.absen).includes(q)
        );

        if (filtered.length === 0) {
            dirGrid.innerHTML = `<div class="col-span-full text-xs font-bold text-muted-adaptive py-6 text-center">Belum ada data anggota kelas terdaftar.</div>`;
        } else {
            const mondays = getMondayDatesList();
            dirGrid.innerHTML = filtered
                .map((s) => {
                    ensureStudentPaidDatesMigrated(s, mondays);
                    const isLunas = mondays.every((d) => Boolean(s.paidDates[d]));
                    return `
                        <div onclick="openStudentCardModal(${s.id})" class="cursor-pointer neo-card neo-card-hover p-4 bg-neo-bg flex flex-col justify-between space-y-3">
                            <div class="flex items-start gap-3">
                                ${renderAvatarHtml(s.name, s.photoUrl, "w-14 h-14", "text-sm")}
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center justify-between gap-1 mb-1">
                                        <span class="font-mono text-[10px] font-extrabold bg-neo-yellow text-neo-ink border border-neo-ink px-1.5 py-0.5 rounded">#${String(s.absen).padStart(2, "0")} • ${s.gender || "L"}</span>
                                        <span class="text-[10px] font-mono font-extrabold px-1.5 py-0.5 rounded border border-neo-ink text-neo-ink ${isLunas ? "bg-neo-lime" : "bg-rose-200"}">
                                            ${isLunas ? "Lunas" : "Aktif"}
                                        </span>
                                    </div>
                                    <h4 class="font-display font-extrabold text-sm sm:text-base truncate">${s.name}</h4>
                                    <p class="text-xs font-bold text-neo-violet truncate">${s.role}</p>
                                </div>
                            </div>
                            <div class="pt-2 border-t border-dashed border-neo-ink/30 flex items-center justify-between text-[11px] font-bold text-muted-adaptive">
                                <span><i class="fa-solid fa-broom mr-1"></i>Piket ${s.piket}</span>
                                ${s.quote ? `<span class="italic truncate max-w-[130px]">"${s.quote}"</span>` : ""}
                            </div>
                        </div>
                    `;
                })
                .join("");
        }
    }
};

// ============================================================================
// RENDER WORKSPACE PANEL ADMIN (SETELAN PER TAB)
// ============================================================================

window.renderAdminWorkspace = function () {
    if (!currentAdmin) return;
    const stats = calculateFinancialSummary();
    const mondays = stats.mondayDates;

    document.getElementById("admStatBalance").textContent = formatRupiah(stats.currentBalance);
    document.getElementById("admStatStudents").textContent = `${appData.students.length} Anggota`;
    document.getElementById("admStatCompliance").textContent = `${stats.complianceRatio}%`;
    document.getElementById("admStatMondays").textContent = `${mondays.length} Senin`;
    document.getElementById("admStatInfo").textContent = `${appData.announcements.length} Info`;
    document.getElementById("admStatSticky").textContent = `${(appData.stickyNotes || []).length} Pesan`;

    const qStart = document.getElementById("quickCfgStartDate");
    const qEnd = document.getElementById("quickCfgEndDate");
    const qFee = document.getElementById("quickCfgFee");
    if (qStart) qStart.value = appData.config.feeStartDate || defaultRange.start;
    if (qEnd) qEnd.value = appData.config.feeEndDate || defaultRange.end;
    if (qFee) qFee.value = appData.config.weeklyFee || 5000;
    document.getElementById("admTotalMondaysBadge").textContent = `${mondays.length} Kolom Senin`;

    // 1. Matriks Kontrol Pelunasan Kas Siswa (Tab 1)
    const admHead = document.getElementById("admIuranMatrixHead");
    const admBody = document.getElementById("admIuranMatrixBody");
    const admSearch = (document.getElementById("admIuranSearchInput")?.value || "").toLowerCase();

    if (admHead && admBody) {
        const weekCols = mondays
            .map(
                (d) =>
                    `<th class="py-2 px-1.5 border-r-2 border-neutral-700 text-center min-w-[64px]">
                        <div class="text-[9px] text-neo-yellow">SEN</div>
                        <div>${formatShortMondayLabel(d)}</div>
                    </th>`
            )
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
            admBody.innerHTML = `<tr><td colspan="${mondays.length + 2}" class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada anggota yang sesuai atau terdaftar.</td></tr>`;
        } else {
            admBody.innerHTML = filteredStu
                .map((stu) => {
                    ensureStudentPaidDatesMigrated(stu, mondays);
                    return `
                        <tr class="transition">
                            <td class="py-2 px-2 border-r-2 border-neo-ink text-center font-mono font-bold">${stu.absen}</td>
                            <td class="py-2 px-3 border-r-2 border-neo-ink font-extrabold">
                                <button onclick="openStudentCardModal(${stu.id})" class="hover:underline text-left">${stu.name}</button>
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
                            <button onclick="editTransaction(${tx.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1 text-[10px]" title="Edit"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="deleteTransaction(${tx.id})" class="neo-btn bg-rose-200 text-rose-900 px-2 py-1 text-[10px]" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `
                )
                .join("");
        }
    }

    // 2. Render Absensi Digital Admin
    renderAdminAttendanceSection();

    // 3. Tabel Daftar Siswa di Admin
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
                                    ${s.phone ? `<div class="font-mono text-[10px] text-muted-adaptive">${s.phone}</div>` : ""}
                                </div>
                            </div>
                        </td>
                        <td class="py-2 px-2.5 border-r-2 border-neo-ink text-center font-mono font-bold">${s.gender || "L"}</td>
                        <td class="py-2 px-3 border-r-2 border-neo-ink text-xs">${s.role}</td>
                        <td class="py-2 px-2.5 border-r-2 border-neo-ink text-xs">${s.piket}</td>
                        <td class="py-2 px-3 text-center space-x-1">
                            <button onclick="editStudentInAdmin(${s.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1 text-[10px]"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="deleteStudentInAdmin(${s.id})" class="neo-btn bg-rose-200 text-rose-900 px-2 py-1 text-[10px]"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `
                )
                .join("");
        }
    }

    // 4. Pengumuman & Moderasi Papan Tempel
    const admInfoBox = document.getElementById("admInfoListContainer");
    if (admInfoBox) {
        if (appData.announcements.length === 0) {
            admInfoBox.innerHTML = `<div class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada pengumuman aktif.</div>`;
        } else {
            admInfoBox.innerHTML = appData.announcements
                .map(
                    (a) => `
                    <div class="border-2 border-neo-ink rounded-lg p-3 flex items-center justify-between gap-3 bg-neo-bg">
                        <div class="min-w-0">
                            <span class="neo-badge bg-neo-yellow text-neo-ink text-[10px]">${a.category} • ${a.deadline}</span>
                            <h4 class="font-display font-extrabold text-sm mt-1 truncate">${a.title}</h4>
                            <p class="text-xs text-muted-adaptive line-clamp-1">${a.body}</p>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            <button onclick="editAnnouncement(${a.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2.5 py-1.5 text-xs"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="deleteAnnouncement(${a.id})" class="neo-btn bg-rose-200 text-rose-900 px-2.5 py-1.5 text-xs"><i class="fa-solid fa-trash"></i></button>
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
        if (notes.length === 0) {
            admStickyBox.innerHTML = `<div class="col-span-full py-4 text-center text-xs font-bold text-muted-adaptive">Belum ada tempelan kertas.</div>`;
        } else {
            admStickyBox.innerHTML = notes
                .map(
                    (n) => `
                    <div style="background-color: ${n.color || "#FFE600"}" class="border-2 border-neo-ink rounded-lg p-3 flex items-start justify-between gap-2 text-xs text-neo-ink">
                        <div class="min-w-0">
                            <span class="font-mono text-[10px] font-extrabold bg-white/85 text-neo-ink px-1.5 py-0.5 rounded border border-neo-ink">${n.author} • ${n.date || ""}</span>
                            <p class="font-bold mt-1 break-words">"${n.message}"</p>
                        </div>
                        <button onclick="deleteStickyNote(${n.id})" class="neo-btn bg-white text-rose-700 px-2 py-1 text-[10px] shrink-0" title="Hapus Tempelan">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `
                )
                .join("");
        }
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
                                        <button onclick="editScheduleItem('${d}', ${idx})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1 text-[10px]"><i class="fa-solid fa-pen"></i></button>
                                        <button onclick="deleteScheduleItem('${d}', ${idx})" class="neo-btn bg-rose-200 text-rose-900 px-2 py-1 text-[10px]"><i class="fa-solid fa-trash"></i></button>
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
        if (appData.albums.length === 0) {
            admAlbumGrid.innerHTML = `<div class="col-span-full py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada foto di album.</div>`;
        } else {
            admAlbumGrid.innerHTML = appData.albums
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
                            <button onclick="editAlbumItem(${alb.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1.5 text-xs"><i class="fa-solid fa-pen"></i></button>
                            <button onclick="deleteAlbumItem(${alb.id})" class="neo-btn bg-rose-200 text-rose-900 px-2 py-1.5 text-xs"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `
                )
                .join("");
        }
    }

    // 7. Daftar Akun Pengurus (Dengan Tombol Edit & Ganti Sandi)
    const accBox = document.getElementById("admAccountsList");
    if (accBox) {
        const allAdmins = getAllCombinedAdmins();
        if (allAdmins.length === 0) {
            accBox.innerHTML = `<div class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada akun pengurus tambahan.</div>`;
        } else {
            accBox.innerHTML = allAdmins
                .map(
                    (acc) => `
                    <div class="border-2.5 border-neo-ink rounded-lg p-3.5 bg-neo-bg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-mono text-xs font-extrabold bg-neo-ink text-white px-2 py-0.5 rounded">${acc.username}</span>
                                <strong class="font-display text-sm">${acc.name}</strong>
                                <span class="neo-badge bg-neo-yellow text-neo-ink text-[10px]">${acc.role}</span>
                                ${
                                    String(acc.username).toLowerCase() === String(currentAdmin.username).toLowerCase()
                                        ? `<span class="neo-badge bg-neo-mint text-neo-ink text-[10px]">Sedang Login</span>`
                                        : ""
                                }
                            </div>
                            <div class="text-[11px] font-mono text-muted-adaptive mt-1">
                                Sandi: <span class="bg-neo-surface px-1.5 py-0.5 rounded border border-neo-ink font-bold text-neo-ink">${acc.password ? "••••••" : "(Kosong)"}</span> •
                                Akses: ${acc.isSuperAdmin ? "PENUH (Super Admin)" : (acc.permissions || []).join(", ")}
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            <button type="button" onclick="editAdminAccount('${acc.username}')" class="neo-btn bg-neo-yellow text-neo-ink px-2.5 py-1.5 text-xs">
                                <i class="fa-solid fa-key"></i> Edit / Sandi
                            </button>
                            ${
                                String(acc.username).toLowerCase() !== String(currentAdmin.username).toLowerCase()
                                    ? `
                                <button type="button" onclick="deleteAdminAccount('${acc.username}')" class="neo-btn bg-rose-200 text-rose-900 px-2.5 py-1.5 text-xs">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            `
                                    : ""
                            }
                        </div>
                    </div>
                `
                )
                .join("");
        }
    }

    // 8. Isi Form Pengaturan Kelas + Live Preview Gambar + Arsip Semester
    document.getElementById("cfgClassCode").value = appData.config.classCode || "MDV";
    document.getElementById("cfgClassName").value = appData.config.className || "MEDIVANCE";
    document.getElementById("cfgClassMotto").value = appData.config.classMotto || "Together We Grow, Together We Heal";
    document.getElementById("cfgClassLogoUrl").value = appData.config.classLogoUrl || "";
    document.getElementById("cfgHeroBgUrl").value = appData.config.heroBgUrl || DEFAULT_HERO_BG;
    document.getElementById("cfgWelcomeTypingText").value = appData.config.welcomeTypingText || "SELAMAT DATANG DI MEDIVANCE";
    document.getElementById("cfgHeroSubtitle").value = appData.config.heroSubtitle || "";
    document.getElementById("cfgAboutClass").value = appData.config.aboutClass || "";
    document.getElementById("cfgWaliKelas").value = appData.config.waliKelas || "";
    document.getElementById("cfgWaliTitle").value = appData.config.waliTitle || "";
    document.getElementById("cfgWaliPhotoUrl").value = appData.config.waliPhotoUrl || "";
    document.getElementById("cfgAcademicYear").value = appData.config.academicYear || "";
    document.getElementById("cfgWeeklyFee").value = appData.config.weeklyFee || 5000;
    document.getElementById("cfgFeeStartDate").value = appData.config.feeStartDate || defaultRange.start;
    document.getElementById("cfgFeeEndDate").value = appData.config.feeEndDate || defaultRange.end;
    document.getElementById("cfgPaymentInfo").value = appData.config.paymentInfo || "";
    document.getElementById("cfgMarqueeText").value = appData.config.marqueeText || "";

    syncConfigPreview("cfgClassLogoUrl", "cfgLogoPreviewImg", "cfgLogoPreviewFallback");
    syncConfigPreview("cfgHeroBgUrl", "cfgHeroBgPreviewImg", "cfgHeroBgPreviewFallback");
    syncConfigPreview("cfgWaliPhotoUrl", "cfgWaliPreviewImg", "cfgWaliPreviewFallback");

    renderSemesterArchivesSection();
};

// ============================================================================
// HANDLER CRUD TIAP TAB ADMIN (LANGSUNG TERSIMPAN KE FIREBASE)
// ============================================================================

window.handleQuickMondayRangeUpdate = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("keuangan") && !canEditInCurrentView("pengaturan")) return;
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

window.handleStudentPhotoUpload = function (e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        document.getElementById("admStuPhotoUrl").value = dataUrl;
        updateStudentPhotoPreview(dataUrl);
        showToast("Foto anggota berhasil dimuat!", "bg-neo-mint");
    });
};

window.updateStudentPhotoPreview = function (url) {
    const img = document.getElementById("admStuPhotoPreview");
    const ph = document.getElementById("admStuPhotoPlaceholder");
    applyImageWithFallback(img, ph, url);
};

window.clearStudentPhotoInput = function () {
    document.getElementById("admStuPhotoUrl").value = "";
    const fileEl = document.getElementById("admStuPhotoFile");
    if (fileEl) fileEl.value = "";
    updateStudentPhotoPreview("");
};

window.handleAdminSaveStudent = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("siswa")) return;

    const editId = document.getElementById("admStuEditId").value;
    const absen = Number(document.getElementById("admStuAbsen").value);
    const name = document.getElementById("admStuName").value.trim();
    const gender = document.getElementById("admStuGender").value;
    const phone = document.getElementById("admStuPhone").value.trim();
    const role = document.getElementById("admStuRole").value;
    const piket = document.getElementById("admStuPiket").value;
    const initKas = document.getElementById("admStuInitKas").value;
    const quote = document.getElementById("admStuQuote").value.trim();
    const photoUrl = (document.getElementById("admStuPhotoUrl").value || "").trim();
    const mondays = getMondayDatesList();

    if (editId) {
        const target = appData.students.find((s) => String(s.id) === String(editId));
        if (target) {
            target.absen = absen;
            target.name = name;
            target.gender = gender;
            target.phone = phone;
            target.role = role;
            target.piket = piket;
            target.quote = quote;
            target.photoUrl = photoUrl;
            if (!target.paidDates) target.paidDates = {};
            if (initKas === "ALL_PAID") {
                mondays.forEach((d) => {
                    target.paidDates[d] = true;
                });
            } else if (initKas === "ALL_UNPAID") {
                target.paidDates = {};
            }
        }
    } else {
        const paidDates = {};
        if (initKas === "ALL_PAID") {
            mondays.forEach((d) => {
                paidDates[d] = true;
            });
        }
        appData.students.push({
            id: Date.now(),
            absen,
            name,
            gender,
            phone,
            role,
            piket,
            quote,
            photoUrl,
            paidDates
        });
    }

    appData.students.sort((a, b) => a.absen - b.absen);
    resetStudentForm();
    await saveToCloudDatabase(`Data & foto profil ${name} berhasil disimpan ke Firebase!`);
    renderAdminWorkspace();
};

window.editStudentInAdmin = function (id) {
    const s = appData.students.find((stu) => stu.id === id);
    if (!s) return;
    document.getElementById("admStuEditId").value = s.id;
    document.getElementById("admStuAbsen").value = s.absen;
    document.getElementById("admStuName").value = s.name;
    document.getElementById("admStuGender").value = s.gender || "L";
    document.getElementById("admStuPhone").value = s.phone || "";
    document.getElementById("admStuRole").value = s.role;
    document.getElementById("admStuPiket").value = s.piket;
    document.getElementById("admStuInitKas").value = "KEEP";
    document.getElementById("admStuQuote").value = s.quote || "";
    document.getElementById("admStuPhotoUrl").value = s.photoUrl || "";
    updateStudentPhotoPreview(s.photoUrl || "");
    document.getElementById("admStudentFormTitle").textContent = `Edit Anggota #${s.absen}`;
    document.getElementById("btnCancelEditStudent").classList.remove("hidden");
};

window.resetStudentForm = function () {
    document.getElementById("admStuEditId").value = "";
    document.getElementById("admStuAbsen").value = "";
    document.getElementById("admStuName").value = "";
    document.getElementById("admStuPhone").value = "";
    document.getElementById("admStuInitKas").value = "KEEP";
    document.getElementById("admStuQuote").value = "";
    clearStudentPhotoInput();
    document.getElementById("admStudentFormTitle").textContent = "Form Anggota & Perangkat Kelas";
    document.getElementById("btnCancelEditStudent").classList.add("hidden");
};

window.deleteStudentInAdmin = async function (id) {
    if (!canEditInCurrentView("siswa")) return;
    appData.students = appData.students.filter((s) => s.id !== id);
    await saveToCloudDatabase("Data anggota telah dihapus dari Firebase.");
    renderAdminWorkspace();
};

window.handleAdminSaveInfo = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("info")) return;

    const editId = document.getElementById("admInfoEditId").value;
    const payload = {
        id: editId ? Number(editId) : Date.now(),
        category: document.getElementById("admInfoCat").value,
        deadline: document.getElementById("admInfoDeadline").value.trim(),
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
    await saveToCloudDatabase("Informasi berhasil dipublikasikan ke Firebase!");
    renderAdminWorkspace();
};

window.editAnnouncement = function (id) {
    const a = appData.announcements.find((item) => item.id === id);
    if (!a) return;
    document.getElementById("admInfoEditId").value = a.id;
    document.getElementById("admInfoCat").value = a.category;
    document.getElementById("admInfoDeadline").value = a.deadline;
    document.getElementById("admInfoTitle").value = a.title;
    document.getElementById("admInfoBody").value = a.body;
    document.getElementById("admInfoFormTitle").textContent = "Edit Pengumuman / Tugas";
    document.getElementById("btnCancelEditInfo").classList.remove("hidden");
};

window.resetInfoForm = function () {
    document.getElementById("admInfoEditId").value = "";
    document.getElementById("admInfoDeadline").value = "";
    document.getElementById("admInfoTitle").value = "";
    document.getElementById("admInfoBody").value = "";
    document.getElementById("admInfoFormTitle").textContent = "Buat Pengumuman / Tugas";
    document.getElementById("btnCancelEditInfo").classList.add("hidden");
};

window.deleteAnnouncement = async function (id) {
    if (!canEditInCurrentView("info")) return;
    appData.announcements = appData.announcements.filter((a) => a.id !== id);
    await saveToCloudDatabase("Pengumuman dihapus.");
    renderAdminWorkspace();
};

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
            if (Array.isArray(appData.schedule[editDay])) {
                appData.schedule[editDay].splice(idxNum, 1);
            }
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

// --- CRUD Akun Pengurus & Ganti Sandi ---
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
        ? ["keuangan", "absensi", "siswa", "info", "jadwal", "album", "pengaturan", "akun"]
        : (target.permissions || []);

    document.querySelectorAll('input[name="admPerm"]').forEach((cb) => {
        cb.checked = perms.includes(cb.value);
    });

    const titleEl = document.getElementById("admAccFormTitle");
    if (titleEl) titleEl.textContent = `Edit / Ganti Sandi: ${target.username}`;
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
    if (titleEl) titleEl.textContent = "Buat / Ganti Sandi Akun Pengurus";
    document.getElementById("btnCancelEditAcc")?.classList.add("hidden");
};

window.handleAdminSaveAccount = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("akun")) return;

    const origUser = (document.getElementById("admAccEditOriginalUser")?.value || "").trim().toLowerCase();
    const username = document.getElementById("admAccUsername").value.trim().toLowerCase();
    const password = document.getElementById("admAccPassword").value;
    const name = document.getElementById("admAccName").value.trim();
    const role = document.getElementById("admAccRole").value.trim();

    const checkedPerms = Array.from(document.querySelectorAll('input[name="admPerm"]:checked')).map((cb) => cb.value);
    if (checkedPerms.length === 0) {
        showToast("Pilih minimal 1 modul hak akses!", "bg-neo-coral");
        return;
    }

    if (checkedPerms.includes("siswa") && !checkedPerms.includes("absensi")) {
        checkedPerms.push("absensi");
    }

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

    if (existingIdx >= 0) {
        appData.admins[existingIdx] = accountObj;
    } else {
        appData.admins.push(accountObj);
    }

    externalFirebaseAdmins = mergeAdminArrays(externalFirebaseAdmins, [accountObj]);

    if (currentAdmin && (String(currentAdmin.username).toLowerCase() === username || String(currentAdmin.username).toLowerCase() === origUser)) {
        currentAdmin = accountObj;
    }

    await saveAdminAccountToCloud(accountObj);
    resetAdminAccountForm();
    await saveToCloudDatabase(`Akun & sandi pengurus "${username}" berhasil disimpan ke Firebase!`);
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
    appData.config.classMotto = document.getElementById("cfgClassMotto").value.trim() || "Together We Grow, Together We Heal";
    appData.config.classLogoUrl = document.getElementById("cfgClassLogoUrl").value.trim();
    appData.config.heroBgUrl = document.getElementById("cfgHeroBgUrl").value.trim() || DEFAULT_HERO_BG;
    appData.config.welcomeTypingText = document.getElementById("cfgWelcomeTypingText").value.trim();
    appData.config.heroSubtitle = document.getElementById("cfgHeroSubtitle").value.trim();
    appData.config.aboutClass = document.getElementById("cfgAboutClass").value.trim();
    appData.config.waliKelas = document.getElementById("cfgWaliKelas").value.trim();
    appData.config.waliTitle = document.getElementById("cfgWaliTitle").value.trim();
    appData.config.waliPhotoUrl = document.getElementById("cfgWaliPhotoUrl").value.trim();
    appData.config.academicYear = document.getElementById("cfgAcademicYear").value.trim();
    appData.config.weeklyFee = Number(document.getElementById("cfgWeeklyFee").value) || 0;
    appData.config.feeStartDate = start;
    appData.config.feeEndDate = end;
    appData.config.paymentInfo = document.getElementById("cfgPaymentInfo").value.trim();
    appData.config.marqueeText = document.getElementById("cfgMarqueeText").value.trim();

    currentTypedGoal = "";
    await saveToCloudDatabase("Identitas Kelas, Logo, Foto Latar & Wali Kelas berhasil disimpan ke Firebase!");
    renderAdminWorkspace();
};

// ============================================================================
// EKSPOR LAPORAN SHEET RESMI (.XLS & .CSV)
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

    const excelHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:Arial,sans-serif;font-size:11pt;">
            <table style="border-collapse:collapse;width:100%;margin-bottom:18px;">
                <tr>
                    <td colspan="${totalColumns}" style="background-color:#111111;color:#FFE600;font-size:16pt;font-weight:bold;padding:12px;text-align:center;border:2px solid #111111;">
                        LAPORAN RESMI REKAPITULASI IURAN & BUKU KAS KELAS ${cfg.className || "MEDIVANCE"}
                    </td>
                </tr>
                <tr>
                    <td colspan="${totalColumns}" style="background-color:#FFE600;color:#111111;font-size:11pt;font-weight:bold;padding:6px;text-align:center;border:2px solid #111111;">
                        MOTTO KELAS: "${cfg.classMotto || "Together We Grow, Together We Heal"}" • ${(cfg.semesterName || "SEMESTER GANJIL").toUpperCase()}
                    </td>
                </tr>
                <tr>
                    <td colspan="3" style="padding:6px;border:1px solid #111;font-weight:bold;background-color:#F4EFE6;">Nama Kelas</td>
                    <td colspan="${Math.max(2, totalColumns - 3)}" style="padding:6px;border:1px solid #111;">${cfg.className} (${cfg.classCode})</td>
                </tr>
                <tr>
                    <td colspan="3" style="padding:6px;border:1px solid #111;font-weight:bold;background-color:#F4EFE6;">Wali Kelas</td>
                    <td colspan="${Math.max(2, totalColumns - 3)}" style="padding:6px;border:1px solid #111;">${cfg.waliKelas || "-"} (${cfg.waliTitle || "Wali Kelas"})</td>
                </tr>
                <tr>
                    <td colspan="3" style="padding:6px;border:1px solid #111;font-weight:bold;background-color:#F4EFE6;">Periode & Tahun Ajaran</td>
                    <td colspan="${Math.max(2, totalColumns - 3)}" style="padding:6px;border:1px solid #111;">${cfg.semesterName || "Semester Ganjil"} • TA ${cfg.academicYear} • Periode Senin: ${mondays[0]} s/d ${mondays[mondays.length - 1]} (${mondays.length} Pekan @ ${formatRupiah(stats.fee)})</td>
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
    showToast("File Sheet Resmi (.xls) berhasil diunduh!", "bg-neo-yellow");
};

window.exportIuranCSV = function () {
    const cfg = appData.config;
    const stats = calculateFinancialSummary();
    const mondays = stats.mondayDates;
    const nowStr = new Date().toLocaleDateString("id-ID");

    const topHeaderRows = [
        `"LAPORAN RESMI REKAPITULASI IURAN KAS KELAS ${(cfg.className || "MEDIVANCE").toUpperCase()}"`,
        `"Motto Kelas:","${cfg.classMotto || "Together We Grow, Together We Heal"}"`,
        `"Wali Kelas:","${cfg.waliKelas || "-"}","Periode:","${cfg.semesterName || "Semester Ganjil"} TA ${cfg.academicYear || "-"}"`,
        `"Periode Kas:","${mondays[0]} s/d ${mondays[mondays.length - 1]} (${mondays.length} Hari Senin)","Tarif / Senin:","${formatRupiah(stats.fee)}"`,
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
        `"BUKU MUTASI KAS RESMI KELAS ${(cfg.className || "MEDIVANCE").toUpperCase()}"`,
        `"Motto Kelas:","${cfg.classMotto || "Together We Grow, Together We Heal"}"`,
        `"Wali Kelas:","${cfg.waliKelas || "-"}","Periode:","${cfg.semesterName || "Semester Ganjil"} TA ${cfg.academicYear || "-"}"`,
        `"Saldo Aktif:","${formatRupiah(stats.currentBalance)}","Total Pemasukan:","${formatRupiah(stats.totalIncome)}","Total Pengeluaran:","${formatRupiah(stats.totalExpense)}","Tanggal Unduh:","${nowStr}"`,
        `""`
    ];

    const headers = ["Tanggal", "Jenis", "Kategori", "Keterangan", "Penanggung_Jawab", "Nominal"];
    const rows = [
        `"AKUMULASI","MASUK","Iuran Hari Senin","Akumulasi Iuran Mingguan Anggota (${stats.totalPaidWeeks} Senin Lunas)","Bendahara Kelas",${stats.totalIuranPaid}`,
        ...appData.transactions.map((t) =>
            [t.date, t.type, `"${t.category}"`, `"${t.desc}"`, `"${t.pic}"`, t.amount].join(",")
        )
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
    renderHeaderAndHeroIdentity();
    renderDashboard();
    renderIuranMatrix();
    renderLedgerTable();
    renderPublicAttendanceView();
    renderStickyNotesWall();
    renderInfoBoard();
    renderScheduleAndPiket();
    renderAlbumGallery();
    renderStudentDirectory();
    if (activeWorkspace === "admin" && currentAdmin) {
        renderAdminWorkspace();
    }
    setTimeout(initScrollRevealObserver, 50);
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
    // 1. Bersihkan sisa cache data localStorage lama agar 100% menggunakan Cloud Firebase
    try {
        localStorage.removeItem("medivance_portal_state_v3");
    } catch (e) {}

    // 2. Suntikkan pembaruan UI (Absensi Digital, Drawer Titik Tiga Admin, Ganti Sandi & Semester Baru)
    upgradeDOMStructure();

    // 3. Terapkan preferensi tema Gelap/Terang
    try {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === "1") applyThemeState(true);
    } catch (e) {}

    // 4. Set tanggal lokal hari ini pada seluruh input tanggal
    const todayIso = toLocalISODate(new Date());
    ["admTxDate", "admAlbumDate", "admAttendanceDateInput", "publicAttendanceDateInput"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = todayIso;
    });

    syncScheduleTimeRange();
    updateClock();
    setInterval(updateClock, 30000);
    updateWorkspaceVisibility();

    // 5. Hubungkan secara real-time ke Cloud Firebase (Firestore Multi-Chunk + RTDB)
    initCloudSynchronization({
        onStateReceived: (incomingState, updatedAt) => {
            if (updatedAt && updatedAt === lastAppliedTimestamp) return;
            if (updatedAt) lastAppliedTimestamp = updatedAt;

            isApplyingRemoteUpdate = true;
            appData = mergeWithDefaults(incomingState);
            renderAllViews();
            isApplyingRemoteUpdate = false;
        },
        onAdminsReceived: (adminList) => {
            externalFirebaseAdmins = mergeAdminArrays(externalFirebaseAdmins, adminList);
            if (activeWorkspace === "admin") renderAdminWorkspace();
        }
    });
});