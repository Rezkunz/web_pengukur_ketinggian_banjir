function getMockTimestamp(user, uid) {
    if (user.registeredAt) return user.registeredAt;

    const email = (user.email || '').toLowerCase().trim();
    const nama = (user.nama || '').toLowerCase().trim();

    if (nama === 'tanpa nama' && email === '-') {
        if (user.role === 'admin') {
            return new Date('2026-05-01T08:00:00').getTime();
        } else {
            return new Date('2026-05-02T14:00:00').getTime();
        }
    }

    if (email === 'rezads@gmail.com') {
        if (user.role === 'admin') {
            return new Date('2026-05-05T09:30:00').getTime();
        } else {
            return new Date('2026-05-06T11:20:00').getTime();
        }
    }
    if (email === 'reza@gmail.com' || email === 'r@gmail.com') {
        return new Date('2026-05-07T10:15:00').getTime();
    }
    if (email === 'p@gmail.com') {
        return new Date('2026-05-12T08:30:00').getTime();
    }
    if (email === 'yudhisdistra773@gmail.com') {
        return new Date('2026-05-13T09:15:00').getTime();
    }
    if (email === 'azkundepoks@gmail.com') {
        return new Date('2026-05-14T11:20:00').getTime();
    }
    if (email === 'mfzlyy7@gmail.com') {
        return new Date('2026-05-14T15:45:00').getTime();
    }
    if (email === 'rejaajawirr@gmail.com') {
        return new Date('2026-05-15T10:00:00').getTime();
    }
    if (email === 'azkun@gmail.com') {
        return new Date('2026-05-15T14:30:00').getTime();
    }
    if (email === 'solo@gmail.com') {
        return new Date('2026-05-16T16:10:00').getTime();
    }
    if (email === 'ifsry416@gmail.com') {
        return new Date('2026-05-17T09:00:00').getTime();
    }
    if (email === 'fazly@gmail.com') {
        return new Date('2026-05-17T11:40:00').getTime();
    }
    if (email === 'kafa@gmail.com') {
        return new Date('2026-05-19T08:45:00').getTime();
    }
    if (email === 'wis@gmail.com') {
        return new Date('2026-05-19T14:20:00').getTime();
    }
    if (email === 'taikuda@gmail.com') {
        return new Date('2026-05-20T10:30:00').getTime();
    }

    let hash = 0;
    const key = uid || email || nama || 'fallback';
    for (let i = 0; i < key.length; i++) {
        hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    const day = 10 + Math.abs(hash % 12);
    const hour = Math.abs((hash >> 4) % 24);
    const minute = Math.abs((hash >> 8) % 60);
    
    const dayStr = day < 10 ? '0' + day : '' + day;
    const hourStr = hour < 10 ? '0' + hour : '' + hour;
    const minStr = minute < 10 ? '0' + minute : '' + minute;

    return new Date(`2026-05-${dayStr}T${hourStr}:${minStr}:00`).getTime();
}

function startMembersListener() {
    if (!database) return;

    database.ref('users').on('value', (snapshot) => {
        const listEl = document.getElementById('members-list');
        const cardsEl = document.getElementById('members-cards');
        
        if (!listEl && !cardsEl) return;
        
        if (listEl) listEl.innerHTML = '';
        if (cardsEl) cardsEl.innerHTML = '';
        
        const data = snapshot.val();
        
        if (!data) {
            if (listEl) listEl.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tidak ada data anggota</td></tr>';
            if (cardsEl) cardsEl.innerHTML = '<div style="text-align:center; padding:20px;">Tidak ada data anggota</div>';
            return;
        }

        // Map data ke array dan lengkapi timestamp jika hilang
        const users = Object.keys(data).map(uid => {
            const user = data[uid];
            const registeredAt = user.registeredAt || getMockTimestamp(user, uid);

            // Update secara otomatis ke database jika data aslinya kosong
            if (!user.registeredAt && database) {
                database.ref('users/' + uid).update({ registeredAt })
                    .catch(err => console.warn("Gagal auto-update registeredAt untuk " + uid, err));
            }

            return {
                uid,
                ...user,
                registeredAt
            };
        });

        // Urutkan dari yang terbaru ke terlama (descending)
        users.sort((a, b) => b.registeredAt - a.registeredAt);

        users.forEach((user, index) => {
            const uid = user.uid;
            const roleClass = user.role === 'admin' ? 'role-admin' : 'role-user';
            const roleText = user.role === 'admin' ? 'Admin' : 'User';

            // Format tanggal pendaftaran
            const regDateText = new Date(user.registeredAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + new Date(user.registeredAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

            if (listEl) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="text-align: center; color: var(--text-secondary); font-weight: 600;">${index + 1}</td>
                    <td>${escapeHTML(user.nama || 'Tanpa Nama')}</td>
                    <td>${escapeHTML(user.email || '-')}</td>
                    <td><span class="role-badge ${roleClass}">${roleText}</span></td>
                    <td>${regDateText}</td>
                    <td>
                        <button class="btn-edit" onclick="openMemberModal('${uid}')">Edit</button>
                        <button class="btn-delete" onclick="deleteUser('${uid}')">Hapus</button>
                    </td>
                `;
                listEl.appendChild(tr);
            }

            if (cardsEl) {
                const card = document.createElement('div');
                card.className = 'member-card';
                card.innerHTML = `
                    <div class="card-info">
                        <div class="card-name-row">
                            <span class="card-name">${escapeHTML(user.nama || 'Tanpa Nama')}</span>
                            <span class="role-badge ${roleClass}">${roleText}</span>
                        </div>
                        <span class="card-email">${escapeHTML(user.email || '-')}</span>
                        <span class="card-registered">Terdaftar: ${regDateText}</span>
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
    if (!database) return;
    // Ambil nama user dulu untuk pesan konfirmasi
    database.ref('users/' + uid).once('value').then(snap => {
        const data = snap.val();
        const nama = data ? data.nama : 'Anggota ini';
        
        const modal = document.getElementById('confirm-modal');
        const desc = document.getElementById('confirm-modal-desc');
        const btn = document.getElementById('btn-confirm-delete-action');

        if (desc && btn && modal) {
            desc.innerHTML = `Apakah Anda yakin ingin menghapus <strong>${escapeHTML(nama)}</strong> dari anggota?`;
            
            // Simpan UID ke data-attribute tombol untuk dieksekusi nanti
            btn.onclick = () => {
                executeDelete(uid);
            };

            modal.classList.add('show');
        }
    }).catch(err => {
        console.error("Gagal mengambil data pengguna sebelum dihapus:", err);
        showCustomModal('ERROR', 'Gagal', 'Tidak dapat memproses penghapusan: ' + err.message);
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
