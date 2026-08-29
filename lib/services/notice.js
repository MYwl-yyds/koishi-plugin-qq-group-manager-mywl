"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoticeService = void 0;
exports.renderNotice = renderNotice;
const koishi_1 = require("koishi");
// 当下列变量取值为空时，包含这些变量的整行将被省略
const OPTIONAL_VARS = ['answer', 'level', 'groupIntro', 'memberCount'];
// 需要自动补全的群信息变量
const GROUP_VARS = ['groupName', 'groupIntro', 'groupAvatar', 'memberCount'];
// 渲染通知模板（支持变量与条件行），返回可直接发送的消息片段数组
function renderNotice(template, vars) {
    const avatarUrl = vars['userId'] ? `https://q1.qlogo.cn/g?b=qq&nk=${vars['userId']}&s=640` : '';
    const lines = String(template ?? '').split('\n');
    const out = [];
    lines.forEach((line, i) => {
        // 可选变量为空则跳过整行（例如无回答、无等级、无群简介、无群人数）
        if (OPTIONAL_VARS.some((k) => line.includes(`{${k}}`) && !vars[k]))
            return;
        const parts = renderLine(line, vars, avatarUrl);
        for (const p of parts)
            out.push(p);
        if (i < lines.length - 1)
            out.push('\n');
    });
    return out;
}
function renderLine(line, vars, avatarUrl) {
    const parts = [];
    const re = /\{(\w+)\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
        const text = line.slice(last, m.index);
        if (text)
            parts.push(text);
        const key = m[1];
        if (key === 'avatar') {
            if (avatarUrl)
                parts.push(koishi_1.segment.image(avatarUrl));
        }
        else if (key === 'groupAvatar') {
            if (vars['groupAvatar'])
                parts.push(koishi_1.segment.image(vars['groupAvatar']));
        }
        else {
            const val = vars[key] ?? '';
            if (val)
                parts.push(val);
        }
        last = m.index + m[0].length;
    }
    const tail = line.slice(last);
    if (tail)
        parts.push(tail);
    return parts;
}
// 通知服务：统一的「执行后结果通知」发送（支持自定义文本与变量）
class NoticeService {
    constructor(ctx, onebot) {
        this.ctx = ctx;
        this.onebot = onebot;
    }
    // 发送通知；fallbackGroup 用于 targetId 为空时回退到事件所在群。
    // 自动按模板引用补全：群信息变量（{groupName}/{groupIntro}/{groupAvatar}/{memberCount}）与 {level}。
    async send(session, notice, vars, fallbackGroup = '') {
        try {
            if (!notice || !notice.enabled)
                return;
            const text = String(notice.text ?? '');
            const groupId = vars['groupId'] || fallbackGroup || '';
            const enriched = { ...vars };
            if (GROUP_VARS.some((k) => text.includes(`{${k}}`)) && groupId) {
                const p = await this.onebot.getGroupProfile(session, groupId);
                enriched['groupName'] = p.name;
                enriched['groupIntro'] = p.intro;
                enriched['groupAvatar'] = p.avatar;
                enriched['memberCount'] = p.memberCount;
            }
            if (text.includes('{level}') && !enriched['level'] && enriched['userId']) {
                const stranger = await this.onebot.getStrangerInfo(session, enriched['userId']);
                enriched['level'] = stranger && typeof stranger.level === 'number' ? String(stranger.level) : '';
            }
            const content = renderNotice(text, enriched);
            if (!content || content.length === 0)
                return;
            if (notice.mode === 'private') {
                if (notice.targetId)
                    await this.onebot.sendPrivate(session, notice.targetId, content);
                else if (groupId)
                    await this.onebot.sendGroup(session, groupId, content);
            }
            else {
                const gid = notice.targetId || groupId;
                if (gid)
                    await this.onebot.sendGroup(session, gid, content);
            }
        }
        catch (e) {
            this.ctx.logger('notice').warn('发送通知失败', e);
        }
    }
}
exports.NoticeService = NoticeService;
//# sourceMappingURL=notice.js.map