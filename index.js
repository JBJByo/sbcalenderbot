require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
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
        GatewayIntentBits.GuildMembers, 
    ],
});

// [기존 설정] 현황판 및 포럼 ID
const MAIN_FORUM_ID = "1442443517313024100";
const OTHER_FORUM_ID = "1518830708179730563";
const ANNOUNCEMENT_TEXT_ID = "1515045364045053952";

// [신규 설정] 버튼 채널 및 방별 카테고리/역할 매핑 데이터
const BUTTON_CHANNEL_ID = "1519706442209300521";

const ROOM_CONFIG = {
    'btn_spectate_a': {
        roomName: 'A방-관전채팅',
        categoryId: '1442440229696045130',
        roleId: '1519716902589563071',
        label: 'A방 관전채팅 신청'
    },
    'btn_spectate_b': {
        roomName: 'B방-관전채팅',
        categoryId: '1469981664531972291',
        roleId: '1519716927881084980',
        label: 'B방 관전채팅 신청'
    },
    'btn_spectate_c': {
        roomName: 'C방-관전채팅',
        categoryId: '1443538692869329088',
        roleId: '1519716938949857360',
        label: 'C방 관전채팅 신청'
    }
};

// 정규표현식 패턴 (기존 코드)
const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*마감[\s]*[)\]]|마감/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*(?:일협|일정협의)[\s]*[)\]]|(?:일협|일정협의)/g; 

client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard();
});

// ================= [ 기존 기능: 공지사항 현황판 자동 갱신 로직 ] =================
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

            const postData = {
                sortKey,
                text: `${displayTitle} ([바로가기](${url}))`
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

        const fetched = await textChannel.messages.fetch({ limit: 100 });
        if (fetched.size > 0) await textChannel.bulkDelete(fetched).catch(() => {});

        const sendSection = async (title, list, color, emptyMsg) => {
            const embed = new EmbedBuilder().setTitle(title).setColor(color);
            await textChannel.send({ embeds: [embed] });

            if (list.length > 0) {
                const content = list.map((post, i) => `${i + 1}. ${post.text}`).join('\n');
                if (content.length > 1950) {
                    let currentChunk = "";
                    for (let i = 0; i < list.length; i++) {
                        const line = `${i + 1}. ${list[i].text}\n`;
                        if ((currentChunk + line).length > 1950) {
                            await textChannel.send(currentChunk.trim());
                            currentChunk = line;
                        } else {
                            currentChunk += line;
                        }
                    }
                    if (currentChunk.trim().length > 0) await textChannel.send(currentChunk.trim());
                } else {
                    await textChannel.send(content);
                }
            } else {
                await textChannel.send(`*${emptyMsg}*`);
            }
        };

        await sendSection("🩸  머미 일정", murderScheduleList, 0xFF0000, "등록된 머미 일정이 없습니다. 🥲");
        await textChannel.send("\u200B");
        await sendSection("🔎  머미 모집 중", murderRecruitingList, 0xFF0000, "모집 중인 머미 포스팅이 없습니다. 👀");
        await textChannel.send("\u200B");
        await sendSection("🚀  기타 일정", otherScheduleList, 0x0099FF, "등록된 기타 일정이 없습니다.");
        await textChannel.send("\u200B");
        await sendSection("🔎  기타 모집 중", otherRecruitingList, 0x0099FF, "모집 중인 기타 포스팅이 없습니다.");

        console.log("✅ 요청 사항 반영 현황판 갱신 완료!");
    } catch (error) {
        console.error("오류 발생:", error);
    }
}

const watchChannels = [MAIN_FORUM_ID, OTHER_FORUM_ID];
client.on('threadCreate', async (t) => { if (watchChannels.includes(t.parentId)) await updateAnnouncementBoard(); });
client.on('threadUpdate', async (b, a) => { if (watchChannels.includes(a.parentId)) await updateAnnouncementBoard(); });
client.on('threadDelete', async (t) => { if (watchChannels.includes(t.parentId)) await updateAnnouncementBoard(); });


// ================= [ 명령어 처리 : 메인 채널 생성 버튼 소환용 ] =================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!버튼생성' && message.channel.id === BUTTON_CHANNEL_ID) {
        try {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_spectate_a').setLabel(ROOM_CONFIG['btn_spectate_a'].label).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_spectate_b').setLabel(ROOM_CONFIG['btn_spectate_b'].label).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_spectate_c').setLabel(ROOM_CONFIG['btn_spectate_c'].label).setStyle(ButtonStyle.Danger)
            );

            await message.channel.send({
                content: '📌 아래 버튼을 누르면 해당 방의 **비공개 관전 채팅 채널**이 생성되고 관전 권한(역할)이 부여됩니다.',
                components: [row]
            });
            await message.delete().catch(() => null);
        } catch (err) {
            console.error("버튼 메인 메뉴 생성 실패:", err);
        }
    }
});


