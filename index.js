require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js'); 
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

        // 🧹 [단계 1] 채널의 기존 메시지 청소
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

        // 🚀 [단계 2] 실시간 자수 계산 및 안전 전송 함수 (2000자 초과 차단 시스템)
        const sendSafeSection = async (sectionTitle, list, emptyMessage) => {
            let currentMsg = `${sectionTitle}\n`;
            
            if (list.length === 0) {
                currentMsg += `${emptyMessage}\n`;
                await textChannel.send({ content: currentMsg });
                return;
            }

            for (let i = 0; i < list.length; i++) {
                const line = `> **${i + 1}.** ${list[i].text}\n`;
                
                // 디스코드 제한 2000자보다 안전하게 1800자 기준으로 끊어 전송
                if (currentMsg.length + line.length > 1800) {
                    await textChannel.send({ content: currentMsg });
                    currentMsg = line; // 다음 메시지는 이 줄부터 시작
                } else {
                    currentMsg += line;
                }
            }
            
            if (currentMsg.length > 0) {
                await textChannel.send({ content: currentMsg });
            }
        };

        // 3. 실제 순차 전송 실행
        await textChannel.send({ content: "# 📢 실시간 포스팅 현황판" });

        await sendSafeSection("### 🩸 머미 마감 일정", murderScheduleList, "> *등록된 머미 마감 일정이 없습니다.* 🥲");
        await sendSafeSection("### 🔎 머미 모집 중", murderRecruitingList, "> *모집 중인 머미 포스팅이 없습니다.* 👀");
        await sendSafeSection("### 📌 기타 모집 완료", otherScheduleList, "> *등록된 기타 완료 일정이 없습니다.*");
        await sendSafeSection("### 🚀 기타 모집 중", otherRecruitingList, "> *모집 중인 기타 포스팅이 없습니다.*");

        console.log("✅ 안전 분할 시스템으로 현황판 갱신 완료!");

    } catch (error) {
        console.error("현황판 갱신 중 오류 발생:", error);
    }
}

// 실시간 감시 리스너
const watchChannels = [MAIN_FORUM_ID, OTHER_FORUM_ID];
client.on('threadCreate', async (thread) => { if (watchChannels.includes(thread.parentId)) await updateAnnouncementBoard(); });
client.on('threadUpdate', async (before, after) => { if (watchChannels.includes(after.parentId)) await updateAnnouncementBoard(); });
client.on('threadDelete', async (thread) => { if (watchChannels.includes(thread.parentId)) await updateAnnouncementBoard(); });

client.login(process.env.DISCORD_TOKEN);
