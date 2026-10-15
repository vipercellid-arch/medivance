// ============================================================================
// ADMIN.JS — MESIN WORKSPACE PENGURUS, BATCH SAVE KAS, RBAC & ARSIP SEMESTER
// ============================================================================

import {
    saveAdminAccountToCloud,
    deleteAdminAccountFromCloud,
    fetchAllAdminsFromCloud,
    loginWithFirebaseAuth,
    logoutFirebaseSession
} from "./firebase.js";

import {
    portalState,
    ADMIN_SESSION_STORAGE_KEY,
    DEFAULT_HERO_BG,
    defaultRange,
    toLocalISODate,
    toLocalISOMonth,
    mergeAdminArrays,
    getAllCombinedAdmins,
    hasAdminPermission,
    canEditInCurrentView,
    saveToCloudDatabase,
    cleanExpiredTaskPhotos,
    updateWorkspaceVisibility,
    readImageFileInstantly,
    applyImageWithFallback,
    getMondayDatesList,
    getSixSchoolDaysOfWeek,
    formatShortMondayLabel,
    formatMonthTitle,
    ensureStudentPaidDatesMigrated,
    formatRupiah,
    calculateFinancialSummary,
    calculateStudentAttendanceStats,
    renderAvatarHtml,
    showToast
} from "./user.js";

// ============================================================================
// 1. HAK AKSES PERIODE KAS & SESI LOGIN PERSISTEN (ANTI-LOGOUT SAAT REFRESH)
// ============================================================================

function canModifyMondayPeriod() {
    const adm = portalState.currentAdmin;
    if (!adm || portalState.activeWorkspace !== "admin") return false;
    if (adm.isSuperAdmin) return true;
    const perms = Array.isArray(adm.permissions) ? adm.permissions : [];
    return perms.includes("atur_periode_kas") || perms.includes("pengaturan") || perms.includes("akun");
}

window.saveAdminSessionToStorage = function () {
    const adm = portalState.currentAdmin;
    if (!adm) {
        try { localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY); } catch (e) {}
        return;
    }
    try {
        localStorage.setItem(
            ADMIN_SESSION_STORAGE_KEY,
            JSON.stringify({
                username: adm.username,
                password: adm.password,
                activeAdminSectionId: portalState.activeAdminSectionId || "adm-beranda",
                activeWorkspace: portalState.activeWorkspace === "preview" ? "preview" : "admin",
                savedAt: Date.now()
            })
        );
    } catch (e) {}
};

window.restoreAdminSessionFromStorage = function () {
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
            portalState.currentAdmin = matched;
            portalState.activeAdminSectionId = parsed.activeAdminSectionId || "adm-beranda";
            portalState.activeWorkspace = parsed.activeWorkspace === "preview" ? "preview" : "admin";
            setupAdminSessionTabs(portalState.activeAdminSectionId);
            updateWorkspaceVisibility();
            return true;
        }
    } catch (e) {}
    return false;
};

