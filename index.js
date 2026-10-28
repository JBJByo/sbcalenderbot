require('dotenv').config();

// Diagnostic logging: stdout (Railway) + bounded local files. No message bodies.
const diagFs = require('fs');
const diagPath = require('path');
const diagCrypto = require('crypto');
const diagUtil = require('util');
const DIAG_RUN = diagCrypto.randomUUID();
const DIAG_SOURCE = diagCrypto.createHash('sha256').update(diagFs.readFileSync(__filename)).digest('hex').slice(0, 16);
const DIAG_HOST = process.env.RAILWAY_SERVICE_ID ? 'railway' : 'local-or-other';
const DIAG_DIR = process.env.BOT_LOG_DIR || diagPath.join(__dirname, 'logs');
const DIAG_FILE = diagPath.join(DIAG_DIR, `bot-${process.pid}-${DIAG_RUN.slice(0,8)}.log`);
const diagOutput = console.log.bind(console);
let diagFileEnabled = true;
function diagRedact(value) {
    let text = String(value);
    if (process.env.DISCORD_TOKEN) text = text.split(process.env.DISCORD_TOKEN).join('[REDACTED]');
    return text.replace(/(\/interactions\/\d+\/)[^/\s?]+/g, '$1[REDACTED]')
        .replace(/(\/webhooks\/\d+\/)[^/\s?]+/g, '$1[REDACTED]')
        .replace(/\b(Bot|Bearer)\s+[^\s'"\\]+/g, '$1 [REDACTED]');
}
function diagnostic(event, data = {}) {
    const line = diagRedact(JSON.stringify({time: new Date().toISOString(), event, run: DIAG_RUN,
        host: DIAG_HOST, pid: process.pid, source: DIAG_SOURCE, ...data}));
    diagOutput(line);
    if (!diagFileEnabled) return;
    try {
        diagFs.mkdirSync(DIAG_DIR, {recursive: true});
        if (diagFs.existsSync(DIAG_FILE) && diagFs.statSync(DIAG_FILE).size > 5 * 1024 * 1024) {
            for (let i = 2; i >= 1; i--) {
                const from = `${DIAG_FILE}.${i}`, to = `${DIAG_FILE}.${i+1}`;
                if (diagFs.existsSync(from)) diagFs.renameSync(from, to);
            }
            diagFs.renameSync(DIAG_FILE, `${DIAG_FILE}.1`);
        }
        diagFs.appendFileSync(DIAG_FILE, line + '\n');
    } catch (error) {
        diagFileEnabled = false;
        diagOutput(JSON.stringify({event: 'log_file_unavailable', message: diagRedact(error.message)}));
    }
}
for (const level of ['log', 'warn', 'error']) {
    console[level] = (...args) => diagnostic(`console_${level}`, {message: args.map(arg =>
        arg instanceof Error ? `${arg.name}: ${arg.message}\n${arg.stack || ''}\ncode=${arg.code || ''}` :
        typeof arg === 'string' ? arg : diagUtil.inspect(arg, {depth: 2})).join(' ')});
}
process.on('uncaughtExceptionMonitor', (error, origin) => diagnostic('fatal',
    {origin, message: error.message, stack: error.stack, code: error.code}));
process.on('exit', code => diagnostic('process_exit', {code}));
diagnostic('boot', {node: process.version, tokenPresent: Boolean(process.env.DISCORD_TOKEN),
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || null, deployment: process.env.RAILWAY_DEPLOYMENT_ID || null,
    logFile: DIAG_FILE});

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

client.on('error', error => console.error('discord_client_error', error));
client.on('shardError', (error, shard) => console.error('discord_shard_error', shard, error));
client.on('shardDisconnect', (event, shard) => diagnostic('discord_disconnect', {shard, code: event.code}));
client.on('shardReconnecting', shard => diagnostic('discord_reconnecting', {shard}));
client.on('shardResume', (shard, replayed) => diagnostic('discord_resumed', {shard, replayed}));
client.on('warn', message => console.warn('discord_warning', message));
let diagnosticHeartbeatAt = Date.now();
setInterval(() => {
    const now = Date.now();
    diagnostic('heartbeat', {ready: client.isReady(), uptimeSeconds: Math.round(process.uptime()),
        pingMs: client.ws.ping, loopDelayMs: Math.max(0, now - diagnosticHeartbeatAt - 60000),
        scheduleBusy: isUpdatingSchedule, schedulePending: hasPendingScheduleUpdate});
    diagnosticHeartbeatAt = now;
}, 60000).unref();

// [서버 및 채널 설정]
const GUILD_ID = "1442440228546678796";

// 현황판 및 포럼 ID
const MAIN_FORUM_ID = "1442443517313024100";
const OTHER_FORUM_ID = "1518830708179730563";
const ANNOUNCEMENT_TEXT_ID = "1515045364045053952";
const BUTTON_CHANNEL_ID = "1519706442209300521"; 

// 3개 방 관전 설정
const ROOM_CONFIG = {
    'btn_create_a': { roomKey: 'A', roomName: 'A방-관전채팅', categoryId: '1442440229696045130', roleId: '1558124021072138240', displayName: 'A방 관전 신청' },
    'btn_create_b': { roomKey: 'B', roomName: 'B방-관전채팅', categoryId: '1469981664531972291', roleId: '1558124046502203420', displayName: 'B방 관전 신청' },
    'btn_create_c': { roomKey: 'C', roomName: 'C방-관전채팅', categoryId: '1443538692869329088', roleId: '1558124062641885356', displayName: 'C방 관전 신청' }
};

const DATE_PATTERN = /(\d{1,2})[월./\s\-]+(\d{1,2})(?:일)?/;
const MARAM_PATTERN = /[(\[][\s]*(?:마감|완료)[\s]*[)\]]|(?:마감|완료)/g; 
const ILHYEOP_PATTERN = /[(\[][\s]*(?:일협|일정협의)[\s]*[)\]]|(?:일협|일정협의)/g; 

// 케미 기능 제거: 시작 시 이 서버의 기존 슬래시 명령어를 해제합니다.
const slashCommands = [];

client.on('clientReady', async (c) => {
    diagnostic('discord_ready', {botId: c.user.id});
    console.log(`🤖 ${c.user.tag} 봇 로그인 완료!`);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(c.user.id, GUILD_ID),
            { body: slashCommands }
        );
        console.log('⚡ 케미 관련 슬래시 명령어 해제 완료');
    } catch (error) {
        console.error('슬래시 명령어 등록 실패:', error);
    }

    await updateAnnouncementBoard('startup').catch(console.error);
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

let diagnosticScheduleSequence = 0;
async function updateAnnouncementBoard(reason = 'unspecified') {
    diagnostic('schedule_requested', {reason, busy: isUpdatingSchedule});
    if (isUpdatingSchedule) {
        diagnostic('schedule_queued', {reason});
        hasPendingScheduleUpdate = true;
        return;
    }
    isUpdatingSchedule = true;
    const updateId = ++diagnosticScheduleSequence;
    const started = Date.now();
    let outcome = 'incomplete';
    diagnostic('schedule_start', {updateId, reason});

    try {
        const textChannel = await client.channels.fetch(ANNOUNCEMENT_TEXT_ID).catch(() => null);
        if (!textChannel) { diagnostic('schedule_channel_unavailable'); return; }

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
            // 저녁, 밤, 새벽 키워드 및 '반'까지 매칭하도록 정규식 개선
            const timeMatch = title.match(/(?:(오전|오후|저녁|밤|새벽|am|pm|AM|PM)\s*)?([0-2]?\d)[:시](?!\s*간)(?:\s*([0-5]\d)분?|\s*(반))?/);

            if (dateMatch) {
                const month = parseInt(dateMatch[1], 10);
                const day = parseInt(dateMatch[2], 10);

                let isPast = false;
                if (month < curMonth && (curMonth - month) < 6) isPast = true;
                if (month === curMonth && day < curDay) isPast = true;
                
                if (isPast) {
                    diagnostic('schedule_archive_change', {threadId: thread.id, archived: true});
                    thread.edit({ archived: true }).catch(console.error);
                    return; 
                }

                const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cleanedTitle = cleanedTitle.replace(new RegExp(`[\\s\\[\\(]*${escapeRegExp(dateMatch[0])}[\\s\\]\\)]*`, 'g'), ' ');

                let timePrefix = "";
                let hour = 99;   // 시간이 없으면 해당 날짜의 맨 뒤로 보내기 위한 기본값
                let minute = 99;

                if (timeMatch) {
                    hour = parseInt(timeMatch[2], 10);
                    minute = 0;

                    if (timeMatch[3]) {
                        minute = parseInt(timeMatch[3], 10);
                    } else if (timeMatch[4] === '반') {
                        minute = 30;
                    }

                    const modifier = timeMatch[1];
                    if (modifier) {
                        const lowerMod = modifier.toLowerCase();
                        if (['오후', '저녁', '밤', 'pm'].includes(lowerMod) && hour < 12) {
                            hour += 12;
                        }
                        if (['오전', '새벽', 'am'].includes(lowerMod) && hour === 12) {
                            hour = 0;
                        }
                    }
                    cleanedTitle = cleanedTitle.replace(new RegExp(`[\\s\\[\\(]*${escapeRegExp(timeMatch[0])}[\\s\\]\\)]*`, 'g'), ' ');
                    timePrefix = `[${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}] `; 
                }

                sortKey = { month, day, hour, minute, isIlhyeop: false };

                cleanedTitle = cleanedTitle.replace(/(?:월|화|수|목|금|토|일)요일/g, ' ');
                displayTitlePrefix = `**[${month}/${day}]** ｜ ${timeMatch ? `\`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}\` ` : ''}`;
            } else {
                sortKey = { month: 98, day: 98, hour: 99, minute: 99, isIlhyeop: true }; 
                displayTitlePrefix = `**[일협]** ｜ `;
            }

            cleanedTitle = cleanedTitle.replace(/[\[\(]\s*오프\s*[\]\)]/g, '___OFFLINE___')
                                       .replace(/오프/g, '___OFFLINE___')
                                       .replace(/[\[\(][\s/,\-~]*[\]\)]/g, ' ')
                                       .replace(/[\[\(\]\)]/g, ' ')
                                       .replace(/___OFFLINE___/g, '[오프]')
                                       .replace(/^[\]\)/\-,\s|?]+|[\[\(/\-,\s|?]+$/g, '')
                                       .replace(/\s+/g, ' ').trim();

            // Keep each entry on one line with a separate navigation link.
            const linkTitle = cleanedTitle.replace(/[\\\[\]`*_~|]/g, char => '\\' + char) || '제목 없음';
            const lastTouchTime = thread.editedTimestamp || thread.createdTimestamp;
            const newBadge = now - lastTouchTime < 24 * 60 * 60 * 1000 ? ' ⭐NEW⭐' : '';
            const postData = { sortKey, text: `${displayTitlePrefix}${linkTitle}${newBadge} [(바로가기)](${url})` };
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
                        diagnostic('schedule_archive_change', {threadId: thread.id, archived: false});
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

        // 월 -> 일 -> 시 -> 분 순서로 정렬
        const sortFunction = (a, b) => {
            if (a.sortKey.month !== b.sortKey.month) return a.sortKey.month - b.sortKey.month;
            if (a.sortKey.day !== b.sortKey.day) return a.sortKey.day - b.sortKey.day;
            if (a.sortKey.hour !== b.sortKey.hour) return a.sortKey.hour - b.sortKey.hour;
            return a.sortKey.minute - b.sortKey.minute;
        };

        murderScheduleList.sort(sortFunction);
        murderRecruitingList.sort(sortFunction);
        otherScheduleList.sort(sortFunction);
        otherRecruitingList.sort(sortFunction);

        const fetched = await textChannel.messages.fetch({ limit: 100 });
        diagnostic('schedule_delete_begin', {updateId, count: fetched.size});
        if (fetched.size > 0) await textChannel.bulkDelete(fetched).catch(error => console.error('schedule_delete_failed', error));
        diagnostic('schedule_write_begin', {updateId});

        // Send the image first so the category heading appears above its entries.
        const sendSection = async (title, list, bannerFile, emptyMsg) => {
            const bannerPath = diagPath.join(__dirname, 'assets', 'headers', bannerFile);
            if (diagFs.existsSync(bannerPath)) {
                await textChannel.send({
                    files: [{ attachment: bannerPath, name: bannerFile, description: title }],
                    allowedMentions: { parse: [] }
                });
            } else {
                console.warn('schedule_banner_missing', bannerFile);
                await textChannel.send({ content: `### ${title}`, allowedMentions: { parse: [] } });
            }
            const pages = [];
            let body = '';
            for (const [i, post] of list.entries()) {
                const line = `${i + 1}. ${post.text}`;
                if (body && body.length + line.length + 1 > 1900) {
                    pages.push(body);
                    body = '';
                }
                body += (body ? '\n' : '') + line;
            }
            pages.push(body || `*${emptyMsg}*`);
            for (const [i, page] of pages.entries()) {
                await textChannel.send({
                    content: page + (i === pages.length - 1 ? '\n\n\u200B' : ''),
                    allowedMentions: { parse: [] },
                    flags: 4 // Suppress link previews while keeping navigation links clickable.
                });
            }
        };

        await sendSection('🩸 머미 일정', murderScheduleList, 'murder-schedule.png', '등록된 일정이 없습니다.');
        await sendSection('🔎 머미 모집 중', murderRecruitingList, 'murder-recruiting.png', '진행 중인 모집이 없습니다.');
        await sendSection('🚀 기타 일정', otherScheduleList, 'other-schedule.png', '등록된 일정이 없습니다.');
        await sendSection('🌱 기타 모집 중', otherRecruitingList, 'other-recruiting.png', '진행 중인 모집이 없습니다.');

        const refreshRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_refresh_schedule')
                .setLabel('🔄 일정 새로고침')
                .setStyle(ButtonStyle.Secondary)
        );

        await textChannel.send({
            content: '-# (바로가기)를 누르면 원본 글로 이동합니다.',
            components: [refreshRow],
            allowedMentions: {parse: []}
        });
        outcome = 'success';

    } catch (error) {
        outcome = 'error';
        console.error("오류 발생:", error);
    } finally {
        diagnostic('schedule_end', {updateId, reason, outcome, elapsedMs: Date.now() - started, pending: hasPendingScheduleUpdate});
        isUpdatingSchedule = false;
        if (hasPendingScheduleUpdate) {
            hasPendingScheduleUpdate = false;
            setTimeout(() => updateAnnouncementBoard('pending_after_previous_update').catch(console.error), 1000);
        }
    }
}

