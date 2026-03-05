import axios from 'axios';

const CONFIG = {
    tokenUrl: "https://api-prod-us-west-2.solinkcloud.com/v2/oauth/token",
    videoLinkUrl: "https://api-prod-us-west-2.solinkcloud.com/v2/video/link", 
    clientId: "7df388c42e968295f2747890b8695cb1",
    clientSecret: "1L0/pk/u4VvKu4nUNhb1tByDgZXSvwi8PLS1BCjINOaM5VxcD5um7MKhEYMG1TSGlZXT84c=",
    apiKey: "FWcxTFalhW5ZNOxmgKUGW38EtLHA4PuM75BUa7jW",
    audience: "https://prod.solinkcloud.com/"
};

async function fetchVideoUrl() {
    console.log("🚀 Solink Video Link Fetcher Started (Fixing 1969 Date)...\n");

    const cameraId = "3f34c890-17fb-11f1-a67a-af67afbf5812"; 
    
    // ★ [수정됨] ISO 문자열을 Unix Timestamp(밀리초 숫자)로 완벽하게 변환합니다.
    const targetDateStr = "2026-03-05T15:33:09Z";
    const timestampMs = new Date(targetDateStr).getTime(); 
    
    console.log(`⏱️ 변환된 시간값(숫자): ${timestampMs}`);

    // 1. 토큰 발급
    let token = "";
    try {
        const authRes = await axios.post(CONFIG.tokenUrl, {
            client_id: CONFIG.clientId,
            client_secret: CONFIG.clientSecret,
            grant_type: "client_credentials",
            audience: CONFIG.audience
        }, { headers: { 'x-api-key': CONFIG.apiKey } });
        token = authRes.data.access_token;
    } catch (e) { 
        console.error("❌ Login Failed", e.message); 
        return; 
    }

    // 2. 비디오 링크 요청 (문자열이 아닌 숫자를 파라미터로 전송)
    try {
        const response = await axios.get(CONFIG.videoLinkUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-api-key': CONFIG.apiKey
            },
            params: {
                cameraId: cameraId,
                timestamp: timestampMs // ★ 밀리초 단위의 숫자가 들어갑니다.
            }
        });
        
        console.log("\n🎉 [성공] 1969년 에러가 해결된 정확한 재생 URL입니다!");
        console.log("▶️ URL:", response.data.url);
        console.log("\n💡 Solink에 미리 로그인해둔 브라우저 탭에 이 주소를 붙여넣어 보세요.");

    } catch (error) {
        console.log(`❌ Failed: ${error.response ? error.response.status : error.message}`);
        if (error.response) console.log(error.response.data);
    }
}

fetchVideoUrl();