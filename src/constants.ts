import { Config } from './types'

// ---------- 默认 LLM 审核提示词 ----------
export const DEFAULT_JOIN_PROMPT = `你是一个 QQ 群的入群申请审核助手。请根据申请人的入群申请内容与验证答案，判断是否应该批准其入群。
请严格以 JSON 格式输出，不要包含任何多余文字、代码块或解释，格式如下：
{"approve": true或false, "reason": "简洁的中文审核理由"}

判断标准：
1. 申请内容包含广告、营销、引流、骚扰、辱骂、色情、政治敏感等恶意信息时，应拒绝（approve=false）。
2. 申请内容明确说明来意、与群主题相关、态度友好时，应批准（approve=true）。
3. 信息不足、无法判断时，默认批准（approve=true）。`

export const DEFAULT_REPORT_PROMPT = `你是一个 QQ 群消息的违规审核助手。请判断给定消息是否违规，并给出违规类型、程度与建议禁言时长。
违规类型只能是：涉黄、涉政、人身攻击、广告、其他
违规程度只能是：轻度、中度、重度
请严格以 JSON 格式输出，不要包含任何多余文字、代码块或解释，格式如下：
{"violation": true或false, "type": "涉黄/涉政/人身攻击/广告/其他", "level": "轻度/中度/重度", "reason": "简洁的中文判断理由", "muteDuration": 建议禁言分钟数}

判断标准：
1. 涉黄、涉政等敏感违规内容为重度；辱骂、人身攻击为中度；广告、引流为轻度。
2. 内容明显不违规时 violation 应为 false，type 与 level 可填空字符串，muteDuration 为 0。
3. 需要禁言时，muteDuration 给出建议禁言分钟数（0 表示不禁言，最长不超过 120 分钟）。`

// ---------- 默认配置 ----------
export const DEFAULT_CONFIG: Config = {
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
    },
    blacklist: {
      enabled: true,
    },
    qqLevel: {
      enabled: false,
      minLevel: 8,
    },
    keyword: {
      enabled: true,
      passKeywords: [],
      rejectKeywords: [],
    },
    manual: {
      enabled: true,
      timeoutMinutes: 30,
      reviewers: [],
      notifyMode: 'group',
      notifyGroupId: '',
    },
    llm: {
      enabled: false,
    },
    autoNotice: {
      enabled: false,
      mode: 'group',
      targetId: '',
      text: '[入群申请]{nickname}申请加入本群\n{avatar}\nQQ：{userId}\n等级：{level}\n群聊问题：{question}\n回答：{answer}\n判定结果：{result}',
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
      joinReview: DEFAULT_JOIN_PROMPT,
      reportReview: DEFAULT_REPORT_PROMPT,
    },
  },
}