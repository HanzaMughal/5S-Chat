import { admin, db, verifyUser } from './_lib/admin.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    try {
        const callerUid = await verifyUser(req, res);
        if (!callerUid) return;

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const chatId = String(body.chatId || '').trim();

        if (!chatId) {
            return res.status(400).json({ error: 'chatId is required' });
        }

        // 1. Verify caller is a member
        const chatSnap = await db.ref(`chats/${chatId}`).once('value');
        if (!chatSnap.exists()) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        const chat = chatSnap.val();
        if (!chat.members || !chat.members[callerUid]) {
            return res.status(403).json({ error: 'You are not a member of this chat' });
        }

        const updates = {};

        // 2. Set my unread to 0
        updates[`chats/${chatId}/unread/${callerUid}`] = 0;

        // If last message was from the other user, mark lastStatus as seen
        if (chat.lastSender && chat.lastSender !== callerUid) {
            updates[`chats/${chatId}/lastStatus`] = 'seen';
        }

        // 3. Set status "seen" only on messages sent by OTHER user that are not yet seen
        // Never mark caller's own messages
        const msgsSnap = await db.ref(`messages/${chatId}`).once('value');
        const messages = msgsSnap.val() || {};

        let markedCount = 0;
        for (const [msgId, msg] of Object.entries(messages)) {
            if (msg.sender !== callerUid && msg.status !== 'seen') {
                updates[`messages/${chatId}/${msgId}/status`] = 'seen';
                updates[`messages/${chatId}/${msgId}/seenAt`] = admin.database.ServerValue.TIMESTAMP;
                markedCount++;
            }
        }

        await db.ref().update(updates);

        return res.status(200).json({ success: true, markedCount });
    } catch (err) {
        console.error('[/api/mark-read] Error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
