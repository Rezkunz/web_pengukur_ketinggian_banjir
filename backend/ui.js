// ── THEME TOGGLE (Dark / Light Mode) ──
function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    try { localStorage.setItem('safe-theme', isDark ? 'dark' : 'light'); } catch(e) {}
    _updateThemeLabels(isDark);
}

function _updateThemeLabels(isDark) {
    document.querySelectorAll('.sidebar-theme-label').forEach(el => {
        el.textContent = isDark ? 'Mode Gelap' : 'Mode Terang';
    });
}

// Tampilkan/sembunyikan FAB berdasarkan status login
function setThemeFabVisible(visible) {
    const fab = document.getElementById('theme-fab');
    if (!fab) return;
    fab.style.display = visible ? 'block' : 'none';
}

// Restore theme saat halaman dimuat
(function initTheme() {
    try {
        const saved = localStorage.getItem('safe-theme');
        if (saved === 'dark') {
            document.body.classList.add('dark-mode');
            setTimeout(() => _updateThemeLabels(true), 100);
        }
    } catch(e) {}
    // FAB hidden by default, shown after login
    const fab = document.getElementById('theme-fab');
    if (fab) fab.style.display = 'none';
})();

// Generic UI Navigation & DOM bindings
function bindDOM() {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            views.forEach(view => view.classList.remove('active'));

            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            const targetEl = document.getElementById(targetId);
            if(targetEl) targetEl.classList.add('active');
        });
    });
}

// Custom Modal Logic
function showCustomModal(level, title, message) {
    const modal = document.getElementById('custom-modal');
    const header = document.getElementById('modal-header');
    const titleEl = document.getElementById('modal-title');
    const descEl = document.getElementById('modal-desc');

    if (!modal) return;

    titleEl.textContent = title;
    descEl.textContent = message;

    header.className = 'custom-modal-header';
    if (level === 'SIAGA1') {
        header.classList.add('siaga1');
    } else {
        header.classList.add('siaga2');
    }

    modal.classList.add('show');
}

function closeCustomModal() {
    const modal = document.getElementById('custom-modal');
    if (modal) modal.classList.remove('show');
}

// Success Modal Logic
function showSuccessModal(title, message) {
    const modal = document.getElementById('success-modal');
    const titleEl = document.getElementById('success-modal-title');
    const descEl = document.getElementById('success-modal-desc');

    if (!modal) return;

    titleEl.textContent = title;
    descEl.textContent = message;
    modal.classList.add('show');

    setTimeout(() => {
        closeSuccessModal();
    }, 3500);
}

function closeSuccessModal(event) {
    const modal = document.getElementById('success-modal');
    if (modal) modal.classList.remove('show');
}

function closeFCMPermissionModal() {
    const modal = document.getElementById('fcm-permission-modal');
    if (modal) modal.classList.remove('show');
}

// Global Notification Function
function sendNotification(title, options) {
    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            new Notification(title, options);
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function (permission) {
                if (permission === "granted") {
                    new Notification(title, options);
                }
            });
        }
    }
}

// Toggle dropdown profile di sidebar (desktop/tablet) — floating popover
function toggleSidebarProfileMenu(role) {
    const dd = document.getElementById(`sidebar-dd-${role}`);
    if (!dd) return;

    const isOpen = dd.classList.contains('open');

    // Tutup semua popover lain
    closeSidebarProfileMenu();

    if (!isOpen) {
        // Sync nama & avatar ke popover header
        const sidebarName = document.getElementById(`sidebar-name-${role}`)?.textContent || '';
        const sidebarAvatar = document.getElementById(`sidebar-avatar-${role}`)?.textContent || '';
        const ddName = document.getElementById(`sidebar-dd-name-${role}`);
        const ddAvatar = document.getElementById(`sidebar-dd-avatar-${role}`);
        if (ddName) ddName.textContent = sidebarName;
        if (ddAvatar) ddAvatar.textContent = sidebarAvatar;

        dd.classList.add('open');
    }
}

// Tutup semua sidebar profile popover
function closeSidebarProfileMenu() {
    document.querySelectorAll('.sidebar-profile-dropdown').forEach(el => el.classList.remove('open'));
}

// Toggle collapse/expand sidebar di desktop
function toggleSidebar() {
    // Hanya aktif di desktop (min-width 768px)
    if (window.innerWidth < 768) return;

    const navbars = document.querySelectorAll('.bottom-nav');
    navbars.forEach(nav => {
        nav.classList.toggle('sidebar-collapsed');
    });

    const isCollapsed = document.querySelector('.bottom-nav')?.classList.contains('sidebar-collapsed');
    try { localStorage.setItem('sidebar-collapsed', isCollapsed ? '1' : '0'); } catch(e) {}
}

// Restore sidebar state dari localStorage saat init
(function restoreSidebarState() {
    try {
        if (localStorage.getItem('sidebar-collapsed') === '1' && window.innerWidth >= 768) {
            // Tunda sedikit agar navbars sudah di-render oleh auth state
            setTimeout(() => {
                document.querySelectorAll('.bottom-nav').forEach(nav => {
                    nav.classList.add('sidebar-collapsed');
                });
            }, 600);
        }
    } catch(e) {}
})();

// Toggle dropdown profile di header (mobile)
function toggleProfileMenu() {
    const dropdown = document.getElementById('profile-dropdown');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
}

// Tutup dropdown jika klik di luar
document.addEventListener('click', (e) => {
    // Sidebar profile popover — tutup jika klik di luar .sidebar-profile DAN di luar popover
    if (!e.target.closest('.sidebar-profile') && !e.target.closest('.sidebar-profile-dropdown')) {
        closeSidebarProfileMenu();
    }
    // Header profile dropdown (mobile)
    if (!e.target.closest('.profile-menu-wrapper')) {
        const dd = document.getElementById('profile-dropdown');
        if (dd) dd.style.display = 'none';
    }
});

// Helper to escape HTML and prevent XSS
function escapeHTML(str) {
    if (!str) return "";
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Sync bottom navigation bar item active state with active view section
function syncNavigationActiveState(targetViewId) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (item.getAttribute('data-target') === targetViewId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

