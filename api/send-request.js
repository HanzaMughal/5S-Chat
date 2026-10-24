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
        const toNumericUid = String(body.toNumericUid || '').trim();

        if (!toNumericUid) {
            return res.status(400).json({ error: 'toNumericUid is required' });
        }

        // 1. Find target user by numeric_uid
        const uidSnap = await db.ref(`uids/${toNumericUid}`).once('value');
        let targetUid = uidSnap.val();

        if (!targetUid) {
            // Fallback lookup in users node
            const userQuerySnap = await db.ref('users').orderByChild('numeric_uid').equalTo(toNumericUid).once('value');
            if (userQuerySnap.exists()) {
                targetUid = Object.keys(userQuerySnap.val())[0];
            }
        }

        if (!targetUid) {
            return res.status(404).json({ error: 'User not found' });
        }

        // 2. Reject if self
        if (targetUid === callerUid) {
            return res.status(400).json({ error: 'Cannot add yourself' });
        }

        // 3. Reject if blocked either way
        const [callerBlockedSnap, targetBlockedSnap] = await Promise.all([
            db.ref(`users/${callerUid}/blocked/${targetUid}`).once('value'),
            db.ref(`users/${targetUid}/blocked/${callerUid}`).once('value')
        ]);

        if (callerBlockedSnap.exists() || targetBlockedSnap.exists()) {
            return res.status(403).json({ error: 'User is blocked' });
        }

        // 4. Reject if already contacts
        const [callerContactSnap, targetContactSnap] = await Promise.all([
            db.ref(`users/${callerUid}/contacts/${targetUid}`).once('value'),
            db.ref(`users/${targetUid}/contacts/${callerUid}`).once('value')
        ]);

        const [u1, u2] = [callerUid, targetUid].sort();
        const chatId = `${u1}_${u2}`;
        const userChatSnap = await db.ref(`user_chats/${callerUid}/${chatId}`).once('value');

        if (callerContactSnap.exists() || targetContactSnap.exists() || userChatSnap.exists()) {
            return res.status(400).json({ error: 'Already contacts' });
        }

        // 5. Check if pending request exists
        // Check if target already sent a request to caller -> auto-accept
        const incomingFromTargetSnap = await db.ref(`requests/${callerUid}/${targetUid}`).once('value');
        if (incomingFromTargetSnap.exists()) {
            const inc = incomingFromTargetSnap.val();
            if (inc.status === 'pending' || inc.type === 'incoming') {
                // Auto-accept request in ONE atomic multi-path update
                const updates = {};
                updates[`users/${callerUid}/contacts/${targetUid}`] = true;
                updates[`users/${targetUid}/contacts/${callerUid}`] = true;
                updates[`user_chats/${callerUid}/${chatId}`] = true;
                updates[`user_chats/${targetUid}/${chatId}`] = true;
                updates[`chats/${chatId}`] = {
                    members: { [callerUid]: true, [targetUid]: true },
                    lastMessage: 'Chat started',
                    timestamp: admin.database.ServerValue.TIMESTAMP,
                    lastSender: 'system',
                    lastStatus: 'sent',
                    unread: { [callerUid]: 0, [targetUid]: 0 }
                };
                updates[`requests/${callerUid}/${targetUid}`] = null;
                updates[`requests/${targetUid}/${callerUid}`] = null;

                await db.ref().update(updates);
                return res.status(200).json({ success: true, autoAccepted: true, chatId });
            }
        }

        // Check if caller already sent a request to target
        const outgoingToTargetSnap = await db.ref(`requests/${targetUid}/${callerUid}`).once('value');
        if (outgoingToTargetSnap.exists()) {
            return res.status(400).json({ error: 'A pending request already exists' });
        }

        // 6. Write the request
        const now = admin.database.ServerValue.TIMESTAMP;
        const updates = {};
        updates[`requests/${targetUid}/${callerUid}`] = {
            type: 'incoming',
            status: 'pending',
            from: callerUid,
            to: targetUid,
            timestamp: now
        };
        updates[`requests/${callerUid}/${targetUid}`] = {
            type: 'outgoing',
            status: 'pending',
            from: callerUid,
            to: targetUid,
            timestamp: now
        };

        await db.ref().update(updates);
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[/api/send-request] Error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
