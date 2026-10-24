import { db, verifyUser } from './_lib/admin.js';

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

        const reqSnap = await db.ref(`requests/${callerUid}/${requestId}`).once('value');
        if (!reqSnap.exists()) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const reqData = reqSnap.val();

        // Verify receiver only
        const isReceiver = reqData.type === 'incoming' || reqData.to === callerUid;
        if (!isReceiver) {
            return res.status(403).json({ error: 'Only the receiver can reject this request' });
        }

        const senderUid = reqData.from || requestId;

        const updates = {};
        updates[`requests/${callerUid}/${senderUid}`] = null;
        updates[`requests/${senderUid}/${callerUid}`] = null;

        await db.ref().update(updates);

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[/api/reject-request] Error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
