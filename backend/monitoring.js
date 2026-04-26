// Water Monitoring and Charting Logic
const THRESHOLDS = {
    SIAGA1: 200, // 2 meter = Siaga 1 (Waspada) → Kuning
    SIAGA2: 300, // 3 meter = Siaga 2 (Bahaya)  → Merah
    MAX_TANK: 400 // 4 meter = Ketinggian Maksimal Tangki
};

let lastNotifState = 'AMAN';

// Chart & Global State
let waterChart;
let historyChart;
let currentWaterLevel = 0;
let chartIntervalTimer = null;
let currentHistoryRef = null;

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

// Format timestamp ke Tanggal Jam:Menit (WIB)
function formatTimestamp(ts) {
    const d = new Date(parseInt(ts));
    const now = new Date();
    
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const timeStr = `${h}:${m}`;

    // Jika bukan hari ini, tambahkan tanggal agar tidak bingung
    if (d.toDateString() !== now.toDateString()) {
        const day = d.getDate();
        const month = d.getMonth() + 1;
        return `${day}/${month} ${timeStr}`;
    }
    
    return timeStr;
}

// Initialize Chart (User/Admin)
function initChart(isAdmin = false) {
    initRealtimeChart(isAdmin);
    initHistoryChart(isAdmin);
}

function initRealtimeChart(isAdmin) {
    const canvasId = isAdmin ? 'adminWaterChart' : 'waterChart';
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    if (waterChart) waterChart.destroy();

    // Generate placeholder labels with actual HH:MM times
    const placeholderLabels = generateTimeSlotLabels();

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
                tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} cm` } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 400,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { color: '#475569', callback: v => v + 'cm', font: { size: 11 }, stepSize: 100 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#475569', font: { size: 11 } }
                }
            }
        }
    });
}

/**
 * Generate time slot labels based on current time
 * Shows last CHART_MAX_POINTS slots in 15-min intervals
 * e.g. at 11:00 → ['09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00']
 */
function generateTimeSlotLabels() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    // Round down to nearest 15-minute slot
    const currentSlot = Math.floor(currentMinutes / 15) * 15;
    
    const labels = [];
    for (let i = CHART_MAX_POINTS - 1; i >= 0; i--) {
        const slotMinutes = currentSlot - (i * 15);
        // Handle midnight wrap-around
        const adjustedMinutes = ((slotMinutes % 1440) + 1440) % 1440;
        const h = String(Math.floor(adjustedMinutes / 60)).padStart(2, '0');
        const m = String(adjustedMinutes % 60).padStart(2, '0');
        labels.push(`${h}:${m}`);
    }
    return labels;
}

function initHistoryChart(isAdmin = false) {
    const canvasId = isAdmin ? 'adminHistoryChart' : 'historyChart';
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    if (historyChart) {
        historyChart.destroy();
        historyChart = null;
    }

    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const ctx = canvasEl.getContext('2d');
    
    // Custom Plugin to draw horizontal threshold lines
    const thresholdLines = {
        id: 'thresholdLines',
        beforeDraw(chart) {
            const { ctx, chartArea: { left, right }, scales: { y } } = chart;
            ctx.save();
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(left, y.getPixelForValue(THRESHOLDS.SIAGA1));
            ctx.lineTo(right, y.getPixelForValue(THRESHOLDS.SIAGA1));
            ctx.stroke();

            ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(left, y.getPixelForValue(THRESHOLDS.SIAGA2));
            ctx.lineTo(right, y.getPixelForValue(THRESHOLDS.SIAGA2));
            ctx.stroke();
            ctx.restore();
        }
    };

    historyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tinggi Air (cm)',
                data: new Array(24).fill(0),
                backgroundColor: [],
                borderRadius: 5,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} cm` } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 400,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { color: '#475569', callback: v => v + 'cm', font: { size: 11 }, stepSize: 100 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#475569', font: { size: 10 }, autoSkip: false }
                }
            }
        },
        plugins: [thresholdLines]
    });

    const datePickerId = isAdmin ? 'admin-history-date' : 'history-date-picker';
    const datePicker = document.getElementById(datePickerId);
    if (datePicker) {
        if (!datePicker.value) {
            const today = new Date().toISOString().split('T')[0];
            datePicker.value = today;
            datePicker.max = today;
        }
        datePicker.onchange = (e) => fetchHistoryData(e.target.value);
        fetchHistoryData(datePicker.value);
    }
}

