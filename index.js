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

// 💡 버튼과 가이드, 그리고 '실시간 관전방 현황'이 들어갈 채널 ID
const BUTTON_CHANNEL_ID = "1519706442209300521"; 

// 3개 버튼에 대한 통합 설정 구조
const ROOM_CONFIG = {
    'btn_create_a': { roomKey: 'A', roomName: 'A방-관전채팅', categoryId: '1442440229696045130', roleId: '1519716902589563071', displayName: 'A방 관전 신청' },
    'btn_create_b': { roomKey: 'B', roomName: 'B방-관전채팅', categoryId: '1469981664531972291', roleId: '1519716927881084980', displayName: 'B방 관전 신청' },
    'btn_create_c': { roomKey: 'C', roomName: 'C방-관전채팅', categoryId: '1443538692869329088', roleId: '1519716938949857360', displayName: 'C방 관전 신청' }
};

// 정규표현식 패턴 (기존 코드)
const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*마감[\s]*[)\]]|마감/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*(?:일협|일정협의)[\s]*[)\]]|(?:일협|일정협의)/g; 

client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard().catch(console.error);
    await autoDeployGuideAndButtons().catch(console.error);
});

// ================= [ 가이드, 버튼, 실시간 현황판 빌더 함수 ] =================

// 실시간 현황판 텍스트를 만들어주는 헬퍼 함수
async function getSpectateStatusText(guild) {
    let text = `### 📊 실시간 관전방 개설 현황\n`;
    
    const rooms = [
        { key: 'A', name: 'A방 관전채팅', cat: '1442440229696045130', roomName: 'A방-관전채팅' },
        { key: 'B', name: 'B방 관전채팅', cat: '1469981664531972291', roomName: 'B방-관전채팅' },
        { key: 'C', name: 'C방 관전채팅', cat: '1443538692869329088', roomName: 'C방-관전채팅' }
    ];

    for (const r of rooms) {
        const categoryChannel = guild.channels.cache.get(r.cat) || await guild.channels.fetch(r.cat).catch(() => null);
        
        let targetChannel = null;
        if (categoryChannel && categoryChannel.children) {
            targetChannel = categoryChannel.children.cache.find(ch => 
                ch && 
                ch.type === ChannelType.GuildText && 
                ch.name.toLowerCase() === r.roomName.toLowerCase()
            );
        }

        if (targetChannel) {
            text += `🟢 **${r.name}**: 개설되어 있습니다! (👉 ${targetChannel})\n`;
        } else {
            text += `🔴 **${r.name}**: 닫혀있습니다.\n`;
        }
    }
    
    text += `\n*※ 버튼을 누르면 실시간으로 현황이 업데이트됩니다.*`;
    return text;
}

// 기존 현황판 메시지를 삭제하고, 맨 아래에 완전히 새로 전송하는 함수
async function refreshSpectateStatus(guild) {
    try {
        const targetChannel = await client.channels.fetch(BUTTON_CHANNEL_ID).catch(() => null);
        if (!targetChannel) return;

        const messages = await targetChannel.messages.fetch({ limit: 50 });
        const statusMessages = messages.filter(msg => msg.author.id === client.user.id && msg.content.includes('📊 실시간 관전방 개설 현황'));
        
        for (const [_, msg] of statusMessages) {
            await msg.delete().catch(() => null);
        }
        
        const cats = ['1442440229696045130', '1469981664531972291', '1443538692869329088'];
        for (const catId of cats) {
            await guild.channels.fetch(catId).catch(() => null);
        }

        const newText = await getSpectateStatusText(guild);
        await targetChannel.send(newText);
        console.log("🔥 지정 카테고리 추적 방식으로 최신 현황판 새로 전송 완료!");
    } catch (err) {
        console.error("현황판 재생성 중 오류 발생:", err);
    }
}

async function generateGuideMessage(channel) {
    const guideEmbed = new EmbedBuilder()
        .setTitle('📖 관전채팅 이용 가이드')
        .setColor(0x00AAFF) 
        .setDescription(
            `원하는 방의 버튼을 눌러 비공개 채널을 생성하거나 관전 역할을 부여받을 수 있습니다.\n` +
            `쾌적하고 원활한 이용을 위해 아래 유의사항을 반드시 지켜주세요.\n\n` +
            `###  ① 원하는 방의 관전 신청 버튼을 눌러주세요.\n` +
            `###  ② 역할 부여와 함께 생성되거나 이미 열려있는 방으로 이동해주세요.\n` +
            `\u200B\n` +
            `### 🚨 유의사항\n` +
            ` ⚠️ 관전에 참여하시는 분만 이용해주세요.\n` +
            ` ⚠️ 버튼을 연속해서 누르지 말아 주세요.\n` +
            ` ⚠️ 스포일러 방지를 위해 게임 종료 후 반드시 [관전 종료] 버튼을 눌러주세요.\n` +
            ` ⚠️ 위 유의사항 미준수 시, 경고가 누적될 수 있습니다.`
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_create_a').setLabel(ROOM_CONFIG['btn_create_a'].displayName).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_create_b').setLabel(ROOM_CONFIG['btn_create_b'].displayName).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('btn_create_c').setLabel(ROOM_CONFIG['btn_create_c'].displayName).setStyle(ButtonStyle.Danger)
    );
    await channel.send({ embeds: [guideEmbed], components: [row] });
    
    const statusText = await getSpectateStatusText(channel.guild);
    await channel.send(statusText);
}

