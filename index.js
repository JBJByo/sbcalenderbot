require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

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
const MARAM_PATTERN = /[(\[][\s]*마감[\s]*[)\]]|마감/g; // (마감), [마감], 마감 모두 매칭
const ILHYEOP_PATTERN = /[(\[][\s]*일협[\s]*[)\]]|일협/g; // (일협), [일협], 일협 모두 매칭

client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard();
});

// 핵심 로직: 포럼 채널의 데이터를 모아서 텍스트 채널의 알림판을 갱신하는 함수
async function updateAnnouncementBoard() {
    try {
        const forumChannel = await client.channels.fetch(FORUM_CHANNEL_ID);
        const textChannel = await client.channels.fetch(TEXT_CHANNEL_ID);

        if (!forumChannel || !textChannel) {
            console.log("❌ 채널 ID를 찾을 수 없습니다. ID 설정을 확인해주세요.");
            return;
        }

        const scheduleList = [];   // (일정) 목록
        const recruitingList = []; // (모집중) 목록

        // 포럼 채널에 열려있는 모든 활성화된 글(스레드)을 가져옵니다.
        const activeThreads = await forumChannel.threads.fetchActive();

        for (const [_, thread] of activeThreads.threads) {
            const title = thread.name;
            const url = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
            
            let sortKey;
            let displayTitle;

            // 1. 우선 제목에서 마감 및 일협 단어를 제거하는 베이스 정리
            let cleanedTitle = title.replace(MARAM_PATTERN, '').replace(ILHYEOP_PATTERN, '').replace(/\s+/g, ' ').trim();

            // 2. 제목에서 날짜(월, 일) 추출 시도
            const match = title.match(DATE_PATTERN);
            
            if (match) {
                const month = parseInt(match[1], 10);
                const day = parseInt(match[2], 10);
                sortKey = { month, day, isIlhyeop: false };
                
                // 날짜 패턴 부분도 제목에서 지워줍니다.
                cleanedTitle = cleanedTitle.replace(match[0], '').replace(/\s+/g, ' ').trim();
                displayTitle = `[${month}/${day}] ${cleanedTitle}`;
            } else {
                // 날짜가 없는 경우 중 '일협'이 포함되어 있었는지 원본 제목(title)으로 확인
                if (title.includes("일협")) {
                    sortKey = { month: 98, day: 98, isIlhyeop: true }; // 일협은 일반 미지정(99)보다 위로 정렬되게 세팅
                    displayTitle = `(일협) ${cleanedTitle}`;
                } else {
                    sortKey = { month: 99, day: 99, isIlhyeop: false };
                    displayTitle = cleanedTitle;
                }
            }

            const postData = {
                sortKey,
                text: `${displayTitle} ([바로가기](${url}))`
            };

            // 원본 제목에 '마감' 단어가 있었는지 여부로 (일정)과 (모집중) 분류
            if (title.includes("마감")) {
                scheduleList.push(postData);
            } else {
                recruitingList.push(postData);
            }
        }

        // 정렬 로직: [1순위] 일반 날짜순 -> [2순위] 일협 -> [3순위] 날짜 없음
        const sortFunction = (a, b) => {
            if (a.sortKey.month !== b.sortKey.month) {
                return a.sortKey.month - b.sortKey.month;
            }
            return a.sortKey.day - b.sortKey.day;
        };

        scheduleList.sort(sortFunction);
        recruitingList.sort(sortFunction);

        // 텍스트 채널에 뿌려줄 최종 메시지 배열 (줄 단위로 관리)
        const lines = ["📢 **실시간 포스팅 현황판** 📢\n"];

        // (일정) 파트 생성
        lines.push("📌 **(일정)**");
        if (scheduleList.length > 0) {
            scheduleList.forEach((post, i) => {
                lines.push(`${i + 1}. ${post.text}`);
            });
        } else {
            lines.push("등록된 마감 일정이 없습니다.");
        }

        lines.push(""); // 한 줄 띄우기

        // (모집중) 파트 생성
        lines.push("🚀 **(모집중)**");
        if (recruitingList.length > 0) {
            recruitingList.forEach((post, i) => {
                lines.push(`${i + 1}. ${post.text}`);
            });
        } else {
            lines.push("모집 중인 포스팅이 없습니다.");
        }

        // 이전 봇이 작성한 현황판 메시지들을 지우기 (도배 방지)
        const fetchedMessages = await textChannel.messages.fetch({ limit: 20 });
        for (const [_, message] of fetchedMessages) {
            if (message.author.id === client.user.id) {
                await message.delete().catch(console.error);
            }
        }

        // 줄바꿈 기준으로 안전하게 잘라서 전송하는 안전벨트 로직
        const MAX_LENGTH = 1900;
        let currentChunk = "";

        for (const line of lines) {
            if ((currentChunk + line + "\n").length > MAX_LENGTH) {
                if (currentChunk.trim().length > 0) {
                    await textChannel.send(currentChunk.trim());
                }
                currentChunk = line + "\n"; // 새 청크 시작
            } else {
                currentChunk += line + "\n";
            }
        }

        // 마지막에 남은 텍스트가 있다면 전송
        if (currentChunk.trim().length > 0) {
            await textChannel.send(currentChunk.trim());
        }

        console.log("✅ 현황판 갱신 완료!");

    } catch (error) {
        console.error("현황판 갱신 중 오류 발생:", error);
    }
}

// 이벤트 1: 누군가 포럼에 새 글을 올렸을 때
client.on('threadCreate', async (thread) => {
    if (thread.parentId === FORUM_CHANNEL_ID) {
        await updateAnnouncementBoard();
    }
});

// 이벤트 2: 누군가 기존 포스팅의 제목을 수정했을 때
client.on('threadUpdate', async (before, after) => {
    if (after.parentId === FORUM_CHANNEL_ID) {
        if (before.name !== after.name) {
            await updateAnnouncementBoard();
        }
    }
});

// 이벤트 3: 누군가 포럼 글을 완전히 삭제했을 때
client.on('threadDelete', async (thread) => {
    if (thread.parentId === FORUM_CHANNEL_ID) {
        console.log(`🗑️ 글이 삭제되어 현황판을 갱신합니다: ${thread.name}`);
        await updateAnnouncementBoard();
    }
});

// 4. 내 디스코드 봇 토큰 입력
client.login(process.env.DISCORD_TOKEN);