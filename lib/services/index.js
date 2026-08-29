"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServices = createServices;
const store_1 = require("./store");
const log_1 = require("./log");
const onebot_1 = require("./onebot");
const ai_1 = require("./ai");
const settings_1 = require("./settings");
const permission_1 = require("./permission");
const notice_1 = require("./notice");
function createServices(ctx, config) {
    const store = new store_1.Store(ctx);
    const onebot = new onebot_1.OneBotService(ctx, config.onebotFramework ?? 'auto');
    const services = {
        ctx,
        config,
        log: new log_1.LogService(ctx, store),
        store,
        ai: new ai_1.AiService(ctx),
        onebot,
        notice: new notice_1.NoticeService(ctx, onebot),
        settings: new settings_1.SettingsService(ctx, store, config),
        permission: null,
    };
    services.permission = new permission_1.PermissionService(ctx, store, async () => (await services.settings.getGlobal()).superUsers);
    return services;
}
//# sourceMappingURL=index.js.map