// ============================================================================
// 2. OTENTIKASI LOGIN INSTAN (ANONYMOUS AUTH) & MENU DRAWER TITIK TIGA ADMIN
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

    const emailCandidate = rawInput.includes("@") ? rawInput : `${rawInput}@kelas.id`;
    const inputNameOnly = rawInput.split("@")[0];

    const findMatchingAdmin = () => {
        const allAdmins = getAllCombinedAdmins();
        return allAdmins.find((a) => {
            const u = String(a.username || "").trim().toLowerCase();
            const em = String(a.email || "").trim().toLowerCase();
            const unameOnly = u.split("@")[0];
            const usernameMatch = u === rawInput || em === rawInput || u === emailCandidate || unameOnly === inputNameOnly;
            return usernameMatch && String(a.password) === String(passwordInput);
        });
    };

    // 1. Cek langsung di memori yang sudah tersinkronisasi (Instan < 0.05 detik)
    let authenticatedProfile = findMatchingAdmin();

    // 2. Jika belum ketemu di memori, tarik paralel cepat dari Cloud
    if (!authenticatedProfile) {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fa-solid fa-bolt fa-spin"></i> Memverifikasi Cepat...`;
        }
        try {
            const freshCloudAdmins = await fetchAllAdminsFromCloud();
            if (freshCloudAdmins.length > 0) {
                portalState.externalFirebaseAdmins = mergeAdminArrays(portalState.externalFirebaseAdmins, freshCloudAdmins);
            }
            authenticatedProfile = findMatchingAdmin();
        } catch (err) {}

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Masuk ke Workspace Pengurus`;
        }
    }

    if (!authenticatedProfile) {
        showToast("Username/Email atau Password tidak sesuai!", "bg-neo-coral");
        return;
    }

    loginWithFirebaseAuth();

    portalState.currentAdmin = authenticatedProfile;
    e.target.reset();
    portalState.activeWorkspace = "admin";
    setupAdminSessionTabs("adm-beranda");
    window.saveAdminSessionToStorage();
    updateWorkspaceVisibility();
    showToast(`Selamat datang kembali, ${authenticatedProfile.name}!`, "bg-neo-mint");
};

window.logoutAdmin = async function () {
    portalState.currentAdmin = null;
    portalState.pendingIuranChanges = {};
    try { localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY); } catch (e) {}
    await logoutFirebaseSession();
    const loginText = document.getElementById("drawerAdminLoginText");
    if (loginText) loginText.textContent = "Login Pengurus Kelas";
    portalState.activeWorkspace = "user";
    updateWorkspaceVisibility();
    showToast("Anda telah keluar dari Workspace Pengurus.", "bg-neo-yellow");
};

function setupAdminSessionTabs(preferredTab = "adm-beranda") {
    const adm = portalState.currentAdmin;
    if (!adm) return;

    const loginTxt = document.getElementById("drawerAdminLoginText");
    if (loginTxt) loginTxt.textContent = `Workspace (${adm.name.split(" ")[0]})`;

    const sessName = document.getElementById("adminSessionName");
    if (sessName) sessName.textContent = adm.name;

    const sessRole = document.getElementById("adminSessionRole");
    if (sessRole) sessRole.textContent = adm.role;

    const drawerTitle = document.getElementById("drawerAdminUserTitle");
    const drawerRole = document.getElementById("drawerAdminRoleBadge");
    if (drawerTitle) drawerTitle.textContent = adm.name;
    if (drawerRole) drawerRole.textContent = adm.role.toUpperCase();

    document.querySelectorAll("#adminDrawerNavList .admin-nav-btn").forEach((btn) => {
        const perm = btn.dataset.perm;
        if (hasAdminPermission(perm)) {
            btn.classList.remove("hidden");
        } else {
            btn.classList.add("hidden");
        }
    });

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

    const targetTab = hasAdminPermission(permMap[preferredTab] || "beranda") ? preferredTab : "adm-beranda";
    window.switchAdminTab(targetTab);
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
    window.toggleAdminDrawer(false);
    window.switchAdminTab(sectionId);
};

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
        "adm-info": "4. TUGAS, WA & NGL",
        "adm-jadwal": "5. JADWAL & PILIH JAM",
        "adm-album": "6. GALERI ALBUM",
        "adm-akun": "7. AKUN & HAK AKSES",
        "adm-pengaturan": "8. IDENTITAS, SLIDE & LIBUR"
    };

    if (!hasAdminPermission(permMap[sectionId])) {
        showToast("Jabatan akun Anda tidak memiliki izin untuk membuka modul ini.", "bg-neo-coral");
        return;
    }

    portalState.activeAdminSectionId = sectionId;
    window.saveAdminSessionToStorage();

    document.querySelectorAll(".admin-section").forEach((sec) => sec.classList.add("hidden"));
    document.getElementById(sectionId)?.classList.remove("hidden");

    document.querySelectorAll("#adminDrawerNavList .admin-nav-btn").forEach((btn) => {
        if (btn.id === `admdrawer-${sectionId}`) btn.classList.add("active");
        else btn.classList.remove("active");
    });

    const indicator = document.getElementById("activeAdminTabIndicator");
    if (indicator) indicator.textContent = tabTitles[sectionId] || "MODUL AKTIF";

    window.renderAdminWorkspace();
    window.scrollTo({ top: 0, behavior: "smooth" });
};

// ============================================================================
// 3. RENDER BERANDA ADMIN & SELURUH TAB MODUL WORKSPACE PENGURUS
// ============================================================================

function updateBatchIuranIndicatorUI() {
    const pendingKeys = Object.keys(portalState.pendingIuranChanges || {});
    const count = pendingKeys.length;
    const badge = document.getElementById("unsavedIuranBadge");
    const discardBtn = document.getElementById("btnDiscardBatchIuran");
    const commitBtn = document.getElementById("btnCommitBatchIuran");

    if (badge) {
        badge.textContent = `${count} Perubahan Belum Disimpan`;
        badge.classList.toggle("hidden", count === 0);
    }
    if (discardBtn) {
        discardBtn.classList.toggle("hidden", count === 0);
    }
    if (commitBtn) {
        if (count > 0) {
            commitBtn.className = "neo-btn bg-neo-yellow text-neo-ink px-3.5 py-2 text-xs ring-2 ring-neo-ink";
            commitBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Simpan ${count} Perubahan Kas`;
        } else {
            commitBtn.className = "neo-btn bg-neo-mint text-neo-ink px-3.5 py-2 text-xs";
            commitBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Update & Simpan Iuran`;
        }
    }
}

function renderAdminHomeSection(stats) {
    const appData = portalState.appData;
    const cfg = appData.config;
    const semBadge = document.getElementById("admHomeSemesterBadge");
    if (semBadge) semBadge.textContent = `${cfg.semesterName || "Semester Ganjil"} • TA ${cfg.academicYear || "2026/2027"}`;

    const welcomeEl = document.getElementById("admHomeWelcomeTitle");
    if (welcomeEl && portalState.currentAdmin) {
        welcomeEl.textContent = `Halo, ${portalState.currentAdmin.name} (${portalState.currentAdmin.role})!`;
    }

    const allModules = [
        { id: "adm-keuangan", perm: "keuangan", icon: "fa-coins", bg: "bg-neo-mint", title: "1. Kas & Pelunasan Senin", desc: `Saldo: ${formatRupiah(stats.currentBalance)} • Kepatuhan ${stats.complianceRatio}%` },
        { id: "adm-absensi", perm: "absensi", icon: "fa-clipboard-user", bg: "bg-neo-lime", title: "2. Absensi Digital (H/M/B)", desc: `${Object.keys(appData.attendance || {}).length} Hari Kehadiran Tercatat` },
        { id: "adm-siswa", perm: "siswa", icon: "fa-user-graduate", bg: "bg-neo-sky", title: "3. Master Data Anggota", desc: `${appData.students.length} Anggota & ID Card` },
        { id: "adm-info", perm: "info", icon: "fa-bullhorn", bg: "bg-neo-yellow", title: "4. Tugas, WA & NGL", desc: `${appData.announcements.length} Tugas • ${(appData.stickyNotes || []).length} Pesan Mading/NGL` },
        { id: "adm-jadwal", perm: "jadwal", icon: "fa-calendar-days", bg: "bg-neo-pink", title: "5. Jadwal & Pilih Jam", desc: "Susunan Mapel Senin s/d Sabtu" },
        { id: "adm-album", perm: "album", icon: "fa-camera-retro", bg: "bg-neo-orange", title: "6. Galeri Album Kelas", desc: `${appData.albums.length} Dokumentasi Tersimpan` },
        { id: "adm-akun", perm: "akun", icon: "fa-users-gear", bg: "surface-card", title: "7. Akun & Hak Akses RBAC", desc: `${getAllCombinedAdmins().length} Akun Pengurus Terdaftar` },
        { id: "adm-pengaturan", perm: "pengaturan", icon: "fa-sliders", bg: "bg-neo-surface", title: "8. Identitas, Slide & Libur", desc: `${(cfg.holidays || []).length} Hari Libur • ${(appData.archives || []).length} Arsip Semester` }
    ];

    const quickGrid = document.getElementById("admHomeQuickModulesGrid");
    if (quickGrid) {
        const accessible = allModules.filter((m) => hasAdminPermission(m.perm));
        quickGrid.innerHTML = accessible
            .map(
                (m) => `
                <div onclick="switchAdminTab('${m.id}')" class="cursor-pointer neo-card neo-card-hover ${m.bg} p-4 flex flex-col justify-between space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="w-10 h-10 rounded-xl bg-white text-neo-ink border-2 border-neo-ink flex items-center justify-center font-extrabold text-base shadow-neo-sm">
                            <i class="fa-solid ${m.icon}"></i>
                        </span>
                        <span class="font-mono text-[10px] font-extrabold bg-white text-neo-ink border border-neo-ink px-2 py-0.5 rounded">BUKA →</span>
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
    const activeNglCount = (appData.stickyNotes || []).filter((n) => n.isNgl).length;
    const storageBox = document.getElementById("admHomeStorageAndHolidayBox");
    if (storageBox) {
        storageBox.innerHTML = `
            <div class="flex items-center justify-between bg-neo-surface border-2 border-neo-ink rounded-lg p-2.5">
                <span><i class="fa-solid fa-image text-neo-violet mr-1.5"></i> Lampiran Foto Tugas Aktif:</span>
                <strong class="font-mono">${activeTaskPhotos} Foto</strong>
            </div>
            <div class="flex items-center justify-between bg-neo-surface border-2 border-neo-ink rounded-lg p-2.5">
                <span><i class="fa-solid fa-user-secret text-pink-500 mr-1.5"></i> Pesan NGL Anonim (24 Jam):</span>
                <strong class="font-mono">${activeNglCount} NGL Aktif</strong>
            </div>
        `;
    }
}

