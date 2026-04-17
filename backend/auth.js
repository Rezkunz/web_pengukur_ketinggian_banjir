// Profil Management

async function openEditProfile() {
    // Tutup semua dropdown (header + sidebar)
    const headerDd = document.getElementById('profile-dropdown');
    if (headerDd) headerDd.style.display = 'none';
    document.querySelectorAll('.sidebar-profile-dropdown').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.sidebar-chevron').forEach(el => el.style.transform = '');

    const viewEdit = document.getElementById('view-edit-profile');
    
    // Selalu reload untuk mendapatkan versi terbaru
    viewEdit.innerHTML = await fetch('views/edit-profile.html?v=' + Date.now()).then(r => r.text());
    
    // Hide all other views
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    viewEdit.classList.add('active');
    
    // Load Data
    const user = auth.currentUser;
    if(user) {
        document.getElementById('edit-email').value = user.email;
        let snap;
        try { snap = await database.ref('users/' + user.uid).once('value'); } catch(e){}
        const data = snap && snap.exists() ? snap.val() : {nama: 'User', role: 'user'};
        
        document.getElementById('edit-nama').value = data.nama;
        document.getElementById('edit-role-badge').textContent = data.role.toUpperCase() === 'ADMIN' ? 'Admin' : 'User';
        document.getElementById('edit-avatar').textContent = data.nama.charAt(0).toUpperCase();
        
        // Add specific color for admin role badge
        if(data.role === 'admin') {
            document.getElementById('edit-role-badge').style.background = '#e74c3c';
        }
    }
}

function closeEditProfile() {
    const viewEdit = document.getElementById('view-edit-profile');
    viewEdit.classList.remove('active');
    // Return to default view
    const user = auth.currentUser;
    if(user && user.email === 'rezads@gmail.com') { // simplified admin check
        document.getElementById('view-admin-dashboard').classList.add('active');
    } else {
        document.getElementById('view-monitoring').classList.add('active');
    }
}

async function saveProfile(e) {
    e.preventDefault();
    const user = auth.currentUser;
    if(!user) return;
    
    const newName = document.getElementById('edit-nama').value.trim();
    if (!newName) return;

    const initial = newName.charAt(0).toUpperCase();
    
    if(database) {
        try {
            await database.ref('users/' + user.uid).update({ nama: newName });
            
            // Sync header (mobile)
            const headerName   = document.getElementById('header-name');
            const headerAvatar = document.getElementById('header-avatar');
            if (headerName)   headerName.textContent   = newName;
            if (headerAvatar) headerAvatar.textContent = initial;

            // Sync edit-profile avatar
            const editAvatar = document.getElementById('edit-avatar');
            if (editAvatar) editAvatar.textContent = initial;

            // Sync sidebar profile (desktop)
            ['user', 'admin'].forEach(role => {
                const sidebarAvatar = document.getElementById(`sidebar-avatar-${role}`);
                const sidebarName   = document.getElementById(`sidebar-name-${role}`);
                if (sidebarAvatar) sidebarAvatar.textContent = initial;
                if (sidebarName)   sidebarName.textContent   = newName;
            });
            
            showSuccessModal('Berhasil!', 'Profil berhasil diperbarui!');
            closeEditProfile();
        } catch(err) {
            showCustomModal('SIAGA1', 'Gagal', err.message);
        }
    }
}


function switchAuthMode(mode) {
    const fLogin = document.getElementById('form-login');
    const fReg = document.getElementById('form-register');
    const tLogin = document.getElementById('tab-login');
    const tReg = document.getElementById('tab-register');
    const pill = document.getElementById('auth-pill');
    
    if(mode === 'login') {
        if(fLogin) fLogin.style.display = 'block';
        if(fReg) fReg.style.display = 'none';
        if(tLogin) tLogin.classList.add('active');
        if(tReg) tReg.classList.remove('active');
        if(pill) pill.style.transform = 'translateX(0)';
    } else {
        if(fLogin) fLogin.style.display = 'none';
        if(fReg) fReg.style.display = 'block';
        if(tReg) tReg.classList.add('active');
        if(tLogin) tLogin.classList.remove('active');
        if(pill) pill.style.transform = 'translateX(100%)';
    }
}

function handleLogin(e) {
    e.preventDefault();
    const em = document.getElementById('login-email').value;
    const px = document.getElementById('login-password').value;
    
    auth.signInWithEmailAndPassword(em, px).catch(err => {
        let msg = err.message;
        if(err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Email atau password yang Anda masukkan salah.';
        else if(err.code === 'auth/user-not-found') msg = 'Akun dengan email tersebut tidak ditemukan.';
        else if(err.code === 'auth/invalid-email') msg = 'Format email tidak valid.';
        showCustomModal('SIAGA2', 'Login Gagal', msg);
    });
}

function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const em = document.getElementById('register-email').value;
    const px = document.getElementById('register-password').value;
    
    auth.createUserWithEmailAndPassword(em, px).then((cred) => {
        if(database) {
            database.ref('users/' + cred.user.uid).set({
                nama: name,
                email: em,
                role: 'user'
            });
        }
    }).catch(err => {
        let msg = err.message;
        if(err.code === 'auth/email-already-in-use') msg = 'Email ini sudah terdaftar. Silakan gunakan email lain atau login.';
        else if(err.code === 'auth/weak-password') msg = 'Password terlalu lemah, minimal 6 karakter.';
        showCustomModal('SIAGA2', 'Register Gagal', msg);
    });
}

function logoutUser() {
    // Tutup semua dropdown dulu
    const headerDd = document.getElementById('profile-dropdown');
    if (headerDd) headerDd.style.display = 'none';
    document.querySelectorAll('.sidebar-profile-dropdown').forEach(el => el.classList.remove('open'));
    
    auth.signOut();
    const lForm = document.getElementById('form-login');
    const rForm = document.getElementById('form-register');
    if(lForm) lForm.reset();
    if(rForm) rForm.reset();
}
