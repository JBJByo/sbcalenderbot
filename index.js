require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');

// ================= [ Render 잠자기 방지용 가짜 웹 서버 ] =================
const PORT = process.env.PORT || 3000;
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

// 2. 내 서버에 맞게 수정해야 하는 ID 설정
const FORUM_CHANNEL_ID = "1442443517313024100"; // 감시할 포럼(게시판) 채널 ID
const TEXT_CHANNEL_ID = "1515045364045053952";  // 알림판 목록을 나열할 일반 텍스트 채널 ID

// 3. 제목 처리를 위한 정규표현식 패턴
const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*마감[\s]*[)\]]|마감/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*일협[\s]*[)\]]|일협/g; 

client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard();
});

// 핵심 로직: 기존 채널을 통째로 밀어버리고 새 현황판을 작성하는 함수
async function updateAnnouncementBoard() {
    try {
        const forumChannel = await client.channels.fetch(FORUM_CHANNEL_ID);
        const textChannel = await client.channels.fetch(TEXT_CHANNEL_ID);

        if (!forumChannel || !textChannel) {
            console.log("❌ 채널 ID를 찾을 수 없습니다. ID 설정을 확인해주세요.");
            return;
        }

        const scheduleList = [];   
        const recruitingList = []; 

        const activeThreads = await forumChannel.threads.fetchActive();

        for (const [_, thread] of activeThreads.threads) {
            const title = thread.name;
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
                displayTitle = `[${month}/${day}] ${cleanedTitle}`;
            } else {
                if (title.includes("일협")) {
                    sortKey = { month: 98, day: 98, isIlhyeop: true }; 
                    displayTitle = `(일협) ${cleanedTitle}`;
                } else {
                    sortKey = { month: 99, day: 99, isIlhyeop: false };
                    displayTitle = cleanedTitle;
                }
            }

            // ================= 🕒 [최근 24시간 이내 신규 글 체크] =================
            const createdAt = thread.createdTimestamp; // 스레드 생성 시간 (ms)
            const now = Date.now();                    // 현재 시간 (ms)
            const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24시간을 밀리초로 환산

            // 생성된 지 24시간이 지나지 않았다면 제목 뒤에 한 칸 띄우고 붙이기
            if (now - createdAt < TWENTY_FOUR_HOURS) {
                displayTitle += " ⭐NEW!⭐";
            }
            // ====================================================================

            const postData = {
                sortKey,
                text: `${displayTitle} ([바로가기](${url}))`
            };

            if (title.includes("마감")) {
                scheduleList.push(postData);
            } else {
                recruitingList.push(postData);
            }
        }

        const sortFunction = (a, b) => {
            if (a.sortKey.month !== b.sortKey.month) return a.sortKey.month - b.sortKey.month;
            return a.sortKey.day - b.sortKey.day;
        };

        scheduleList.sort(sortFunction);
        recruitingList.sort(sortFunction);

        const lines = ["📢 **실시간 포스팅 현황판** 📢\n"];
        lines.push("📌 **(일정)**");
        if (scheduleList.length > 0) {
            scheduleList.forEach((post, i) => lines.push(`${i + 1}. ${post.text}`));
        } else {
            lines.push("등록된 마감 일정이 없습니다.");
        }

        lines.push(""); 

        lines.push("🚀 **(모집중)**");
        if (recruitingList.length > 0) {
            recruitingList.forEach((post, i) => lines.push(`${i + 1}. ${post.text}`));
        } else {
            lines.push("모집 중인 포스팅이 없습니다.");
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

        // 🧹 2. [무조건 전체 청소] 채널 안의 모든 메시지를 예외 없이 싹 밀어버립니다.
        try {
            const fetched = await textChannel.messages.fetch({ limit: 100 });
            if (fetched.size > 0) {
                await textChannel.bulkDelete(fetched).catch(async () => {
                    for (const msg of fetched.values()) {
                        await msg.delete().catch(() => {});
                    }
                });
                console.log(`🧹 채널 내 기존 메시지 ${fetched.size}개를 완전히 청소했습니다.`);
            }
        } catch (cleanError) {
            console.error("🧹 채널 청소 중 오류 발생:", cleanError);
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

// 실시간 감시 이벤트 리스너들
client.on('threadCreate', async (thread) => {
    if (thread.parentId === FORUM_CHANNEL_ID) await updateAnnouncementBoard();
});

client.on('threadUpdate', async (before, after) => {
    if (after.parentId === FORUM_CHANNEL_ID && before.name !== after.name) {
        await updateAnnouncementBoard();
    }
});

client.on('threadDelete', async (thread) => {
    if (thread.parentId === FORUM_CHANNEL_ID) await updateAnnouncementBoard();
});

client.login(process.env.DISCORD_TOKEN);
