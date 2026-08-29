"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const constants_1 = require("../constants");
const utils_1 = require("../utils");
// 设置服务：解析「Schema 默认 → 全局覆盖 → 群级覆盖」三级配置
class SettingsService {
    constructor(ctx, store, base) {
        this.store = store;
        this.base = base;
    }
    fallback() {
        return (0, utils_1.mergeDeep)(JSON.parse(JSON.stringify(constants_1.DEFAULT_CONFIG)), this.base);
    }
    // 全局生效配置（Schema + DB 全局覆盖）
    async getGlobal() {
        const override = await this.store.globalConfigGet();
        if (!override?.config)
            return this.fallback();
        return (0, utils_1.mergeEffective)(this.fallback(), override.config);
    }
    async setGlobal(patch) {
        const current = await this.store.globalConfigGet();
        const merged = (0, utils_1.mergeDeep)(current?.config ?? {}, patch);
        await this.store.globalConfigSet(merged);
    }
    // 某群生效配置（全局 + 群级覆盖，群级为空值则回退全局）
    async getGroup(groupId) {
        const global = await this.getGlobal();
        const rec = await this.store.groupConfigGet(groupId);
        if (!rec?.config)
            return global;
        return (0, utils_1.mergeEffective)(global, rec.config);
    }
    async setGroup(groupId, patch) {
        const current = await this.store.groupConfigGet(groupId);
        const merged = (0, utils_1.mergeDeep)(current?.config ?? {}, patch);
        await this.store.groupConfigSet(groupId, merged);
    }
    async clearGroup(groupId) {
        await this.store.groupConfigSet(groupId, {});
    }
    async allGroups() {
        return this.store.groupConfigAll();
    }
    // 判断某群是否启用了群管总开关（群级可用 enableGroupManagement 覆盖）
    async isEnabled(groupId) {
        const cfg = await this.getGroup(groupId);
        return cfg.enableGroupManagement !== false;
    }
}
exports.SettingsService = SettingsService;
//# sourceMappingURL=settings.js.map