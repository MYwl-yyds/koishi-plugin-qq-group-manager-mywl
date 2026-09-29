<template>
  <div>
    <Skeleton v-if="!data && loading" :rows="6" />

    <template v-else-if="data">
      <!-- 群选择 -->
      <Section title="选择群聊" sub="所有配置仅对该群生效，留空项沿用全局设置" icon="💬" :open="true">
        <div class="qg-grid two" style="align-items:start">
          <div>
            <label class="qg-field">
              <label>群号</label>
              <select class="qg-select" v-model="groupId" @change="onGroupChange">
                <option value="">— 请选择 —</option>
                <option v-for="g in groupOptions" :key="g.groupId" :value="g.groupId">
                  {{ g.name ? `${g.name}（${g.groupId}）` : g.groupId }}
                </option>
              </select>
            </label>
            <div class="qg-add">
              <input class="qg-input" v-model="manualGroupId" placeholder="或输入未在列表中的群号" />
              <button class="qg-btn" @click="useManualGroup">切换</button>
            </div>
          </div>
          <div v-if="groupId">
            <span class="qg-hint tight">
              该群{{ data.exists ? '已有独立配置覆盖' : '当前使用全局配置（尚未产生任何覆盖）' }}。
              「重置为全局」会清空本群全部覆盖项；「删除配置」会让本群从列表中移除。
            </span>
            <div class="qg-actions">
              <button class="qg-btn sm" @click="resetGroup">重置为全局</button>
              <button class="qg-btn sm danger" @click="removeGroup">删除配置</button>
            </div>
          </div>
        </div>
      </Section>

      <EmptyState v-if="!groupId" text="请先选择或输入一个群号" sub="选择后即可配置该群的欢迎语、入群审核、违禁词、群员检查等" icon="👈" />

      <template v-else>
        <!-- 基础开关 -->
        <Section title="基础功能" icon="🎛️" :open="true">
          <div class="qg-grid three">
            <div>
              <ToggleRow label="群管总开关" v-model="form.enableGroupManagement" title="关闭后本群不启用任何群管功能" />
              <ToggleRow label="禁言功能" v-model="form.muteEnabled" />
              <ToggleRow label="最大禁言时长(分)" type="number" v-model="form.muteMaxDuration" />
            </div>
            <div>
              <ToggleRow label="精华消息" v-model="form.essenceEnabled" title="是否允许设置/取消精华消息" />
              <ToggleRow label="群头衔" v-model="form.titleEnabled" title="是否允许设置/取消群专属头衔" />
            </div>
            <div>
              <ToggleRow label="应用全局黑名单" v-model="form.applyGlobalBlacklist" title="开启后本群直接使用全局黑名单" />
              <ToggleRow label="应用全局白名单" v-model="form.applyGlobalWhitelist" title="开启后本群直接使用全局白名单" />
            </div>
          </div>
        </Section>

        <!-- 欢迎 / 欢送 -->
        <Section title="欢迎语 / 欢送语" icon="👋">
          <div class="qg-grid two">
            <div>
              <ToggleRow label="欢迎语" v-model="form.welcomeEnabled" title="新成员入群时发送" />
              <label class="qg-field">
                <label>欢迎语文案</label>
                <textarea class="qg-textarea" rows="3" v-model="form.welcomeText" placeholder="默认：欢迎 {nickname} 加入本群！"></textarea>
              </label>
            </div>
            <div>
              <ToggleRow label="欢送语" v-model="form.farewellEnabled" title="成员退群时发送" />
              <label class="qg-field">
                <label>欢送语文案</label>
                <textarea class="qg-textarea" rows="3" v-model="form.farewellText" placeholder="默认：{nickname} 离开了本群。"></textarea>
              </label>
            </div>
          </div>
          <p class="qg-hint">可用变量：{userId}=成员QQ、{groupId}=群号、{nickname}=成员昵称、{level}=QQ等级、{avatar}=头像图片。</p>
        </Section>

        <!-- 入群审核 -->
        <Section title="入群审核" :sub="form.joinEnabled ? '已启用' : '未启用'" icon="🚪">
          <ToggleRow label="总开关" v-model="form.joinEnabled" />
          <p class="qg-hint">
            固定执行顺序：频率检查 → 黑名单检查 → QQ 等级检查 → 关键词检查 → 人工审核 → LLM 自动审核 → 默认操作。
            未开启的步骤自动跳过；「默认操作」仅在所有判定失效或超时后执行。
          </p>

          <div class="qg-grid three" style="margin-top:10px">
            <div class="qg-card flat">
              <h4>① 频率 / 黑名单</h4>
              <ToggleRow label="频率检查" v-model="form.freqEnabled" />
              <ToggleRow label="频率窗口(分)" type="number" v-model="form.freqWindow" />
              <ToggleRow label="窗口内最大次数" type="number" v-model="form.freqMax" />
              <label class="qg-field"><label>频率拒绝理由</label><textarea class="qg-textarea" rows="2" v-model="form.freqRejectReason"></textarea></label>
              <div class="qg-sep"></div>
              <ToggleRow label="黑名单检查" v-model="form.blEnabled" />
              <label class="qg-field"><label>黑名单拒绝理由</label><textarea class="qg-textarea" rows="2" v-model="form.blRejectReason"></textarea></label>
            </div>

            <div class="qg-card flat">
              <h4>② QQ 等级 / 关键词</h4>
              <ToggleRow label="QQ 等级检查" v-model="form.levelEnabled" title="按申请人 QQ 账号等级判断" />
              <ToggleRow label="最低等级" type="number" v-model="form.minLevel" />
              <label class="qg-field"><label>等级拒绝理由</label><textarea class="qg-textarea" rows="2" v-model="form.levelRejectReason"></textarea></label>
              <div class="qg-sep"></div>
              <ToggleRow label="关键词检查" v-model="form.kwEnabled" />
              <label class="qg-field"><label>通过关键词（逗号分隔）</label><textarea class="qg-textarea" rows="2" v-model="form.passKeywords" placeholder="命中即自动通过"></textarea></label>
              <label class="qg-field"><label>拒绝关键词（逗号分隔）</label><textarea class="qg-textarea" rows="2" v-model="form.rejectKeywords" placeholder="命中即自动拒绝"></textarea></label>
              <label class="qg-field"><label>关键词拒绝理由</label><textarea class="qg-textarea" rows="2" v-model="form.kwRejectReason"></textarea></label>
            </div>

            <div class="qg-card flat">
              <h4>③ 人工 / LLM / 默认</h4>
              <ToggleRow label="人工审核" v-model="form.manualEnabled" title="拥有「审核员」权限的用户可引用回复通知审批" />
              <ToggleRow label="人工超时(分)" type="number" v-model="form.manualTimeout" />
              <label class="qg-field"><label>人工拒绝理由</label><textarea class="qg-textarea" rows="2" v-model="form.manualRejectReason"></textarea></label>
              <div class="qg-sep"></div>
              <ToggleRow label="LLM 自动处理" v-model="form.llmEnabled" />
              <label class="qg-field"><label>LLM 拒绝理由（留空用 AI 理由）</label><textarea class="qg-textarea" rows="2" v-model="form.llmRejectReason"></textarea></label>
              <div class="qg-sep"></div>
              <ToggleRow label="默认操作" type="select" v-model="form.defaultAction" :options="[{ label: '同意', value: 'approve' }, { label: '拒绝', value: 'reject' }]" />
              <label class="qg-field"><label>默认拒绝理由</label><textarea class="qg-textarea" rows="2" v-model="form.defaultRejectReason"></textarea></label>
            </div>
          </div>
          <p class="qg-hint">「审核员」请在「权限组」页面勾选对应权限项统一管理；超级管理员始终可审核。</p>
        </Section>

        <!-- 违禁词 -->
        <Section title="违禁词" :sub="bwSub" icon="🚫">
          <ToggleRow
            label="继承全局违禁词配置"
            v-model="form.bwInherit"
            title="开启时本群完全沿用全局的违禁词表与处罚设置；关闭后可自定义"
          />
          <p v-if="form.bwInherit" class="qg-hint tight">
            当前沿用「违禁词与链接」页面的全局配置：共 {{ globalWordCount }} 个违禁词。
            取消勾选即可为本群单独设置。
          </p>
          <template v-else>
            <ToggleRow label="总开关" v-model="form.bwEnabled" />
            <div class="qg-grid two">
              <div>
                <ToggleRow label="触发后禁言" v-model="form.bwBan" @update:model-value="onBanToggle" title="与「踢出」互斥" />
                <ToggleRow label="触发后踢出" v-model="form.bwKick" @update:model-value="onKickToggle" title="与「禁言」互斥" />
                <ToggleRow label="触发后撤回" v-model="form.bwRecall" />
                <ToggleRow label="禁言时长(分)" type="number" v-model="form.bwDuration" />
              </div>
              <div>
                <label class="qg-field">
                  <label>违禁词库（本群专用）</label>
                  <div class="qg-add" style="margin-top:0">
                    <input class="qg-input" v-model="bannedInput" placeholder="多个用逗号 / 空格分隔" @keyup.enter="addBannedWords" />
                    <button class="qg-btn primary" @click="addBannedWords">添加</button>
                  </div>
                </label>
                <div style="margin-top:10px">
                  <TagList :items="form.bwWords" removable empty-text="暂无违禁词" @remove="removeBannedWord" />
                </div>
              </div>
            </div>
          </template>
        </Section>

        <!-- 禁发链接 -->
        <Section title="禁发链接" :sub="form.linkInherit ? '继承全局' : (form.linkEnabled ? '本群已启用' : '本群未启用')" icon="🔗">
          <ToggleRow
            label="继承全局禁发链接配置"
            v-model="form.linkInherit"
            title="开启时沿用全局的开关、处罚规则与链接白名单；关闭后可为本群单独设置"
          />
          <p v-if="form.linkInherit && form.linkWasCustom" class="qg-error tight">
            注意：本群此前保存过独立的链接配置，它仍在数据库中生效。「继承全局」只表示本次保存不再写入新值，
            如需真正恢复为全局设置，请点上方「重置为全局」。
          </p>
          <p v-else-if="form.linkInherit" class="qg-hint tight">
            当前沿用「违禁词与链接」页面的全局配置。取消勾选即可为本群单独设置开关与处罚规则。
          </p>
          <template v-else>
            <ToggleRow label="本群启用禁发链接" v-model="form.linkEnabled" />
            <div class="qg-grid two">
              <div>
                <ToggleRow label="触发后禁言" v-model="form.linkBan" @update:model-value="onLinkBanToggle" title="与「踢出」互斥" />
                <ToggleRow label="触发后踢出" v-model="form.linkKick" @update:model-value="onLinkKickToggle" title="与「禁言」互斥" />
                <ToggleRow label="触发后撤回" v-model="form.linkRecall" />
                <ToggleRow label="禁言时长(分)" type="number" v-model="form.linkDuration" />
              </div>
              <div>
                <label class="qg-field">
                  <label>本群链接白名单（完整链接 / 域名 / 泛域名）</label>
                  <div class="qg-add" style="margin-top:0">
                    <input class="qg-input" v-model="linkWlInput" placeholder="如 example.com 或 *.example.com" @keyup.enter="addLinkWl" />
                    <button class="qg-btn primary" @click="addLinkWl">添加</button>
                  </div>
                </label>
                <div style="margin-top:10px">
                  <TagList :items="form.linkWhitelist" removable empty-text="本群未设置白名单（将拦截全部链接）" @remove="removeLinkWl" />
                </div>
                <p class="qg-hint tight" style="margin-top:8px">
                  白名单只对本群生效。全局白名单请在「违禁词与链接」页面维护。
                </p>
              </div>
            </div>
          </template>
        </Section>

        <!-- 禁发指定图片 -->
        <Section title="禁发指定图片" :sub="form.imgInherit ? '继承全局' : (form.imgEnabled ? '本群已启用' : '本群未启用')" icon="🖼">
          <ToggleRow
            label="继承全局禁发图片配置"
            v-model="form.imgInherit"
            title="开启时沿用全局的开关、阈值与处罚规则；关闭后可为本群单独设置"
          />
          <p v-if="form.imgInherit && form.imgWasCustom" class="qg-error tight">
            注意：本群此前保存过独立的图片配置，它仍在数据库中生效。「继承全局」只表示本次保存不再写入新值，
            如需真正恢复为全局设置，请点上方「重置为全局」。
          </p>
          <p v-else-if="form.imgInherit" class="qg-hint tight">
            当前沿用「违禁词与链接」页面的全局配置。取消勾选即可为本群单独设置阈值与处罚。
          </p>
          <template v-else>
            <ToggleRow label="本群启用禁发图片" v-model="form.imgEnabled" />
            <div class="qg-grid two">
              <div>
                <ToggleRow label="相似度阈值（汉明距离）" type="number" v-model="form.imgThreshold" title="0 最严格（几乎完全一致），8 可容忍转发压缩与缩放，越大越宽松" />
                <ToggleRow label="触发后禁言" v-model="form.imgBan" @update:model-value="onImgBanToggle" title="与「踢出」互斥" />
                <ToggleRow label="触发后踢出" v-model="form.imgKick" @update:model-value="onImgKickToggle" title="与「禁言」互斥" />
                <ToggleRow label="触发后撤回" v-model="form.imgRecall" />
                <ToggleRow label="禁言时长(分)" type="number" v-model="form.imgDuration" />
              </div>
              <div>
                <h4 class="qg-sub-title" style="margin-top:0;padding-top:0;border-top:none">本群额外样本（{{ form.imgSamples.length }}）</h4>
                <div class="qg-add" style="margin-top:0">
                  <input class="qg-input" v-model="imgSampleInput" placeholder="粘贴图片地址（http/https）" @keyup.enter="addGroupSample" />
                  <button class="qg-btn primary" :disabled="!imgSampleInput || imgSampleBusy" @click="addGroupSample">添加</button>
                </div>
                <EmptyState v-if="!form.imgSamples.length" text="本群暂无额外样本" sub="本群同时受全局样本库约束（只读）" icon="🖼" sm />
                <div v-else class="qg-grid" style="margin-top:10px">
                  <div v-for="s in form.imgSamples" :key="s.id" class="qg-sample-row">
                    <code>{{ s.hash.slice(0, 12) }}</code>
                    <span class="qg-muted">{{ s.label || s.origin || '（无备注）' }}</span>
                    <button class="qg-btn sm danger" @click="removeGroupSample(s)">移除</button>
                  </div>
                </div>
                <p class="qg-hint tight" style="margin-top:8px">
                  全局样本库（下方，只读）对所有群生效；此处添加的样本仅在本群生效。
                </p>
                <h4 class="qg-sub-title">全局样本（{{ globalSamples.length }}，只读）</h4>
                <EmptyState v-if="!globalSamples.length" text="全局样本库为空" sub="可在「违禁词与链接」页面维护" icon="🖼" sm />
                <div v-else class="qg-grid" style="margin-top:10px">
                  <div v-for="s in globalSamples" :key="s.id" class="qg-sample-row readonly">
                    <code>{{ s.hash.slice(0, 12) }}</code>
                    <span class="qg-muted">{{ s.label || s.origin || '（无备注）' }}</span>
                    <span class="qg-tag neutral">全局</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="qg-grid two" style="margin-top:12px">
              <div>
                <NoticeEditor title="图片·撤回通知" v-model="form.imgRecallNotice" hint="变量：{userId} {nickname} {groupId} {distance} {image} {punish}" />
                <NoticeEditor title="图片·禁言通知" v-model="form.imgBanNotice" hint="变量：{userId} {nickname} {groupId} {distance} {image} {punish}" />
              </div>
              <NoticeEditor title="图片·踢出通知" v-model="form.imgKickNotice" hint="变量：{userId} {nickname} {groupId} {distance} {image} {punish}" />
            </div>
          </template>
        </Section>

        <!-- 违禁词通知（仅本群自定义时显示） -->
        <Section v-if="!form.bwInherit" title="违禁词通知（本群）" icon="🔔">
          <div class="qg-grid two">
            <div>
              <NoticeEditor title="撤回通知" v-model="form.bwRecallNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
              <NoticeEditor title="禁言通知" v-model="form.bwBanNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
            </div>
            <NoticeEditor title="踢出通知" v-model="form.bwKickNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
          </div>
        </Section>

        <!-- 链接通知（仅本群自定义时显示） -->
        <Section v-if="!form.linkInherit" title="禁发链接通知（本群）" icon="🔔">
          <div class="qg-grid two">
            <div>
              <NoticeEditor title="撤回通知" v-model="form.linkRecallNotice" hint="变量：{userId} {nickname} {groupId} {host} {link} {punish}" />
              <NoticeEditor title="禁言通知" v-model="form.linkBanNotice" hint="变量：{userId} {nickname} {groupId} {host} {link} {punish}" />
            </div>
            <NoticeEditor title="踢出通知" v-model="form.linkKickNotice" hint="变量：{userId} {nickname} {groupId} {host} {link} {punish}" />
          </div>
        </Section>

        <!-- 举报 -->
        <Section title="举报" :sub="form.reportEnabled ? '已启用' : '未启用'" icon="🚨">
          <ToggleRow label="举报功能" v-model="form.reportEnabled" title="是否允许在本群使用举报命令" />
          <ToggleRow label="频率限制" v-model="form.reportFreqEnabled" />
          <div class="qg-grid two">
            <ToggleRow label="窗口(分钟)" type="number" v-model="form.reportFreqWindow" />
            <ToggleRow label="窗口内最大次数" type="number" v-model="form.reportFreqMax" />
          </div>
          <label class="qg-field" style="margin-top:8px">
            <label>惩罚映射（JSON，按违规程度配置禁言/踢出/撤回）</label>
            <textarea class="qg-textarea" rows="5" v-model="form.levelsJson"></textarea>
          </label>
          <p class="qg-hint">禁言时长优先使用 AI 返回的 muteDuration，未提供时用此处配置值，最长 120 分钟。</p>
        </Section>

        <!-- 群员检查 -->
        <Section title="群员检查" :sub="form.mcEnabled ? '已启用' : '未启用'" icon="🔎">
          <p class="qg-hint tight" style="margin-top:0">
            群员检查为<b>纯群级配置</b>：每个群一份独立设置，互不影响，不跟随任何全局值。
          </p>
          <ToggleRow label="本群启用群员检查" v-model="form.mcEnabled" title="关闭后本群不参与定时扫描" />
          <div class="qg-grid three">
            <div class="qg-card flat">
              <h4>QQ 账号等级</h4>
              <ToggleRow label="启用检测" v-model="form.mcQqEnabled" />
              <ToggleRow label="最低等级" type="number" v-model="form.mcQqMinLevel" />
              <ToggleRow label="触发操作" type="select" v-model="form.mcQqAction" :options="actionOptions" />
              <ToggleRow label="禁言时长(分)" type="number" v-model="form.mcQqMuteDuration" :disabled="form.mcQqAction !== 'mute'" />
              <ToggleRow label="取不到时处理" type="select" v-model="form.mcQqWhenUnknown" :options="unknownOptions" />
            </div>
            <div class="qg-card flat">
              <h4>群名片</h4>
              <ToggleRow label="启用检测" v-model="form.mcCardEnabled" />
              <ToggleRow label="匹配方式" type="select" v-model="form.mcCardMatchMode" :options="[{ label: '包含', value: 'contains' }, { label: '完全等于', value: 'equals' }]" />
              <ToggleRow label="区分大小写" v-model="form.mcCardCaseSensitive" />
              <ToggleRow label="排除群管理" v-model="form.mcCardExcludeAdmins" />
              <ToggleRow label="排除白名单" v-model="form.mcCardExcludeWhitelist" />
              <ToggleRow label="触发操作" type="select" v-model="form.mcCardAction" :options="actionOptions" />
              <ToggleRow label="禁言时长(分)" type="number" v-model="form.mcCardMuteDuration" :disabled="form.mcCardAction !== 'mute'" />
              <label class="qg-field"><label>匹配内容（逗号分隔，支持 /正则/）</label><textarea class="qg-textarea" rows="2" v-model="form.mcCardPatterns"></textarea></label>
            </div>
            <div class="qg-card flat">
              <h4>群等级</h4>
              <ToggleRow label="启用检测" v-model="form.mcGroupEnabled" />
              <ToggleRow label="最低群等级" type="number" v-model="form.mcGroupMinLevel" />
              <ToggleRow label="触发操作" type="select" v-model="form.mcGroupAction" :options="actionOptions" />
              <ToggleRow label="禁言时长(分)" type="number" v-model="form.mcGroupMuteDuration" :disabled="form.mcGroupAction !== 'mute'" />
              <ToggleRow label="取不到时处理" type="select" v-model="form.mcGroupWhenUnknown" :options="unknownOptions" />
              <p class="qg-hint tight">群等级来自 get_group_member_info 的 level 字段（群活跃等级）。</p>
            </div>
          </div>

          <h4 class="qg-sub-title">扫描调度（本群）</h4>
          <div class="qg-grid four">
            <ToggleRow label="扫描间隔(分)" type="number" v-model="form.mcIntervalMinutes" title="本群每隔多久自动扫描一次" />
            <ToggleRow label="单群超时(秒)" type="number" v-model="form.mcTimeoutSeconds" />
            <ToggleRow label="并发数" type="number" v-model="form.mcBatchSize" title="同时拉取 QQ 等级 / 群等级的并发请求数" />
            <ToggleRow label="冷却时间(小时)" type="number" v-model="form.mcCooldownHours" title="同一成员在该时间内不会重复处罚，0 表示不限制" />
            <ToggleRow label="仅检查活跃成员" type="number" v-model="form.mcActiveWithinDays" title="仅检查最近 N 天内发言过的成员，0 表示不限" />
          </div>

          <div class="qg-grid two" style="margin-top:12px">
            <div>
              <NoticeEditor title="QQ 等级命中通知" v-model="form.mcQqNotice" hint="变量：{userId} {nickname} {groupId} {level} {threshold} {punish}" />
              <NoticeEditor title="群名片命中通知" v-model="form.mcCardNotice" hint="变量：{userId} {nickname} {groupId} {card} {word} {punish}" />
            </div>
            <div>
              <NoticeEditor title="群等级命中通知" v-model="form.mcGroupNotice" hint="变量：{userId} {nickname} {groupId} {level} {threshold} {punish}" />
              <p class="qg-hint">
                三类检测的触发操作互相独立，可分别为禁言 / 踢出 / 仅记录。
                保存后可在「群员检查」页面预览命中名单或立即执行一次扫描。
              </p>
            </div>
          </div>
        </Section>

        <!-- 退群自动拉黑 -->
        <Section title="退群自动拉黑" :sub="form.abEnabled ? '已启用' : '未启用'" icon="⛔">
          <ToggleRow label="总开关" v-model="form.abEnabled" />
          <div class="qg-grid two">
            <ToggleRow label="拉黑主动退群" v-model="form.abSelf" />
            <ToggleRow label="拉黑被踢出" v-model="form.abKicked" />
          </div>
          <ToggleRow label="延迟(分钟)" type="number" v-model="form.abDelay" title="0 表示立即拉黑" />
        </Section>

        <!-- 群级 AI 接口 -->
        <Section title="AI 接口（群级覆盖）" sub="留空则使用全局接口" icon="🤖">
          <div class="qg-grid two">
            <label class="qg-field"><label>baseURL</label><input class="qg-input" v-model="aiForm.baseURL" placeholder="留空用全局" /></label>
            <label class="qg-field"><label>API Key</label><input class="qg-input" type="password" v-model="aiForm.apiKey" placeholder="留空用全局" /></label>
            <label class="qg-field"><label>模型</label><input class="qg-input" v-model="aiForm.model" placeholder="留空用全局" /></label>
            <label class="qg-field"><label>超时(毫秒)</label><input class="qg-input" type="number" v-model="aiForm.timeout" placeholder="留空用全局" /></label>
            <label class="qg-field"><label>temperature</label><input class="qg-input" type="number" step="0.1" v-model="aiForm.temperature" placeholder="留空用全局" /></label>
            <label class="qg-field"><label>max_tokens</label><input class="qg-input" type="number" v-model="aiForm.maxTokens" placeholder="留空用全局" /></label>
          </div>
          <label class="qg-field" style="margin-top:10px">
            <label>入群审核提示词（自定义补充，系统会自动拼接固定提示词）</label>
            <textarea class="qg-textarea" rows="3" v-model="aiForm.joinPrompt" placeholder="填写本群额外的审核要求（可选）"></textarea>
          </label>
          <label class="qg-field">
            <label>举报审核提示词（留空使用默认）</label>
            <textarea class="qg-textarea" rows="4" v-model="aiForm.reportPrompt"></textarea>
          </label>
        </Section>

        <!-- 通知模板 -->
        <Section title="执行结果通知（群级覆盖）" sub="支持变量模板，留空使用全局模板" icon="🔔">
          <div class="qg-grid two">
            <div>
              <NoticeEditor title="入群判定结果通知" v-model="form.autoNotice" hint="变量：{userId} {nickname} {level} {avatar} {groupId} {groupName} {groupIntro} {groupAvatar} {memberCount} {answer} {result} {reason}" />
              <NoticeEditor title="违禁词·撤回通知" v-model="form.bwRecallNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
            </div>
            <div>
              <NoticeEditor title="违禁词·禁言通知" v-model="form.bwBanNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
              <NoticeEditor title="违禁词·踢出通知" v-model="form.bwKickNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
              <NoticeEditor title="退群自动拉黑通知" v-model="form.abNotice" hint="变量：{userId} {nickname} {groupId} {reason}" />
            </div>
          </div>
        </Section>

        <div class="qg-actions sticky">
          <button class="qg-btn primary" @click="save">保存本群配置</button>
          <span class="qg-muted">群 {{ groupId }}</span>
        </div>
      </template>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useScope, mutate, invalidateScope } from '../useData'
