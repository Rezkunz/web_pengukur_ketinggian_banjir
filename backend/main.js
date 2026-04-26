// Initialization and Auth Routing
document.addEventListener('DOMContentLoaded', async () => {
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    auth.onAuthStateChanged(async (user) => {
        const viewAuth = document.getElementById('view-auth');
        const viewMonitoring = document.getElementById('view-monitoring');
        const viewDarurat = document.getElementById('view-darurat');
        const viewLapor = document.getElementById('view-lapor');
        const viewSaran = document.getElementById('view-saran');
        
        const viewAdminDash = document.getElementById('view-admin-dashboard');
        const viewAdminLapor = document.getElementById('view-admin-laporan');
        const viewAdminSaran = document.getElementById('view-admin-saran');
        const viewAdminMembers = document.getElementById('view-admin-members');

        const userNav = document.getElementById('user-navbar');
        const adminNav = document.getElementById('admin-navbar');
        const profileWrapper = document.getElementById('profile-wrapper');

        const statusEl = document.getElementById('connection-status');
        if (statusEl) statusEl.style.display = 'none';

        document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

        if (user) {
            profileWrapper.style.display = 'flex';
            
            let snapshot = null;
            if(database) {
                try {
                    snapshot = await database.ref('users/' + user.uid).once('value');
                } catch(e) {}
            }
            
            const userData = snapshot && snapshot.exists() ? snapshot.val() : { nama: 'User', role: 'user' };
            
            document.getElementById('header-name').textContent = userData.nama;
            document.getElementById('header-avatar').textContent = userData.nama.charAt(0).toUpperCase();

            // Sync ke sidebar profile (desktop)
            const initial = userData.nama.charAt(0).toUpperCase();
            ['user', 'admin'].forEach(role => {
                const sidebarAvatar = document.getElementById(`sidebar-avatar-${role}`);
                const sidebarName   = document.getElementById(`sidebar-name-${role}`);
                if (sidebarAvatar) sidebarAvatar.textContent = initial;
                if (sidebarName)   sidebarName.textContent   = userData.nama;
            });

            // Admin Setup (One off fallback)
            if ((user.email === 'rezads@gmail.com' || user.email === 'admin@safe.net') && userData.role !== 'admin') {
                 if(database) {
                     await database.ref('users/' + user.uid).set({
                         nama: user.email === 'admin@safe.net' ? 'Administrator' : 'Admin Reza',
                         email: user.email,
                         role: 'admin'
                     });
                     userData.role = 'admin';
                 }
            }
            if (userData.role === 'admin') {
                if (!viewAdminDash.innerHTML) {
                    viewAdminDash.innerHTML = await fetch('views/admin-dashboard.html?v=53').then(r => r.text());
                    viewAdminLapor.innerHTML = await fetch('views/admin-laporan.html?v=53').then(r => r.text());
                    viewAdminSaran.innerHTML = await fetch('views/admin-saran.html?v=53').then(r => r.text());
                    viewAdminMembers.innerHTML = await fetch('views/admin-members.html?v=53').then(r => r.text());
                }
                adminNav.style.display = 'flex';
                userNav.style.display = 'none';
                document.body.classList.add('admin-view');
                document.body.classList.remove('user-view');
                viewAdminDash.classList.add('active');
                
                bindDOM();
                // initStats(); // Removed: handled by listenAdminData
                initChart(true);
                listenAdminData();
                startMembersListener();
                startDataListener(); 
            } else {
                if (!viewMonitoring.innerHTML) {
                    viewMonitoring.innerHTML = await fetch('views/monitoring.html?v=53').then(r => r.text());
                    viewDarurat.innerHTML = await fetch('views/darurat.html?v=53').then(r => r.text());
                    viewLapor.innerHTML = await fetch('views/lapor.html?v=53').then(r => r.text());
                    viewSaran.innerHTML = await fetch('views/saran.html?v=53').then(r => r.text());
                }
                userNav.style.display = 'flex';
                adminNav.style.display = 'none';
                document.body.classList.add('user-view');
                document.body.classList.remove('admin-view');
                viewMonitoring.classList.add('active');

                bindDOM();
                initChart(false);
                startDataListener();
            }
        } else {
            profileWrapper.style.display = 'none';
            userNav.style.display = 'none';
            adminNav.style.display = 'none';
            document.body.classList.remove('admin-view');
            document.body.classList.remove('user-view');
            if (!viewAuth.innerHTML) {
                viewAuth.innerHTML = await fetch('views/auth.html?v=53').then(r => r.text());
            }
            viewAuth.classList.add('active');
        }

        // Sembunyikan global loader jika ada
        const globalLoader = document.getElementById('global-loader');
        if (globalLoader) {
            globalLoader.style.opacity = '0';
            globalLoader.style.visibility = 'hidden';
            setTimeout(() => {
                globalLoader.style.display = 'none';
            }, 500);
        }
    });
});