window.renderAdminWorkspace = function () {
    if (!portalState.currentAdmin) return;
    const appData = portalState.appData;
    const stats = calculateFinancialSummary();
    const mondays = stats.mondayDates;

    document.getElementById("admStatBalance").textContent = formatRupiah(stats.currentBalance);
    document.getElementById("admStatStudents").textContent = `${appData.students.length} Anggota`;
    document.getElementById("admStatCompliance").textContent = `${stats.complianceRatio}%`;
    document.getElementById("admStatMondays").textContent = `${mondays.length} Senin`;
    document.getElementById("admStatInfo").textContent = `${appData.announcements.length} Info`;
    document.getElementById("admStatSticky").textContent = `${(appData.stickyNotes || []).length} Pesan`;

    renderAdminHomeSection(stats);
    updateBatchIuranIndicatorUI();

    // Kunci Periode Senin untuk Bendahara Operasional
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

    // 1. Matriks Kontrol Pelunasan Kas Siswa (Header Tanggal Vertikal + Batch Save)
    const admHead = document.getElementById("admIuranMatrixHead");
    const admBody = document.getElementById("admIuranMatrixBody");
    const admSearch = (document.getElementById("admIuranSearchInput")?.value || "").toLowerCase();

    if (admHead && admBody) {
        const weekCols = mondays
            .map(
                (d) => `
                <th class="py-2 px-1 border-r-2 border-neutral-700 text-center w-11">
                    <div class="writing-vertical mx-auto font-mono text-[10px] tracking-tighter leading-none py-1">
                        <span class="text-neo-yellow block mb-1">SEN</span>
                        <span>${formatShortMondayLabel(d)}</span>
                    </div>
                </th>`
            )
            .join("");

        admHead.innerHTML = `
            <tr>
                <th class="py-2 px-2 border-r-2 border-neutral-700 text-center w-10">No</th>
                <th class="py-2 px-3 border-r-2 border-neutral-700 min-w-[165px]">Nama Anggota</th>
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
                                    const isPending = Object.prototype.hasOwnProperty.call(
                                        portalState.pendingIuranChanges || {},
                                        `${stu.id}_${dateStr}`
                                    );
                                    return `
                                        <td class="p-1 border-r-2 border-neo-ink text-center">
                                            <button
                                                type="button"
                                                onclick="toggleStudentMondayDate(${stu.id}, '${dateStr}')"
                                                title="Senin, ${dateStr}"
                                                class="w-full py-1 px-1 rounded border ${isPending ? "border-2 border-neo-violet ring-2 ring-neo-yellow" : "border-neo-ink"} font-mono text-[10px] font-extrabold ${paid ? "bg-neo-lime text-neo-ink" : "bg-rose-200 text-rose-900"}"
                                            >
                                                ${paid ? "✓" : "✕"}
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
        admLedger.innerHTML = appData.transactions.length === 0
            ? `<tr><td colspan="4" class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada transaksi kas.</td></tr>`
            : [...appData.transactions]
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

    // 2. Render Absensi Digital Admin
    renderAdminAttendanceSection();

    // 3. Tabel Daftar Master Anggota
    document.getElementById("admStuTotalBadge").textContent = `${appData.students.length} Anggota`;
    const stuBody = document.getElementById("admStudentListBody");
    if (stuBody) {
        stuBody.innerHTML = appData.students.length === 0
            ? `<tr><td colspan="6" class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada anggota terdaftar.</td></tr>`
            : appData.students
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

    // 4. Pengumuman Berfoto, Link WA & Moderasi Papan Tempel / NGL 24 Jam
    const admInfoBox = document.getElementById("admInfoListContainer");
    if (admInfoBox) {
        admInfoBox.innerHTML = appData.announcements.length === 0
            ? `<div class="py-6 text-center text-xs font-bold text-muted-adaptive">Belum ada pengumuman aktif.</div>`
            : appData.announcements
                .map(
                    (a) => `
                    <div class="border-2 border-neo-ink rounded-lg p-3 flex items-center justify-between gap-3 bg-neo-bg">
                        <div class="flex items-center gap-3 min-w-0">
                            ${a.photoUrl ? `<img src="${a.photoUrl}" alt="Foto" class="w-12 h-12 rounded border border-neo-ink object-cover shrink-0">` : ""}
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="neo-badge bg-neo-yellow text-neo-ink text-[10px]">${a.category} • ${a.deadline}</span>
                                    ${a.waLink ? `<span class="neo-badge bg-neo-lime text-neo-ink text-[9px]"><i class="fa-brands fa-whatsapp"></i> Link WA</span>` : ""}
                                    ${a.expireAt ? `<span class="font-mono text-[9px] surface-card border border-neo-ink px-1.5 py-0.5 rounded text-rose-500">Hapus Foto: ${a.expireAt.replace("T", " ")}</span>` : ""}
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

    const admStickyBox = document.getElementById("admStickyListContainer");
    const stickyBadge = document.getElementById("admStickyCountBadge");
    const notes = appData.stickyNotes || [];
    if (stickyBadge) stickyBadge.textContent = `${notes.length} Pesan`;
    if (admStickyBox) {
        admStickyBox.innerHTML = notes.length === 0
            ? `<div class="col-span-full py-4 text-center text-xs font-bold text-muted-adaptive">Belum ada tempelan kertas atau pesan NGL.</div>`
            : notes
                .map(
                    (n) => `
                    <div style="background-color: ${n.isNgl ? "#9B5DE5" : (n.color || "#FFE600")}" class="border-2 border-neo-ink rounded-lg p-3 flex items-start justify-between gap-2 text-xs ${n.isNgl ? "text-white" : "text-neo-ink"}">
                        <div class="min-w-0">
                            <span class="font-mono text-[10px] font-extrabold bg-white text-neo-ink px-1.5 py-0.5 rounded border border-neo-ink">
                                ${n.isNgl ? "🕵️ NGL ANONIM" : n.author} • ${n.date || ""}
                            </span>
                            <p class="font-bold mt-1.5 break-words">"${n.message}"</p>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            ${
                                n.isNgl
                                    ? `<button type="button" onclick="downloadNglStoryImage(${n.id})" class="neo-btn bg-neo-yellow text-neo-ink px-2 py-1 text-[10px]" title="Unduh Kartu Story IG"><i class="fa-brands fa-instagram"></i></button>`
                                    : ""
                            }
                            <button type="button" onclick="deleteStickyNote(${n.id})" class="neo-btn bg-white text-rose-700 px-2 py-1 text-[10px]" title="Hapus">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
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
                                <div class="surface-card border border-neo-ink rounded p-2.5 flex items-center justify-between gap-2 text-xs">
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
                            ${String(acc.username).toLowerCase() === String(portalState.currentAdmin.username).toLowerCase() ? `<span class="neo-badge bg-neo-mint text-neo-ink text-[10px]">Sedang Login</span>` : ""}
                        </div>
                        <div class="text-[11px] font-mono text-muted-adaptive mt-1.5 flex flex-wrap items-center gap-2">
                            <span>Sandi: <strong class="bg-neo-surface px-1.5 py-0.5 rounded border border-neo-ink text-main-adaptive">${acc.password || "(Kosong)"}</strong></span>
                            <span>•</span>
                            <span>Akses: ${acc.isSuperAdmin ? "SUPER ADMIN (PENUH)" : (acc.permissions || []).filter((p) => p !== "beranda").join(", ")}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button type="button" onclick="editAdminAccount('${acc.username}')" class="neo-btn bg-neo-yellow text-neo-ink px-2.5 py-1.5 text-xs">
                            <i class="fa-solid fa-key"></i> Edit / Hak Akses
                        </button>
                        ${
                            String(acc.username).toLowerCase() !== String(portalState.currentAdmin.username).toLowerCase()
                                ? `<button type="button" onclick="deleteAdminAccount('${acc.username}')" class="neo-btn bg-rose-200 text-rose-900 px-2.5 py-1.5 text-xs"><i class="fa-solid fa-trash"></i></button>`
                                : ""
                        }
                    </div>
                </div>
            `
            )
            .join("");
    }

    // 8. Isi Form Pengaturan Kelas, Slideshow 3 Foto, Saluran WA & Hari Libur
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

    const bg2El = document.getElementById("cfgHeroBgUrl2");
    const bg3El = document.getElementById("cfgHeroBgUrl3");
    if (bg2El) bg2El.value = cfg.heroBgUrl2 || "";
    if (bg3El) bg3El.value = cfg.heroBgUrl3 || "";

    document.getElementById("cfgWelcomeTypingText").value = cfg.welcomeTypingText || "SELAMAT DATANG DI MEDIVANCE";
    document.getElementById("cfgHeroSubtitle").value = cfg.heroSubtitle || "";
    document.getElementById("cfgAboutClass").value = cfg.aboutClass || "";
    document.getElementById("cfgMarqueeText").value = cfg.marqueeText || "";

    const igEl = document.getElementById("cfgSocialIg");
    const ttEl = document.getElementById("cfgSocialTiktok");
    const emEl = document.getElementById("cfgSocialEmail");
    const waEl = document.getElementById("cfgWaChannelUrl");
    if (igEl) igEl.value = cfg.socialIg || "@medivance.class";
    if (ttEl) ttEl.value = cfg.socialTiktok || "@medivance.official";
    if (emEl) emEl.value = cfg.socialEmail || "medivance@kelas.id";
    if (waEl) waEl.value = cfg.waChannelUrl || "";

    document.getElementById("cfgWaliKelas").value = cfg.waliKelas || "";
    document.getElementById("cfgWaliTitle").value = cfg.waliTitle || "";
    document.getElementById("cfgWaliPhotoUrl").value = cfg.waliPhotoUrl || "";
    document.getElementById("cfgWeeklyFee").value = cfg.weeklyFee || 5000;
    document.getElementById("cfgFeeStartDate").value = cfg.feeStartDate || defaultRange.start;
    document.getElementById("cfgFeeEndDate").value = cfg.feeEndDate || defaultRange.end;
    document.getElementById("cfgPaymentInfo").value = cfg.paymentInfo || "";

    window.syncConfigPreview("cfgWebsiteLogoUrl", "cfgWebLogoPreviewImg", "cfgWebLogoPreviewFallback");
    window.syncConfigPreview("cfgClassLogoUrl", "cfgLogoPreviewImg", "cfgLogoPreviewFallback");
    window.syncConfigPreview("cfgSchoolLogoUrl", "cfgSchoolLogoPreviewImg", "cfgSchoolLogoPreviewFallback");
    window.syncConfigPreview("cfgHeroBgUrl", "cfgHeroBgPreviewImg", "cfgHeroBgPreviewFallback");
    window.syncConfigPreview("cfgWaliPhotoUrl", "cfgWaliPreviewImg", "cfgWaliPreviewFallback");

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
                        <button type="button" onclick="deleteCustomHoliday(${h.id})" class="text-rose-500 hover:underline text-[11px] font-extrabold">Hapus</button>
                    </div>
                `
                )
                .join("");
    }

    renderSemesterArchivesSection();
};

// ============================================================================
// 4. MODUL 1 & 2: KEUANGAN KAS (BATCH SAVE ANTI-LEMOT) & ABSENSI DIGITAL
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

    portalState.appData.config.feeStartDate = start;
    portalState.appData.config.feeEndDate = end;
    portalState.appData.config.weeklyFee = fee;

    const count = getMondayDatesList().length;
    await saveToCloudDatabase(`Periode ${count} pekan hari Senin berhasil disimpan ke Firebase!`);
    window.renderAdminWorkspace();
};

/**
 * Ketika tombol tanggal Senin diklik di tabel Admin, perubahan langsung diterapkan di memori (0ms)
 * dan ditampung dalam `pendingIuranChanges` agar tidak lemot saat mencentang banyak siswa sekaligus.
 */
window.toggleStudentMondayDate = async function (studentId, dateStr) {
    if (!canEditInCurrentView("keuangan")) {
        showToast("Perubahan status kas hanya dapat dilakukan di dalam Panel Admin!", "bg-neo-coral");
        return;
    }
    const student = portalState.appData.students.find((s) => s.id === studentId);
    if (!student) return;
    if (!student.paidDates || typeof student.paidDates !== "object") student.paidDates = {};

    if (!portalState.pendingIuranChanges) portalState.pendingIuranChanges = {};
    const changeKey = `${studentId}_${dateStr}`;
    const prevValue = Boolean(student.paidDates[dateStr]);

    // Simpan nilai awal sebelum diedit agar bisa di-Batal (Discard)
    if (!Object.prototype.hasOwnProperty.call(portalState.pendingIuranChanges, changeKey)) {
        portalState.pendingIuranChanges[changeKey] = {
            studentId,
            dateStr,
            originalPaid: prevValue
        };
    } else if (portalState.pendingIuranChanges[changeKey].originalPaid === !prevValue) {
        // Jika dikembalikan ke nilai semula, hapus dari antrean perubahan
        delete portalState.pendingIuranChanges[changeKey];
    }

    student.paidDates[dateStr] = !prevValue;

    // Render ulang tampilan lokal secara instan tanpa menunggu jaringan
    window.renderAdminWorkspace();
    window.renderIuranMatrix();
    if (portalState.selectedStudentIdForCard === studentId) {
        window.openStudentCardModal(studentId);
    }
};

window.commitBatchIuranChanges = async function () {
    if (!canEditInCurrentView("keuangan")) return;
    const count = Object.keys(portalState.pendingIuranChanges || {}).length;
    portalState.pendingIuranChanges = {};
    updateBatchIuranIndicatorUI();
    await saveToCloudDatabase(
        count > 0
            ? `${count} perubahan pelunasan kas siswa berhasil disimpan sekaligus ke Firebase!`
            : "Data pelunasan iuran kas berhasil disinkronkan ke Firebase!"
    );
    window.renderAdminWorkspace();
};

window.discardBatchIuranChanges = function () {
    if (!canEditInCurrentView("keuangan")) return;
    const pending = portalState.pendingIuranChanges || {};
    Object.values(pending).forEach((item) => {
        const stu = portalState.appData.students.find((s) => s.id === item.studentId);
        if (stu && stu.paidDates) {
            stu.paidDates[item.dateStr] = item.originalPaid;
        }
    });
    portalState.pendingIuranChanges = {};
    window.renderAdminWorkspace();
    window.renderIuranMatrix();
    showToast("Perubahan iuran yang belum disimpan telah dibatalkan.", "bg-neo-yellow");
};

window.markAllWeeksPaidCurrentStudent = async function () {
    if (!canEditInCurrentView("keuangan")) return;
    const student = portalState.appData.students.find((s) => s.id === portalState.selectedStudentIdForCard);
    if (!student) return;
    const mondays = getMondayDatesList();
    if (!student.paidDates) student.paidDates = {};
    mondays.forEach((d) => { student.paidDates[d] = true; });
    portalState.pendingIuranChanges = {};
    await saveToCloudDatabase(`Seluruh tanggal Senin untuk ${student.name} ditandai LUNAS!`);
    window.renderAdminWorkspace();
    window.openStudentCardModal(student.id);
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
        const idx = portalState.appData.transactions.findIndex((t) => String(t.id) === String(editId));
        if (idx >= 0) portalState.appData.transactions[idx] = txPayload;
    } else {
        portalState.appData.transactions.push(txPayload);
    }

    window.resetTransactionForm();
    await saveToCloudDatabase("Transaksi buku kas berhasil disimpan ke Firebase!");
    window.renderAdminWorkspace();
};

