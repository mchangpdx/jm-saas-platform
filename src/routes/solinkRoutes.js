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
        // 2. Convert ISO timestamp → Unix milliseconds → Unix seconds (10-digit) required by Solink
        // (ISO 타임스탬프 → Unix 밀리초 → Solink가 요구하는 Unix 초(10자리)로 변환)
        const timestampMs      = new Date(timestamp).getTime();
        const timestampSeconds = Math.floor(timestampMs / 1000); // Solink expects seconds, not ms (Solink는 밀리초가 아닌 초 단위 요구)
        const utcDateStr       = new Date(timestampMs).toUTCString();

        if (isNaN(timestampMs)) {
            return res.status(400).json({
                success: false,
                message: "Invalid timestamp format. Must be a valid date string."
            });
        }

        // Debug log for timestamp alignment tracking (영수증-비디오 시간 불일치 추적용 디버그 로그)
        console.log([
            '┌─────────────────────────────────────────',
            '│  [Solink] Timestamp Debug',
            `│  cameraId         : ${cameraId}`,
            `│  raw input        : ${timestamp}`,
            `│  UTC string       : ${utcDateStr}`,
            `│  timestampMs      : ${timestampMs}`,
            `│  timestampSeconds : ${timestampSeconds}  ← sent to Solink`,
            '└─────────────────────────────────────────',
        ].join('\n'));

        // 3. Get Access Token
        const token = await getSolinkToken();

        // 4. Fetch Video Playback URL from Solink
        const response = await axios.get(CONFIG.videoLinkUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-api-key': CONFIG.apiKey
            },
            params: {
                cameraId:  cameraId,
                timestamp: timestampSeconds // Solink requires Unix seconds (10-digit), not milliseconds (Solink는 밀리초가 아닌 Unix 초(10자리) 요구)
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

// GET /api/solink/snapshot?cameraId=<uuid>&timestamp=<ISO8601>
// Proxies a still-frame snapshot image from Solink for the given camera and moment.
// Returns the raw image binary with the correct Content-Type so the browser <img> tag
// can display it directly without a separate fetch call from the frontend.
router.get('/snapshot', async (req, res) => {
    const { cameraId, timestamp } = req.query;

    // Validate required parameters
    if (!cameraId || !timestamp) {
        return res.status(400).json({
            success: false,
            message: "Missing required query parameters: 'cameraId' and/or 'timestamp'",
        });
    }

    // Validate and convert to ISO-8601 string — the snapshot API requires this format, not Unix seconds
    const timestampMs = new Date(timestamp).getTime();

    if (isNaN(timestampMs)) {
        return res.status(400).json({
            success: false,
            message: "Invalid timestamp format. Must be a valid ISO 8601 date string.",
        });
    }

    const timestampIso = new Date(timestampMs).toISOString(); // e.g. "2026-03-05T15:33:09.000Z"

    try {
        const token = await getSolinkToken();

        // Fetch snapshot as raw binary buffer — cameraId is in the URL path, timestamp as ISO-8601 string
        const response = await axios.get(
            `https://api-prod-us-west-2.solinkcloud.com/v2/cameras/${cameraId}/snapshot`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-api-key':     CONFIG.apiKey,
                },
                params: {
                    timestamp: timestampIso, // ISO-8601 string required by snapshot API (not Unix seconds)
                },
                responseType: 'arraybuffer', // Binary image data, not JSON
                timeout:      10_000,
            },
        );

        // Forward the image Content-Type from Solink (typically image/jpeg)
        const contentType = response.headers['content-type'] ?? 'image/jpeg';
        res.setHeader('Content-Type', contentType);

        // Cache snapshot aggressively — the frame at a fixed timestamp never changes
        res.setHeader('Cache-Control', 'public, max-age=3600');

        return res.send(Buffer.from(response.data));

    } catch (error) {
        console.error('[Solink Snapshot Error] Failed to fetch snapshot image:', error.response?.data || error.message);
        return res.status(502).json({
            success: false,
            message: 'Failed to retrieve snapshot from Solink',
            error:   error.response?.data || error.message,
        });
    }
});

export default router;