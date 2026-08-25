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
    Partials,
    SlashCommandBuilder,
    REST,
    Routes
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

// [서버 및 채널 설정]
const GUILD_ID = "1442440228546678796";

// 분석 대상 채널 (후기 채널 1442451879186661477 제거 완료)
const GAME_LOG_CHANNEL_ID = "1447498782840328353"; // 게임 참여/기록 채널
const CHAT_CHANNEL_IDS = [
    "1442443208926953586",
    "1442449707141042318",
    "1482638402334752900"
];

const ALL_ANALYSIS_CHANNELS = [
    GAME_LOG_CHANNEL_ID,
    ...CHAT_CHANNEL_IDS
];

// 현황판 및 포럼 ID
const MAIN_FORUM_ID = "1442443517313024100";
const OTHER_FORUM_ID = "1518830708179730563";
const ANNOUNCEMENT_TEXT_ID = "1515045364045053952";
const BUTTON_CHANNEL_ID = "1519706442209300521"; 

// 3개 방 관전 설정
const ROOM_CONFIG = {
    'btn_create_a': { roomKey: 'A', roomName: 'A방-관전채팅', categoryId: '1442440229696045130', roleId: '1519716902589563071', displayName: 'A방 관전 신청' },
    'btn_create_b': { roomKey: 'B', roomName: 'B방-관전채팅', categoryId: '1469981664531972291', roleId: '1519716927881084980', displayName: 'B방 관전 신청' },
    'btn_create_c': { roomKey: 'C', roomName: 'C방-관전채팅', categoryId: '1443538692869329088', roleId: '1519716938949857360', displayName: 'C방 관전 신청' }
};

const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*(?:마감|완료)[\s]*[)\]]|(?:마감|완료)/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*(?:일협|일정협의)[\s]*[)\]]|(?:일협|일정협의)/g; 

// ================= [ 비동기 작업 및 취소 관리 ] =================
const activeTasks = new Map();
let isGlobalCancelRequested = false;

// ================= [ 슬래시 명령어 정의 (기본 600개) ] =================
const slashCommands = [
    new SlashCommandBuilder()
        .setName('케미분석')
        .setDescription('🧪 같이 한 게임 기록과 일상 티키타카를 종합한 1:1 케미 리포트')
        .addUserOption(opt => opt.setName('user1').setDescription('첫 번째 유저').setRequired(true))
        .addUserOption(opt => opt.setName('user2').setDescription('두 번째 유저').setRequired(true))
        .addIntegerOption(opt => opt.setName('문장수').setDescription('채널당 분석할 메시지 수 (기본 600개)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('케미랭킹')
        .setDescription('🏆 최근 1주일간 최고의 케미를 보여준 서버 공인 찰떡 듀오 TOP 5'),

    new SlashCommandBuilder()
        .setName('접속랭킹')
        .setDescription('⏱️ 최근 서버 채팅 활동 및 상주 체류 시간이 가장 긴 유저 TOP 5'),

    new SlashCommandBuilder()
        .setName('케미잠재력')
        .setDescription('✨ 최애 키워드, 야행성, 소통 스타일을 종합 분석하는 개인 케미 잠재력 리포트')
        .addUserOption(opt => opt.setName('user').setDescription('분석할 대상 유저').setRequired(true)),

    new SlashCommandBuilder()
        .setName('실행취소')
        .setDescription('🛑 현재 실행 중인 분석 작업을 즉시 중단하고 대기 상태를 해제합니다')
].map(cmd => cmd.toJSON());

// 안전한 메시지 수집 함수 (기본 600개)
async function fetchChannelMessages(channel, limit = 600, taskId = null) {
    if (!channel || !channel.isTextBased?.()) return [];
    let messages = [];
    let lastId = null;

    try {
        while (messages.length < limit) {
            const task = taskId ? activeTasks.get(taskId) : null;
            if (isGlobalCancelRequested || (task && task.isCancelled)) break;

            const fetchLimit = Math.min(limit - messages.length, 100);
            const options = { limit: fetchLimit };
            if (lastId) options.before = lastId;

            const fetched = await Promise.race([
                channel.messages.fetch(options),
                new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 4000))
            ]).catch(() => null);

            if (!fetched || fetched.size === 0) break;

            messages = messages.concat(Array.from(fetched.values()));
            lastId = fetched.last().id;
            if (fetched.size < fetchLimit) break;
        }
    } catch (e) {
        console.error(`채널(${channel.id}) 수집 오류:`, e.message);
    }
    return messages;
}

