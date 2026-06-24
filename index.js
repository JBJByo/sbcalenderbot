require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const MAIN_FORUM_ID = "1442443517313024100";
const OTHER_FORUM_ID = "1518830708179730563";
const ANNOUNCEMENT_TEXT_ID = "1515045364045053952";

// 정규표현식 패턴
const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*마감[\s]*[)\]]|마감/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*(?:일협|일정협의)[\s]*[)\]]|(?:일협|일정협의)/g; 

client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard();
});

async function updateAnnouncementBoard() {
    try {
        const textChannel = await client.channels.fetch(ANNOUNCEMENT_TEXT_ID).catch(() => null);
        if (!textChannel) return;

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
                const month = parseInt(match[1], 10);
                const day = parseInt(match[2], 10);
                sortKey = { month, day, isIlhyeop: false };
                cleanedTitle = cleanedTitle.replace(match[0], '').replace(/\s+/g, ' ').trim();
                
                // 날짜에 대괄호 [ ] 적용 및 세로줄 유지
                displayTitle = `[${month}/${day}] ｜ ${cleanedTitle}`;
            } else {
                if (title.match(ILHYEOP_PATTERN)) {
                    sortKey = { month: 98, day: 98, isIlhyeop: true }; 
                    displayTitle = `[일협] ｜ ${cleanedTitle}`;
                } else {
                    sortKey = { month: 99, day: 99, isIlhyeop: false };
                    displayTitle = cleanedTitle;
                }
            }

            const lastTouchTime = thread.editedTimestamp || thread.createdTimestamp;
            if (now - lastTouchTime < 24 * 60 * 60 * 1000) {
                displayTitle += " ⭐NEW!⭐";
            }

            // 본문 텍스트 전체를 진하게(**) 만들기 위해 구조 변경
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

        const mainForum = await client.channels.fetch(MAIN_FORUM_ID).catch(() => null);
        if (mainForum) {
            const threads = await mainForum.threads.fetchActive();
            for (const [_, thread] of threads.threads) processThread(thread, murderScheduleList, murderRecruitingList);
        }

        const otherForum = await client.channels.fetch(OTHER_FORUM_ID).catch(() => null);
        if (otherForum) {
            const threads = await otherForum.threads.fetchActive();
            for (const [_, thread] of threads.threads) processThread(thread, otherScheduleList, otherRecruitingList);
        }

        const sortFunction = (a, b) => (a.sortKey.month !== b.sortKey.month) ? a.sortKey.month - b.sortKey.month : a.sortKey.day - b.sortKey.day;
        
        murderScheduleList.sort(sortFunction);
        murderRecruitingList.sort(sortFunction);
        otherScheduleList.sort(sortFunction);
        otherRecruitingList.sort(sortFunction);

        // 모든 메시지 비우기
        const fetched = await textChannel.messages.fetch({ limit: 100 });
        if (fetched.size > 0) await textChannel.bulkDelete(fetched).catch(() => {});

        // 🌟 [임베드 제목 + 2000자 규정 일반 본문] 전송 헬퍼 함수
        const sendSection = async (title, list, color, emptyMsg) => {
            // 1. 제목용 임베드 전송 (깔끔한 테두리와 제목 표시)
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setColor(color);
            
            await textChannel.send({ embeds: [embed] });

            // 2. 본문 내용 전송 (글씨 크기 극대화 및 줄간격 축소)
            if (list.length > 0) {
                const content = list.map((post, i) => `**${i + 1}. ${post.text}**`).join('\n');
                
                // 만약 하나의 섹션이 2000자 제한을 넘을 경우를 대비한 안전한 분할 전송(청크) 로직
                if (content.length > 1950) {
                    let currentChunk = "";
                    for (let i = 0; i < list.length; i++) {
                        const line = `**${i + 1}. ${list[i].text}**\n`;
                        if ((currentChunk + line).length > 1950) {
                            await textChannel.send(currentChunk.trim());
                            currentChunk = line;
                        } else {
                            currentChunk += line;
                        }
                    }
                    if (currentChunk.trim().length > 0) {
                        await textChannel.send(currentChunk.trim());
                    }
                } else {
                    await textChannel.send(content);
                }
            } else {
                await textChannel.send(`*${emptyMsg}*`);
            }
        };

        // 각 섹션을 순서대로 전송
        await sendSection("🩸 머미 마감 일정", murderScheduleList, 0xFF0000, "등록된 머미 마감 일정이 없습니다. 🥲");
        await sendSection("🔎 머미 모집 중", murderRecruitingList, 0xFF0000, "모집 중인 머미 포스팅이 없습니다. 👀");
        await sendSection("📌 기타 모집 완료", otherScheduleList, 0x0099FF, "등록된 기타 완료 일정이 없습니다.");
        await sendSection("🚀 기타 모집 중", otherRecruitingList, 0x0099FF, "모집 중인 기타 포스팅이 없습니다.");

        console.log("✅ 하이브리드 현황판 갱신 완료!");
    } catch (error) {
        console.error("오류 발생:", error);
    }
}

const watchChannels = [MAIN_FORUM_ID, OTHER_FORUM_ID];
client.on('threadCreate', async (t) => { if (watchChannels.includes(t.parentId)) await updateAnnouncementBoard(); });
client.on('threadUpdate', async (b, a) => { if (watchChannels.includes(a.parentId)) await updateAnnouncementBoard(); });
client.on('threadDelete', async (t) => { if (watchChannels.includes(t.parentId)) await updateAnnouncementBoard(); });

client.login(process.env.DISCORD_TOKEN);
