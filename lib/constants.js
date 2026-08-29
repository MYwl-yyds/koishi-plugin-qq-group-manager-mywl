"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.DEFAULT_REPORT_PROMPT = exports.DEFAULT_JOIN_PROMPT = exports.JOIN_PROMPT_FIXED = void 0;
// ---------- 默认 LLM 审核提示词 ----------
// 入群审核「系统提示词」：内容固定，系统自动附加在用户自定义提示词之前，无需用户填写
exports.JOIN_PROMPT_FIXED = `你是一个 QQ 群的入群申请审核助手。请根据申请人的入群申请内容与验证答案，判断是否应该批准其入群。
请严格以 JSON 格式输出，不要包含任何多余文字、代码块或解释，格式如下：
{"approve": true或false, "reason": "简洁的中文审核理由"}`;
exports.DEFAULT_JOIN_PROMPT = exports.JOIN_PROMPT_FIXED;
exports.DEFAULT_REPORT_PROMPT = `你是一个 QQ 群消息的违规审核助手。请判断给定消息是否违规，并给出违规类型、程度与建议禁言时长。
违规类型只能是：涉黄、涉政、人身攻击、广告、其他
违规程度只能是：轻度、中度、重度
请严格以 JSON 格式输出，不要包含任何多余文字、代码块或解释，格式如下：
{"violation": true或false, "type": "涉黄/涉政/人身攻击/广告/其他", "level": "轻度/中度/重度", "reason": "简洁的中文判断理由", "muteDuration": 建议禁言分钟数}

判断标准：
1. 涉黄、涉政等敏感违规内容为重度；辱骂、人身攻击为中度；广告、引流为轻度。
2. 内容明显不违规时 violation 应为 false，type 与 level 可填空字符串，muteDuration 为 0。
3. 需要禁言时，muteDuration 给出建议禁言分钟数（0 表示不禁言，最长不超过 120 分钟）。`;
// ---------- 默认配置 ----------
exports.DEFAULT_CONFIG = {
    enableGroupManagement: true,
    superUsers: [],
    onebotFramework: 'auto',
    applyGlobalBlacklist: true,
    applyGlobalWhitelist: true,
    mute: {
        enabled: true,
        maxDuration: 43200,
    },
    welcome: {
        enabled: false,
        text: '欢迎 {nickname} 加入本群！',
    },
    farewell: {
        enabled: false,
        text: '{nickname} 离开了本群。',
    },
    joinReview: {
        enabled: false,
        frequency: {
            enabled: true,
            windowMinutes: 10,
            maxCount: 3,
            rejectReason: '申请过于频繁，已被拒绝',
        },
        blacklist: {
            enabled: true,
            rejectReason: '您已被列入本群黑名单',
        },
        qqLevel: {
            enabled: false,
            minLevel: 8,
            rejectReason: 'QQ 等级不足，申请已被拒绝',
        },
        keyword: {
            enabled: true,
            passKeywords: [],
            rejectKeywords: [],
            rejectReason: '申请内容未通过审核',
        },
        manual: {
            enabled: true,
            timeoutMinutes: 30,
            rejectReason: '人工审核未通过',
        },
        llm: {
            enabled: false,
            rejectReason: '',
        },
        default: {
            action: 'reject',
            rejectReason: '审核超时，本次申请未被批准',
        },
        autoNotice: {
            enabled: false,
            mode: 'group',
            targetId: '',
            text: '[入群申请]{nickname}申请加入本群\n{avatar}\nQQ：{userId}\n等级：{level}\n{answer}\n判定结果：{result}',
        },
    },
    bannedWords: {
        enabled: false,
        words: [],
        banOnTrigger: true,
        kickOnTrigger: false,
        recallOnTrigger: true,
        banDuration: 10,
        banNotice: {
            enabled: false,
            mode: 'group',
            targetId: '',
            text: '【违禁词处理】\n群号：{groupId}\n用户：{nickname}({userId}) 触发违禁词「{word}」\n处理：{punish}',
        },
        kickNotice: {
            enabled: false,
            mode: 'group',
            targetId: '',
            text: '【违禁词处理】\n群号：{groupId}\n用户：{nickname}({userId}) 触发违禁词「{word}」\n处理：{punish}',
        },
        recallNotice: {
            enabled: false,
            mode: 'group',
            targetId: '',
            text: '【违禁词处理】\n群号：{groupId}\n用户：{nickname}({userId}) 触发违禁词「{word}」\n处理：{punish}',
        },
    },
    report: {
        enabled: true,
        levels: [
            { level: '轻度', muteDuration: 0, kick: false, recall: true },
            { level: '中度', muteDuration: 10, kick: false, recall: true },
            { level: '重度', muteDuration: 0, kick: true, recall: true },
        ],
        frequency: {
            enabled: true,
            windowMinutes: 5,
            maxCount: 3,
        },
    },
    autoBlacklist: {
        enabled: false,
        onSelfLeave: true,
        onKicked: true,
        delayMinutes: 0,
        notice: {
            enabled: false,
            mode: 'group',
            targetId: '',
            text: '【退群拉黑通知】\n群号：{groupId}\n用户：{nickname}({userId}) 已拉黑\n原因：{reason}',
        },
    },
    requestForward: {
        enabled: false,
        mode: 'group',
        targetId: '',
        text: '【{title}通知】\n申请人：{nickname}({userId})\n申请内容：{comment}',
    },
    essence: {
        enabled: true,
    },
    title: {
        enabled: true,
    },
    ai: {
        enabled: false,
        baseURL: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 1024,
        timeout: 30000,
        prompts: {
            // 入群审核提示词仅存「用户自定义」部分，固定内容由系统自动合并
            joinReview: '',
            reportReview: exports.DEFAULT_REPORT_PROMPT,
        },
    },
};
//# sourceMappingURL=constants.js.map