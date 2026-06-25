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

// 💡 [중요] 버튼과 가이드가 들어갈 '#관전채팅-이용' 채널 ID를 꼭 확인해주세요!
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

// 봇이 준비되었을 때 실행되는 구역
client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard();
    
    // 💡 [자동화 추가] 봇이 켜질 때 가이드와 버튼이 없다면 자동으로 전송합니다.
    await autoDeployGuideAndButtons();
});

// ================= [ 가이드 및 버튼 자동/수동 빌더 함수 ] =================
async function generateGuideMessage(channel) {
    const guideEmbed = new EmbedBuilder()
        .setTitle('📖 관전채팅 이용 가이드')
        .setColor(0x00AAFF) 
        .setDescription(
            `원하는 방의 관전채팅 신청 버튼을 누르면 비공개 채팅에 참여하실 수 있습니다.\n` +
            `쾌적하고 원활한 이용을 위해 아래 유의사항을 반드시 지켜주세요.\n` +
            `### 🚨 유의사항\n` +
            `> ⚠️ 관전에 참여하시는 분만 이용해주세요.\n` +
            `> ⚠️ 스포일러 방지를 위해 게임 종료 후 반드시 [관전 종료] 버튼을 눌러주세요.\n` +
            `> ⚠️ 위 유의사항 미준수 시, 경고가 누적될 수 있습니다.`
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_spectate_a').setLabel(ROOM_CONFIG['btn_spectate_a'].label).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_spectate_b').setLabel(ROOM_CONFIG['btn_spectate_b'].label).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('btn_spectate_c').setLabel(ROOM_CONFIG['btn_spectate_c'].label).setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [guideEmbed], components: [row] });
}

// 봇 켜질 때 실행되는 중복 방지 배포 함수
async function autoDeployGuideAndButtons() {
    try {
        const targetChannel = await client.channels.fetch(BUTTON_CHANNEL_ID).catch(() => null);
        if (!targetChannel) {
            console.log("⚠️ 가이드 버튼을 생성할 채널을 찾을 수 없습니다. BUTTON_CHANNEL_ID를 확인하세요.");
            return;
        }

        // 채널의 최근 메시지 10개를 긁어와서 이미 임베드나 버튼이 배치되어 있는지 검사
        const messages = await targetChannel.messages.fetch({ limit: 10 });
        const hasGuide = messages.some(msg => msg.embeds.length > 0 || msg.components.length > 0);
        
        // 채널이 텅 비어있거나 가이드가 없다면 즉시 생성
        if (!hasGuide) {
            console.log("📢 채널이 비어있어 관전 가이드와 버튼을 자동으로 생성합니다...");
            await generateGuideMessage(targetChannel);
            console.log("✅ 가이드 및 버튼 생성 완료!");
        } else {
            console.log("ℹ️ 채널에 이미 생성된 가이드가 존재하여 자동 생성을 건너뜁니다.");
        }
    } catch (err) {
        console.error("자동 배포 진행 중 에러 발생:", err);
    }
}


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


// ================= [ 명령어 처리 : 수동 강제 재생성용 ] =================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 만약 채널 청소를 했거나 강제로 다시 가이드 세트를 뽑고 싶을 때 채널 안에서 !버튼생성 입력
    if (message.content === '!버튼생성' && message.channel.id === BUTTON_CHANNEL_ID) {
        try {
            await generateGuideMessage(message.channel);
            await message.delete().catch(() => null);
        } catch (err) {
            console.error("수동 버튼 메뉴 생성 실패:", err);
        }
    }
});


// ================= [ 상호작용 처리 : 관전방 생성 & 관전 종료 버튼 클릭 ] =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // 1. [관전 채널 생성] 버튼을 누른 경우
    if (ROOM_CONFIG[interaction.customId]) {
        const config = ROOM_CONFIG[interaction.customId];
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
            let isAlreadyExist = !!targetChannel;
            
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
                    content: `📢 **${config.label}** 완료! 개설된 비공개 관전 채팅방입니다.\n현재 관전 역할을 가진 인원만 이 채널을 볼 수 있습니다.\n\n**[안내]** 관전 및 게임이 모두 완전히 끝나면 아래 버튼을 눌러 방을 폭파해 주세요.`,
                    components: [closeRow]
                });
            }

            const responseText = isAlreadyExist 
                ? `✅ 관전 역할이 부여되었습니다! 이미 생성된 채널이 존재합니다. 👉 ${targetChannel}`
                : `🎉 완료되었습니다! 👉 ${targetChannel}`;

            await interaction.editReply({ content: responseText });
            
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
        
        await interaction.reply({ content: '🔒 관전방 삭제 및 역할 회수 작업을 시작합니다!' });
        setTimeout(async () => { await interaction.deleteReply().catch(() => null); }, 2000);

        try {
            await currentChannel.send('⚠️ 관전 종료 절차가 발동되었습니다. 참여 멤버들의 역할을 정리하는 중입니다...');

            const channelMembers = currentChannel.members;
            const targetMembers = channelMembers.filter(member => member.roles.cache.has(config.roleId));

            let removedCount = 0;
            for (const [_, member] of targetMembers) {
                await member.roles.remove(config.roleId).catch(() => null);
                removedCount++;
            }

            await currentChannel.send(`✅ 총 ${removedCount}명의 관전 역할을 정상 회수했습니다.\n스포일러 방지를 위해 **5초 후에 이 채널이 영구 삭제**됩니다.`);

            setTimeout(async () => {
                await currentChannel.delete().catch(() => null);
            }, 5000);

        } catch (error) {
            console.error('관전방 버튼 종료 처리 중 오류:', error);
            await currentChannel.send('❌ 역할을 회수하거나 방을 삭제하는 과정에서 오류가 발생했습니다.');
        }
    }
});

client.on('error', console.error);

client.login(process.env.DISCORD_TOKEN);
