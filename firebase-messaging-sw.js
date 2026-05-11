importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyChO4h8v33LB_ovIXcBg-yVJrmN40N0WUk",
    authDomain: "safe-93f61.firebaseapp.com",
    projectId: "safe-93f61",
    storageBucket: "safe-93f61.firebasestorage.app",
    messagingSenderId: "323210012333",
    appId: "1:323210012333:web:3704c556377b5a45600824",
    measurementId: "G-HSWSEVKJD1",
    databaseURL: "https://safe-93f61-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// SW Lifecycle: Force activation
self.addEventListener('install', (event) => {
    console.log('[SW] Melakukan Instalasi...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Aktivasi Berhasil. Mengambil kendali klien...');
    event.waitUntil(clients.claim());
});

// Handle Background Messages
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Pesan Latar Belakang Diterima:', payload);
    return showNotification(payload);
});

// Manual push listener removed to prevent duplicate notifications with onBackgroundMessage


function showNotification(payload) {
    // Ambil data dari payload notification ATAU payload data
    const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || '🚨 PERINGATAN BANJIR';
    const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || 'Level air dalam kondisi bahaya!';

    const notificationOptions = {
        body: body,
        icon: '/logo.png',
        badge: '/logo.png',
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110],
        tag: 'flood-alert',
        renotify: true,
        requireInteraction: true,
        data: {
            url: '/'
        },
        actions: [
            { action: 'open', title: 'Buka Aplikasi' }
        ]
    };

    return self.registration.showNotification(title, notificationOptions);
}

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
