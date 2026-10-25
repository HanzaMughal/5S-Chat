// public/firebase-messaging-sw.js
// Firebase Cloud Messaging Service Worker for background push notifications.
// Must be at the root of the served domain (served via /firebase-messaging-sw.js).

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// ─── Firebase config (must match the one in the main app) ─────────────────────
// These are public client-side keys (safe to embed in service worker).
firebase.initializeApp({
    apiKey: "AIzaSyB_MS4r1-kG0TuSt_YYTADTNxgXix0BTM0",
    authDomain: "fir-chat-3a76d.firebaseapp.com",
    databaseURL: "https://fir-chat-3a76d-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "fir-chat-3a76d",
    storageBucket: "fir-chat-3a76d.firebasestorage.app",
    messagingSenderId: "430056427282",
    appId: "1:430056427282:web:ac4bb300596cf4176c6dcb"
});

const messaging = firebase.messaging();

// ─── Background message handler ────────────────────────────────────────────────
// Called when the app is in the background or closed.
// Foreground messages are handled in the main app via onMessage().
messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Background message received:', payload);

    const { notification = {}, data = {} } = payload;

    const title = notification.title || data.senderName || '5S Chat';
    const body  = notification.body  || '(new message)';
    const icon  = notification.icon  || notification.imageUrl || '/icon-192.png';
    const link  = data.link || '/';

    const notifOptions = {
        body,
        icon,
        badge: '/icon-192.png',
        tag: data.chatId || 'chat',       // Collapse repeated notifications for same chat
        renotify: true,
        requireInteraction: false,
        data: { link },
    };

    return self.registration.showNotification(title, notifOptions);
});

// ─── Notification click handler ────────────────────────────────────────────────
// Opens (or focuses) the app and navigates to the chat when user taps the notification.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const link = event.notification.data?.link || '/';

    event.waitUntil(
        clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then((windowClients) => {
                // If the app is already open, focus it and navigate
                for (const client of windowClients) {
                    if ('navigate' in client) {
                        client.focus();
                        return client.navigate(link);
                    }
                }
                // Otherwise open a new window
                return clients.openWindow(link);
            })
    );
});