window.editTransaction = function (id) {
    const tx = portalState.appData.transactions.find((t) => t.id === id);
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
    portalState.appData.transactions = portalState.appData.transactions.filter((t) => t.id !== txId);
    await saveToCloudDatabase("Transaksi dihapus dari buku kas.");
    window.renderAdminWorkspace();
};

// --- Absensi Digital Admin ---
window.switchAdminAttendanceMode = function (mode) {
    portalState.adminAttendanceMode = mode;
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
    portalState.selectedAttendanceDate = val;
    renderAdminAttendanceSection();
};

window.handleAdminAttendanceWeekChange = function (val) {
    if (!val) return;
    portalState.selectedAttendanceWeek = val;
    renderAdminAttendanceSection();
};

window.handleAdminAttendanceMonthChange = function (val) {
    if (!val) return;
    portalState.selectedAttendanceMonth = val;
    renderAdminAttendanceSection();
};

function renderAdminAttendanceSection() {
    const thead = document.getElementById("admAttendanceTableHead");
    const tbody = document.getElementById("admAttendanceTableBody");
    if (!thead || !tbody) return;

    const appData = portalState.appData;
    const mode = portalState.adminAttendanceMode;
    const selDate = portalState.selectedAttendanceDate;
    const selWeek = portalState.selectedAttendanceWeek;
    const selMonth = portalState.selectedAttendanceMonth;

    const dInput = document.getElementById("admAttendanceDateInput");
    if (dInput && dInput.value !== selDate) dInput.value = selDate;
    const wInput = document.getElementById("admAttendanceWeekInput");
    if (wInput && wInput.value !== selWeek) wInput.value = selWeek;
    const mInput = document.getElementById("admAttendanceMonthInput");
    if (mInput && mInput.value !== selMonth) mInput.value = selMonth;

    const titleEl = document.getElementById("admAttendanceTableTitle");
    const q = (document.getElementById("admAttSearchInput")?.value || "").toLowerCase();
    const filteredStudents = appData.students.filter(
        (s) => s.name.toLowerCase().includes(q) || String(s.absen).includes(q)
    );

    let totalH = 0, totalI = 0, totalS = 0, totalA = 0;

    if (mode === "DAILY") {
        if (titleEl) titleEl.textContent = `Input Presensi Harian — Tanggal: ${selDate}`;
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
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[170px]">Nama Anggota</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 text-center min-w-[240px]">Pilih Status / Hapus (✕)</th>
                <th class="py-2.5 px-3 border-r-2 border-neutral-700 min-w-[180px]">Catatan (Surat/Alasan)</th>
                <th class="py-2.5 px-2.5 text-center">Rekap Semester</th>
            </tr>
        `;

        tbody.innerHTML = filteredStudents.length === 0
            ? `<tr><td colspan="5" class="py-8 text-center text-xs font-bold text-muted-adaptive">Belum ada anggota kelas terdaftar.</td></tr>`
            : filteredStudents
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
                                    <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'H', '${selDate}')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("H", "bg-neo-lime")}">H</button>
                                    <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'I', '${selDate}')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("I", "bg-neo-sky")}">I</button>
                                    <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'S', '${selDate}')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("S", "bg-neo-yellow")}">S</button>
                                    <button type="button" onclick="setStudentAttendanceStatus(${stu.id}, 'A', '${selDate}')" class="px-2.5 py-1 rounded border-2 border-neo-ink font-mono text-xs transition ${btnClass("A", "bg-neo-coral text-white")}">A</button>
                                    <button type="button" onclick="clearStudentAttendanceStatus(${stu.id}, '${selDate}')" title="Hapus pilihan absensi siswa ini" class="px-2 py-1 rounded border-2 border-neo-ink bg-white text-rose-600 hover:bg-rose-100 font-mono text-xs font-extrabold transition">✕</button>
                                </div>
                            </td>
                            <td class="py-1.5 px-2.5 border-r-2 border-neo-ink">
                                <input
                                    type="text"
                                    value="${(rec.note || "").replace(/"/g, "&quot;")}"
                                    onchange="setStudentAttendanceNote(${stu.id}, this.value, '${selDate}')"
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
    } else if (mode === "WEEKLY") {
        const weekDays = getSixSchoolDaysOfWeek(selWeek);
        const weekIsoKeys = weekDays.map((d) => d.iso);
        if (titleEl) titleEl.textContent = `Matriks Mingguan (${weekDays[0].shortDate} - ${weekDays[5].shortDate}) — Klik Sel untuk Ubah/Hapus`;

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
        const monthPrefix = selMonth || toLocalISOMonth();
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

window.renderAdminAttendanceSection = renderAdminAttendanceSection;

window.setStudentAttendanceStatus = async function (studentId, status, targetDate = portalState.selectedAttendanceDate) {
    if (!canEditInCurrentView("absensi")) return;
    const appData = portalState.appData;
    if (!appData.attendance) appData.attendance = {};
    if (!appData.attendance[targetDate]) appData.attendance[targetDate] = {};

    const existing = appData.attendance[targetDate][studentId] || { status: "", note: "" };
    existing.status = existing.status === status ? "" : status;
    if (!existing.status && !existing.note) {
        delete appData.attendance[targetDate][studentId];
    } else {
        appData.attendance[targetDate][studentId] = existing;
    }

    await saveToCloudDatabase();
    renderAdminAttendanceSection();
};

window.clearStudentAttendanceStatus = async function (studentId, targetDate = portalState.selectedAttendanceDate) {
    if (!canEditInCurrentView("absensi")) return;
    const appData = portalState.appData;
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
    const selDate = portalState.selectedAttendanceDate;
    if (portalState.appData.attendance?.[selDate]) {
        delete portalState.appData.attendance[selDate];
        await saveToCloudDatabase(`Seluruh pilihan absen pada tanggal ${selDate} telah direset!`);
        renderAdminAttendanceSection();
    } else {
        showToast("Tanggal ini memang belum memiliki data absen.", "bg-neo-yellow");
    }
};

window.cycleStudentAttendanceStatus = async function (studentId, targetDate) {
    if (!canEditInCurrentView("absensi")) return;
    const appData = portalState.appData;
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

window.setStudentAttendanceNote = async function (studentId, noteText, targetDate = portalState.selectedAttendanceDate) {
    if (!canEditInCurrentView("absensi")) return;
    const appData = portalState.appData;
    if (!appData.attendance) appData.attendance = {};
    if (!appData.attendance[targetDate]) appData.attendance[targetDate] = {};

    const existing = appData.attendance[targetDate][studentId] || { status: "H", note: "" };
    existing.note = noteText.trim();
    appData.attendance[targetDate][studentId] = existing;
    await saveToCloudDatabase();
};

window.markAllAttendancePresent = async function () {
    if (!canEditInCurrentView("absensi")) return;
    const appData = portalState.appData;
    const selDate = portalState.selectedAttendanceDate;
    if (!appData.attendance) appData.attendance = {};
    if (!appData.attendance[selDate]) appData.attendance[selDate] = {};

    appData.students.forEach((stu) => {
        const prevNote = appData.attendance[selDate][stu.id]?.note || "";
        appData.attendance[selDate][stu.id] = { status: "H", note: prevNote };
    });
    await saveToCloudDatabase(`Seluruh anggota ditandai HADIR untuk ${selDate}!`);
    renderAdminAttendanceSection();
};

window.saveCurrentDayAttendance = async function () {
    if (!canEditInCurrentView("absensi")) return;
    await saveToCloudDatabase("Data absensi berhasil disimpan secara real-time ke Firebase!");
};

// ============================================================================
// 5. MODUL 3, 4, 5, 6: MASTER ANGGOTA, TUGAS + LINK WA, JADWAL & ALBUM
// ============================================================================

window.handleStudentPhotoUpload = function (e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        document.getElementById("admStuPhotoUrl").value = dataUrl;
        window.updateStudentPhotoPreview(dataUrl);
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
    window.updateStudentPhotoPreview("");
};

window.handleAdminSaveStudent = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("siswa")) {
        showToast("Akses Ditolak: Hanya pemegang izin Master Data Anggota yang dapat mengubah daftar siswa!", "bg-neo-coral");
        return;
    }

    const appData = portalState.appData;
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
    window.resetStudentForm();
    await saveToCloudDatabase(`Data anggota "${name}" berhasil disimpan ke Firebase!`);
    window.renderAdminWorkspace();
};

window.editStudentInAdmin = function (id) {
    if (!canEditInCurrentView("siswa")) return;
    const s = portalState.appData.students.find((stu) => stu.id === id);
    if (!s) return;
    document.getElementById("admStuEditId").value = s.id;
    document.getElementById("admStuAbsen").value = s.absen;
    document.getElementById("admStuName").value = s.name;
    document.getElementById("admStuGender").value = s.gender || "L";
    document.getElementById("admStuRole").value = s.role || "Anggota Kelas";
    document.getElementById("admStuPiket").value = s.piket || "Senin";
    document.getElementById("admStuQuote").value = s.quote || "";
    document.getElementById("admStuPhotoUrl").value = s.photoUrl || "";
    window.updateStudentPhotoPreview(s.photoUrl || "");
    document.getElementById("admStudentFormTitle").textContent = `Edit Anggota #${s.absen}`;
    document.getElementById("btnCancelEditStudent")?.classList.remove("hidden");
};

window.resetStudentForm = function () {
    document.getElementById("admStuEditId").value = "";
    document.getElementById("admStuAbsen").value = "";
    document.getElementById("admStuName").value = "";
    document.getElementById("admStuQuote").value = "";
    window.clearStudentPhotoInput();
    document.getElementById("admStudentFormTitle").textContent = "Form Master Anggota & Perangkat";
    document.getElementById("btnCancelEditStudent")?.classList.add("hidden");
};

window.deleteStudentInAdmin = async function (id) {
    if (!canEditInCurrentView("siswa")) return;
    portalState.appData.students = portalState.appData.students.filter((s) => s.id !== id);
    await saveToCloudDatabase("Data anggota telah dihapus dari Firebase.");
    window.renderAdminWorkspace();
};

// --- Tugas Berfoto + Link Saluran WA + Auto-Expire Deadline ---
window.handleInfoPhotoUpload = function (e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        document.getElementById("admInfoPhotoUrl").value = dataUrl;
        window.updateInfoPhotoPreview(dataUrl);
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
    window.updateInfoPhotoPreview("");
};

window.handleAdminSaveInfo = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("info")) return;

    const appData = portalState.appData;
    const editId = document.getElementById("admInfoEditId").value;
    const photoUrl = (document.getElementById("admInfoPhotoUrl")?.value || "").trim();
    const expireAt = (document.getElementById("admInfoExpireAt")?.value || "").trim();
    const waLink = (document.getElementById("admInfoWaLink")?.value || "").trim();

    const payload = {
        id: editId ? Number(editId) : Date.now(),
        category: document.getElementById("admInfoCat").value,
        deadline: document.getElementById("admInfoDeadline").value.trim(),
        waLink,
        expireAt,
        photoUrl,
        photoExpired: false,
        title: document.getElementById("admInfoTitle").value.trim(),
        body: document.getElementById("admInfoBody").value.trim(),
        author: `${portalState.currentAdmin.name} (${portalState.currentAdmin.role})`
    };

    if (editId) {
        const idx = appData.announcements.findIndex((a) => String(a.id) === String(editId));
        if (idx >= 0) appData.announcements[idx] = payload;
    } else {
        appData.announcements.unshift(payload);
    }

    window.resetInfoForm();
    await cleanExpiredTaskPhotos(false);
    await saveToCloudDatabase("Pengumuman/Tugas berhasil dipublikasikan ke Firebase!");
    window.renderAdminWorkspace();
};

