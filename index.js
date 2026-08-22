require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    PermissionFlagsBits,
    Partials 
} = require('discord.js');
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
    partials: [Partials.Channel, Partials.ThreadMember],
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

// 정규표현식 패턴
const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*(?:마감|완료)[\s]*[)\]]|(?:마감|완료)/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*(?:일협|일정협의)[\s]*[)\]]|(?:일협|일정협의)/g; 

client.on('ready', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇이 성공적으로 로그인했습니다!`);
    await updateAnnouncementBoard().catch(console.error);
    await autoDeployGuideAndButtons().catch(console.error);
});

// ================= [ 관전방 수동 일괄 초기화 함수 (고속/안전 처리) ] =================
async function resetAllSpectateRooms(guild) {
    // 1. 전체 채널 캐시 새로고침
    await guild.channels.fetch();

    for (const key in ROOM_CONFIG) {
        const config = ROOM_CONFIG[key];
        
        // 관전 채널 탐색 및 삭제
        const categoryChannel = guild.channels.cache.get(config.categoryId);
        if (categoryChannel && categoryChannel.children) {
            const targetChannels = categoryChannel.children.cache.filter(ch => 
                ch && 
                ch.type === ChannelType.GuildText && 
                ch.name.toLowerCase() === config.roomName.toLowerCase()
            );
            for (const [_, ch] of targetChannels) {
                await ch.delete('수동 갱신/초기화').catch(console.error);
            }
        }

        // 해당 역할 보유자 회수 (캐시된 멤버 기준 빠른 처리)
        const role = guild.roles.cache.get(config.roleId);
        if (role && role.members) {
            for (const [_, member] of role.members) {
                await member.roles.remove(role).catch(console.error);
            }
        }
    }
}

// ================= [ 가이드, 버튼, 실시간 현황판 빌더 함수 ] =================

async function getSpectateStatusText(guild) {
    let text = `### 📊 실시간 관전방 개설 현황\n`;
    
    // 서버 채널 최신 상태 조회
    await guild.channels.fetch().catch(() => null);

    const rooms = [
        { key: 'A', name: 'A방 관전채팅', cat: '1442440229696045130', roomName: 'A방-관전채팅' },
        { key: 'B', name: 'B방 관전채팅', cat: '1469981664531972291', roomName: 'B방-관전채팅' },
        { key: 'C', name: 'C방 관전채팅', cat: '1443538692869329088', roomName: 'C방-관전채팅' }
    ];

    for (const r of rooms) {
        const categoryChannel = guild.channels.cache.get(r.cat);
        
        let targetChannel = null;
        if (categoryChannel && categoryChannel.children) {
            targetChannel = categoryChannel.children.cache.find(ch => 
                ch && 
                ch.type === ChannelType.GuildText && 
                ch.name.toLowerCase() === r.roomName.toLowerCase() &&
                !ch.deleted
            );
        }

        if (targetChannel) {
            text += `🟢 **${r.name}**: 개설되어 있습니다! (👉 <#${targetChannel.id}>)\n`;
        } else {
            text += `🔴 **${r.name}**: 닫혀있습니다.\n`;
        }
    }
    
    text += `\n*※ 방이 제대로 열리지 않거나 오류가 생기면 아래 [관전방 초기화/갱신] 버튼을 눌러주세요.*`;
    return text;
}

// 실시간 현황판 메시지와 함께 최하단에 초기화 버튼 첨부
async function refreshSpectateStatus(guild) {
    try {
        const targetChannel = await client.channels.fetch(BUTTON_CHANNEL_ID).catch(() => null);
        if (!targetChannel) return;

        const messages = await targetChannel.messages.fetch({ limit: 50 });
        const statusMessages = messages.filter(msg => msg.author.id === client.user.id && msg.content.includes('📊 실시간 관전방 개설 현황'));
        
        for (const [_, msg] of statusMessages) {
            await msg.delete().catch(() => null);
        }

        const newText = await getSpectateStatusText(guild);
        
        const resetRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_reset_all_spectate')
                .setLabel('🛠️ 관전방 초기화/갱신')
                .setStyle(ButtonStyle.Secondary)
        );

        await targetChannel.send({
            content: newText,
            components: [resetRow]
        });
    } catch (err) {
        console.error("현황판 재생성 중 오류 발생:", err);
    }
}

