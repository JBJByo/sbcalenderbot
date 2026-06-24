require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const http = require('http');

// ================= [ Render 잠자기 방지용 가짜 웹 서버 ] =================
const PORT = process.env.PORT || 3008;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 디스코드 봇이 정상 구동 중입니다!');
}).listen(PORT, () => {
    console.log(`🌐 가짜 웹 서버가 ${PORT}번 포트에서 작동 중입니다.`);
});

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

// [현황판 업데이트 함수]
const updateAnnouncementBoard = async () => {
    try {
        const textChannel = await client.channels.fetch(ANNOUNCEMENT_TEXT_ID);
        
        // 1. 여기서 데이터를 추출하는 로직(기존 코드의 필터링 로직)을 거쳐 4개의 배열을 준비합니다.
        // murderScheduleList, murderRecruitingList, otherScheduleList, otherRecruitingList 
        
        // 2. 임베드 생성 함수
        const createEmbed = (title, list, color, emptyMsg) => {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setColor(color)
                .setTimestamp();

            if (list && list.length > 0) {
                // Fields를 사용하여 가독성 확보 (16px 정도의 강조 효과를 위해 굵게 처리)
                const content = list.map((item, i) => `**${i + 1}. ${item.text}**`).join('\n');
                embed.setDescription(content);
            } else {
                embed.setDescription(`*${emptyMsg}*`);
            }
            return embed;
        };

        // 3. 임베드 4개 구성
        const embeds = [
            createEmbed("🔥 머미 마감 일정", murderScheduleList, 0xFF0000, "마감 임박 일정이 없습니다."),
            createEmbed("🔎 머미 모집 중", murderRecruitingList, 0xFF0000, "모집 중인 머미가 없습니다."),
            createEmbed("💧 기타 일정", otherScheduleList, 0x0099FF, "등록된 기타 일정이 없습니다."),
            createEmbed("🚀 기타 모집 중", otherRecruitingList, 0x0099FF, "모집 중인 기타 게시물이 없습니다.")
        ];

        // 4. 메시지 갱신
        const fetched = await textChannel.messages.fetch({ limit: 10 });
        if (fetched.size > 0) await textChannel.bulkDelete(fetched).catch(() => {});
        
        await textChannel.send({ embeds: embeds });
        console.log("✅ 임베드 현황판 갱신 완료!");
        
    } catch (error) {
        console.error("오류 발생:", error);
    }
};

// ... (이하 기존의 client.on 등 이벤트 리스너 코드 동일)