window.editAnnouncement = function (id) {
    const a = portalState.appData.announcements.find((item) => item.id === id);
    if (!a) return;
    document.getElementById("admInfoEditId").value = a.id;
    document.getElementById("admInfoCat").value = a.category;
    document.getElementById("admInfoDeadline").value = a.deadline;
    const waEl = document.getElementById("admInfoWaLink");
    if (waEl) waEl.value = a.waLink || "";
    const expEl = document.getElementById("admInfoExpireAt");
    if (expEl) expEl.value = a.expireAt || "";
    const pUrl = document.getElementById("admInfoPhotoUrl");
    if (pUrl) pUrl.value = a.photoUrl || "";
    window.updateInfoPhotoPreview(a.photoUrl || "");
    document.getElementById("admInfoTitle").value = a.title;
    document.getElementById("admInfoBody").value = a.body;
    document.getElementById("admInfoFormTitle").textContent = "Edit Pengumuman / Tugas";
    document.getElementById("btnCancelEditInfo").classList.remove("hidden");
};

window.resetInfoForm = function () {
    document.getElementById("admInfoEditId").value = "";
    document.getElementById("admInfoDeadline").value = "";
    const waEl = document.getElementById("admInfoWaLink");
    if (waEl) waEl.value = "";
    const expEl = document.getElementById("admInfoExpireAt");
    if (expEl) expEl.value = "";
    window.clearInfoPhotoInput();
    document.getElementById("admInfoTitle").value = "";
    document.getElementById("admInfoBody").value = "";
    document.getElementById("admInfoFormTitle").textContent = "Buat Pengumuman / Tugas + Link WA";
    document.getElementById("btnCancelEditInfo").classList.add("hidden");
};