client.on('clientReady', async (c) => {
    console.log(`🤖 ${c.user.tag} 봇 로그인 완료!`);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(c.user.id, GUILD_ID),
            { body: slashCommands }
        );
        console.log('⚡ 슬래시 명령어 등록 완료');
    } catch (error) {
        console.error('슬래시 명령어 등록 실패:', error);
    }

    await updateAnnouncementBoard().catch(console.error);
    await autoDeployGuideAndButtons().catch(console.error);
});

// ================= [ 관전방 수동 일괄 초기화 ] =================
async function resetAllSpectateRooms(guild) {
    const allChannels = await guild.channels.fetch();

    for (const key in ROOM_CONFIG) {
        const config = ROOM_CONFIG[key];
        const targetChannels = allChannels.filter(ch => 
            ch && 
            ch.parentId === config.categoryId &&
            ch.name.toLowerCase() === config.roomName.toLowerCase()
        );

        for (const [_, ch] of targetChannels) {
            await ch.delete('수동 관전방 초기화/갱신').catch(console.error);
        }

        const role = guild.roles.cache.get(config.roleId) || await guild.roles.fetch(config.roleId).catch(() => null);
        if (role) {
            for (const [_, member] of role.members) {
                await member.roles.remove(role).catch(console.error);
            }
        }
    }
}

// ================= [ 가이드, 버튼, 실시간 현황판 빌더 ] =================
async function getSpectateStatusText(guild) {
    let text = `### 📊 실시간 관전방 개설 현황\n`;
    const allChannels = await guild.channels.fetch().catch(() => guild.channels.cache);

    const rooms = [
        { key: 'A', name: 'A방 관전채팅', cat: '1442440229696045130', roomName: 'A방-관전채팅' },
        { key: 'B', name: 'B방 관전채팅', cat: '1469981664531972291', roomName: 'B방-관전채팅' },
        { key: 'C', name: 'C방 관전채팅', cat: '1443538692869329088', roomName: 'C방-관전채팅' }
    ];

    for (const r of rooms) {
        const targetChannel = allChannels.find(ch => 
            ch && 
            ch.parentId === r.cat &&
            ch.type === ChannelType.GuildText && 
            ch.name.toLowerCase() === r.roomName.toLowerCase()
        );

        if (targetChannel) {
            text += `🟢 **${r.name}**: 개설되어 있습니다! (👉 <#${targetChannel.id}>)\n`;
        } else {
            text += `🔴 **${r.name}**: 닫혀있습니다.\n`;
        }
    }
    
    text += `\n*※ 방이 제대로 열리지 않거나 오류가 생기면 아래 [관전방 초기화/갱신] 버튼을 눌러주세요.*`;
    return text;
}

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

        await targetChannel.send({ content: newText, components: [resetRow] });
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

            const kstDateString = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date());
            const [curMonth, curDay] = kstDateString.split('/').map(Number);
            const url = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
            let sortKey;
            let displayTitlePrefix = "";
            let cleanedTitle = title.replace(MARAM_PATTERN, '').replace(ILHYEOP_PATTERN, '');

            const dateMatch = title.match(DATE_PATTERN);
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
                cleanedTitle = cleanedTitle.replace(new RegExp(`[\\s\\[\\(]*${escapeRegExp(dateMatch[0])}[\\s\\]\\)]*`, 'g'), ' ');

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
                    cleanedTitle = cleanedTitle.replace(new RegExp(`[\\s\\[\\(]*${escapeRegExp(timeMatch[0])}[\\s\\]\\)]*`, 'g'), ' ');
                    timePrefix = `[${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}] `; 
                }

                cleanedTitle = cleanedTitle.replace(/(?:월|화|수|목|금|토|일)요일/g, ' ');
                displayTitlePrefix = `[${month}/${day}] ｜ ${timePrefix}`;
            } else {
                sortKey = { month: 98, day: 98, isIlhyeop: true }; 
                displayTitlePrefix = `[일협] ｜ `;
            }

            cleanedTitle = cleanedTitle.replace(/[\[\(]\s*오프\s*[\]\)]/g, '___OFFLINE___')
                                       .replace(/오프/g, '___OFFLINE___')
                                       .replace(/[\[\(][\s/,\-~]*[\]\)]/g, ' ')
                                       .replace(/[\[\(\]\)]/g, ' ')
                                       .replace(/___OFFLINE___/g, '[오프]')
                                       .replace(/^[\]\)/\-,\s|?]+|[\[\(/\-,\s|?]+$/g, '')
                                       .replace(/\s+/g, ' ').trim();

            let displayTitle = displayTitlePrefix + cleanedTitle;
            const lastTouchTime = thread.editedTimestamp || thread.createdTimestamp;
            if (now - lastTouchTime < 24 * 60 * 60 * 1000) {
                displayTitle += " ⭐NEW!⭐";
            }

            const postData = { sortKey, text: `${displayTitle} ([바로가기](${url}))` };
            if (title.includes("마감") || title.includes("꽉") || title.includes("완료")) {
                scheduleArr.push(postData);
            } else {
                recruitingArr.push(postData);
            }
        };

        const fetchAndProcessThreads = async (forumChannel, scheduleArr, recruitingArr) => {
            if (!forumChannel) return;
            const activeThreads = await forumChannel.threads.fetchActive();
            for (const [_, thread] of activeThreads.threads) processThread(thread, scheduleArr, recruitingArr);

            const archivedThreads = await forumChannel.threads.fetchArchived({ limit: 20 });
            const kstDateString = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date());
            const [curMonth, curDay] = kstDateString.split('/').map(Number);

            for (const [_, thread] of archivedThreads.threads) {
                const dateMatch = thread.name.match(DATE_PATTERN);
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

        await textChannel.send({ embeds: [refreshEmbed], components: [refreshRow] });

    } catch (error) {
        console.error("오류 발생:", error);
    } finally {
        isUpdatingSchedule = false;
        if (hasPendingScheduleUpdate) {
            hasPendingScheduleUpdate = false;
            setTimeout(() => updateAnnouncementBoard().catch(console.error), 1000);
        }
    }
}

