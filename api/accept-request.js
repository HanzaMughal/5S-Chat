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
        const requestId = String(body.requestId || body.senderUid || body.uid || '').trim();

        if (!requestId) {
            return res.status(400).json({ error: 'requestId is required' });
        }

        // In existing RTDB schema, requests for caller are stored at requests/${callerUid}/${senderUid}
        const reqSnap = await db.ref(`requests/${callerUid}/${requestId}`).once('value');
        if (!reqSnap.exists()) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const reqData = reqSnap.val();

        // Verify caller is the receiver
        const isReceiver = reqData.type === 'incoming' || reqData.to === callerUid;
        if (!isReceiver) {
            return res.status(403).json({ error: 'Only the receiver can accept this request' });
        }

        // Verify status is pending
        if (reqData.status && reqData.status !== 'pending') {
            return res.status(400).json({ error: 'Request is not pending' });
        }

        const senderUid = reqData.from || requestId;

        // Deterministic chatId: both uids sorted and joined
        const [u1, u2] = [callerUid, senderUid].sort();
        const chatId = `${u1}_${u2}`;

        // ONE atomic multi-path update
        const updates = {};
        // Contacts for BOTH users
        updates[`users/${callerUid}/contacts/${senderUid}`] = true;
        updates[`users/${senderUid}/contacts/${callerUid}`] = true;
        // user_chats for BOTH users so existing realtime listeners update immediately
        updates[`user_chats/${callerUid}/${chatId}`] = true;
        updates[`user_chats/${senderUid}/${chatId}`] = true;
        // Chat node
        updates[`chats/${chatId}`] = {
            members: { [callerUid]: true, [senderUid]: true },
            lastMessage: 'Chat started',
            timestamp: admin.database.ServerValue.TIMESTAMP,
            lastSender: 'system',
            lastStatus: 'sent',
            unread: { [callerUid]: 0, [senderUid]: 0 }
        };
        // Remove requests for both sides
        updates[`requests/${callerUid}/${senderUid}`] = null;
        updates[`requests/${senderUid}/${callerUid}`] = null;

        await db.ref().update(updates);

        return res.status(200).json({ success: true, chatId });
    } catch (err) {
        console.error('[/api/accept-request] Error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