window.deleteAnnouncement = async function (id) {
    if (!canEditInCurrentView("info")) return;
    portalState.appData.announcements = portalState.appData.announcements.filter((a) => a.id !== id);
    await saveToCloudDatabase("Pengumuman dihapus.");
    window.renderAdminWorkspace();
};

window.deleteStickyNote = async function (id) {
    if (!canEditInCurrentView("info")) return;
    portalState.appData.stickyNotes = (portalState.appData.stickyNotes || []).filter((n) => n.id !== id);
    await saveToCloudDatabase("Pesan tempelan/NGL berhasil dihapus.");
    window.renderAdminWorkspace();
};

// --- Jadwal Pelajaran & Pilih Jam ---
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
    window.syncScheduleTimeRange();
};

window.handleAdminSaveSchedule = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("jadwal")) return;

    window.syncScheduleTimeRange();
    const appData = portalState.appData;
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

    window.resetScheduleForm();
    await saveToCloudDatabase(`Jadwal hari ${day} berhasil disimpan ke Firebase!`);
    window.renderAdminWorkspace();
};

window.editScheduleItem = function (day, idx) {
    const item = portalState.appData.schedule[day]?.[idx];
    if (!item) return;
    document.getElementById("admSchEditDay").value = day;
    document.getElementById("admSchEditIdx").value = idx;
    document.getElementById("admSchDay").value = day;

    const parts = String(item.time || "").split("-").map((s) => s.trim());
    if (parts.length === 2 && parts[0].includes(":") && parts[1].includes(":")) {
        document.getElementById("admSchStartTime").value = parts[0];
        document.getElementById("admSchEndTime").value = parts[1];
    }
    window.syncScheduleTimeRange();

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
    window.applySchedulePreset("07:30", "09:00");
    document.getElementById("admScheduleFormTitle").textContent = "Atur Jadwal Mata Pelajaran";
    document.getElementById("btnCancelEditSchedule").classList.add("hidden");
};

