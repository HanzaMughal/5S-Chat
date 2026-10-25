// /api/send-notification.js
// Sends an FCM push notification to the recipient of a chat message.
// Called after a message is saved to the Realtime Database.

import { admin, db, verifyUser } from './_lib/admin.js';

const APP_URL = 'https://5schat.vercel.app';
const APP_ICON = `${APP_URL}/icon-192.png`;

// Database paths
const USERS_PATH = 'users';
const FCM_TOKENS_PATH = 'fcm_tokens';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
    // Apply CORS headers to every response
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    try {
        // ── 1. Authenticate the caller ─────────────────────────────────────────
        const senderId = await verifyUser(req, res);
        if (!senderId) return; // verifyUser already sent 401

        // ── 2. Parse & validate request body ──────────────────────────────────
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { recipientId, chatId, messageText, messageType } = body;

        if (!recipientId || typeof recipientId !== 'string' || !recipientId.trim()) {
            return res.status(400).json({ error: 'recipientId is required' });
        }
        if (!chatId || typeof chatId !== 'string' || !chatId.trim()) {
            return res.status(400).json({ error: 'chatId is required' });
        }
        if (recipientId.trim() === senderId) {
            return res.status(400).json({ error: 'recipientId must not equal senderId' });
        }

        const rid = recipientId.trim();
        const cid = chatId.trim();
        const msgType = (messageType || 'text').trim();

        // ── 3. Read sender profile & recipient FCM tokens in parallel ──────────
        const [senderSnap, tokensSnap] = await Promise.all([
            db.ref(`${USERS_PATH}/${senderId}`).once('value'),
            db.ref(`${FCM_TOKENS_PATH}/${rid}`).once('value'),
        ]);

        const senderData = senderSnap.val() || {};
        const senderName = senderData.username || senderData.displayName || 'Someone';
        const senderAvatar = senderData.avatar || APP_ICON;

        // ── 4. Collect FCM tokens ──────────────────────────────────────────────
        // Stored as { tokenString: true } or { tokenString: { ... } } or a bare string
        const tokensRaw = tokensSnap.val();
        if (!tokensRaw) {
            return res.status(200).json({ success: true, sent: 0, failed: 0 });
        }

        let tokens = [];
        if (typeof tokensRaw === 'string') {
            tokens = [tokensRaw];
        } else if (typeof tokensRaw === 'object') {
            tokens = Object.keys(tokensRaw).filter(k => k && k.length > 10);
        }

        if (tokens.length === 0) {
            return res.status(200).json({ success: true, sent: 0, failed: 0 });
        }

        // ── 5. Build notification body ─────────────────────────────────────────
        let notifBody;
        switch (msgType) {
            case 'image':  notifBody = 'Photo'; break;
            case 'audio':  notifBody = 'Voice message'; break;
            case 'file':   notifBody = 'File'; break;
            default: {
                const text = (messageText || '').trim();
                notifBody = text.length > 100 ? text.slice(0, 97) + '...' : (text || '(message)');
            }
        }

        const chatLink = `${APP_URL}/?chatId=${cid}`;

        // ── 6. Build multicast message ─────────────────────────────────────────
        const message = {
            tokens,
            notification: {
                title: senderName,
                body: notifBody,
                imageUrl: senderAvatar,
            },
            data: {
                chatId: cid,
                senderId,
                type: 'chat_message',
                link: chatLink,
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                },
            },
            apns: {
                payload: {
                    aps: { sound: 'default', badge: 1 },
                },
            },
            webpush: {
                notification: {
                    icon: senderAvatar,
                    badge: APP_ICON,
                    requireInteraction: false,
                },
                fcmOptions: {
                    link: chatLink,
                },
            },
        };

        // ── 7. Send & handle invalid-token cleanup ────────────────────────────
        const batchResponse = await admin.messaging().sendEachForMulticast(message);

        let sent = 0;
        let failed = 0;
        const invalidTokens = [];

        batchResponse.responses.forEach((resp, idx) => {
            if (resp.success) {
                sent++;
            } else {
                failed++;
                const errCode = resp.error?.code || '';
                if (
                    errCode === 'messaging/registration-token-not-registered' ||
                    errCode === 'messaging/invalid-registration-token'
                ) {
                    invalidTokens.push(tokens[idx]);
                }
                console.error(`[send-notification] FCM error for token[${idx}]:`, errCode, resp.error?.message);
            }
        });

        // Remove stale/invalid tokens from the database
        if (invalidTokens.length > 0) {
            const removeOps = invalidTokens.map(t =>
                db.ref(`${FCM_TOKENS_PATH}/${rid}/${t}`).remove().catch(e =>
                    console.error('[send-notification] Failed to remove invalid token:', e.message)
                )
            );
            await Promise.all(removeOps);
        }

        // ── 8. Return result ───────────────────────────────────────────────────
        return res.status(200).json({ success: true, sent, failed });

    } catch (err) {
        console.error('[/api/send-notification] Error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