async function autoDeployGuideAndButtons() {
    try {
        const targetChannel = await client.channels.fetch(BUTTON_CHANNEL_ID).catch(() => null);
        if (!targetChannel) {
            console.log("⚠️ 가이드 버튼을 생성할 채널을 찾을 수 없습니다. BUTTON_CHANNEL_ID를 확인하세요.");
            return;
        }

        const messages = await targetChannel.messages.fetch({ limit: 20 });
        const hasGuide = messages.some(msg => msg.embeds.length > 0 || msg.components.length > 0);
        
        if (!hasGuide) {
            console.log("📢 채널이 비어있어 관전 가이드, 버튼, 현황판을 자동으로 생성합니다...");
            await generateGuideMessage(targetChannel);
            console.log("✅ 생성 완료!");
        } else {
            console.log("ℹ️ 채널에 이미 생성된 가이드가 존재합니다. 현황판 최신화 프로세스를 시작합니다.");
            await refreshSpectateStatus(targetChannel.guild);
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

    // 관전 신청 버튼을 누른 경우
    if (ROOM_CONFIG[interaction.customId]) {
        const config = ROOM_CONFIG[interaction.customId];
        await interaction.deferReply({ flags: [ 'Ephemeral' ] });

        try {
            const guild = interaction.guild;
            const member = await guild.members.fetch(interaction.user.id);
            const role = guild.roles.cache.get(config.roleId);

            if (!role) {
                await interaction.editReply({ content: `⚠️ 설정된 역할 ID(\`${config.roleId}\`)를 서버에서 찾을 수 없습니다.` });
                return;
            }

            // 1. 해당 카테고리 내에서 이미 방이 생성되어 있는지 확인
            const categoryChannel = guild.channels.cache.get(config.categoryId) || await guild.channels.fetch(config.categoryId).catch(() => null);
            
            let targetChannel = null;
            if (categoryChannel && categoryChannel.children) {
                targetChannel = categoryChannel.children.cache.find(ch =>
                    ch &&
                    ch.type === ChannelType.GuildText &&
                    ch.name.toLowerCase() === config.roomName.toLowerCase()
                );
            }
            
            let isAlreadyExist = !!targetChannel;
            
            // 2. 방이 없다면 새로 생성
            if (!targetChannel) {
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
                console.log(`★★★★★ 신규 ${config.roomKey} 채널 생성 완료 ★★★★★`);

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('btn_close_spectate')
                        .setLabel('🔒 관전 종료 및 방 삭제')
                        .setStyle(ButtonStyle.Danger)
                );

                await targetChannel.send({
                    content: `📢 **${config.displayName}** 채널이 생성되었습니다!\n현재 해당 방의 관전 역할을 부여받은 인원만 이 채널을 볼 수 있습니다.\n\n**[안내]** 관전 및 게임이 모두 완전히 끝나면 아래 버튼을 눌러 방을 폭파해 주세요.`,
                    components: [closeRow]
                });
            }

            // 3. 방 유무와 상관없이 무조건 유저에게 역할 부여
            let responseText = "";
            if (member.roles.cache.has(config.roleId)) {
                responseText = isAlreadyExist 
                    ? `ℹ️ 이미 **${config.roomKey}방 관전 역할**을 가지고 계십니다! 👉 ${targetChannel}`
                    : `ℹ️ 이미 역할을 가지고 계십니다. 방이 없어서 새로 생성했습니다! 👉 ${targetChannel}`;
            } else {
                await member.roles.add(role);
                responseText = isAlreadyExist
                    ? `✅ 이미 생성된 채널이 존재합니다. **${config.roomKey}방 관전 역할**을 부여해 드렸습니다! 👉 ${targetChannel}`
                    : `🎉 **${config.roomKey}방 관전채팅** 채널이 개설되었으며, 관전 역할이 부여되었습니다! 👉 ${targetChannel}`;
            }

            await interaction.editReply({ content: responseText });
            
            // 방 상태 변동이 있었으므로 현황판 최신화 (신규 생성 시에만 딜레이 후 갱신)
            if (!isAlreadyExist) {
                setTimeout(async () => {
                    await refreshSpectateStatus(guild);
                }, 1500);
            }
            
            setTimeout(async () => {
                await interaction.deleteReply().catch(() => null);
            }, 10000);

        } catch (error) {
            console.error("버튼 처리 프로세스 오류:", error);
            await interaction.editReply({ content: '❌ 요청을 처리하는 중에 오류가 발생했습니다.' });
        }
    }

    // 관전방 내부에서 [🔒 관전 종료 및 방 삭제] 버튼을 누른 경우
    if (interaction.customId === 'btn_close_spectate') {
        const currentChannel = interaction.channel;
        const guild = interaction.guild;
        
        const roomKey = Object.keys(ROOM_CONFIG).find(key => 
            ROOM_CONFIG[key].categoryId === currentChannel.parentId
        );
        
        if (!roomKey) {
            return interaction.reply({ content: '❌ 이 채널은 관전방 설정 카테고리에 속해있지 않습니다.', flags: [ 'Ephemeral' ] });
        }

        const config = ROOM_CONFIG[roomKey];
        await interaction.reply({ content: '🔒 관전 종료 및 채널 삭제를 시작합니다!' });

        try {
            const role = guild.roles.cache.get(config.roleId);
            if (role) {
                const guildMembers = await guild.members.fetch();
                const membersWithRole = guildMembers.filter(member => member.roles.cache.has(config.roleId));
                
                for (const [_, member] of membersWithRole) {
                    await member.roles.remove(role).catch(console.error);
                }
            }

            // 채널 삭제
            await currentChannel.delete('관전 종료 버튼에 의한 자동 삭제').catch(console.error);

            // 방 삭제 반영을 위해 1.5초 딜레이 후 현황판 재생성
            setTimeout(async () => {
                await refreshSpectateStatus(guild);
            }, 1500);

        } catch (error) {
            console.error('관전방 종료 처리 중 오류:', error);
        }
    }
});

client.on('error', console.error);
client.login(process.env.DISCORD_TOKEN);