function handleDatePickerChange(e) {
    fetchHistoryData(e.target.value);
}

async function fetchHistoryData(dateStr) {
    if (!database) return;
    
    // Detach old listener if exists
    if (currentHistoryRef) {
        currentHistoryRef.off();
        currentHistoryRef = null;
    }
    
    currentHistoryRef = database.ref(`history/${dateStr}`);
    currentHistoryRef.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        const hourlyValues = Array.from({ length: 24 }, (_, i) => data[i] || 0);
        
        // Dynamic colors based on value
        const colors = hourlyValues.map(v => {
            if (v >= THRESHOLDS.SIAGA2) return 'rgba(239, 68, 68, 0.8)'; // Merah
            if (v >= THRESHOLDS.SIAGA1) return 'rgba(245, 158, 11, 0.8)'; // Kuning
            return 'rgba(14, 165, 233, 0.6)'; // Biru (Normal)
        });
        
        if (historyChart) {
            historyChart.data.datasets[0].data = hourlyValues;
            historyChart.data.datasets[0].backgroundColor = colors;
            historyChart.update();
        }
    }, (err) => {
        console.warn('Gagal mendengarkan data history:', err);
    });
}

function saveHourlyData(value) {
    if (!database || value === null || value === undefined) return;
    if (isSensorOffline) return; // Jangan simpan data jam jika sensor offline

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const hour = now.getHours();

    // Check if this hour is already saved to avoid redundant writes
    const path = `history/${dateStr}/${hour}`;
    database.ref(path).once('value', (snap) => {
        if (!snap.exists()) {
            database.ref(path).set(Math.round(value));
            
            // Clean up old history (> 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 31);
            const oldDateStr = thirtyDaysAgo.toISOString().split('T')[0];
            database.ref(`history/${oldDateStr}`).remove();
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
            const rawData = [];
            
            snapshot.forEach(child => {
                rawData.push({
                    key: parseInt(child.key),
                    value: child.val()
                });
            });

            // Pastikan terurut secara numerik (kronologis)
            rawData.sort((a, b) => a.key - b.key);

            const entries = rawData.map(d => d.value);
            const labels = rawData.map(d => formatTimestamp(d.key));

            // Padded dengan null di depan jika data kurang dari CHART_MAX_POINTS
            while (entries.length < CHART_MAX_POINTS) {
                entries.unshift(null);
                labels.unshift('--:--');
            }

            if (waterChart) {
                waterChart.data.labels = labels;
                waterChart.data.datasets[0].data = entries;
                waterChart.update('none');
            }
        });
}

// Save Chart Point (Max 1x per 15 minutes)
function saveChartPoint(value) {
    if (!database || value === null || value === undefined) return;
    if (isSensorOffline) return; // Jangan simpan jika sensor offline

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
    if (isSensorOffline) return; // Jangan simpan jika sensor offline

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
        if (currentWaterLevel !== null && currentWaterLevel !== undefined && !isSensorOffline) {
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
            const dateStr = offlineSince 
                ? new Date(offlineSince).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })
                : '';
            const timeStr = offlineSince 
                ? new Date(offlineSince).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) 
                : sinceText;
            msg = `Sensor mati dari tanggal ${dateStr} jam ${timeStr} WIB`;
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

    // ── Chart offline overlays ──
    updateChartOfflineOverlays(offline);
}

/**
 * Toggle offline overlay pada semua grafik (user + admin)
 */
function updateChartOfflineOverlays(offline) {
    const overlayIds = [
        'chart-offline-realtime',
        'chart-offline-history',
        'chart-offline-admin-realtime',
        'chart-offline-admin-history'
    ];
    overlayIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('visible', offline);
    });
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
        const offDate = new Date(offlineSince).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        const lastUpdateEl = document.getElementById('last-update');
        const adminSensorTime = document.getElementById('admin-sensor-time');
        
        if (lastUpdateEl) lastUpdateEl.textContent = `${offDate}, ${offTime}`;
        if (adminSensorTime) adminSensorTime.textContent = `${offDate}, ${offTime}`;
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

        // Hanya simpan data jika sensor online
        if (!isSensorOffline) {
            // 5. Smart save chart (maks 1x per 15 menit)
            maybeSaveChartPoint(data);
            
            // 6. Hourly data save (Mencatat setiap jam)
            saveHourlyData(data);
        }
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