import { gotoPage, takePageParams } from '../nav'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'
import ToggleRow from '../components/ToggleRow.vue'
import TagList from '../components/TagList.vue'
import NoticeEditor from '../components/NoticeEditor.vue'

const actionOptions = [
  { label: '仅记录（不处罚）', value: 'none' },
  { label: '禁言', value: 'mute' },
  { label: '踢出', value: 'kick' },
]
const unknownOptions = [
  { label: '跳过（安全）', value: 'skip' },
  { label: '视为命中', value: 'trigger' },
]

const groupId = ref('')
const manualGroupId = ref('')
const bannedInput = ref('')
const linkWlInput = ref('')
const imgSampleInput = ref('')
const imgSampleBusy = ref(false)
const globalWordCount = ref(0)
const form = reactive<any>({})
const aiForm = reactive<any>({ baseURL: '', apiKey: '', model: '', temperature: '', maxTokens: '', timeout: '', joinPrompt: '', reportPrompt: '' })

// 群列表（用于下拉选择）
const { data: listData } = useScope<any>('groups')

// 全局样本库（只读展示）
const { data: settingsData } = useScope<any>('settings')
const globalSamples = computed<any[]>(() => settingsData.value?.imageSamples || [])

// 违禁词区块的副标题
const bwSub = computed(() => {
  if (form.bwInherit) return '继承全局'
  return form.bwEnabled ? `${form.bwWords?.length ?? 0} 个词` : '本群未启用'
})

