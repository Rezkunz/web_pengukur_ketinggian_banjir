// Water Monitoring and Charting Logic
const THRESHOLDS = {
    SIAGA1: 250,
    SIAGA2: 200,
    MAX_TANK: 400
};

let lastNotifState = 'AMAN';

// Chart
let waterChart;
let currentWaterLevel = 0;
let chartIntervalTimer = null;

// ── Sensor Offline Detection ──
// Strategi: polling database tiap 60 detik.
// Ambil sensor_data/ts dua kali dengan jeda 2 detik.
// Jika nilai berubah  → sensor ONLINE (NodeMCU masih kirim data).
// Jika nilai sama    → sensor OFFLINE (tidak ada data baru).
const POLL_INTERVAL_MS = 20 * 1000; // polling dipercepat menjadi 20 detik untuk respons lebih cepat
const POLL_GAP_MS      = 2000;       // jeda antara dua sampling (2 detik)
let offlinePollTimer   = null;
let isSensorOffline    = false;
let lastOfflineCheckAt = null;       // kapan terakhir polling dilakukan

const CHART_HISTORY_PATH = 'sensor_data/chart_history';
const CHART_MAX_POINTS = 8; // 8 titik = 2 jam data (8 × 15 menit)
const CHART_INTERVAL_MS = 15 * 60 * 1000; // 15 menit dalam milidetik

// Format timestamp ke jam:menit (WIB)
function formatTimestamp(ts) {
    const d = new Date(parseInt(ts));
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

// ─────────────────────────────────────────────
// CHART INIT
// ─────────────────────────────────────────────
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
                borderColor: '#6e93b3',
                backgroundColor: 'rgba(110, 147, 179, 0.15)',
                tension: 0.4,
                fill: true,
                borderWidth: 2.5,
                pointBackgroundColor: '#476a8a',
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
                    max: 350,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { callback: v => v + 'cm', font: { size: 11 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 } }
                }
            }
        }
    });
}

// ─────────────────────────────────────────────
// REAL-TIME CHART LISTENER (baca dari Firebase)
// Semua device akan mendapat data & label waktu yang sama secara real-time.
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// SMART SAVE: Simpan ke Firebase hanya jika sudah
// lewat 15 menit dari entri terakhir, atau belum ada data.
// Dipanggil saat data sensor baru masuk DAN dari setInterval.
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// AUTO-SAVE TIMER: Pastikan data tersimpan tiap 15 menit
// meskipun tidak ada perubahan sensor masuk.
// ─────────────────────────────────────────────
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

    if (currentLevelEl) currentLevelEl.textContent = Math.round(waterLevel);

    const percentage = calculatePercentage(waterLevel, THRESHOLDS.MAX_TANK);
    if (waterFillEl) waterFillEl.style.height = `${percentage}%`;

    if (alertPanelEl) alertPanelEl.className = 'alert-section glass-panel';

    let currentState = 'AMAN';

    // SIAGA 2 (≥250cm) lebih bahaya dari SIAGA 1 (≥200cm)
    // Cek threshold tertinggi dulu
    if (waterLevel >= THRESHOLDS.SIAGA1) {
        // Level ≥ 250cm → SIAGA 2 (paling bahaya, wajib evakuasi)
        if (waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-siaga1)';
        if (alertPanelEl) alertPanelEl.classList.add('status-siaga1');
        if (alertMessageEl) { alertMessageEl.textContent = 'SIAGA 2 (Bahaya!)'; alertMessageEl.style.color = 'var(--status-siaga1)'; }
        if (adminStatusAir) { adminStatusAir.textContent = 'SIAGA 2'; adminStatusAir.style.color = '#e74c3c'; }
        currentState = 'SIAGA2';
    } else if (waterLevel >= THRESHOLDS.SIAGA2) {
        // Level ≥ 200cm → SIAGA 1 (waspada, himbauan evakuasi)
        if (waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-siaga2)';
        if (alertPanelEl) alertPanelEl.classList.add('status-siaga2');
        if (alertMessageEl) { alertMessageEl.textContent = 'SIAGA 1 (Waspada)'; alertMessageEl.style.color = 'var(--status-siaga2)'; }
        if (adminStatusAir) { adminStatusAir.textContent = 'SIAGA 1'; adminStatusAir.style.color = '#f1c40f'; }
        currentState = 'SIAGA1';
    } else {
        if (waterFillEl) waterFillEl.style.backgroundColor = 'var(--water-aman)';
        if (alertPanelEl) alertPanelEl.classList.add('status-aman');
        if (alertMessageEl) { alertMessageEl.textContent = 'Aman'; alertMessageEl.style.color = 'var(--status-aman)'; }
        if (adminStatusAir) { adminStatusAir.textContent = 'Aman'; adminStatusAir.style.color = '#58d68d'; }
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
    const msg = reason || (offline
        ? `Tidak ada data baru sejak pengecekan terakhir (${sinceText})`
        : `Sensor aktif — dicek ${sinceText}`);

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
        if (badgeTime) badgeTime.textContent = `Dicek: ${sinceText}`;
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
            // Mode ts: nilai HARUS berubah dalam 2 detik jika sensor aktif
            setOfflineState(val1 === val2);
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
 */
function setOfflineState(offline, reason) {
    if (offline === isSensorOffline) return; // tidak berubah, skip
    isSensorOffline = offline;

    const sinceText = lastOfflineCheckAt
        ? new Date(lastOfflineCheckAt).toLocaleTimeString('id-ID') + ' WIB'
        : '-';

    updateOfflineUI(offline, sinceText, reason);
}

/**
 * Mulai polling otomatis setiap POLL_INTERVAL_MS
 */
function startOfflineDetector() {
    if (offlinePollTimer) clearInterval(offlinePollTimer);

    // Cek pertama kali 10 detik setelah page load
    // (beri waktu Firebase listener untuk setup)
    setTimeout(pollSensorStatus, 10 * 1000);

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
        
        // Langsung set ONLINE jika data masuk (menghilangkan delay respon)
        if (isSensorOffline) setOfflineState(false);
        
        updateUI(data);

        // 5. Smart save chart (maks 1x per 15 menit)
        maybeSaveChartPoint(data);
    });
}
