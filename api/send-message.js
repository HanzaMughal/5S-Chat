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
        const { chatId, text, type, url, quoted } = body;

        if (!chatId) {
            return res.status(400).json({ error: 'chatId is required' });
        }

        // 1. Verify caller is a member of the chat
        const chatSnap = await db.ref(`chats/${chatId}`).once('value');
        if (!chatSnap.exists()) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        const chat = chatSnap.val();
        if (!chat.members || !chat.members[callerUid]) {
            return res.status(403).json({ error: 'You are not a member of this chat' });
        }

        // Find receiver
        const otherUid = Object.keys(chat.members).find(id => id !== callerUid);
        if (!otherUid) {
            return res.status(400).json({ error: 'Receiver not found in chat members' });
        }

        // 2. Verify caller is not blocked either way
        const [callerBlockedSnap, otherBlockedSnap] = await Promise.all([
            db.ref(`users/${callerUid}/blocked/${otherUid}`).once('value'),
            db.ref(`users/${otherUid}/blocked/${callerUid}`).once('value')
        ]);

        if (callerBlockedSnap.exists() || otherBlockedSnap.exists()) {
            return res.status(403).json({ error: 'Cannot send message; user is blocked' });
        }

        // Determine message preview
        let preview = (text || '').trim();
        const msgType = type || 'text';
        if (msgType === 'audio') {
            preview = '🎤 Voice Note';
        } else if (msgType === 'file') {
            preview = '📎 ' + (preview || 'File');
        } else if (!preview && quoted) {
            preview = 'Quoted message';
        }

        if (!preview && !url) {
            return res.status(400).json({ error: 'Message content is required' });
        }

        // Generate message ID
        const msgRef = db.ref(`messages/${chatId}`).push();
        const messageId = msgRef.key;

        const msgData = {
            text: (text || '').trim(),
            sender: callerUid,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            type: msgType,
            status: 'sent',
            quoted: quoted ? {
                id: quoted.id,
                text: quoted.text || (quoted.type === 'audio' ? '🎤 Voice Note' : '📎 Media'),
                sender: quoted.sender
            } : null
        };
        if (url) {
            msgData.url = url;
        }

        // In ONE atomic update:
        // write message, update lastMessage and timestamp, increment receiver unread count
        const updates = {};
        updates[`messages/${chatId}/${messageId}`] = msgData;
        updates[`chats/${chatId}/lastMessage`] = preview;
        updates[`chats/${chatId}/timestamp`] = admin.database.ServerValue.TIMESTAMP;
        updates[`chats/${chatId}/lastSender`] = callerUid;
        updates[`chats/${chatId}/lastStatus`] = 'sent';
        updates[`chats/${chatId}/unread/${otherUid}`] = admin.database.ServerValue.increment(1);
        updates[`user_chats/${callerUid}/${chatId}`] = true;
        updates[`user_chats/${otherUid}/${chatId}`] = true;

        await db.ref().update(updates);

        return res.status(200).json({ success: true, messageId });
    } catch (err) {
        console.error('[/api/send-message] Error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
