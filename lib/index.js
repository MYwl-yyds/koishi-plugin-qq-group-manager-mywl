"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.using = exports.DEFAULT_CONFIG = exports.name = exports.Config = void 0;
exports.apply = apply;
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const store_1 = require("./services/store");
const services_1 = require("./services");
const commands_1 = require("./commands");
const listeners_1 = require("./listeners");
const webui_1 = require("./webui");
var config_1 = require("./config");
Object.defineProperty(exports, "Config", { enumerable: true, get: function () { return config_1.Config; } });
Object.defineProperty(exports, "name", { enumerable: true, get: function () { return config_1.name; } });
var constants_2 = require("./constants");
Object.defineProperty(exports, "DEFAULT_CONFIG", { enumerable: true, get: function () { return constants_2.DEFAULT_CONFIG; } });
exports.using = ['database'];
function apply(ctx, config) {
    const log = (0, utils_1.logger)(ctx);
    // 用内置默认值 + 极简 Schema 配置，得到完整生效配置（其余均在 WebUI 中修改）
    const fullConfig = (0, utils_1.mergeDeep)(JSON.parse(JSON.stringify(constants_1.DEFAULT_CONFIG)), config);
    // 初始化数据库表结构与服务
    (0, store_1.initModels)(ctx);
    const svc = (0, services_1.createServices)(ctx, fullConfig);
    // 群管功能总开关
    if (fullConfig.enableGroupManagement !== false) {
        (0, commands_1.registerCommands)(ctx, svc);
        (0, listeners_1.registerListeners)(ctx, svc);
    }
    // WebUI（用于配置与看板），仅在安装了 console 插件时启用
    ctx.using(['console'], (cctx) => {
        (0, webui_1.applyWebUI)(cctx, svc);
    });
    // 定时清理过期的入群审核申请（每 5 分钟）
    ctx.setInterval(async () => {
        try {
            await svc.store.joinRequestCleanup();
        }
        catch (e) {
            log.warn('清理过期入群申请失败', e);
        }
    }, 5 * 60 * 1000);
    log.info('全方面QQ群管已启动');
}
//# sourceMappingURL=index.js.map