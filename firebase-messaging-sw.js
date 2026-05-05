importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyChO4h8v33LB_ovIXcBg-yVJrmN40N0WUk",
    authDomain: "safe-93f61.firebaseapp.com",
    projectId: "safe-93f61",
    storageBucket: "safe-93f61.firebasestorage.app",
    messagingSenderId: "323210012333",
    appId: "1:323210012333:web:3704c556377b5a45600824",
    measurementId: "G-HSWSEVKJD1"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Handle Background Messages
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Pesan Latar Belakang Diterima:', payload);
    
    const notificationTitle = payload.notification ? payload.notification.title : '🚨 PERINGATAN BANJIR';
    const notificationOptions = {
        body: payload.notification ? payload.notification.body : 'Level air dalam kondisi bahaya! Segera cek aplikasi.',
        icon: '/logo.png',
        badge: '/logo.png',
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40], // SOS Pattern
        tag: 'flood-alert', // Mencegah notifikasi menumpuk banyak
        renotify: true, // Bergetar lagi jika ada notifikasi baru dengan tag sama
        requireInteraction: true, // Notifikasi tidak hilang sampai diklik
        data: {
            url: '/' // Bisa diarahkan ke halaman spesifik
        },
        actions: [
            { action: 'open', title: 'Buka Aplikasi' }
        ]
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle Notification Click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return clients.openWindow('/');
        })
    );
});