window.deleteScheduleItem = async function (day, index) {
    if (!canEditInCurrentView("jadwal")) return;
    if (Array.isArray(portalState.appData.schedule[day])) {
        portalState.appData.schedule[day].splice(index, 1);
        await saveToCloudDatabase("Mata pelajaran dihapus dari jadwal.");
        window.renderAdminWorkspace();
    }
};

// --- Galeri Album Kenangan ---
window.handleAlbumImageUpload = function (e) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        document.getElementById("admAlbumUrl").value = dataUrl;
        window.updateAlbumPhotoPreview(dataUrl);
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
    window.updateAlbumPhotoPreview("");
};

window.handleAdminSaveAlbum = async function (e) {
    e.preventDefault();
    if (!canEditInCurrentView("album")) return;

    const appData = portalState.appData;
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
        author: portalState.currentAdmin.name
    };

    if (editId) {
        const idx = appData.albums.findIndex((a) => String(a.id) === String(editId));
        if (idx >= 0) appData.albums[idx] = payload;
    } else {
        appData.albums.unshift(payload);
    }

    window.resetAlbumForm();
    await saveToCloudDatabase("Foto berhasil disimpan ke Album Firebase!");
    window.renderAdminWorkspace();
};

window.editAlbumItem = function (id) {
    const alb = portalState.appData.albums.find((a) => a.id === id);
    if (!alb) return;
    document.getElementById("admAlbumEditId").value = alb.id;
    document.getElementById("admAlbumTitle").value = alb.title;
    document.getElementById("admAlbumCategory").value = alb.category;
    document.getElementById("admAlbumDate").value = alb.date;
    document.getElementById("admAlbumUrl").value = alb.url;
    document.getElementById("admAlbumCaption").value = alb.caption || "";
    window.updateAlbumPhotoPreview(alb.url);
    document.getElementById("admAlbumFormTitle").textContent = "Edit Foto Album";
    document.getElementById("btnCancelEditAlbum").classList.remove("hidden");
};

window.resetAlbumForm = function () {
    document.getElementById("admAlbumEditId").value = "";
    document.getElementById("admAlbumTitle").value = "";
    document.getElementById("admAlbumCaption").value = "";
    document.getElementById("admAlbumDate").value = toLocalISODate(new Date());
    window.clearAlbumPhotoInput();
    document.getElementById("admAlbumFormTitle").textContent = "Unggah Dokumentasi Album";
    document.getElementById("btnCancelEditAlbum").classList.add("hidden");
};

window.deleteAlbumItem = async function (id) {
    if (!canEditInCurrentView("album")) return;
    portalState.appData.albums = portalState.appData.albums.filter((a) => a.id !== id);
    await saveToCloudDatabase("Foto dihapus dari album.");
    window.renderAdminWorkspace();
};

// ============================================================================
// 6. MODUL 7 & 8: AKUN RBAC, IDENTITAS, SLIDESHOW, KALENDER LIBUR & SEMESTER
// ============================================================================

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

    const appData = portalState.appData;
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
        portalState.externalFirebaseAdmins = portalState.externalFirebaseAdmins.filter((a) => String(a.username).toLowerCase() !== origUser);
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

    portalState.externalFirebaseAdmins = mergeAdminArrays(portalState.externalFirebaseAdmins, [accountObj]);

    if (portalState.currentAdmin && (String(portalState.currentAdmin.username).toLowerCase() === username || String(portalState.currentAdmin.username).toLowerCase() === origUser)) {
        portalState.currentAdmin = accountObj;
        window.saveAdminSessionToStorage();
    }

    await saveAdminAccountToCloud(accountObj);
    window.resetAdminAccountForm();
    await saveToCloudDatabase(`Akun pengurus "${username}" (${role}) berhasil disimpan ke Firebase!`);
    window.renderAdminWorkspace();
};

window.deleteAdminAccount = async function (username) {
    if (!canEditInCurrentView("akun")) return;
    const targetUser = String(username).trim().toLowerCase();
    if (portalState.currentAdmin && String(portalState.currentAdmin.username).toLowerCase() === targetUser) {
        showToast("Tidak dapat menghapus akun yang sedang Anda gunakan!", "bg-neo-coral");
        return;
    }

    portalState.appData.admins = portalState.appData.admins.filter((a) => String(a.username).toLowerCase() !== targetUser);
    portalState.externalFirebaseAdmins = portalState.externalFirebaseAdmins.filter((a) => String(a.username).toLowerCase() !== targetUser);

    await deleteAdminAccountFromCloud(targetUser);
    await saveToCloudDatabase(`Akun ${targetUser} telah dihapus permanen dari Firebase.`);
    window.renderAdminWorkspace();
};

// --- Pengaturan Visual, Identitas, Saluran WA & Hari Libur ---
window.handleInstantConfigImage = function (e, targetInputId, previewImgId, fallbackId) {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFileInstantly(file, (dataUrl) => {
        const inputEl = document.getElementById(targetInputId);
        if (inputEl) inputEl.value = dataUrl;
        if (previewImgId) window.syncConfigPreview(targetInputId, previewImgId, fallbackId);
        showToast("Gambar dimuat! Klik Simpan Pengaturan untuk menyimpan ke Firebase.", "bg-neo-mint");
    });
};

window.syncConfigPreview = function (targetInputId, previewImgId, fallbackId) {
    if (!previewImgId) return;
    const val = document.getElementById(targetInputId)?.value || "";
    const imgEl = document.getElementById(previewImgId);
    const fbEl = document.getElementById(fallbackId);
    applyImageWithFallback(imgEl, fbEl, val);
};

window.clearConfigImage = function (targetInputId, previewImgId, fallbackId) {
    const inputEl = document.getElementById(targetInputId);
    if (inputEl) inputEl.value = "";
    if (previewImgId) window.syncConfigPreview(targetInputId, previewImgId, fallbackId);
};

