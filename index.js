// ... (앞쪽 코드 생략)
        for (const [_, thread] of activeThreads.threads) {
            const title = thread.name;
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
                displayTitle = `[${month}/${day}] ${cleanedTitle}`;
            } else {
                if (title.includes("일협")) {
                    sortKey = { month: 98, day: 98, isIlhyeop: true }; 
                    displayTitle = `(일협) ${cleanedTitle}`;
                } else {
                    sortKey = { month: 99, day: 99, isIlhyeop: false };
                    displayTitle = cleanedTitle;
                }
            }

            // ================= 🕒 [최근 24시간 이내 신규 글 체크] =================
            const createdAt = thread.createdTimestamp; // 스레드 생성 시간 (ms)
            const now = Date.now();                    // 현재 시간 (ms)
            const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24시간을 밀리초로 환산

            // 생성된 지 24시간이 지나지 않았다면 제목 뒤에 한 칸 띄우고 붙이기
            if (now - createdAt < TWENTY_FOUR_HOURS) {
                displayTitle += " ⭐NEW!⭐";
            }
            // ====================================================================

            const postData = {
                sortKey,
                text: `${displayTitle} ([바로가기](${url}))`
            };

            if (title.includes("마감")) {
                scheduleList.push(postData);
            } else {
                recruitingList.push(postData);
            }
        }
        // ... (뒤쪽 코드 생략)
