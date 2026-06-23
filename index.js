require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');

// ================= [ Render 잠자기 방지용 가짜 웹 서버 ] =================
const PORT = process.env.PORT || 3008;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 디스코드 봇이 정상 구동 중입니다!');
}).listen(PORT, () => {
    console.log(`🌐 가짜 웹 서버가 ${PORT}번 포트에서 작동 중입니다. (Render 우회용)`);
});
// ====================================================================

// 1. 봇의 기본 권한(Intents) 설정
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// 2. 역할에 맞는 채널 ID 설정
const MAIN_FORUM_ID = "1442443517313024100";     // 메인 포스팅 포럼 (머미)
const OTHER_FORUM_ID = "1518830708179730563";    // 추가 포스팅 포럼 (기타 모집)
const ANNOUNCEMENT_TEXT_ID = "1515045364045053952"; // 로직을 통해 목록이 업데이트되는 현황판 텍스트 채널 ID

// 3. 제목 처리를 위한 정규표현식 패턴
const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*마감[\s]*[)\]]|마감/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*일협[\s]*[)\]]|일협/g; 

client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard();
});

// 핵심 로직: 두 포럼의 글을 모아 하나의 현황판으로 작성
async function updateAnnouncementBoard() {
    try {
        const textChannel = await client.channels.fetch(ANNOUNCEMENT_TEXT_ID).catch(() => null);

        if (!textChannel) {
            console.log("❌ 현황판 채널을 찾을 수 없습니다. ID 설정을 확인해주세요.");
            return;
        }

        // 머미용 배열
        const murderScheduleList = [];   
        const murderRecruitingList = []; 
        // 기타 모집용 배열
        const otherScheduleList = [];
        const otherRecruitingList = [];

        const now = Date.now();

        // 스레드 데이터를 처리하여 알맞은 배열에 넣는 공통 함수
        const processThread = (thread, scheduleArr, recruitingArr) => {
            const title = thread.name;
            if (title.includes("펑")) return; // "펑" 포함 글은 제외

            const url = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
            let sortKey;
            let displayTitle;

            let cleanedTitle = title.replace(MARAM_PATTERN, '').replace(ILHYEOP_PATTERN, '').replace(/\s+/g, ' ').trim();
            const match = title.match(DATE_PATTERN);
            
            if (match) {
                const month = parseInt(match[1], 10);
                const day = parseInt(match[2], 10);
                sortKey = { month, day, isIlhyeop: false };
                cleanedTitle = cleanedTitle.replace(match[0], '').replace(/\s+/g, ' ').trim();
                // 🎨 날짜 부분을 굵게(**) 강조 처리
                displayTitle = `**[${month}/${day}]** ${cleanedTitle}`;
            } else {
                if (title.includes("일협")) {
                    sortKey = { month: 98, day: 98, isIlhyeop: true }; 
                    // 🎨 일협 텍스트를 굵게(**) 강조 처리
                    displayTitle = `**(일협)** ${cleanedTitle}`;
                } else {
                    sortKey = { month: 99, day: 99, isIlhyeop: false };
                    displayTitle = cleanedTitle;
                }
            }

            // ================= 🕒 [진짜 NEW! 글만 판별하는 로직] =================
            const lastTouchTime = thread.editedTimestamp || thread.createdTimestamp;
            const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

            if (now - lastTouchTime < TWENTY_FOUR_HOURS) {
                displayTitle += " ⭐NEW!⭐";
            }
            // ============================================================================

            const postData = {
                sortKey,
                text: `${displayTitle} ([이동](${url}))`
            };

            if (title.includes("마감") || title.includes("꽉")) {
                scheduleArr.push(postData);
            } else {
                recruitingArr.push(postData);
            }
        };

        // 1. 머미 포럼 글 가져오기
        try {
            const mainForum = await client.channels.fetch(MAIN_FORUM_ID);
            if (mainForum) {
                const mainActiveThreads = await mainForum.threads.fetchActive();
                for (const [_, thread] of mainActiveThreads.threads) {
                    processThread(thread, murderScheduleList, murderRecruitingList);
                }
            }
        } catch (e) {
            console.log("⚠️ 메인 포럼(머미)을 읽어오는 중 문제가 발생했습니다.");
        }

        // 2. 기타 모집 포럼 글 가져오기
        try {
            const otherForum = await client.channels.fetch(OTHER_FORUM_ID);
            if (otherForum) {
                const otherActiveThreads = await otherForum.threads.fetchActive();
                for (const [_, thread] of otherActiveThreads.threads) {
                    processThread(thread, otherScheduleList, otherRecruitingList);
                }
            }
        } catch (e) {
            console.log("⚠️ 추가 포럼(기타 모집)을 읽어오는 중 문제가 발생했습니다.");
        }

        // 정렬 함수
        const sortFunction = (a, b) => {
            if (a.sortKey.month !== b.sortKey.month) return a.sortKey.month - b.sortKey.month;
            return a.sortKey.day - b.sortKey.day;
        };

        murderScheduleList.sort(sortFunction);
        murderRecruitingList.sort(sortFunction);
        otherScheduleList.sort(sortFunction);
        otherRecruitingList.sort(sortFunction);

        // ==========================================
        // 🎨 디자인이 적용된 현황판 텍스트 구성 시작
        // ==========================================
        const lines = []; // 배열 초기화 시 \n 제거

        // 1. 메인 타이틀과 인용구, 그리고 첫 구분선
        lines.push("# 📢 실시간 포스팅 현황판");
        lines.push("> 머미 및 기타 모집 일정을 실시간으로 안내합니다.");
        lines.push("---");
        lines.push(""); // 깔끔하게 한 칸 띄우기 (엔터 중복 방지)
        
        // --- 머미 파트 ---
        lines.push("## 🩸 머미 마감 일정");
        if (murderScheduleList.length > 0) {
            murderScheduleList.forEach((post, i) => lines.push(`${i + 1}. ${post.text}`));
        } else {
            lines.push("*등록된 머미 마감 일정이 없습니다.* 🥲");
        }
        lines.push("");
        lines.push("---"); // 구역 분리용 가로선
        lines.push("");

        lines.push("## 🔎 머미 모집 중");
        if (murderRecruitingList.length > 0) {
            murderRecruitingList.forEach((post, i) => lines.push(`${i + 1}. ${post.text}`));
        } else {
            lines.push("*모집 중인 머미 포스팅이 없습니다.* 👀");
        }
        lines.push("");
        lines.push("---");
        lines.push("");

        // --- 기타 모집 파트 ---
        lines.push("## 📌 기타 모집 완료");
        if (otherScheduleList.length > 0) {
            otherScheduleList.forEach((post, i) => lines.push(`${i + 1}. ${post.text}`));
        } else {
            lines.push("*등록된 기타 완료 일정이 없습니다.*");
        }
        lines.push("");
        lines.push("---");
        lines.push(""); 

        lines.push("## 🚀 기타 모집 중");
        if (otherRecruitingList.length > 0) {
            otherRecruitingList.forEach((post, i) => lines.push(`${i + 1}. ${post.text}`));
        } else {
            lines.push("*모집 중인 기타 포스팅이 없습니다.*");
        }

        // 📦 1. 2000자 안 넘게 청크(덩어리) 분할하기
        const MAX_LENGTH = 1900;
        const chunks = [];
        let currentChunk = "";

        for (const line of lines) {
            if ((currentChunk + line + "\n").length > MAX_LENGTH) {
                if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
                currentChunk = line + "\n"; 
            } else {
                currentChunk += line + "\n";
            }
        }
        if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());

        // 🧹 2. 현황판 텍스트 채널 안의 모든 메시지를 싹 밀어버립니다.
        try {
            const fetched = await textChannel.messages.fetch({ limit: 100 });
            if (fetched.size > 0) {
                await textChannel.bulkDelete(fetched).catch(async () => {
                    for (const msg of fetched.values()) {
                        await msg.delete().catch(() => {});
                    }
                });
                console.log(`🧹 현황판 채널 내 기존 메시지 ${fetched.size}개를 완전히 청소했습니다.`);
            }
        } catch (cleanError) {
            console.error("🧹 현황판 채널 청소 중 오류 발생:", cleanError);
        }

        // 📝 3. 텅 빈 채널에 새 현황판 깔끔하게 발송
        for (const chunk of chunks) {
            await textChannel.send(chunk);
        }

        console.log("✅ 중복 없는 새 현황판 완벽 갱신 완료!");

    } catch (error) {
        console.error("현황판 갱신 중 오류 발생:", error);
    }
}

// 실시간 감시 이벤트 리스너들 (두 채널 모두 감시)
const watchChannels = [MAIN_FORUM_ID, OTHER_FORUM_ID];

client.on('threadCreate', async (thread) => {
    if (watchChannels.includes(thread.parentId)) await updateAnnouncementBoard();
});

client.on('threadUpdate', async (before, after) => {
    if (watchChannels.includes(after.parentId)) await updateAnnouncementBoard();
});

client.on('threadDelete', async (thread) => {
    if (watchChannels.includes(thread.parentId)) await updateAnnouncementBoard();
});

client.login(process.env.DISCORD_TOKEN);