async function generateGuideMessage(channel) {
    const guideEmbed = new EmbedBuilder()
        .setTitle('📖 관전채팅 이용 가이드')
        .setColor(0x00AAFF) 
        .setDescription(
            `원하는 방의 버튼을 눌러 관전 채널을 생성하거나 참가할 수 있습니다.\n` +
            `쾌적하고 원활한 이용을 위해 아래 유의사항을 반드시 지켜주세요.\n\n` +
            `###  ① 원하는 방의 관전 신청 버튼을 눌러주세요.\n` +
            `###  ② 해당하는 방으로 이동해주세요.\n` +
            `\u200B\n` +
            `### 🚨 유의사항\n` +
            ` ⚠️ 관전에 참여하시는 분만 이용해주세요.\n` +
            ` ⚠️ 버튼을 연속해서 누르지 말아 주세요.\n` +
            ` ⚠️ 스포일러 방지를 위해 게임 종료 후 반드시 [관전 종료] 버튼을 눌러주세요.\n` +
            ` ⚠️ 방 상태가 이상하거나 고장난 경우 맨 아래 [관전방 초기화/갱신] 버튼을 이용해 주세요.`
        );

    const applyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_create_a').setLabel(ROOM_CONFIG['btn_create_a'].displayName).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_create_b').setLabel(ROOM_CONFIG['btn_create_b'].displayName).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('btn_create_c').setLabel(ROOM_CONFIG['btn_create_c'].displayName).setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [guideEmbed], components: [applyRow] });
    await refreshSpectateStatus(channel.guild);
}

async function autoDeployGuideAndButtons() {
    try {
        const targetChannel = await client.channels.fetch(BUTTON_CHANNEL_ID).catch(() => null);
        if (!targetChannel) return;

        const messages = await targetChannel.messages.fetch({ limit: 20 });
        const hasGuide = messages.some(msg => msg.embeds.length > 0 || msg.components.length > 0);
        
        if (!hasGuide) {
            await generateGuideMessage(targetChannel);
        } else {
            await refreshSpectateStatus(targetChannel.guild);
        }
    } catch (err) {
        console.error("자동 배포 에러:", err);
    }
}

// ================= [ 공지사항 현황판 자동 갱신 로직 ] =================
let isUpdatingSchedule = false; 
let hasPendingScheduleUpdate = false; 
let scheduleUpdateTimer = null;