// ================= [ 상호작용 처리 : 관전방 생성 & 관전 종료 버튼 클릭 ] =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // 1. [관전 채널 생성] 버튼을 누른 경우
    if (ROOM_CONFIG[interaction.customId]) {
        const config = ROOM_CONFIG[interaction.customId];
        
        // 💡 화면 도배 방지: 대기 메시지를 전송하고 3초 뒤 자동 삭제되도록 구현
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            const member = await guild.members.fetch(interaction.user.id);

            // 역할 지급
            const role = guild.roles.cache.get(config.roleId);
            if (role) {
                await member.roles.add(role);
            } else {
                return interaction.editReply({ content: `⚠️ 설정된 역할 ID(\`${config.roleId}\`)를 서버에서 찾을 수 없습니다.` });
            }

            // 중복 생성 검사
            let targetChannel = guild.channels.cache.find(ch => ch.parentId === config.categoryId && ch.name === config.roomName);
            
            if (!targetChannel) {
                // 비공개 채널 신규 생성
                targetChannel = await guild.channels.create({
                    name: config.roomName,
                    type: ChannelType.GuildText,
                    parent: config.categoryId,
                    permissionOverwrites: [
                        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: config.roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
                    ],
                });

                // 새로 개설된 관전 채팅방 내부에 [관전 종료] 버튼 배치
                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('btn_close_spectate')
                        .setLabel('🔒 관전 종료 및 방 삭제')
                        .setStyle(ButtonStyle.Danger)
                );

                await targetChannel.send({
                    content: `👁️ **${config.label}**을 통해 개설된 비공개 관전 채팅방입니다.\n현재 관전 역할을 가진 인원만 이 채널을 볼 수 있습니다.\n\n**[안내]** 관전 및 게임이 모두 완전히 끝나면 아래 버튼을 눌러 방을 폭파해 주세요.`,
                    components: [closeRow]
                });
            }

            // 💡 "본인만 볼 수 있어요" 알림창이 누적되지 않도록, 10초 뒤 응답 메시지를 자동으로 비웁니다.
            await interaction.editReply({ content: `🎉 완료되었습니다! 👉 ${targetChannel}` });
            setTimeout(async () => {
                await interaction.deleteReply().catch(() => null);
            }, 10000);

        } catch (error) {
            console.error("채널 생성 프로세스 오류:", error);
            await interaction.editReply({ content: '❌ 채널을 생성하거나 역할을 부여하는 중 오류가 발생했습니다.' });
        }
    }

    // 2. 관전방 내부에서 [🔒 관전 종료 및 방 삭제] 버튼을 누른 경우
    if (interaction.customId === 'btn_close_spectate') {
        const currentChannel = interaction.channel;
        const roomKey = Object.keys(ROOM_CONFIG).find(key => ROOM_CONFIG[key].roomName === currentChannel.name);
        
        if (!roomKey) {
            return interaction.reply({ content: '❌ 자동 정리 대상 관전방이 아닙니다.', ephemeral: true });
        }

        const config = ROOM_CONFIG[roomKey];
        
        // 버튼 누른 순간 안내 팝업 전송 후 즉시 자동 삭제 트리거
        await interaction.reply({ content: '🔒 관전방 삭제 및 역할 회수 작업을 시작합니다!' });
        setTimeout(async () => { await interaction.deleteReply().catch(() => null); }, 2000);

        try {
            await currentChannel.send('⚠️ 관전 종료 절차가 발동되었습니다. 참여 멤버들의 역할을 정리하는 중입니다...');

            // 💡 [에러 해결책]: 서버 전체를 긁지 않고, 현재 관전 채널의 멤버 명단만 가져와 역할을 가진 사람들 필터링 (레이트 리밋 우회)
            const channelMembers = currentChannel.members;
            const targetMembers = channelMembers.filter(member => member.roles.cache.has(config.roleId));

            let removedCount = 0;
            for (const [_, member] of targetMembers) {
                await member.roles.remove(config.roleId).catch(() => null);
                removedCount++;
            }

            await currentChannel.send(`✅ 총 ${removedCount}명의 관전 역할을 정상 회수했습니다.\n스포일러 방지를 위해 **5초 후에 이 채널이 영구 삭제**됩니다.`);

            // 5초 대기 후 채널 폭파
            setTimeout(async () => {
                await currentChannel.delete().catch(() => null);
            }, 5000);

        } catch (error) {
            console.error('관전방 버튼 종료 처리 중 오류:', error);
            await currentChannel.send('❌ 역할을 회수하거나 방을 삭제하는 과정에서 오류가 발생했습니다.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
