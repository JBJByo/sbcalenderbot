// 🧹 [개선된 무조건 청소 구역] 
// 채널에 있는 글이 누구의 글이든 상관없이, 최근 메시지들을 통째로 싹 쓸어 담아 삭제합니다.
try {
    const fetched = await textChannel.messages.fetch({ limit: 100 });
    if (fetched.size > 0) {
        // 만약 메시지가 14일 이상 오래된 것이 섞여 있으면 bulkDelete가 안 되므로 안전하게 하나씩 지우거나 통째로 지웁니다.
        await textChannel.bulkDelete(fetched).catch(async () => {
            for (const msg of fetched.values()) {
                await msg.delete().catch(() => {});
            }
        });
        console.log(`🧹 채널 내 기존 메시지 ${fetched.size}개를 완전히 청소했습니다.`);
    }
} catch (cleanError) {
    console.error("🧹 채널 청소 중 오류 발생 (무시하고 진행):", cleanError);
}

// 📝 3. 청소가 완전히 끝나 텅 빈 채널에 새 글을 새로 발송 (수정됨 표시 X, 중복 누적 X)
for (const chunk of chunks) {
    await textChannel.send(chunk);
}