async function updateAnnouncementBoard() {
    if (isUpdatingSchedule) {
        hasPendingScheduleUpdate = true;
        return;
    }

    isUpdatingSchedule = true;

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

            const kstDateString = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Seoul',
                month: 'numeric',
                day: 'numeric'
            }).format(new Date());
            const [curMonth, curDay] = kstDateString.split('/').map(Number);

            const url = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
            let sortKey;
            let displayTitlePrefix = "";

            let cleanedTitle = title.replace(MARAM_PATTERN, '').replace(ILHYEOP_PATTERN, '');

            const dateMatch = title.match(/(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/);
            const timeMatch = title.match(/(?:(오전|오후|am|pm|AM|PM)\s*)?([0-2]?\d)[:시](?!\s*간)(?:\s*([0-5]\d)분?)?/);

            if (dateMatch) {
                const month = parseInt(dateMatch[1], 10);
                const day = parseInt(dateMatch[2], 10);

                let isPast = false;
                if (month < curMonth && (curMonth - month) < 6) isPast = true;
                if (month === curMonth && day < curDay) isPast = true;
                
                if (isPast) {
                    thread.edit({ archived: true }).catch(console.error);
                    return; 
                }

                sortKey = { month, day, isIlhyeop: false };
                
                const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const dateEraser = new RegExp(`[\\s\\[\\(]*${escapeRegExp(dateMatch[0])}[\\s\\]\\)]*`, 'g');
                cleanedTitle = cleanedTitle.replace(dateEraser, ' ');

                let timePrefix = "";
                if (timeMatch) {
                    let hour = parseInt(timeMatch[2], 10);
                    let minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
                    const ampm = timeMatch[1];

                    if (ampm) {
                        const lowerAmpm = ampm.toLowerCase();
                        if ((lowerAmpm === '오후' || lowerAmpm === 'pm') && hour < 12) hour += 12;
                        if ((lowerAmpm === '오전' || lowerAmpm === 'am') && hour === 12) hour = 0;
                    }

                    const timeEraser = new RegExp(`[\\s\\[\\(]*${escapeRegExp(timeMatch[0])}[\\s\\]\\)]*`, 'g');
                    cleanedTitle = cleanedTitle.replace(timeEraser, ' ');

                    const pad = (num) => String(num).padStart(2, '0');
                    timePrefix = `[${pad(hour)}:${pad(minute)}] `; 
                }

                cleanedTitle = cleanedTitle.replace(/(?:월|화|수|목|금|토|일)요일/g, ' ');
                displayTitlePrefix = `[${month}/${day}] ｜ ${timePrefix}`;
                
            } else {
                sortKey = { month: 98, day: 98, isIlhyeop: true }; 
                displayTitlePrefix = `[일협] ｜ `;
            }

            cleanedTitle = cleanedTitle.replace(/[\[\(]\s*오프\s*[\]\)]/g, '___OFFLINE___');
            cleanedTitle = cleanedTitle.replace(/오프/g, '___OFFLINE___');
            cleanedTitle = cleanedTitle.replace(/[\[\(][\s/,\-~]*[\]\)]/g, ' ');
            cleanedTitle = cleanedTitle.replace(/[\[\(\]\)]/g, ' ');
            cleanedTitle = cleanedTitle.replace(/___OFFLINE___/g, '[오프]');
            cleanedTitle = cleanedTitle.replace(/^[\]\)/\-,\s|?]+|[\[\(/\-,\s|?]+$/g, '');
            cleanedTitle = cleanedTitle.replace(/\s+/g, ' ').trim();

            let displayTitle = displayTitlePrefix + cleanedTitle;

            const lastTouchTime = thread.editedTimestamp || thread.createdTimestamp;
            if (now - lastTouchTime < 24 * 60 * 60 * 1000) {
                displayTitle += " ⭐NEW!⭐";
            }

            const postData = {
                sortKey,
                text: `${displayTitle} ([바로가기](${url}))`
            };

            if (title.includes("마감") || title.includes("꽉") || title.includes("완료")) {
                scheduleArr.push(postData);
            } else {
                recruitingArr.push(postData);
            }
        };

        const fetchAndProcessThreads = async (forumChannel, scheduleArr, recruitingArr) => {
            if (!forumChannel) return;

            const activeThreads = await forumChannel.threads.fetchActive();
            for (const [_, thread] of activeThreads.threads) {
                processThread(thread, scheduleArr, recruitingArr);
            }

            const archivedThreads = await forumChannel.threads.fetchArchived({ limit: 20 });
            
            const kstDateString = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Seoul',
                month: 'numeric',
                day: 'numeric'
            }).format(new Date());
            const [curMonth, curDay] = kstDateString.split('/').map(Number);

            for (const [_, thread] of archivedThreads.threads) {
                const title = thread.name;
                const dateMatch = title.match(/(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/);
                
                if (dateMatch) {
                    const month = parseInt(dateMatch[1], 10);
                    const day = parseInt(dateMatch[2], 10);
                    
                    let isPast = false;
                    if (month < curMonth && (curMonth - month) < 6) isPast = true;
                    if (month === curMonth && day < curDay) isPast = true;

                    if (!isPast) {
                        await thread.edit({ archived: false }).catch(console.error);
                        processThread(thread, scheduleArr, recruitingArr);
                    }
                }
            }
        };

        const mainForum = await client.channels.fetch(MAIN_FORUM_ID).catch(() => null);
        await fetchAndProcessThreads(mainForum, murderScheduleList, murderRecruitingList);

        const otherForum = await client.channels.fetch(OTHER_FORUM_ID).catch(() => null);
        await fetchAndProcessThreads(otherForum, otherScheduleList, otherRecruitingList);

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
        await textChannel.send("\u200B");

        const refreshRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_refresh_schedule')
                .setLabel('🔄 일정 새로고침')
                .setStyle(ButtonStyle.Secondary)
        );

        const refreshEmbed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setDescription("💡 **수동 새로고침**\n동시 변경으로 인해 일정이 꼬이거나 누락된 경우 아래 버튼을 눌러주세요.");

        await textChannel.send({ 
            embeds: [refreshEmbed],
            components: [refreshRow] 
        });

    } catch (error) {
        console.error("오류 발생:", error);
    } finally {
        isUpdatingSchedule = false;
        if (hasPendingScheduleUpdate) {
            hasPendingScheduleUpdate = false;
            setTimeout(() => {
                updateAnnouncementBoard().catch(console.error);
            }, 1000);
        }
    }
}

// ================= [ 동시성 감지 및 스레드 이벤트 처리 ] =================
function requestScheduleUpdate() {
    if (scheduleUpdateTimer) clearTimeout(scheduleUpdateTimer);
    scheduleUpdateTimer = setTimeout(() => {
        updateAnnouncementBoard().catch(console.error);
    }, 3000); 
}

const watchChannels = [MAIN_FORUM_ID, OTHER_FORUM_ID];

function handleThreadEvent(thread, eventName) {
    if (!thread) return;
    const parentId = thread.parentId || thread.parent?.id;
    if (watchChannels.includes(parentId)) {
        requestScheduleUpdate();
    }
}

