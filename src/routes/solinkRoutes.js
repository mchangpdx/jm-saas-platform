import express from 'express';
import axios from 'axios';

const router = express.Router();

// ==========================================
// Solink Configuration (Ideally, use process.env)
// ==========================================
const CONFIG = {
    tokenUrl: "https://api-prod-us-west-2.solinkcloud.com/v2/oauth/token",
    videoLinkUrl: "https://api-prod-us-west-2.solinkcloud.com/v2/video/link", 
    clientId: process.env.SOLINK_CLIENT_ID || "7df388c42e968295f2747890b8695cb1",
    clientSecret: process.env.SOLINK_CLIENT_SECRET || "1L0/pk/u4VvKu4nUNhb1tByDgZXSvwi8PLS1BCjINOaM5VxcD5um7MKhEYMG1TSGlZXT84c=",
    apiKey: process.env.SOLINK_API_KEY || "FWcxTFalhW5ZNOxmgKUGW38EtLHA4PuM75BUa7jW",
    audience: "https://prod.solinkcloud.com/"
};

/**
 * Helper Function: Fetch Solink Access Token
 */
async function getSolinkToken() {
    try {
        const response = await axios.post(CONFIG.tokenUrl, {
            client_id: CONFIG.clientId,
            client_secret: CONFIG.clientSecret,
            grant_type: "client_credentials",
            audience: CONFIG.audience
        }, { 
            headers: { 'x-api-key': CONFIG.apiKey } 
        });
        return response.data.access_token;
    } catch (error) {
        console.error("[Solink Auth Error] Failed to fetch token:", error.response?.data || error.message);
        throw new Error("Solink Authentication Failed");
    }
}

/**
 * GET /api/solink/video-link
 * Query Params:
 * - cameraId: string (e.g., "3f34c890-17fb-11f1-a67a-af67afbf5812")
 * - timestamp: string (ISO 8601 format, e.g., "2026-03-05T15:33:09Z")
 */
router.get('/video-link', async (req, res) => {
    const { cameraId, timestamp } = req.query;

    // 1. Validate query parameters
    if (!cameraId || !timestamp) {
        return res.status(400).json({ 
            success: false, 
            message: "Missing required query parameters: 'cameraId' and/or 'timestamp'" 
        });
    }

    try {
        console.log(`[Solink API] Requesting video link for Camera: ${cameraId} at Time: ${timestamp}`);

        // 2. Convert ISO timestamp string to Unix Milliseconds to prevent the "1969 Epoch" error
        const timestampMs = new Date(timestamp).getTime();

        if (isNaN(timestampMs)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid timestamp format. Must be a valid date string." 
            });
        }

        // 3. Get Access Token
        const token = await getSolinkToken();

        // 4. Fetch Video Playback URL from Solink
        const response = await axios.get(CONFIG.videoLinkUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-api-key': CONFIG.apiKey
            },
            params: {
                cameraId: cameraId,
                timestamp: timestampMs // Sending numeric milliseconds
            }
        });

        // 5. Return the URL to the frontend
        console.log(`[Solink API] Successfully retrieved video link.`);
        return res.status(200).json({
            success: true,
            data: {
                url: response.data.url
            }
        });

    } catch (error) {
        console.error("[Solink API Error] Failed to get video link:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve video link from Solink",
            error: error.response?.data || error.message
        });
    }
});

// GET /api/solink/cameras
// Returns a list of all cameras registered to this Solink account (Solink 계정에 등록된 카메라 목록 반환)
router.get('/cameras', async (_req, res) => {
    try {
        const token = await getSolinkToken();
        const response = await axios.get(
            'https://api-prod-us-west-2.solinkcloud.com/v2/cameras',
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-api-key': CONFIG.apiKey
                },
                timeout: 8_000
            }
        );
        // Normalize to id + name + status fields (id, name, status 필드로 정규화)
        const cameras = (Array.isArray(response.data) ? response.data : []).map(cam => ({
            id:     cam.id     ?? cam.cameraId ?? '',
            name:   cam.name   ?? cam.label   ?? 'Unnamed Camera',
            status: cam.status ?? 'unknown'
        }));
        return res.json({ success: true, data: cameras });
    } catch (error) {
        console.error('[Solink Cameras Error] Failed to fetch camera list (카메라 목록 조회 실패):', error.response?.data || error.message);
        return res.status(502).json({
            success: false,
            message: 'Failed to retrieve camera list from Solink',
            error: error.response?.data || error.message
        });
    }
});

export default router;