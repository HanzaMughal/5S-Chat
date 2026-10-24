import admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
const databaseURL = process.env.FIREBASE_DATABASE_URL;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
        }),
        databaseURL,
    });
}

export const auth = admin.auth();
export const db = admin.database();
export { admin };

/**
 * Verifies Bearer ID token from request Authorization header.
 * Returns the decoded user uid.
 * If res is provided, responds with 401 JSON on failure.
 * Otherwise, throws an Error with statusCode 401.
 */
export async function verifyUser(req, res = null) {
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        if (res && !res.headersSent) {
            res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
        }
        const err = new Error('Unauthorized: Missing or invalid Authorization header');
        err.statusCode = 401;
        if (!res) throw err;
        return null;
    }

    const token = authHeader.slice(7).trim();
    try {
        const decoded = await auth.verifyIdToken(token);
        return decoded.uid;
    } catch (err) {
        console.error('[verifyUser] Token verification error:', err.message);
        if (res && !res.headersSent) {
            res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }
        const error = new Error('Unauthorized: Invalid token');
        error.statusCode = 401;
        if (!res) throw error;
        return null;
    }
}