window.resetHeroBgToDefault = function () {
    const inputEl = document.getElementById("cfgHeroBgUrl");
    if (inputEl) inputEl.value = DEFAULT_HERO_BG;
    window.syncConfigPreview("cfgHeroBgUrl", "cfgHeroBgPreviewImg", "cfgHeroBgPreviewFallback");
    showToast("Foto latar utama dikembalikan ke default.", "bg-neo-yellow");
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

    const cfg = portalState.appData.config;
    cfg.classCode = document.getElementById("cfgClassCode").value.trim() || "MDV";
    cfg.className = document.getElementById("cfgClassName").value.trim() || "MEDIVANCE";
    const schEl = document.getElementById("cfgSchoolName");
    if (schEl) cfg.schoolName = schEl.value.trim() || "SMA NEGERI 5 AMBON";
    cfg.classMotto = document.getElementById("cfgClassMotto").value.trim() || "Together We Grow, Together We Heal";
    const semSel = document.getElementById("cfgSemesterName");
    if (semSel) cfg.semesterName = semSel.value;
    cfg.academicYear = document.getElementById("cfgAcademicYear").value.trim();

    const webLogoEl = document.getElementById("cfgWebsiteLogoUrl");
    if (webLogoEl) cfg.websiteLogoUrl = webLogoEl.value.trim();
    cfg.classLogoUrl = document.getElementById("cfgClassLogoUrl").value.trim();
    const schLogoEl = document.getElementById("cfgSchoolLogoUrl");
    if (schLogoEl) cfg.schoolLogoUrl = schLogoEl.value.trim();
    cfg.heroBgUrl = document.getElementById("cfgHeroBgUrl").value.trim() || DEFAULT_HERO_BG;

    const bg2El = document.getElementById("cfgHeroBgUrl2");
    const bg3El = document.getElementById("cfgHeroBgUrl3");
    if (bg2El) cfg.heroBgUrl2 = bg2El.value.trim();
    if (bg3El) cfg.heroBgUrl3 = bg3El.value.trim();

    cfg.welcomeTypingText = document.getElementById("cfgWelcomeTypingText").value.trim();
    cfg.heroSubtitle = document.getElementById("cfgHeroSubtitle").value.trim();
    cfg.aboutClass = document.getElementById("cfgAboutClass").value.trim();
    cfg.marqueeText = document.getElementById("cfgMarqueeText").value.trim();

    const igEl = document.getElementById("cfgSocialIg");
    const ttEl = document.getElementById("cfgSocialTiktok");
    const emEl = document.getElementById("cfgSocialEmail");
    const waEl = document.getElementById("cfgWaChannelUrl");
    if (igEl) cfg.socialIg = igEl.value.trim();
    if (ttEl) cfg.socialTiktok = ttEl.value.trim();
    if (emEl) cfg.socialEmail = emEl.value.trim();
    if (waEl) cfg.waChannelUrl = waEl.value.trim();

    cfg.waliKelas = document.getElementById("cfgWaliKelas").value.trim();
    cfg.waliTitle = document.getElementById("cfgWaliTitle").value.trim();
    cfg.waliPhotoUrl = document.getElementById("cfgWaliPhotoUrl").value.trim();
    cfg.weeklyFee = Number(document.getElementById("cfgWeeklyFee").value) || 0;
    cfg.feeStartDate = start;
    cfg.feeEndDate = end;
    cfg.paymentInfo = document.getElementById("cfgPaymentInfo").value.trim();

    await saveToCloudDatabase("Pengaturan Identitas, Slideshow Latar, Logo Kop & Saluran WA berhasil disimpan!");
    window.renderAdminWorkspace();
};

window.handleAddCustomHoliday = async function () {
    if (!canEditInCurrentView("pengaturan")) return;
    const dateVal = document.getElementById("admHolidayDateInput")?.value || "";
    const nameVal = (document.getElementById("admHolidayNameInput")?.value || "").trim();

    if (!dateVal || !nameVal) {
        showToast("Pilih tanggal libur dan isi keterangannya terlebih dahulu!", "bg-neo-coral");
        return;
    }

    const cfg = portalState.appData.config;
    if (!Array.isArray(cfg.holidays)) cfg.holidays = [];
    const existingIdx = cfg.holidays.findIndex((h) => h.date === dateVal);
    if (existingIdx >= 0) {
        cfg.holidays[existingIdx].name = nameVal;
    } else {
        cfg.holidays.push({ id: Date.now(), date: dateVal, name: nameVal });
    }

    cfg.holidays.sort((a, b) => a.date.localeCompare(b.date));
    document.getElementById("admHolidayDateInput").value = "";
    document.getElementById("admHolidayNameInput").value = "";

    await saveToCloudDatabase(`Hari libur "${nameVal}" (${dateVal}) berhasil ditambahkan ke kalender!`);
    window.renderAdminWorkspace();
};

window.deleteCustomHoliday = async function (id) {
    if (!canEditInCurrentView("pengaturan")) return;
    portalState.appData.config.holidays = (portalState.appData.config.holidays || []).filter((h) => h.id !== id);
    await saveToCloudDatabase("Tanggal libur dihapus dari kalender.");
    window.renderAdminWorkspace();
};

// --- Manajemen Semester Baru & Brankas Arsip ---
function renderSemesterArchivesSection() {
    const appData = portalState.appData;
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

    const appData = portalState.appData;
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
            pic: portalState.currentAdmin ? portalState.currentAdmin.name : "Bendahara Kelas"
        });
    }

    appData.announcements = [];
    appData.attendance = {};
    portalState.pendingIuranChanges = {};

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
    window.renderAdminWorkspace();
};

window.restoreArchivedSemester = async function (archiveId) {
    if (!canEditInCurrentView("pengaturan")) return;
    const appData = portalState.appData;
    const arc = (appData.archives || []).find((a) => a.id === archiveId);
    if (!arc) return;

    appData.config = { ...appData.config, ...(arc.configSnapshot || {}) };
    appData.students = JSON.parse(JSON.stringify(arc.students || appData.students));
    appData.transactions = JSON.parse(JSON.stringify(arc.transactions || []));
    appData.announcements = JSON.parse(JSON.stringify(arc.announcements || []));
    appData.attendance = JSON.parse(JSON.stringify(arc.attendance || {}));
    if (arc.schedule) appData.schedule = JSON.parse(JSON.stringify(arc.schedule));
    portalState.pendingIuranChanges = {};

    await saveToCloudDatabase(`Data arsip "${arc.label}" berhasil dipulihkan menjadi semester aktif!`);
    window.renderAdminWorkspace();
};

window.deleteArchivedSemester = async function (archiveId) {
    if (!canEditInCurrentView("pengaturan")) return;
    portalState.appData.archives = (portalState.appData.archives || []).filter((a) => a.id !== archiveId);
    await saveToCloudDatabase("Arsip semester dihapus dari brankas.");
    window.renderAdminWorkspace();
};

window.downloadArchivedSemesterExcel = function (archiveId) {
    const arc = (portalState.appData.archives || []).find((a) => a.id === archiveId);
    if (!arc) return;
    const backupCurrent = JSON.parse(JSON.stringify(portalState.appData));
    portalState.appData.config = { ...portalState.appData.config, ...(arc.configSnapshot || {}) };
    portalState.appData.students = arc.students || [];
    portalState.appData.transactions = arc.transactions || [];
    window.downloadOfficialExcelSheet();
    portalState.appData = backupCurrent;
};

// ============================================================================
// 7. INISIALISASI INPUT DEFAULT & UPLOAD FILE SLIDE 2/3 SAAT DOM SIAP
// ============================================================================

window.addEventListener("DOMContentLoaded", () => {
    const todayIso = toLocalISODate(new Date());
    const monthIso = toLocalISOMonth(new Date());
    ["admTxDate", "admAlbumDate", "admAttendanceDateInput", "admAttendanceWeekInput"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = todayIso;
    });
    const admMonthEl = document.getElementById("admAttendanceMonthInput");
    if (admMonthEl) admMonthEl.value = monthIso;

    // Tambahkan tombol pilih file foto langsung untuk Slide 2 & Slide 3 jika belum ada
    ["cfgHeroBgUrl2", "cfgHeroBgUrl3"].forEach((inputId) => {
        const textInput = document.getElementById(inputId);
        if (textInput && !document.getElementById(`${inputId}_file`)) {
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.id = `${inputId}_file`;
            fileInput.accept = "image/*";
            fileInput.className = "mt-1.5 block w-full text-[10px] file:mr-1.5 file:py-1 file:px-2 file:border file:border-neo-ink file:rounded file:font-bold file:bg-neo-yellow file:text-neo-ink cursor-pointer";
            fileInput.onchange = (ev) => window.handleInstantConfigImage(ev, inputId, "", "");
            textInput.parentNode.appendChild(fileInput);
        }
    });

    window.syncScheduleTimeRange();
});