// 该群的详细配置（按需加载）
const { data, loading, error, refresh } = useScope<any>('groupDetail', {
  params: () => ({ groupId: groupId.value }),
  immediate: false,
})

const groupOptions = computed(() => {
  const seen = new Set<string>()
  const out: Array<{ groupId: string, name: string }> = []
  const push = (groupId: string, name: string) => {
    if (!groupId || seen.has(groupId)) return
    seen.add(groupId)
    out.push({ groupId, name })
  }
  for (const g of listData.value?.groups || []) push(String(g.groupId), g.name || '')
  for (const g of listData.value?.available || []) push(String(g.groupId), g.name || '')
  return out
})

function split(s: any): string[] {
  if (Array.isArray(s)) return s.map(String)
  return String(s || '').split(/[,，\s]+/).filter(Boolean)
}

function loadNotice(c: any, g: any) {
  c = c || {}; g = g || {}
  return {
    enabled: c.enabled ?? g.enabled ?? false,
    mode: c.mode ?? g.mode ?? 'group',
    targetId: c.targetId ?? g.targetId ?? '',
    text: c.text || g.text || '',
  }
}

function fillFrom(cfg: any, g: any) {
  const c = cfg || {}
  form.enableGroupManagement = c.enableGroupManagement !== undefined ? c.enableGroupManagement : g.enableGroupManagement
  form.muteEnabled = c.mute?.enabled ?? g.mute?.enabled
  form.muteMaxDuration = c.mute?.maxDuration ?? g.mute?.maxDuration ?? 43200
  form.welcomeEnabled = c.welcome?.enabled ?? g.welcome?.enabled
  form.welcomeText = c.welcome?.text ?? g.welcome?.text ?? ''
  form.farewellEnabled = c.farewell?.enabled ?? g.farewell?.enabled
  form.farewellText = c.farewell?.text ?? g.farewell?.text ?? ''
  form.joinEnabled = c.joinReview?.enabled ?? g.joinReview?.enabled
  form.freqEnabled = c.joinReview?.frequency?.enabled ?? g.joinReview?.frequency?.enabled
  form.freqWindow = c.joinReview?.frequency?.windowMinutes ?? g.joinReview?.frequency?.windowMinutes ?? 10
  form.freqMax = c.joinReview?.frequency?.maxCount ?? g.joinReview?.frequency?.maxCount ?? 3
  form.freqRejectReason = c.joinReview?.frequency?.rejectReason ?? g.joinReview?.frequency?.rejectReason ?? ''
  form.blEnabled = c.joinReview?.blacklist?.enabled ?? g.joinReview?.blacklist?.enabled
  form.blRejectReason = c.joinReview?.blacklist?.rejectReason ?? g.joinReview?.blacklist?.rejectReason ?? ''
  form.levelEnabled = c.joinReview?.qqLevel?.enabled ?? g.joinReview?.qqLevel?.enabled
  form.minLevel = c.joinReview?.qqLevel?.minLevel ?? g.joinReview?.qqLevel?.minLevel ?? 8
  form.levelRejectReason = c.joinReview?.qqLevel?.rejectReason ?? g.joinReview?.qqLevel?.rejectReason ?? ''
  form.kwEnabled = c.joinReview?.keyword?.enabled ?? g.joinReview?.keyword?.enabled
  form.passKeywords = (c.joinReview?.keyword?.passKeywords ?? g.joinReview?.keyword?.passKeywords ?? []).join(',')
  form.rejectKeywords = (c.joinReview?.keyword?.rejectKeywords ?? g.joinReview?.keyword?.rejectKeywords ?? []).join(',')
  form.kwRejectReason = c.joinReview?.keyword?.rejectReason ?? g.joinReview?.keyword?.rejectReason ?? ''
  form.manualEnabled = c.joinReview?.manual?.enabled ?? g.joinReview?.manual?.enabled
  form.manualTimeout = c.joinReview?.manual?.timeoutMinutes ?? g.joinReview?.manual?.timeoutMinutes ?? 30
  form.manualRejectReason = c.joinReview?.manual?.rejectReason ?? g.joinReview?.manual?.rejectReason ?? ''
  form.llmEnabled = c.joinReview?.llm?.enabled ?? g.joinReview?.llm?.enabled
  form.llmRejectReason = c.joinReview?.llm?.rejectReason ?? g.joinReview?.llm?.rejectReason ?? ''
  form.defaultAction = c.joinReview?.default?.action ?? g.joinReview?.default?.action ?? 'reject'
  form.defaultRejectReason = c.joinReview?.default?.rejectReason ?? g.joinReview?.default?.rejectReason ?? ''
  // 违禁词 / 禁发链接 / 禁发图片：三块各自有「继承全局」开关。
  // 判断依据是「本群是否真的写过这些字段」——只有本群显式存过才算自定义。
  const cbw = c.bannedWords
  globalWordCount.value = (g.bannedWords?.words ?? []).length

  // 违禁词：群级有自己的 words 数组或处罚开关才算自定义
  form.bwInherit = !(cbw && (
    Array.isArray(cbw.words) || cbw.enabled !== undefined || cbw.banOnTrigger !== undefined
    || cbw.kickOnTrigger !== undefined || cbw.recallOnTrigger !== undefined || cbw.banDuration !== undefined
  ))
  form.bwEnabled = cbw?.enabled ?? g.bannedWords?.enabled
  form.bwBan = cbw?.banOnTrigger ?? g.bannedWords?.banOnTrigger
  form.bwKick = cbw?.kickOnTrigger ?? g.bannedWords?.kickOnTrigger
  form.bwRecall = cbw?.recallOnTrigger ?? g.bannedWords?.recallOnTrigger
  form.bwDuration = cbw?.banDuration ?? g.bannedWords?.banDuration ?? 10
  form.bwWords = [...(cbw?.words ?? g.bannedWords?.words ?? [])]

  // 禁发链接
  const cl = cbw?.link
  const gl = g.bannedWords?.link || {}
  form.linkInherit = !cl
  form.linkWasCustom = !!cl
  form.linkEnabled = cl?.enabled ?? gl.enabled ?? false
  form.linkBan = cl?.banOnTrigger ?? gl.banOnTrigger ?? true
  form.linkKick = cl?.kickOnTrigger ?? gl.kickOnTrigger ?? false
  form.linkRecall = cl?.recallOnTrigger ?? gl.recallOnTrigger ?? true
  form.linkDuration = cl?.banDuration ?? gl.banDuration ?? 10
  // 继承时把全局白名单带出来展示，取消继承后即为本群独立的初始列表
  form.linkWhitelist = [...(cl?.whitelist ?? gl.whitelist ?? [])]

  // 禁发指定图片
  const ci = cbw?.image
  const gi = g.bannedWords?.image || {}
  form.imgInherit = !ci
  form.imgWasCustom = !!ci
  form.imgEnabled = ci?.enabled ?? gi.enabled ?? false
  form.imgThreshold = ci?.threshold ?? gi.threshold ?? 8
  form.imgBan = ci?.banOnTrigger ?? gi.banOnTrigger ?? true
  form.imgKick = ci?.kickOnTrigger ?? gi.kickOnTrigger ?? false
  form.imgRecall = ci?.recallOnTrigger ?? gi.recallOnTrigger ?? true
  form.imgDuration = ci?.banDuration ?? gi.banDuration ?? 10

  // 本群额外样本（groupId 匹配本群者）
  form.imgSamples = [...(data.value?.groupImageSamples || [])]

  // 三块各自的通知模板（未自定义时从全局回填展示，勾回继承即不写入）
  form.bwRecallNotice = loadNotice(cbw?.recallNotice, g.bannedWords?.recallNotice)
  form.bwBanNotice = loadNotice(cbw?.banNotice, g.bannedWords?.banNotice)
  form.bwKickNotice = loadNotice(cbw?.kickNotice, g.bannedWords?.kickNotice)
  form.linkRecallNotice = loadNotice(cl?.recallNotice, gl.recallNotice)
  form.linkBanNotice = loadNotice(cl?.banNotice, gl.banNotice)
  form.linkKickNotice = loadNotice(cl?.kickNotice, gl.kickNotice)
  form.imgRecallNotice = loadNotice(ci?.recallNotice, gi.recallNotice)
  form.imgBanNotice = loadNotice(ci?.banNotice, gi.banNotice)
  form.imgKickNotice = loadNotice(ci?.kickNotice, gi.kickNotice)
  form.applyGlobalBlacklist = c.applyGlobalBlacklist !== undefined ? c.applyGlobalBlacklist === true : g.applyGlobalBlacklist === true
  form.applyGlobalWhitelist = c.applyGlobalWhitelist !== undefined ? c.applyGlobalWhitelist === true : g.applyGlobalWhitelist === true
  form.essenceEnabled = c.essence?.enabled ?? g.essence?.enabled
  form.titleEnabled = c.title?.enabled ?? g.title?.enabled

  // 举报
  form.reportEnabled = c.report?.enabled ?? g.report?.enabled
  form.reportFreqEnabled = c.report?.frequency?.enabled ?? g.report?.frequency?.enabled ?? true
  form.reportFreqWindow = c.report?.frequency?.windowMinutes ?? g.report?.frequency?.windowMinutes ?? 5
  form.reportFreqMax = c.report?.frequency?.maxCount ?? g.report?.frequency?.maxCount ?? 3
  form.levelsJson = JSON.stringify(c.report?.levels ?? g.report?.levels ?? [], null, 2)

  // 退群自动拉黑
  form.abEnabled = c.autoBlacklist?.enabled ?? g.autoBlacklist?.enabled
  form.abSelf = c.autoBlacklist?.onSelfLeave ?? g.autoBlacklist?.onSelfLeave
  form.abKicked = c.autoBlacklist?.onKicked ?? g.autoBlacklist?.onKicked
  form.abDelay = c.autoBlacklist?.delayMinutes ?? g.autoBlacklist?.delayMinutes ?? 0

  // 群员检查（纯群级配置）：不再回退全局，各群一份独立配置
  const mc = c.memberCheck
  form.mcEnabled = mc?.enabled ?? false
  form.mcQqEnabled = mc?.qqLevel?.enabled ?? false
  form.mcQqMinLevel = mc?.qqLevel?.minLevel ?? 8
  form.mcQqAction = mc?.qqLevel?.action ?? 'none'
  form.mcQqMuteDuration = mc?.qqLevel?.muteDuration ?? 10
  form.mcQqWhenUnknown = mc?.qqLevel?.whenUnknown ?? 'skip'
  form.mcCardEnabled = mc?.card?.enabled ?? false
  form.mcCardMatchMode = mc?.card?.matchMode ?? 'contains'
  form.mcCardCaseSensitive = mc?.card?.caseSensitive ?? false
  form.mcCardExcludeAdmins = mc?.card?.excludeAdmins ?? true
  form.mcCardExcludeWhitelist = mc?.card?.excludeWhitelist ?? true
  form.mcCardPatterns = (mc?.card?.patterns ?? []).join(',')
  form.mcCardAction = mc?.card?.action ?? 'none'
  form.mcCardMuteDuration = mc?.card?.muteDuration ?? 10
  form.mcGroupEnabled = mc?.groupLevel?.enabled ?? false
  form.mcGroupMinLevel = mc?.groupLevel?.minLevel ?? 1
  form.mcGroupAction = mc?.groupLevel?.action ?? 'none'
  form.mcGroupMuteDuration = mc?.groupLevel?.muteDuration ?? 10
  form.mcGroupWhenUnknown = mc?.groupLevel?.whenUnknown ?? 'skip'
  // 调度参数同样是群级配置
  form.mcIntervalMinutes = mc?.intervalMinutes ?? 30
  form.mcTimeoutSeconds = mc?.timeoutSeconds ?? 60
  form.mcBatchSize = mc?.batchSize ?? 4
  form.mcCooldownHours = mc?.cooldownHours ?? 24
  form.mcActiveWithinDays = mc?.activeWithinDays ?? 0

  form.mcQqNotice = loadNotice(mc?.qqLevel?.notice)
  form.mcCardNotice = loadNotice(mc?.card?.notice)
  form.mcGroupNotice = loadNotice(mc?.groupLevel?.notice)
  form.autoNotice = loadNotice(c.joinReview?.autoNotice, g.joinReview?.autoNotice)
  form.abNotice = loadNotice(c.autoBlacklist?.notice, g.autoBlacklist?.notice)

  // 群级 AI 覆盖
  const a = c.ai
  aiForm.baseURL = a?.baseURL ?? ''
  aiForm.apiKey = a?.apiKey ?? ''
  aiForm.model = a?.model ?? ''
  aiForm.temperature = a?.temperature ?? ''
  aiForm.maxTokens = a?.maxTokens ?? ''
  aiForm.timeout = a?.timeout ?? ''
  aiForm.joinPrompt = a?.prompts?.joinReview || ''
  aiForm.reportPrompt = a?.prompts?.reportReview || ''
}

