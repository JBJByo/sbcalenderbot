// ==========================================
// 🎨 디자인이 적용된 현황판 텍스트 구성 시작
// ==========================================
const lines = [];

// 1. 메인 타이틀과 인용구, 그리고 첫 구분선
lines.push("# 📢 실시간 포스팅 현황판");
lines.push("> 실시간으로 업데이트되는 구인 현황입니다.");
lines.push("---");
lines.push("");

// --- 머미 마감 파트 ---
lines.push("## 🩸 머미 마감 일정");
if (murderScheduleList.length > 0) {
    // 날짜 부분을 찾아 볼드 처리하는 정규식(옵션)을 쓸 수도 있지만, 심플하게 텍스트만 출력해도 좋습니다.
    murderScheduleList.forEach((post, i) => lines.push(`${i + 1}. **[${post.sortKey.month}/${post.sortKey.day}]** ${post.text.replace(`[${post.sortKey.month}/${post.sortKey.day}]`, '')}`));
} else {
    lines.push("*등록된 머미 마감 일정이 없습니다.* 🥲");
}
lines.push("");
lines.push("---"); // 카테고리 사이 구분선
lines.push("");

// --- 머미 모집 파트 ---
lines.push("## 🔎 머미 모집 중");
if (murderRecruitingList.length > 0) {
    murderRecruitingList.forEach((post, i) => lines.push(`${i + 1}. **[${post.sortKey.month}/${post.sortKey.day}]** ${post.text.replace(`[${post.sortKey.month}/${post.sortKey.day}]`, '')}`));
} else {
    lines.push("*모집 중인 머미 포스팅이 없습니다.* 👀");
}
lines.push("");
lines.push("---"); // 카테고리 사이 구분선
lines.push("");

// ... (기타 모집 파트도 동일한 방식으로 구성) ...
