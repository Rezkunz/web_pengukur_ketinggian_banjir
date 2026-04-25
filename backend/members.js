// Member Management Logic
function startMembersListener() {
    if (!database) return;

    database.ref('users').on('value', (snapshot) => {
        const listEl = document.getElementById('members-list');
        const cardsEl = document.getElementById('members-cards');
        
        // Cek jika elemen tidak ada di DOM saat ini, hentikan (mungkin sedang di view lain)
        if (!listEl && !cardsEl) return;
        
        if (listEl) listEl.innerHTML = '';
        if (cardsEl) cardsEl.innerHTML = '';
        
        const data = snapshot.val();
        
        if (!data) {
            if (listEl) listEl.innerHTML = '<tr><td colspan="4" style="text-align:center;">Tidak ada data anggota</td></tr>';
            if (cardsEl) cardsEl.innerHTML = '<div style="text-align:center; padding:20px;">Tidak ada data anggota</div>';
            return;
        }

        Object.keys(data).forEach(uid => {
            const user = data[uid];
            const roleClass = user.role === 'admin' ? 'role-admin' : 'role-user';
            const roleText = user.role === 'admin' ? 'Admin' : 'User';

            // 1. Desktop Table Row
            if (listEl) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${user.nama || 'Tanpa Nama'}</td>
                    <td>${user.email || '-'}</td>
                    <td><span class="role-badge ${roleClass}">${roleText}</span></td>
                    <td>
                        <button class="btn-edit" onclick="openMemberModal('${uid}')">Edit</button>
                        <button class="btn-delete" onclick="deleteUser('${uid}')">Hapus</button>
                    </td>
                `;
                listEl.appendChild(tr);
            }

            // 2. Mobile card
            if (cardsEl) {
                const card = document.createElement('div');
                card.className = 'member-card';
                card.innerHTML = `
                    <div class="card-info">
                        <div class="card-name-row">
                            <span class="card-name">${user.nama || 'Tanpa Nama'}</span>
                            <span class="role-badge ${roleClass}">${roleText}</span>
                        </div>
                        <span class="card-email">${user.email || '-'}</span>
                    </div>
                    <div class="card-side-actions">
                        <button class="btn-edit-premium" onclick="openMemberModal('${uid}')" aria-label="Edit Anggota">
                            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                        </button>
                        <button class="btn-delete-premium" onclick="deleteUser('${uid}')" aria-label="Hapus Anggota">
                            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    </div>
                `;
                cardsEl.appendChild(card);
            }
        });
    });
}

function openMemberModal(uid) {
    if (!uid) return;
    const modal = document.getElementById('member-modal');
    const form = document.getElementById('member-form');
    
    form.reset();
    document.getElementById('member-uid').value = uid;
    
    // Ambil data user dari DB untuk pre-fill
    database.ref('users/' + uid).once('value').then(snap => {
        const data = snap.val();
        if (data) {
            document.getElementById('member-nama').value = data.nama || '';
            document.getElementById('member-email').value = data.email || '';
            document.getElementById('member-role').value = data.role || 'user';
            modal.classList.add('show');
        }
    }).catch(err => {
        console.error("Gagal mendapatkan data user:", err);
        showCustomModal('ERROR', 'Gagal', 'Tidak dapat memuat data pengguna.');
    });
}

function closeMemberModal() {
    document.getElementById('member-modal').classList.remove('show');
}

function saveMember(e) {
    e.preventDefault();
    console.group("Member Update Process");
    
    const uid = document.getElementById('member-uid').value;
    const nama = document.getElementById('member-nama').value;
    const email = document.getElementById('member-email').value;
    const role = document.getElementById('member-role').value;

    console.log("Updating UID:", uid);
    console.log("New Data:", { nama, email, role });

    if (!uid) {
        console.error("No UID provided for update");
        console.groupEnd();
        return;
    }

    const userData = {
        nama: nama,
        email: email,
        role: role
    };

    database.ref('users/' + uid).update(userData)
        .then(() => {
            console.log("Update successful!");
            showSuccessModal('Berhasil', 'Data pengguna telah diperbarui.');
            closeMemberModal();
        })
        .catch(err => {
            console.error("Update failed:", err);
            showCustomModal('ERROR', 'Gagal', err.message);
        })
        .finally(() => {
            console.groupEnd();
        });
}

function deleteUser(uid) {
    // Ambil nama user dulu untuk pesan konfirmasi
    database.ref('users/' + uid).once('value').then(snap => {
        const data = snap.val();
        const nama = data ? data.nama : 'Anggota ini';
        
        const modal = document.getElementById('confirm-modal');
        const desc = document.getElementById('confirm-modal-desc');
        const btn = document.getElementById('btn-confirm-delete-action');

        desc.innerHTML = `Apakah Anda yakin ingin menghapus <strong>${nama}</strong> dari anggota?`;
        
        // Simpan UID ke data-attribute tombol untuk dieksekusi nanti
        btn.onclick = () => {
            executeDelete(uid);
        };

        modal.classList.add('show');
    });
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('show');
}

function executeDelete(uid) {
    if (!database) return;
    
    database.ref('users/' + uid).remove()
        .then(() => {
            showSuccessModal('Berhasil', 'Data pengguna telah dihapus.');
            closeConfirmModal();
        })
        .catch(err => {
            showCustomModal('ERROR', 'Gagal', err.message);
        });
}
