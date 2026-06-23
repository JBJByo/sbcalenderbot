require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js'); // EmbedBuilder 제거
const http = require('http');

// ================= [ Render 잠자기 방지용 가짜 웹 서버 ] =================
const PORT = process.env.PORT || 3005;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 디스코드 봇이 정상 구동 중입니다!');
}).listen(PORT, () => {
    console.log(`🌐 가짜 웹 서버가 ${PORT}번 포트에서 작동 중입니다. (Render 우회용)`);
});
// ====================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// 역할에 맞는 채널 ID 설정
const MAIN_FORUM_ID = "1442443517313024100";     // 메인 포스팅 포럼 (머미)
const OTHER_FORUM_ID = "1518830708179730563";    // 추가 포스팅 포럼 (기타 모집)
const ANNOUNCEMENT_TEXT_ID = "1515045364045053952"; // 현황판 텍스트 채널 ID

const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*마감[\s]*[)\]]|마감/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*일협[\s]*[)\]]|일협/g; 

client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard();
});

async function updateAnnouncementBoard() {
    try {
        const textChannel = await client.channels.fetch(ANNOUNCEMENT_TEXT_ID).catch(() => null);
        if (!textChannel) {
            console.log("❌ 현황판 채널을 찾을 수 없습니다. ID 설정을 확인해주세요.");
            return;
        }

        const murderScheduleList = [];   
        const murderRecruitingList = []; 
        const otherScheduleList = [];
        const otherRecruitingList = [];
        const now = Date.now();

        const processThread = (thread, scheduleArr, recruitingArr) => {
            const title = thread.name;
            if (title.includes("펑")) return;

            const url = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
            let sortKey;
            let displayTitle;

            let cleanedTitle = title.replace(MARAM_PATTERN, '').replace(ILHYEOP_PATTERN, '').replace(/\s+/g, ' ').trim();
            const match = title.match(DATE_PATTERN);
            
            // 날짜 및 고정 문구에서 회색 박스(백틱) 기호 완전히 제거
            if (match) {
                const monthNum = parseInt(match[1], 10);
                const dayNum = parseInt(match[2], 10);
                const monthStr = String(monthNum).padStart(2, '0');
                const dayStr = String(dayNum).padStart(2, '0');

                sortKey = { month: monthNum, day: dayNum, isIlhyeop: false };
                cleanedTitle = cleanedTitle.replace(match[0], '').replace(/\s+/g, ' ').trim();
                displayTitle = `${monthStr}/${dayStr} ┃ ${cleanedTitle}`;
            } else {
                if (title.includes("일협")) {
                    sortKey = { month: 98, day: 98, isIlhyeop: true }; 
                    displayTitle = `일협 ┃ ${cleanedTitle}`;
                } else {
                    sortKey = { month: 99, day: 99, isIlhyeop: false };
                    displayTitle = `상시 ┃ ${cleanedTitle}`;
                }
            }

            // 신규 글 표시 원래대로 유지
            const lastTouchTime = thread.editedTimestamp || thread.createdTimestamp;
            const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
            if (now - lastTouchTime < TWENTY_FOUR_HOURS) {
                displayTitle += " ⭐NEW!⭐";
            }

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

        // 1. 머미 포럼 데이터 수집
        try {
            const mainForum = await client.channels.fetch(MAIN_FORUM_ID);
            if (mainForum) {
                const mainActiveThreads = await mainForum.threads.fetchActive();
                for (const [_, thread] of mainActiveThreads.threads) {
                    processThread(thread, murderScheduleList, murderRecruitingList);
                }
            }
        } catch (e) {
            console.log("⚠️ 메인 포럼(머미) 수집 실패");
        }

        // 2. 기타 포럼 데이터 수집
        try {
            const otherForum = await client.channels.fetch(OTHER_FORUM_ID);
            if (otherForum) {
                const otherActiveThreads = await otherForum.threads.fetchActive();
                for (const [_, thread] of otherActiveThreads.threads) {
                    processThread(thread, otherScheduleList, otherRecruitingList);
                }
            }
        } catch (e) {
            console.log("⚠️ 추가 포럼(기타) 수집 실패");
        }

        // 정렬
        const sortFunction = (a, b) => {
            if (a.sortKey.month !== b.sortKey.month) return a.sortKey.month - b.sortKey.month;
            return a.sortKey.day - b.sortKey.day;
        };
        murderScheduleList.sort(sortFunction);
        murderRecruitingList.sort(sortFunction);
        otherScheduleList.sort(sortFunction);
        otherRecruitingList.sort(sortFunction);

        // ==========================================
        // 📝 일반 텍스트 포맷으로 현황판 데이터 조립
        // ==========================================
        let finalMessage = "# 📢 실시간 포스팅 현황판\n\n";

        // [1] 머미 마감 일정
        finalMessage += "### 🩸 머미 마감 일정\n";
        if (murderScheduleList.length > 0) {
            // > 기호로 세로선을 넣고 리스트 번호는 굵게(**) 만들어 깔끔하게 만듭니다.
            murderScheduleList.forEach((post, i) => finalMessage += `> **${i + 1}.** ${post.text}\n`);
        } else {
            finalMessage += "> *등록된 머미 마감 일정이 없습니다.* 🥲\n";
        }
        finalMessage += "\n";

        // [2] 머미 모집 중
        finalMessage += "### 🔎 머미 모집 중\n";
        if (murderRecruitingList.length > 0) {
            murderRecruitingList.forEach((post, i) => finalMessage += `> **${i + 1}.** ${post.text}\n`);
        } else {
            finalMessage += "> *모집 중인 머미 포스팅이 없습니다.* 👀\n";
        }
        finalMessage += "\n";

        // [3] 기타 모집 완료
        finalMessage += "### 📌 기타 모집 완료\n";
        if (otherScheduleList.length > 0) {
            otherScheduleList.forEach((post, i) => finalMessage += `> **${i + 1}.** ${post.text}\n`);
        } else {
            finalMessage += "> *등록된 기타 완료 일정이 없습니다.*\n";
        }
        finalMessage += "\n";

        // [4] 기타 모집 중
        finalMessage += "### 🚀 기타 모집 중\n";
        if (otherRecruitingList.length > 0) {
            otherRecruitingList.forEach((post, i) => finalMessage += `> **${i + 1}.** ${post.text}\n`);
        } else {
            finalMessage += "> *모집 중인 기타 포스팅이 없습니다.*\n";
        }

        // 🧹 기존 메시지 청소
        try {
            const fetched = await textChannel.messages.fetch({ limit: 100 });
            if (fetched.size > 0) {
                await textChannel.bulkDelete(fetched).catch(async () => {
                    for (const msg of fetched.values()) {
                        await msg.delete().catch(() => {});
                    }
                });
            }
        } catch (cleanError) {
            console.error("🧹 현황판 채널 청소 중 오류 발생:", cleanError);
        }

        // 🚀 최종 조립된 텍스트 메시지만 전송
        await textChannel.send({ 
            content: finalMessage 
        });

        console.log("✅ 일반 텍스트 포맷으로 현황판 완벽 갱신 완료!");

    } catch (error) {
        console.error("현황판 갱신 중 오류 발생:", error);
    }
}

// 실시간 감시 리스너 (기존 threadUpdate 오류 수정 완료)
const watchChannels = [MAIN_FORUM_ID, OTHER_FORUM_ID];
client.on('threadCreate', async (thread) => { if (watchChannels.includes(thread.parentId)) await updateAnnouncementBoard(); });
client.on('threadUpdate', async (before, after) => { if (watchChannels.includes(after.parentId)) await updateAnnouncementBoard(); });
client.on('threadDelete', async (thread) => { if (watchChannels.includes(thread.parentId)) await updateAnnouncementBoard(); });

client.login(process.env.DISCORD_TOKEN);