// 详情数据到达后回填表单。
// 校验数据确实属于当前选中的群，避免切换群时用上一个群的旧数据覆盖表单。
watch(data, (v) => {
  if (!v) return
  if (v.groupId && String(v.groupId) !== String(groupId.value)) return
  fillFrom(v.config, v.global)
}, { immediate: true })

function onGroupChange() {
  manualGroupId.value = ''
  if (groupId.value) refresh(undefined, true)
}

function useManualGroup() {
  const gid = String(manualGroupId.value || '').trim()
  if (!/^\d{5,}$/.test(gid)) {
    toast.warning('请输入有效的群号')
    return
  }
  groupId.value = gid
  manualGroupId.value = ''
  refresh(undefined, true)
}

async function save() {
  if (!groupId.value) {
    toast.warning('请先选择要保存的群聊')
    return
  }
  let levels: any[] = []
  try {
    levels = JSON.parse(form.levelsJson || '[]')
  } catch {
    toast.error('惩罚映射 JSON 格式错误')
    return
  }
  const noticePatch = (n: any) => ({ enabled: !!n?.enabled, mode: n?.mode, targetId: n?.targetId || '', text: n?.text || '' })
  const mcRule = (enabled: any, action: any, muteDuration: any, extra: any = {}) => ({
    enabled: !!enabled, action, muteDuration: Number(muteDuration) || 10, recall: false, ...extra,
  })

  const patch: any = {
    enableGroupManagement: form.enableGroupManagement,
    applyGlobalBlacklist: form.applyGlobalBlacklist,
    applyGlobalWhitelist: form.applyGlobalWhitelist,
    mute: { enabled: form.muteEnabled, maxDuration: Number(form.muteMaxDuration) },
    welcome: { enabled: form.welcomeEnabled, text: form.welcomeText },
    farewell: { enabled: form.farewellEnabled, text: form.farewellText },
    joinReview: {
      enabled: form.joinEnabled,
      frequency: { enabled: form.freqEnabled, windowMinutes: Number(form.freqWindow), maxCount: Number(form.freqMax), rejectReason: form.freqRejectReason || '' },
      blacklist: { enabled: form.blEnabled, rejectReason: form.blRejectReason || '' },
      qqLevel: { enabled: form.levelEnabled, minLevel: Number(form.minLevel), rejectReason: form.levelRejectReason || '' },
      keyword: { enabled: form.kwEnabled, passKeywords: split(form.passKeywords), rejectKeywords: split(form.rejectKeywords), rejectReason: form.kwRejectReason || '' },
      manual: { enabled: form.manualEnabled, timeoutMinutes: Number(form.manualTimeout), rejectReason: form.manualRejectReason || '' },
      llm: { enabled: form.llmEnabled, rejectReason: form.llmRejectReason || '' },
      default: { action: form.defaultAction === 'approve' ? 'approve' : 'reject', rejectReason: form.defaultRejectReason || '' },
      autoNotice: noticePatch(form.autoNotice),
    },
    // 违禁词 / 链接 / 图片：勾选「继承全局」时完全不写这些字段，
    // 从而真正沿用全局配置（而不是把当前全局值固化成群级覆盖）。
    // 违禁词表本身即使继承也要保留，否则无法与全局表合并 —— 这里按块分别处理。
    bannedWords: {
      ...(form.bwInherit ? {} : {
        enabled: form.bwEnabled, banOnTrigger: form.bwBan, kickOnTrigger: form.bwKick, recallOnTrigger: form.bwRecall,
        banDuration: Number(form.bwDuration), words: form.bwWords,
      }),
      // 链接块
      ...(form.linkInherit ? {} : {
        link: {
          enabled: form.linkEnabled, banOnTrigger: form.linkBan, kickOnTrigger: form.linkKick,
          recallOnTrigger: form.linkRecall, banDuration: Number(form.linkDuration),
          whitelist: form.linkWhitelist,
          banNotice: noticePatch(form.linkBanNotice),
          kickNotice: noticePatch(form.linkKickNotice),
          recallNotice: noticePatch(form.linkRecallNotice),
        },
      }),
      // 图片块
      ...(form.imgInherit ? {} : {
        image: {
          enabled: form.imgEnabled, threshold: Math.max(0, Math.min(64, Number(form.imgThreshold) || 0)),
          banOnTrigger: form.imgBan, kickOnTrigger: form.imgKick, recallOnTrigger: form.imgRecall,
          banDuration: Number(form.imgDuration),
          banNotice: noticePatch(form.imgBanNotice),
          kickNotice: noticePatch(form.imgKickNotice),
          recallNotice: noticePatch(form.imgRecallNotice),
        },
      }),
    },
    memberCheck: {
      enabled: !!form.mcEnabled,
      // 调度参数为群级配置（群员检查不参与全局回退）
      intervalMinutes: Number(form.mcIntervalMinutes) || 30,
      timeoutSeconds: Number(form.mcTimeoutSeconds) || 60,
      batchSize: Number(form.mcBatchSize) || 4,
      cooldownHours: Number(form.mcCooldownHours) || 0,
      activeWithinDays: Number(form.mcActiveWithinDays) || 0,
      qqLevel: mcRule(form.mcQqEnabled, form.mcQqAction, form.mcQqMuteDuration, {
        minLevel: Number(form.mcQqMinLevel),
        whenUnknown: form.mcQqWhenUnknown,
        notice: noticePatch(form.mcQqNotice),
      }),
      card: mcRule(form.mcCardEnabled, form.mcCardAction, form.mcCardMuteDuration, {
        matchMode: form.mcCardMatchMode,
        patterns: split(form.mcCardPatterns),
        caseSensitive: !!form.mcCardCaseSensitive,
        excludeAdmins: !!form.mcCardExcludeAdmins,
        excludeWhitelist: !!form.mcCardExcludeWhitelist,
        notice: noticePatch(form.mcCardNotice),
      }),
      groupLevel: mcRule(form.mcGroupEnabled, form.mcGroupAction, form.mcGroupMuteDuration, {
        minLevel: Number(form.mcGroupMinLevel),
        whenUnknown: form.mcGroupWhenUnknown,
        notice: noticePatch(form.mcGroupNotice),
      }),
    },
    report: { enabled: form.reportEnabled, levels, frequency: { enabled: form.reportFreqEnabled, windowMinutes: Number(form.reportFreqWindow), maxCount: Number(form.reportFreqMax) } },
    autoBlacklist: {
      enabled: form.abEnabled, onSelfLeave: form.abSelf, onKicked: form.abKicked,
      delayMinutes: Number(form.abDelay),
      notice: noticePatch(form.abNotice),
    },
    essence: { enabled: form.essenceEnabled },
    title: { enabled: form.titleEnabled },
  }

  // 群级 AI 覆盖：全部留空时不写入，避免产生无意义的空覆盖
  const aiPatch: any = {
    baseURL: aiForm.baseURL || '',
    apiKey: aiForm.apiKey || '',
    model: aiForm.model || '',
    temperature: aiForm.temperature === '' ? '' : Number(aiForm.temperature),
    maxTokens: aiForm.maxTokens === '' ? '' : Number(aiForm.maxTokens),
    timeout: aiForm.timeout === '' ? '' : Number(aiForm.timeout),
    prompts: { joinReview: aiForm.joinPrompt || '', reportReview: aiForm.reportPrompt || '' },
  }
  if (Object.values(aiPatch).some((v) => v !== '' && !(typeof v === 'object' && Object.values(v).every((x) => x === '')))) {
    patch.ai = aiPatch
  }

  const res = await mutate('setGroup', { groupId: groupId.value, patch })
  if (res?.ok) {
    toast.success('已保存该群配置')
    invalidateScope('groups')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '保存失败')
  }
}

