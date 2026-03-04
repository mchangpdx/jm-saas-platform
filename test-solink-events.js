import axios from 'axios'; 

// ==========================================
// 사장님께서 제공해주신 솔링크 샌드박스 인증 정보
// ==========================================
const CLIENT_ID = "7df388c42e968295f2747890b8695cb1";
const CLIENT_SECRET = "1L0/pk/u4VvKu4nUNhb1tByDgZXSvwi8PLS1BCjINOaM5VxcD5um7MKhEYMG1TSGlZXT84c=";
const API_KEY = "FWcxTFalhW5ZNOxmgKUGW38EtLHA4PuM75BUa7jW";

async function testSolinkEvents() {
    try {
        console.log("🚀 1단계: 솔링크 출입증(토큰) 발급 요청 중...");
        
        const tokenResponse = await axios.post(
            "https://api-prod-us-west-2.solinkcloud.com/v2/oauth/token", 
            {
                client_id: CLIENT_ID, 
                client_secret: CLIENT_SECRET, 
                audience: "https://prod.solinkcloud.com/", 
                grant_type: "client_credentials" 
            },
            {
                headers: {
                    "x-api-key": API_KEY, 
                    "Content-Type": "application/json"
                }
            }
        );

        const token = tokenResponse.data.access_token;
        console.log("✅ 토큰 발급 성공!\n");

        console.log("🚀 2단계: 솔링크 클라우드에서 영수증 데이터 검색 중...");
        
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 7);
        
        const startTime = startDate.toISOString();
        const endTime = endDate.toISOString();

        console.log(`검색 기간: ${startTime} ~ ${endTime}`);

        // 👇 바로 이 부분입니다! headers에 x-api-key를 추가했습니다.
        const eventsResponse = await axios.get(
            `https://api-prod-us-west-2.solinkcloud.com/v2/events?startTime=${startTime}&endTime=${endTime}`,
            {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "x-api-key": API_KEY // ✨ 필수: 데이터 조회 시에도 API 키가 필요합니다!
                }
            }
        );

        console.log("\n🎉 [테스트 성공] 솔링크에서 검색된 영수증 데이터:");
        console.log("--------------------------------------------------");
        
        const events = eventsResponse.data.events || eventsResponse.data; 
        
        if (Array.isArray(events) && events.length > 0) {
            console.log(`총 검색된 이벤트 수: ${events.length}개`);
            console.log("👉 첫 번째 데이터 샘플 (최신 영수증):");
            console.log(JSON.stringify(events[0], null, 2));
        } else {
            console.log("⚠️ 해당 기간에 데이터가 없습니다.");
            console.log("전체 응답:", eventsResponse.data);
        }
        console.log("--------------------------------------------------");

    } catch (error) {
        console.error("❌ 에러 발생:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}

testSolinkEvents();