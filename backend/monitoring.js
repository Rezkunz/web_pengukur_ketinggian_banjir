// Water Monitoring and Charting Logic
const THRESHOLDS = {
    SIAGA1: 200, // 2 meter = Siaga 1 (Waspada) → Kuning
    SIAGA2: 300, // 3 meter = Siaga 2 (Bahaya)  → Merah
    MAX_TANK: 400 // 4 meter = Ketinggian Maksimal Tangki
};

let lastNotifState = 'AMAN';

// Chart & Global State
let waterChart;
let currentWaterLevel = 0;
let chartIntervalTimer = null;

// Sensor Offline Detection Logic (20s polling)
const POLL_INTERVAL_MS = 3 * 1000; // Cek setiap 3 detik
const POLL_GAP_MS      = 1000;     // Jeda 1 detik antar sampel
let offlinePollTimer   = null;
let isSensorOffline    = false;
let lastOfflineCheckAt = null;
let offlineSince       = null; // Mencatat kapan sensor mulai offline

const CHART_HISTORY_PATH = 'sensor_data/chart_history';
const CHART_MAX_POINTS = 8; 
const CHART_INTERVAL_MS = 15 * 60 * 1000; // 15 Minutes

// Format timestamp ke jam:menit (WIB)
function formatTimestamp(ts) {
    const d = new Date(parseInt(ts));
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

// Initialize Chart (User/Admin)
function initChart(isAdmin = false) {
    const canvasId = isAdmin ? 'adminWaterChart' : 'waterChart';
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    if (waterChart) waterChart.destroy();

    // Label placeholder (akan diupdate oleh listener Firebase)
    const placeholderLabels = Array.from({ length: CHART_MAX_POINTS }, (_, i) => {
        const minutesAgo = (CHART_MAX_POINTS - 1 - i) * 15;
        return minutesAgo === 0 ? 'Skrg' : `-${minutesAgo}m`;
    });

    const ctx = canvasEl.getContext('2d');
    waterChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: placeholderLabels,
            datasets: [{
                label: 'Tinggi Air (cm)',
                data: new Array(CHART_MAX_POINTS).fill(null),
                borderColor: '#0ea5e9',
                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                tension: 0.4,
                fill: true,
                borderWidth: 2.5,
                pointBackgroundColor: '#0369a1',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                spanGaps: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.parsed.y} cm`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 400, // 4 meter max
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        color: '#475569',
                        callback: v => v + 'cm',
                        font: { size: 11 },
                        stepSize: 100
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#475569', font: { size: 11 } }
                }
            }
        }
    });
}

// Real-time Chart Listener
function startChartHistoryListener() {
    if (!database) return;

    database.ref(CHART_HISTORY_PATH)
        .orderByKey()
        .limitToLast(CHART_MAX_POINTS)
        .on('value', (snapshot) => {
            const entries = [];   // nilai ketinggian air
            const labels = [];   // label waktu dari timestamp key

            snapshot.forEach(child => {
                labels.push(formatTimestamp(child.key));
                entries.push(child.val());
            });

            // Padded dengan null di depan jika data kurang dari CHART_MAX_POINTS
            while (entries.length < CHART_MAX_POINTS) {
                entries.unshift(null);
                labels.unshift('--:--');
            }

            if (waterChart) {
                waterChart.data.labels = labels;
                waterChart.data.datasets[0].data = entries;
                waterChart.update('none'); // update tanpa animasi agar lebih cepat
            }
        });
}

// Save Chart Point (Max 1x per 15 minutes)
function saveChartPoint(value) {
    if (!database || value === null || value === undefined) return;

    const historyRef = database.ref(CHART_HISTORY_PATH);
    const now = Date.now();

    // Simpan titik baru dengan timestamp sebagai key
    historyRef.child(now.toString()).set(Math.round(value))
        .then(() => historyRef.orderByKey().once('value'))
        .then((snap) => {
            const keys = [];
            snap.forEach(child => keys.push(child.key));
            // Hapus entri lama jika melebihi batas CHART_MAX_POINTS
            const toDelete = keys.slice(0, Math.max(0, keys.length - CHART_MAX_POINTS));
            return Promise.all(toDelete.map(key => historyRef.child(key).remove()));
        })
        .catch(err => console.warn('Gagal menyimpan riwayat grafik:', err));
}

function maybeSaveChartPoint(value) {
    if (!database) return;

    const historyRef = database.ref(CHART_HISTORY_PATH);

    // Ambil entri terakhir untuk cek timestamp-nya
    historyRef.orderByKey().limitToLast(1).once('value', (snapshot) => {
        const now = Date.now();
        let shouldSave = true;

        snapshot.forEach(child => {
            const lastTimestamp = parseInt(child.key);
            if (!isNaN(lastTimestamp) && (now - lastTimestamp) < CHART_INTERVAL_MS) {
                shouldSave = false; // Belum 15 menit, jangan simpan
            }
        });

        if (shouldSave) saveChartPoint(value);
    });
}

// Auto-Save Timer
function startChartAutoSaveTimer() {
    if (chartIntervalTimer) clearInterval(chartIntervalTimer);
    chartIntervalTimer = setInterval(() => {
        if (currentWaterLevel !== null && currentWaterLevel !== undefined) {
            saveChartPoint(currentWaterLevel);
        }
    }, CHART_INTERVAL_MS);
}

// ─────────────────────────────────────────────────────
function calculatePercentage(currentValue, maxValue) {
    let percentage = (currentValue / maxValue) * 100;
    if (percentage > 100) percentage = 100;
    if (percentage < 5) percentage = 5;
    return percentage;
}

function updateUI(waterLevel) {
    if (!auth || !auth.currentUser) return;

    const currentLevelEl = document.getElementById('current-level');
    const waterFillEl = document.getElementById('water-fill');
    const alertPanelEl = document.getElementById('alert-panel');
    const alertMessageEl = document.getElementById('alert-message');
    const lastUpdateEl = document.getElementById('last-update');
    const adminStatusAir = document.getElementById('admin-status-air');
    const adminSensorTime = document.getElementById('admin-sensor-time');

    if (currentLevelEl) {
        currentLevelEl.textContent = Math.round(waterLevel);
    }

    const percentage = calculatePercentage(waterLevel, THRESHOLDS.MAX_TANK);
    if (waterFillEl) waterFillEl.style.height = `${percentage}%`;

    if (alertPanelEl) alertPanelEl.className = 'alert-section glass-panel';

    let currentState = 'AMAN';

    // Cek dari level tertinggi ke bawah
    if (waterLevel >= THRESHOLDS.SIAGA2) {
        // ≥ 300cm (3m) → SIAGA 2 (Bahaya, evakuasi)
        if (waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-siaga2)';
        if (alertPanelEl) alertPanelEl.classList.add('status-siaga2');
        if (alertMessageEl) {
            alertMessageEl.textContent = 'SIAGA 2 (Bahaya!)';
            alertMessageEl.style.color = 'var(--status-siaga2)';
        }
        if (adminStatusAir) { adminStatusAir.textContent = 'SIAGA 2'; adminStatusAir.style.color = 'var(--status-siaga2)'; }
        currentState = 'SIAGA2';
    } else if (waterLevel >= THRESHOLDS.SIAGA1) {
        // ≥ 200cm (2m) → SIAGA 1 (Waspada, himbauan)
        if (waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-siaga1)';
        if (alertPanelEl) alertPanelEl.classList.add('status-siaga1');
        if (alertMessageEl) {
            alertMessageEl.textContent = 'SIAGA 1 (Waspada)';
            alertMessageEl.style.color = 'var(--status-siaga1)';
        }
        if (adminStatusAir) { adminStatusAir.textContent = 'SIAGA 1'; adminStatusAir.style.color = 'var(--status-siaga1)'; }
        currentState = 'SIAGA1';
    } else {
        // < 200cm → Aman
        if (waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-aman)';
        if (alertPanelEl) alertPanelEl.classList.add('status-aman');
        if (alertMessageEl) { alertMessageEl.textContent = 'Aman'; alertMessageEl.style.color = 'var(--status-aman)'; }
        if (adminStatusAir) { adminStatusAir.textContent = 'Aman'; adminStatusAir.style.color = 'var(--status-aman)'; }
        currentState = 'AMAN';
    }

    if (currentState !== lastNotifState) {
        if (currentState === 'SIAGA2') {
            // SIAGA 2 = paling bahaya → wajib evakuasi ke pos terdekat
            const msg = `Ketinggian air mencapai ${Math.round(waterLevel)}cm.\n⚠️ PERINGATAN: Segera evakuasi dan pergi ke pos evakuasi terdekat!`;
            sendNotification('🚨 SIAGA 2 — Bahaya!', { body: msg });
            showCustomModal('SIAGA2', 'SIAGA 2 — Bahaya!', msg);
        } else if (currentState === 'SIAGA1') {
            // SIAGA 1 = waspada → himbauan evakuasi
            const msg = `Ketinggian air mencapai ${Math.round(waterLevel)}cm.\n🔔 HIMBAUAN: Masyarakat dihimbau untuk siap-siap evakuasi.`;
            sendNotification('⚠️ SIAGA 1 — Waspada', { body: msg });
            showCustomModal('SIAGA1', 'SIAGA 1 — Waspada', msg);
        }
        lastNotifState = currentState;
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString('id-ID') + ' WIB';
    if (lastUpdateEl) lastUpdateEl.textContent = timeString;
    if (adminSensorTime) adminSensorTime.textContent = timeString;
}

// ─────────────────────────────────────────────
// SENSOR OFFLINE DETECTION
// ─────────────────────────────────────────────


/**
 * Update semua elemen UI terkait status offline/online
 * @param {boolean} offline
 * @param {string}  sinceText  - waktu terakhir dicek (string)
 * @param {string}  reason     - alasan offline (opsional)
 */
function updateOfflineUI(offline, sinceText, reason) {
    let msg = reason;
    
    if (!msg) {
        if (offline) {
            // Jika offline, hitung waktu sejak offlineSince
            const timeStr = offlineSince 
                ? new Date(offlineSince).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) 
                : sinceText;
            msg = `Sensor mati dari jam ${timeStr} WIB`;
        } else {
            msg = `Sensor aktif — dicek ${sinceText}`;
        }
    }

    // ── Banner user ──
    const bannerUser = document.getElementById('offline-banner-user');
    if (bannerUser) {
        bannerUser.classList.toggle('visible', offline);
        const durEl = document.getElementById('offline-duration-user');
        if (durEl) durEl.textContent = msg;
    }

    // ── Banner admin ──
    const bannerAdmin = document.getElementById('offline-banner-admin');
    if (bannerAdmin) {
        bannerAdmin.classList.toggle('visible', offline);
        const durElA = document.getElementById('offline-duration-admin');
        if (durElA) durElA.textContent = msg;
    }

    // ── Admin sensor badge ──
    const badge      = document.getElementById('admin-sensor-badge');
    const badgeLabel = document.getElementById('admin-sensor-label');
    const badgeTime  = document.getElementById('admin-sensor-time');
    
    // ── New Stat Card Sensor Info ──
    const statStatus = document.getElementById('stat-sensor-status');
    const statIconWrap = document.getElementById('stat-sensor-icon');

    if (badge) {
        badge.className = `sensor-status-badge ${offline ? 'offline' : 'online'}`;
        if (badgeLabel) badgeLabel.textContent = offline ? 'Offline' : 'Online';
        // Tampilkan waktu mulai mati jika offline, atau waktu cek terakhir jika online
        if (badgeTime) {
            if (offline && offlineSince) {
                const offTime = new Date(offlineSince).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                badgeTime.textContent = `Mati sejak: ${offTime} WIB`;
            } else {
                badgeTime.textContent = `Dicek: ${sinceText}`;
            }
        }
    }

    if (statStatus) {
        statStatus.textContent = offline ? 'Offline' : 'Online';
        statStatus.style.color = offline ? 'var(--status-siaga1)' : 'var(--status-aman)';
    }

    if (statIconWrap) {
        statIconWrap.className = `stat-icon-wrap ${offline ? 'icon-orange' : 'icon-green'}`;
    }

    // ── Water tank visual ──
    const tank = document.getElementById('water-tank');
    if (tank) tank.classList.toggle('sensor-offline', offline);

    // ── Alert panel saat offline ──
    const alertPanel   = document.getElementById('alert-panel');
    const alertMessage = document.getElementById('alert-message');
    if (offline && alertPanel && alertMessage) {
        alertPanel.className = 'alert-section glass-panel status-offline';
        alertMessage.textContent = 'Sensor Offline';
        alertMessage.style.color = '#888';
    }
}

/**
 * Polling database untuk deteksi sensor offline.
 *
 * Cara kerja:
 *   1. Ambil nilai sensor_data/ts dari Firebase (sampel pertama)
 *   2. Tunggu POLL_GAP_MS (2 detik)
 *   3. Ambil lagi   sensor_data/ts (sampel kedua)
 *   4. Jika nilai berubah  → NodeMCU masih aktif kirim data = ONLINE
 *      Jika nilai sama     → tidak ada data baru dalam 2 detik    = OFFLINE
 *
 * Logika ini 100% akurat karena:
 *   - NodeMCU kirim ts (millis/1000) setiap 0.5 detik
 *   - Dalam jeda 2 detik, ts pasti berubah minimal 1
 *   - Kalau tidak berubah, berarti tidak ada write dari NodeMCU
 */
async function pollSensorStatus() {
    if (!database) return;

    try {
        // ── Strategi 1: gunakan sensor_data/ts jika ada ──
        // ts dikirim NodeMCU tiap 0.5 detik (millis/1000), selalu berubah
        const snap1ts = await database.ref('sensor_data/ts').once('value');
        const ts1     = snap1ts.val();

        // Jika ts belum ada (NodeMCU belum di-flash ulang),
        // gunakan water_level sebagai fallback
        const path = (ts1 !== null) ? 'sensor_data/ts' : 'sensor_data/water_level';

        // Sampel pertama
        const snap1 = await database.ref(path).once('value');
        const val1  = snap1.val();

        // Jika path juga null, tidak ada data apapun di Firebase
        if (val1 === null) {
            lastOfflineCheckAt = Date.now();
            setOfflineState(true, 'Belum ada data sensor di database');
            return;
        }

        // Tunggu jeda: lebih lama jika pakai water_level (bisa konstan)
        const gap = (ts1 !== null) ? POLL_GAP_MS : 10000; // 2 detik vs 10 detik
        await new Promise(r => setTimeout(r, gap));

        // Sampel kedua
        const snap2 = await database.ref(path).once('value');
        const val2  = snap2.val();

        lastOfflineCheckAt = Date.now();

        if (val2 === null) {
            setOfflineState(true, 'Data sensor hilang dari database');
            return;
        }

        if (ts1 !== null) {
            // Mode ts: nilai HARUS berubah dalam POLL_GAP_MS jika sensor aktif
            const isReallyOffline = (val1 === val2);
            // Jika offline, gunakan nilai 'val2' (timestamp dari server) sebagai waktu mulai mati
            setOfflineState(isReallyOffline, null, isReallyOffline ? val2 : null);
        } else {
            // Mode water_level: nilai mungkin konstan walau sensor aktif.
            // Jangan tampilkan offline hanya karena level sama.
            // Cukup tandai online selama data ada di database.
            setOfflineState(false);
            console.info('ℹ️ Mode fallback: ts belum ada. Upload kode NodeMCU terbaru untuk deteksi offline yang akurat.');
        }

    } catch (err) {
        console.warn('⚠️ Gagal polling sensor status:', err.message);
    }
}

/**
 * Set status offline/online dan update semua UI
 * @param {boolean} offline
 * @param {string}  reason
 * @param {number}  timestamp - Waktu server saat sensor terakhir aktif (ms)
 */
function setOfflineState(offline, reason, timestamp) {
    if (offline === isSensorOffline && !timestamp) return; // tidak berubah, skip
    isSensorOffline = offline;

    if (offline) {
        // Jika offline, gunakan timestamp dari database (jika ada) atau waktu sekarang
        if (!offlineSince) {
            offlineSince = timestamp || Date.now();
        }
    } else {
        // Baru saja kembali online
        offlineSince = null;
    }

    const sinceText = lastOfflineCheckAt
        ? new Date(lastOfflineCheckAt).toLocaleTimeString('id-ID') + ' WIB'
        : '-';

    // Update 'Terakhir diperbarui' di bawah grafik agar sinkron dengan waktu mati
    if (offline && offlineSince) {
        const offTime = new Date(offlineSince).toLocaleTimeString('id-ID') + ' WIB';
        const lastUpdateEl = document.getElementById('last-update');
        const adminSensorTime = document.getElementById('admin-sensor-time');
        
        if (lastUpdateEl) lastUpdateEl.textContent = offTime;
        if (adminSensorTime) adminSensorTime.textContent = offTime;
    }

    updateOfflineUI(offline, sinceText, reason);
}

/**
 * Mulai polling otomatis setiap POLL_INTERVAL_MS
 */
function startOfflineDetector() {
    if (offlinePollTimer) clearInterval(offlinePollTimer);

    // Cek pertama kali 3 detik setelah page load
    setTimeout(pollSensorStatus, 3 * 1000);

    // Polling rutin setiap 60 detik
    offlinePollTimer = setInterval(pollSensorStatus, POLL_INTERVAL_MS);
}

// ─────────────────────────────────────────────
// START: Listener utama untuk data sensor & grafik
// ─────────────────────────────────────────────
function startDataListener() {
    if (!database) return;

    // 1. Real-time listener grafik
    startChartHistoryListener();

    // 2. Auto-save timer tiap 15 menit
    startChartAutoSaveTimer();

    // 3. Mulai offline detector (polling setiap 60 detik)
    startOfflineDetector();

    // 4. Real-time listener data sensor
    const waterLevelRef = database.ref('sensor_data/water_level');
    waterLevelRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data === null) return;

        currentWaterLevel = data;
        
        // Langsung set ONLINE jika data masuk
        if (isSensorOffline) setOfflineState(false);
        
        updateUI(data);

        // 5. Smart save chart (maks 1x per 15 menit)
        maybeSaveChartPoint(data);
    });

    // 6. Real-time listener untuk sinkronisasi status offline awal
    database.ref('sensor_data/ts').on('value', (snap) => {
        const ts = snap.val();
        if (!ts) return;

        const now = Date.now();
        const diff = now - ts;

        // Jika data di DB sudah lebih dari 10 detik yang lalu, 
        // berarti saat ini sensor sudah offline
        if (diff > 10 * 1000) {
            setOfflineState(true, null, ts);
        } else {
            if (isSensorOffline) setOfflineState(false);
        }
    });
}