async function resetGroup() {
  if (!groupId.value) return
  if (!confirm('确定将该群配置重置为全局配置？')) return
  const res = await mutate('group.clear', { groupId: groupId.value })
  if (res?.ok) {
    toast.info('已重置为全局配置')
    invalidateScope('groups')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '重置失败')
  }
}

async function removeGroup() {
  if (!groupId.value) return
  if (!confirm('确定删除该群的全部配置？删除后该群将直接使用全局配置。')) return
  const res = await mutate('group.remove', { groupId: groupId.value })
  if (res?.ok) {
    toast.success('已删除该群配置')
    invalidateScope('groups')
    groupId.value = ''
  } else {
    toast.error(res?.error || '删除失败')
  }
}

function onBanToggle(v: any) { if (v && form.bwKick) form.bwKick = false }
function onKickToggle(v: any) { if (v && form.bwBan) form.bwBan = false }
function onLinkBanToggle(v: any) { if (v && form.linkKick) form.linkKick = false }
function onLinkKickToggle(v: any) { if (v && form.linkBan) form.linkBan = false }
function onImgBanToggle(v: any) { if (v && form.imgKick) form.imgKick = false }
function onImgKickToggle(v: any) { if (v && form.imgBan) form.imgBan = false }

function addBannedWords() {
  for (const w of split(bannedInput.value)) {
    if (!form.bwWords.includes(w)) form.bwWords.push(w)
  }
  bannedInput.value = ''
}
function removeBannedWord(w: string) {
  form.bwWords = form.bwWords.filter((x: string) => x !== w)
}

