import axios from 'axios';

// ==========================================
// [설정 정보 - 기존 키 그대로 사용]
// ==========================================
const CONFIG = {
    tokenUrl: "https://api-prod-us-west-2.solinkcloud.com/v2/oauth/token",
    cameraUrl: "https://api-prod-us-west-2.solinkcloud.com/v2/cameras",
    clientId: "7df388c42e968295f2747890b8695cb1",
    clientSecret: "1L0/pk/u4VvKu4nUNhb1tByDgZXSvwi8PLS1BCjINOaM5VxcD5um7MKhEYMG1TSGlZXT84c=",
    apiKey: "FWcxTFalhW5ZNOxmgKUGW38EtLHA4PuM75BUa7jW",
    audience: "https://prod.solinkcloud.com/"
};

async function getCameraId() {
    console.log("🚀 Solink Camera List Fetcher Started (ESM Version)...\n");

    // 1. 토큰 발급 (로그인)
    let token = "";
    try {
        const authRes = await axios.post(CONFIG.tokenUrl, {
            client_id: CONFIG.clientId,
            client_secret: CONFIG.clientSecret,
            grant_type: "client_credentials",
            audience: CONFIG.audience
        }, { headers: { 'x-api-key': CONFIG.apiKey } });
        token = authRes.data.access_token;
        console.log("✅ Token received!");
    } catch (e) { 
        console.error("❌ Login Failed"); 
        return; 
    }

    // 2. 카메라 리스트 조회
    console.log(`📡 Fetching cameras from: ${CONFIG.cameraUrl}\n`);
    try {
        const response = await axios.get(CONFIG.cameraUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-api-key': CONFIG.apiKey
            }
        });
        
        const cameras = response.data;
        
        if (cameras.length === 0) {
            console.log("⚠️ 등록된 카메라가 없습니다.");
            return;
        }

        console.log("🎉 [성공] 카메라 리스트를 불러왔습니다!\n");
        console.log("==========================================");
        cameras.forEach((cam, index) => {
            console.log(`📷 카메라 #${index + 1}`);
            console.log(`   - 이름(Name): ${cam.name}`);
            console.log(`   - ★ ID (이 값을 복사): ${cam.id}`);
            console.log(`   - 상태(Status): ${cam.status}`);
            console.log("------------------------------------------");
        });

    } catch (error) {
        console.log(`❌ Failed: ${error.response ? error.response.status : error.message}`);
    }
}

getCameraId();