// ================= [ 스레드 이벤트 리스너 ] =================
function requestScheduleUpdate() {
    if (scheduleUpdateTimer) clearTimeout(scheduleUpdateTimer);
    scheduleUpdateTimer = setTimeout(() => updateAnnouncementBoard().catch(console.error), 3000); 
}

const watchChannels = [MAIN_FORUM_ID, OTHER_FORUM_ID];
function handleThreadEvent(thread) {
    if (!thread) return;
    const parentId = thread.parentId || thread.parent?.id;
    if (watchChannels.includes(parentId)) requestScheduleUpdate();
}

client.on('threadCreate', handleThreadEvent);
client.on('threadUpdate', (b, a) => handleThreadEvent(a));
client.on('threadDelete', handleThreadEvent);

// ================= [ 상호작용 통합 처리 ] =================
client.on('interactionCreate', async (interaction) => {
    
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        const taskId = interaction.id;

        // [0] 실행취소
        if (commandName === '실행취소') {
            isGlobalCancelRequested = true;

            for (const [id, task] of activeTasks.entries()) {
                task.isCancelled = true;
                if (task.interaction) {
                    task.interaction.editReply({ content: '🛑 관리자 또는 사용자에 의해 분석 작업이 취소되었습니다.' }).catch(() => null);
                }
            }
            activeTasks.clear();

            setTimeout(() => { isGlobalCancelRequested = false; }, 3000);
            return interaction.reply({ content: '🛑 진행 중이던 모든 분석 작업을 즉시 중단하고 대기 상태를 해제했습니다!', flags: ['Ephemeral'] });
        }

        // [A] 케미분석
        if (commandName === '케미분석') {
            await interaction.deferReply();
            activeTasks.set(taskId, { interaction, isCancelled: false });

            const user1 = interaction.options.getUser('user1');
            const user2 = interaction.options.getUser('user2');
            const limit = interaction.options.getInteger('문장수') || 600;

            if (user1.id === user2.id) {
                activeTasks.delete(taskId);
                return interaction.editReply({ content: '❌ 서로 다른 두 유저를 선택해주세요.' });
            }

            const name1 = user1.globalName || user1.username;
            const name2 = user2.globalName || user2.username;

            const [gameLogChannel, chatChannels] = await Promise.all([
                interaction.guild.channels.fetch(GAME_LOG_CHANNEL_ID).catch(() => null),
                Promise.all(CHAT_CHANNEL_IDS.map(id => interaction.guild.channels.fetch(id).catch(() => null)))
            ]);

            const [gameLogMsgs, chatMsgsList] = await Promise.all([
                fetchChannelMessages(gameLogChannel, limit, taskId),
                Promise.all(chatChannels.filter(Boolean).map(ch => fetchChannelMessages(ch, limit, taskId)))
            ]);

            const currentTask = activeTasks.get(taskId);
            if (!currentTask || currentTask.isCancelled || isGlobalCancelRequested) {
                activeTasks.delete(taskId);
                return interaction.editReply({ content: '🛑 작업이 사용자에 의해 중단되었습니다.' }).catch(() => null);
            }

            // 1. 게임 동반 플레이 분석 (1447498782840328353)
            let sharedGameCount = 0;
            for (const msg of gameLogMsgs) {
                const content = msg.content;
                const hasUser1 = msg.mentions.users.has(user1.id) || content.includes(name1) || content.includes(user1.username);
                const hasUser2 = msg.mentions.users.has(user2.id) || content.includes(name2) || content.includes(user2.username);
                if (hasUser1 && hasUser2) sharedGameCount++;
            }

            // 2. 일반 채팅 상호작용 분석
            let directInteractions = 0;
            let normalTikitaka = 0;
            let fastTikitaka = 0;
            let reactionScore = 0;
            const targetIds = new Set([user1.id, user2.id]);

            for (const messages of chatMsgsList) {
                const sortedMsgs = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                let prevMsg = null;

                for (const msg of sortedMsgs) {
                    if (msg.author.id === user1.id) {
                        if (msg.mentions.users.has(user2.id) || (msg.reference && msg.referencedMessage?.author?.id === user2.id)) directInteractions++;
                    } else if (msg.author.id === user2.id) {
                        if (msg.mentions.users.has(user1.id) || (msg.reference && msg.referencedMessage?.author?.id === user1.id)) directInteractions++;
                    }

                    if (prevMsg && targetIds.has(prevMsg.author.id) && targetIds.has(msg.author.id)) {
                        if (prevMsg.author.id !== msg.author.id) {
                            const timeDiff = msg.createdTimestamp - prevMsg.createdTimestamp;
                            if (timeDiff <= 30000) fastTikitaka++;
                            else if (timeDiff <= 180000) normalTikitaka++;
                        }
                    }

                    if (targetIds.has(msg.author.id)) {
                        if (/(ㅋ|ㅎ|좋아|굿|굳|인정|대박|맞아|ㄹㅇ|오호|감사|나이스|재밌|웃겨)/.test(msg.content)) reactionScore++;
                    }
                    prevMsg = msg;
                }
            }

            activeTasks.delete(taskId);

            // 가중치 종합 계산
            const totalScoreRaw = (sharedGameCount * 14.0) + (directInteractions * 4.0) + (fastTikitaka * 2.8) + (normalTikitaka * 1.3) + (reactionScore * 0.35);
            const chemiScore = totalScoreRaw > 0 ? Math.min(100, Math.floor(Math.sqrt(totalScoreRaw) * 11.0)) : 0;

            let tier = "🧊 어색한 탐색 단계 (낯가리는 사이)";
            let summary = "아직 함께한 게임이나 교류가 적은 편입니다. 같이 구인에 참가해보세요!";

            if (chemiScore >= 88) {
                tier = "💖 영혼의 단짝 (서버 공인 고정 파티)";
                summary = "게임도 같이 많이 달리고 대화 티키타카까지 완벽한 환상의 듀오입니다!";
            } else if (chemiScore >= 68) {
                tier = "🔥 든든한 게임 메이트 (믿고 보는 조합)";
                summary = "플레이 기록이 풍부하며 대화 호응과 핑퐁이 아주 뛰어납니다.";
            } else if (chemiScore >= 42) {
                tier = "✨ 편안한 지인 (스몰토크 최적화)";
                summary = "가벼운 일상과 안부를 나누기 편안하고 원만한 사이입니다.";
            } else if (chemiScore >= 18) {
                tier = "🌱 친해지는 중 (친밀감 형성 단계)";
                summary = "서로 알아가는 중입니다. 다음 머미나 보드게임 일정을 함께 잡아보세요!";
            }

            const embed = new EmbedBuilder()
                .setTitle(`🧪 ${name1} X ${name2} 케미 분석표`)
                .setColor(0xFF6E96)
                .setDescription("📅 **분석 범위:** `게임 동반 플레이 기록 + 일상 대화 티키타카 종합 분석`\n\u200B")
                .addFields(
                    { name: '🧬 케미 지수', value: `### **${chemiScore}점** / 100점\n\`${tier}\``, inline: false },
                    { 
                        name: '🎮 게임 활동 연계 지표', 
                        value: `• **동반 플레이 기록:** \`${sharedGameCount}회\``, 
                        inline: false 
                    },
                    { 
                        name: '💬 실시간 대화 상호작용', 
                        value: `• **직접 멘션/답장:** \`${directInteractions}회\`\n• **초고속 티키타카(30초 내):** \`${fastTikitaka}회\`\n• **호응 & 리액션:** \`${reactionScore}회\``, 
                        inline: false 
                    },
                    { name: '📌 케미 진단 총평', value: `> ${summary}`, inline: false }
                );

            return interaction.editReply({ embeds: [embed] });
        }

        // [B] 케미랭킹
        if (commandName === '케미랭킹') {
            await interaction.deferReply();
            activeTasks.set(taskId, { interaction, isCancelled: false });

            const targetChannels = (await Promise.all(
                ALL_ANALYSIS_CHANNELS.map(id => interaction.guild.channels.fetch(id).catch(() => null))
            )).filter(Boolean);

            const allResults = await Promise.all(
                targetChannels.map(ch => fetchChannelMessages(ch, 600, taskId))
            );

            const currentTask = activeTasks.get(taskId);
            if (!currentTask || currentTask.isCancelled || isGlobalCancelRequested) {
                activeTasks.delete(taskId);
                return interaction.editReply({ content: '🛑 작업이 사용자에 의해 중단되었습니다.' }).catch(() => null);
            }

            const pairScores = {};

            for (const messages of allResults) {
                const sortedMsgs = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                let prevMsg = null;

                for (const msg of sortedMsgs) {
                    if (msg.author.bot) continue;

                    if (msg.mentions.users.size > 1) {
                        const userArr = Array.from(msg.mentions.users.keys()).filter(id => id !== client.user.id);
                        for (let i = 0; i < userArr.length; i++) {
                            for (let j = i + 1; j < userArr.length; j++) {
                                const pair = [userArr[i], userArr[j]].sort().join(':');
                                pairScores[pair] = (pairScores[pair] || 0) + 6;
                            }
                        }
                    }

                    if (msg.reference && msg.referencedMessage?.author && !msg.referencedMessage.author.bot && msg.referencedMessage.author.id !== msg.author.id) {
                        const pair = [msg.author.id, msg.referencedMessage.author.id].sort().join(':');
                        pairScores[pair] = (pairScores[pair] || 0) + 3;
                    }

                    if (prevMsg && !prevMsg.author.bot && prevMsg.author.id !== msg.author.id) {
                        if ((msg.createdTimestamp - prevMsg.createdTimestamp) <= 180000) {
                            const pair = [msg.author.id, prevMsg.author.id].sort().join(':');
                            pairScores[pair] = (pairScores[pair] || 0) + 2;
                        }
                    }
                    prevMsg = msg;
                }
            }

            activeTasks.delete(taskId);

            const sortedPairs = Object.entries(pairScores).sort((a, b) => b[1] - a[1]).slice(0, 5);

            if (sortedPairs.length === 0) {
                return interaction.editReply({ content: '분석할 교류 데이터가 충분하지 않습니다.' });
            }

            const embed = new EmbedBuilder()
                .setTitle("🏆 최근 1주일간 최고의 케미! 실시간 찰떡 듀오 TOP 5")
                .setColor(0xFFD700)
                .setDescription("🔥 **최근 1주일 동안 최고의 케미를 보여준 서버 공인 찰떡 듀오 순위입니다!**\n`게임 참여 기록 + 일상 핑퐁 화력 종합 집계`\n\u200B");

            const rankIcons = ["🥇 1위", "🥈 2위", "🥉 3위", "4️⃣ 4위", "5️⃣ 5위"];

            for (let i = 0; i < sortedPairs.length; i++) {
                const [pairStr, score] = sortedPairs[i];
                const [id1, id2] = pairStr.split(':');
                
                const u1 = await client.users.fetch(id1).catch(() => null);
                const u2 = await client.users.fetch(id2).catch(() => null);
                const name1 = u1?.globalName || u1?.username || "유저";
                const name2 = u2?.globalName || u2?.username || "유저";

                embed.addFields({ 
                    name: `${rankIcons[i]} ${name1} × ${name2}`, 
                    value: `> 찰떡 상호작용 화력: **${score} pt**`, 
                    inline: false 
                });
            }

            return interaction.editReply({ embeds: [embed] });
        }

        // [C] 접속랭킹
        if (commandName === '접속랭킹') {
            await interaction.deferReply();
            activeTasks.set(taskId, { interaction, isCancelled: false });

            const targetChannels = (await Promise.all(
                ALL_ANALYSIS_CHANNELS.map(id => interaction.guild.channels.fetch(id).catch(() => null))
            )).filter(Boolean);

            const allResults = await Promise.all(
                targetChannels.map(ch => fetchChannelMessages(ch, 600, taskId))
            );

            const currentTask = activeTasks.get(taskId);
            if (!currentTask || currentTask.isCancelled || isGlobalCancelRequested) {
                activeTasks.delete(taskId);
                return interaction.editReply({ content: '🛑 작업이 사용자에 의해 중단되었습니다.' }).catch(() => null);
            }

            const userTimestamps = {};
            for (const messages of allResults) {
                for (const msg of messages) {
                    if (msg.author.bot) continue;
                    if (!userTimestamps[msg.author.id]) userTimestamps[msg.author.id] = [];
                    userTimestamps[msg.author.id].push(msg.createdTimestamp);
                }
            }

            const userActiveMinutes = {};
            const SESSION_GAP = 5 * 60 * 1000; // 5분

            for (const [userId, timestamps] of Object.entries(userTimestamps)) {
                if (timestamps.length < 2) {
                    userActiveMinutes[userId] = 1;
                    continue;
                }

                timestamps.sort((a, b) => a - b);
                let totalDurationMs = 0;
                let sessionStart = timestamps[0];
                let prevTime = timestamps[0];

                for (let i = 1; i < timestamps.length; i++) {
                    const diff = timestamps[i] - prevTime;
                    if (diff <= SESSION_GAP) {
                        prevTime = timestamps[i];
                    } else {
                        totalDurationMs += Math.max(prevTime - sessionStart, 60000);
                        sessionStart = timestamps[i];
                        prevTime = timestamps[i];
                    }
                }
                totalDurationMs += Math.max(prevTime - sessionStart, 60000);
                userActiveMinutes[userId] = Math.max(1, Math.round(totalDurationMs / (60 * 1000)));
            }

            activeTasks.delete(taskId);

            const sortedUsers = Object.entries(userActiveMinutes).sort((a, b) => b[1] - a[1]).slice(0, 5);

            if (sortedUsers.length === 0) {
                return interaction.editReply({ content: '분석할 활동 데이터가 부족합니다.' });
            }

            const embed = new EmbedBuilder()
                .setTitle("⏱️ 서버 실시간 접속 및 체류 랭킹 TOP 5")
                .setColor(0x00CEC9)
                .setDescription("📊 **최근 대화 흐름과 세션 지속 시간을 기반으로 측정한 상주 시간 순위입니다!**\n\u200B");

            const rankIcons = ["🥇 1위", "🥈 2위", "🥉 3위", "4️⃣ 4위", "5️⃣ 5위"];

            for (let i = 0; i < sortedUsers.length; i++) {
                const [userId, minutes] = sortedUsers[i];
                const u = await client.users.fetch(userId).catch(() => null);
                const name = u?.globalName || u?.username || "유저";

                const hours = Math.floor(minutes / 60);
                const remainMins = minutes % 60;
                const timeStr = hours > 0 ? `${hours}시간 ${remainMins}분` : `${remainMins}분`;

                embed.addFields({ 
                    name: `${rankIcons[i]} ${name}`, 
                    value: `> 실시간 활동 체류: **${timeStr}** (\`${userTimestamps[userId]?.length || 0}개 메시지\`)`, 
                    inline: false 
                });
            }

            return interaction.editReply({ embeds: [embed] });
        }

        // [D] 케미잠재력
        if (commandName === '케미잠재력') {
            await interaction.deferReply();
            activeTasks.set(taskId, { interaction, isCancelled: false });
            const targetUser = interaction.options.getUser('user');

            const targetChannels = (await Promise.all(
                ALL_ANALYSIS_CHANNELS.map(id => interaction.guild.channels.fetch(id).catch(() => null))
            )).filter(Boolean);

            const allResults = await Promise.all(
                targetChannels.map(ch => fetchChannelMessages(ch, 600, taskId))
            );

            const currentTask = activeTasks.get(taskId);
            if (!currentTask || currentTask.isCancelled || isGlobalCancelRequested) {
                activeTasks.delete(taskId);
                return interaction.editReply({ content: '🛑 작업이 사용자에 의해 중단되었습니다.' }).catch(() => null);
            }

            const userMsgs = allResults.flat().filter(m => m.author.id === targetUser.id && m.content);
            activeTasks.delete(taskId);

            const targetDisplayName = targetUser.globalName || targetUser.username;

            if (userMsgs.length < 5) {
                return interaction.editReply({ 
                    content: `앗, ${targetDisplayName}님은 최근 서버에 자주 안 오셨군요! 🥺\n대화를 조금 더 나누어 숨겨진 케미 잠재력을 깨워주세요! 분발을 기대합니다! 🔥` 
                });
            }

            const totalMsgs = userMsgs.length;
            const avgLen = Math.floor(userMsgs.reduce((acc, m) => acc + m.content.length, 0) / totalMsgs);
            
            const nightMsgs = userMsgs.filter(m => {
                const hour = new Date(m.createdTimestamp + (9 * 60 * 60 * 1000)).getUTCHours();
                return hour >= 0 && hour < 6;
            }).length;
            const nightRatio = Math.floor((nightMsgs / totalMsgs) * 100);

            const laughMsgs = userMsgs.filter(m => /(ㅋ|ㅎ|ㅜ|ㅠ|웃겨|웃기|재밌|잼따|개웃|꿀잼|ㅎㅎ|ㅋㅋ|푸하|대박|좋아|굳|굿)/.test(m.content)).length;
            const rawLaughRatio = (laughMsgs / totalMsgs) * 100;
            const laughRatio = Math.min(100, Math.floor(rawLaughRatio * 2.2));

            const questionMsgs = userMsgs.filter(m => /(\?|물어|궁금)/.test(m.content)).length;
            const questionRatio = Math.floor((questionMsgs / totalMsgs) * 100);

            const emojiMsgs = userMsgs.filter(m => /([\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[!~^;])/g.test(m.content)).length;
            const emojiRatio = Math.floor((emojiMsgs / totalMsgs) * 100);

            const wordCount = {};
            for (const msg of userMsgs) {
                const cleanText = msg.content
                    .replace(/<t:\d+(?::[tTdDfFR])?>/g, '')
                    .replace(/<@!?\d+>/g, '')
                    .replace(/<#\d+>/g, '')
                    .replace(/<a?:\w+:\d+>/g, '')
                    .replace(/https?:\/\/\S+/g, '')
                    .replace(/\b\d+([:.\-/]\d+)*\b/g, '')
                    .replace(/[0-9]/g, '');

                const words = cleanText.replace(/[^가-힣a-zA-Z\s]/g, ' ').split(/\s+/);
                for (const w of words) {
                    if (w.length >= 2 && !/^(ㅋ+|ㅎ+|ㅜ+|ㅠ+|ㅇ+|ㄴ+|ㄱ+|ㄷ+|ㄹ+|ㅁ+|ㅂ+|ㅅ+|ㅈ+|ㅊ+|ㅋ+|ㅌ+|ㅍ+)$/.test(w)) {
                        wordCount[w] = (wordCount[w] || 0) + 1;
                    }
                }
            }

            const topWords = Object.entries(wordCount)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([word, cnt]) => `\`#${word}\`(${cnt}회)`)
                .join(' ') || '`#데이터수집중`';

            let potentialType = "⚡ 번개 반응러";
            let potentialDesc = "짧고 간결하게 대화 흐름을 바로바로 이어받아 주는 든든한 핑퐁러입니다.";

            if (nightRatio >= 45) {
                potentialType = "🌙 심야의 토크마스터";
                potentialDesc = "모두가 잠든 새벽 시간대에 진가를 발휘하는 올빼미형 케미 장인입니다.";
            } else if (laughRatio >= 50) {
                potentialType = "💖 긍정 비타민형";
                potentialDesc = "모든 말에 호응과 웃음을 가득 실어 분위기를 밝게 띄워주는 분위기 메이커입니다.";
            } else if (avgLen >= 35) {
                potentialType = "📜 정성 가득 스토리텔러";
                potentialDesc = "차분하고 논리정연한 장문으로 깊이 있는 대화를 이끌어내는 타입입니다.";
            } else if (questionRatio >= 28) {
                potentialType = "🔍 호기심 가득 탐구자";
                potentialDesc = "질문과 관심을 통해 상대방의 말문을 술술 열어주는 훌륭한 경청자입니다.";
            }

            const embed = new EmbedBuilder()
                .setTitle(`✨ ${targetDisplayName}님의 케미 잠재력 리포트`)
                .setColor(0x00D2D3)
                .setDescription(`최근 활동 **${totalMsgs}개**를 기반으로 분석한 개인 소통 데이터입니다.\n\u200B`)
                .addFields(
                    { name: '🏷️ 소통 잠재력 유형', value: `**${potentialType}**\n> ${potentialDesc}`, inline: false },
                    { name: '🏷️ 자주 쓰는 최애 키워드 TOP 3', value: `> ${topWords}`, inline: false },
                    { 
                        name: '📊 세부 활동 성향 지표', 
                        value: `• **평균 문장 길이:** \`${avgLen}자\` (${avgLen >= 25 ? '정성 장문파' : '스피드 단문파'})\n• **심야 활동률:** \`${nightRatio}%\` (${nightRatio >= 30 ? '🌙 야행성' : '☀️ 주간파'})\n• **웃음 장착도:** \`${laughRatio}%\` (😆 긍정 에너지 가득!)\n• **감정/이모지 표현력:** \`${emojiRatio}%\`\n• **질문 빈도율:** \`${questionRatio}%\``,
                        inline: false 
                    }
                );

            return interaction.editReply({ embeds: [embed] });
        }
    }

    // -------------------------------------------------------------
    // 버튼 클릭 이벤트
    // -------------------------------------------------------------
    if (!interaction.isButton()) return;

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

    if (interaction.customId === 'btn_reset_all_spectate') {
        await interaction.deferReply({ flags: [ 'Ephemeral' ] });
        try {
            await resetAllSpectateRooms(interaction.guild);
            await refreshSpectateStatus(interaction.guild);
            await interaction.editReply({ content: '🛠️ 관전방을 모두 정리하고 현황판을 최신 상태로 복구했습니다!' });
        } catch (error) {
            console.error("관전방 초기화 중 오류:", error);
            await interaction.editReply({ content: '❌ 관전방 초기화 중 오류가 발생했습니다.' });
        }
        return;
    }

    if (ROOM_CONFIG[interaction.customId]) {
        const config = ROOM_CONFIG[interaction.customId];
        await interaction.deferReply({ flags: [ 'Ephemeral' ] });

        try {
            const guild = interaction.guild;
            const member = await guild.members.fetch(interaction.user.id);
            const role = guild.roles.cache.get(config.roleId) || await guild.roles.fetch(config.roleId).catch(() => null);

            if (!role) {
                await interaction.editReply({ content: `⚠️ 설정된 역할 ID(\`${config.roleId}\`)를 서버에서 찾을 수 없습니다.` });
                return;
            }

            const allChannels = await guild.channels.fetch();
            let targetChannel = allChannels.find(ch =>
                ch &&
                ch.parentId === config.categoryId &&
                ch.type === ChannelType.GuildText &&
                ch.name.toLowerCase() === config.roomName.toLowerCase()
            );
            
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
            const role = guild.roles.cache.get(config.roleId) || await guild.roles.fetch(config.roleId).catch(() => null);
            if (role) {
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

// ================= [ 수동 버튼 생성 ] =================
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

client.on('error', console.error);
client.login(process.env.DISCORD_TOKEN);