// ================= [ 스레드 이벤트 리스너 ] =================
function requestScheduleUpdate(reason) {
    diagnostic('schedule_debounce', {reason, replacedTimer: Boolean(scheduleUpdateTimer)});
    if (scheduleUpdateTimer) clearTimeout(scheduleUpdateTimer);
    scheduleUpdateTimer = setTimeout(() => { scheduleUpdateTimer = null; updateAnnouncementBoard(reason).catch(console.error); }, 3000); 
}

const watchChannels = [MAIN_FORUM_ID, OTHER_FORUM_ID];
function handleThreadEvent(thread, event = 'unknown', before = null) {
    if (!thread) return;
    const parentId = thread.parentId || thread.parent?.id;
    if (watchChannels.includes(parentId)) {
        diagnostic('thread_event', {event, threadId: thread.id, parentId,
            archivedBefore: before?.archived, archivedAfter: thread.archived, nameChanged: before ? before.name !== thread.name : null});
        requestScheduleUpdate(`${event}:${thread.id}`);
    }
}

client.on('threadCreate', thread => handleThreadEvent(thread, 'threadCreate'));
client.on('threadUpdate', (b, a) => handleThreadEvent(a, 'threadUpdate', b));
client.on('threadDelete', thread => handleThreadEvent(thread, 'threadDelete'));

// ================= [ 상호작용 통합 처리 ] =================
client.on('interactionCreate', async (interaction) => {
    diagnostic('interaction_received', {interactionId: interaction.id,
        action: interaction.customId || interaction.commandName || interaction.type,
        ageMs: Date.now() - interaction.createdTimestamp});
    
    // -------------------------------------------------------------
    // 버튼 클릭 이벤트
    // -------------------------------------------------------------
    if (!interaction.isButton()) return;

    if (interaction.customId === 'btn_refresh_schedule') {
        await interaction.deferReply({ flags: [ 'Ephemeral' ] }); 
        try {
            await updateAnnouncementBoard('manual_refresh');
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
diagnostic('discord_login_begin');
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('discord_login_failed', error);
    process.exitCode = 1;
    client.destroy();
    setImmediate(() => process.exit(1));
});