function addLinkWl() {
  const v = linkWlInput.value.trim()
  if (!v) return
  if (!form.linkWhitelist.includes(v)) form.linkWhitelist.push(v)
  linkWlInput.value = ''
}
function removeLinkWl(v: string) {
  form.linkWhitelist = form.linkWhitelist.filter((x: string) => x !== v)
}

// 向本群添加额外违规图样本（入库时带上 groupId）
async function addGroupSample() {
  const url = imgSampleInput.value.trim()
  if (!/^https?:\/\//i.test(url)) {
    toast.warning('请填写以 http(s):// 开头的图片地址')
    return
  }
  if (!groupId.value) return
  imgSampleBusy.value = true
  const res = await mutate('image.sample.add', { url, label: '', groupId: groupId.value })
  imgSampleBusy.value = false
  if (res?.ok) {
    toast.success('已加入本群样本库')
    imgSampleInput.value = ''
    // 重新拉取群详情，groupImageSamples 会随新数据一起返回
    await refresh(undefined, true)
  } else {
    toast.error(res?.error || '添加失败')
  }
}

async function removeGroupSample(s: any) {
  const res = await mutate('image.sample.remove', { id: s.id, groupId: groupId.value })
  if (res?.ok) {
    toast.info('已移除该样本')
    await refresh(undefined, true)
  } else {
    toast.error(res?.error || '移除失败')
  }
}

onMounted(() => {
  const params = takePageParams()
  if (params?.groupId) groupId.value = String(params.groupId)
  if (groupId.value) refresh(undefined, true)
})
</script>

<style scoped>
.qg-sub-title { font-size: 13px; margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--qg-border); }
.qg-sample-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  padding: 5px 8px;
  border: 1px solid var(--qg-border);
  border-radius: 8px;
}
.qg-sample-row code { background: var(--qg-hover); border-radius: 4px; padding: 1px 5px; font-size: 11.5px; }
.qg-sample-row .qg-muted { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qg-sample-row.readonly { background: var(--qg-hover); opacity: .85; }
</style>