client.on('threadCreate', async (t) => handleThreadEvent(t, '생성됨'));
client.on('threadUpdate', async (b, a) => handleThreadEvent(a, '수정/열림/닫힘'));
client.on('threadDelete', async (t) => handleThreadEvent(t, '삭제됨'));

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

// ================= [ 상호작용 처리 : 버튼 클릭 이벤트 ] =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // 1. 일정 현황판 수동 새로고침
    if (interaction.customId === 'btn_refresh_schedule') {
        await interaction.deferReply({ flags: [ 'Ephemeral' ] }); 
        try {
            await updateAnnouncementBoard();
            await interaction.editReply({ content: '✅ 일정 현황판이 정상적으로 갱신되었습니다!' });
        } catch (error) {
            console.error("수동 갱신 오류:", error);
            await interaction.editReply({ content: '❌ 현황판 갱신 중 오류가 발생했습니다.' });
        }
        return;
    }

    // 2. 관전방 수동 초기화 및 갱신 (고장 복구용)
    if (interaction.customId === 'btn_reset_all_spectate') {
        // 즉시 대기 응답 전송 (3초 타임아웃 방지)
        await interaction.deferReply({ flags: [ 'Ephemeral' ] });
        try {
            await resetAllSpectateRooms(interaction.guild);
            await refreshSpectateStatus(interaction.guild);
            await interaction.editReply({ content: '🛠️ 관전방을 모두 정리하고 현황판을 정상 복구했습니다!' });
        } catch (error) {
            console.error("관전방 초기화 중 오류:", error);
            await interaction.editReply({ content: '❌ 관전방 초기화 중 오류가 발생했습니다.' });
        }
        return;
    }

    // 3. 관전 신청 버튼 (A/B/C)
    if (ROOM_CONFIG[interaction.customId]) {
        const config = ROOM_CONFIG[interaction.customId];
        await interaction.deferReply({ flags: [ 'Ephemeral' ] });

        try {
            const guild = interaction.guild;
            await guild.channels.fetch(); // 채널 상태 즉시 동기화
            
            const member = await guild.members.fetch(interaction.user.id);
            const role = guild.roles.cache.get(config.roleId);

            if (!role) {
                await interaction.editReply({ content: `⚠️ 설정된 역할 ID(\`${config.roleId}\`)를 서버에서 찾을 수 없습니다.` });
                return;
            }

            const categoryChannel = guild.channels.cache.get(config.categoryId);
            
            let targetChannel = null;
            if (categoryChannel && categoryChannel.children) {
                targetChannel = categoryChannel.children.cache.find(ch =>
                    ch &&
                    ch.type === ChannelType.GuildText &&
                    ch.name.toLowerCase() === config.roomName.toLowerCase() &&
                    !ch.deleted
                );
            }
            
            let isAlreadyExist = !!targetChannel;
            
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

            let responseText = "";
            if (member.roles.cache.has(config.roleId)) {
                responseText = isAlreadyExist 
                    ? `ℹ️ 이미 **${config.roomKey}방 관전 역할**을 가지고 계십니다! 👉 <#${targetChannel.id}>`
                    : `ℹ️ 이미 역할을 가지고 계십니다. 방이 없어서 새로 생성했습니다! 👉 <#${targetChannel.id}>`;
            } else {
                await member.roles.add(role);
                responseText = isAlreadyExist
                    ? `✅ 이미 생성된 채널이 존재합니다. **${config.roomKey}방 관전 역할**을 부여해 드렸습니다! 👉 <#${targetChannel.id}>`
                    : `🎉 **${config.roomKey}방 관전채팅** 채널이 개설되었으며, 관전 역할이 부여되었습니다! 👉 <#${targetChannel.id}>`;
            }

            await interaction.editReply({ content: responseText });
            
            if (!isAlreadyExist) {
                setTimeout(async () => {
                    await refreshSpectateStatus(guild);
                }, 1000);
            }
            
            setTimeout(async () => {
                await interaction.deleteReply().catch(() => null);
            }, 10000);

        } catch (error) {
            console.error("버튼 처리 프로세스 오류:", error);
            await interaction.editReply({ content: '❌ 요청을 처리하는 중에 오류가 발생했습니다.' });
        }
    }

    // 4. 관전방 개별 삭제 버튼
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
            if (role && role.members) {
                for (const [_, member] of role.members) {
                    await member.roles.remove(role).catch(console.error);
                }
            }

            await currentChannel.delete('관전 종료 버튼에 의한 자동 삭제').catch(console.error);

            setTimeout(async () => {
                await refreshSpectateStatus(guild);
            }, 1000);

        } catch (error) {
            console.error('관전방 종료 처리 중 오류:', error);
        }
    }
});

client.on('error', console.error);
client.login(process.env.DISCORD_TOKEN);
