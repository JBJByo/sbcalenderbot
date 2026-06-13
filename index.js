const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 환경 변수 설정
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const FORUM_CHANNEL_ID = '1442443517313024100';
const TEXT_CHANNEL_ID = '1515045364045053952';

// 타이틀 정제를 위한 정규식 패턴 설정
const DATE_PATTERN = /\[(\d{1,2})[./](\d{1,2})\]/; // [월/일] 또는 [월.일] 형태 매칭
const MARAM_PATTERN = /\[마감\]/g;
const ILHYEOP_PATTERN = /\[일협\]/g;

// 봇이 준비되었을 때 실행
client.once('ready', () => {
    console.log(`🤖 봇이 로그인되었습니다: ${client.user.tag}`);
    // 봇이 켜지자마자 한 번 현황판을 동기화합니다.
    updateAnnouncementBoard();
});

// 포럼에서 새로운 스레드(게시글)가 생성되었을 때
client.on('threadCreate', async (thread) => {
    if (thread.parentId === FORUM_CHANNEL_ID) {
        console.log(`🆕 새 스레드 감지: ${thread.name}`);
        await updateAnnouncementBoard();
    }
});

// 포럼 게시글 제목이 수정되거나 마감 태그 등이 변경되었을 때
client.on('threadUpdate', async (oldThread, newThread) => {
    if (newThread.parentId === FORUM_CHANNEL_ID) {
        // 제목이 바뀌었거나 아카이브 상태가 바뀌었다면 갱신
        if (oldThread.name !== newThread.name || oldThread.archived !== newThread.archived) {
            console.log(`🔄 스레드 상태 변경 감지: ${newThread.name}`);
            await updateAnnouncementBoard();
        }
    }
});

// 포럼 게시글이 삭제되었을 때
client.on('threadDelete', async (thread) => {
    if (thread.parentId === FORUM_CHANNEL_ID) {
        console.log(`🗑️ 스레드 삭제 감지: ${thread.name}`);
        await updateAnnouncementBoard();
    }
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

        // 1. 활성화된 모든 포럼 스레드 가져오기
        const activeThreads = await forumChannel.threads.fetchActive();

        // 2. 각 스레드를 순회하며 데이터 정제 및 NEW 배지 판별
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

            // 생성된 지 24시간이 지나지 않았다면 제목 뒤에 한 칸 띄우고 ⭐NEW!⭐ 붙이기
            if (now - createdAt < TWENTY_FOUR_HOURS) {
                displayTitle += " ⭐NEW!⭐";
            }
            // ====================================================================

            const postData = {
                sortKey,
                text: `${displayTitle} ([바로가기](${url}))`
            };

            // 마감 여부에 따라 배열 분기 처리
            if (title.includes("마감")) {
                scheduleList.push(postData);
            } else {
                recruitingList.push(postData);
            }
        }

        // 날짜 순 정렬 함수 (월 -> 일 순서)
        const sortFunction = (a, b) => {
            if (a.sortKey.month !== b.sortKey.month) return a.sortKey.month - b.sortKey.month;
            return a.sortKey.day - b.sortKey.day;
        };

        scheduleList.sort(sortFunction);
        recruitingList.sort(sortFunction);

        // 출력할 메시지 텍스트 조립
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

        // 📦 3. 디스코드 글자수 제한(2000자) 우회를 위한 청크 분할
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

        // 🧹 4. 채널 내 기존 현황판 메시지 싹 청소하기
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

        // 📝 5. 새로 정리된 현황판 순차 발송
        for (const chunk of chunks) {
            await textChannel.send(chunk);
        }

        console.log("✅ 중복 없는 새 현황판 완벽 갱신 완료!");

    } catch (error) {
        console.error("현황판 갱신 중 오류 발생:", error);
    }
}

// 디스코드 로그인
client.login(DISCORD_TOKEN);
