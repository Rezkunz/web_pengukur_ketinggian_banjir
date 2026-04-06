importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker by passing in
// your app's Firebase config object.
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

// Retrieve an instance of Firebase Messaging so that it can handle background messages.
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification ? payload.notification.title : 'Peringatan Banjir';
    const notificationOptions = {
        body: payload.notification ? payload.notification.body : 'Level air telah berubah secara drastis.',
        icon: '/logo.png',
        badge: '/logo.png',
        vibrate: [200, 100, 200, 100, 200]
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
