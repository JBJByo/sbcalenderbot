const { EmbedBuilder } = require('discord.js'); // 상단에 추가

// ... (기존 코드 생략)

// 현황판 갱신 로직 수정
const updateAnnouncementBoard = async () => {
    // ... (리스트 추출 및 정렬 로직 동일)

    const createEmbed = (title, list, color, emptyMsg) => {
        const embed = new EmbedBuilder()
            .setTitle(`📢 ${title}`)
            .setColor(color)
            .setTimestamp();

        if (list.length > 0) {
            // Fields를 사용하여 텍스트 가독성 확보
            const description = list.map((post, i) => `${i + 1}. ${post.text}`).join('\n');
            embed.setDescription(description);
        } else {
            embed.setDescription(`*${emptyMsg}*`);
        }
        return embed;
    };

    const embeds = [
        createEmbed("머미 마감 일정", murderScheduleList, 0xFF0000, "등록된 머미 마감 일정이 없습니다. 🥲"),
        createEmbed("머미 모집 중", murderRecruitingList, 0xFF0000, "모집 중인 머미 포스팅이 없습니다. 👀"),
        createEmbed("기타 모집 완료", otherScheduleList, 0x0000FF, "등록된 기타 완료 일정이 없습니다."),
        createEmbed("기타 모집 중", otherRecruitingList, 0x0000FF, "모집 중인 기타 포스팅이 없습니다.")
    ];

    // 기존 메시지 삭제 후 새 임베드 전송
    const fetched = await textChannel.messages.fetch({ limit: 10 });
    if (fetched.size > 0) await textChannel.bulkDelete(fetched).catch(() => {});
    
    // 임베드 4개 한 번에 전송
    await textChannel.send({ embeds: embeds });
};
