"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.name = void 0;
const koishi_1 = require("koishi");
const constants_1 = require("./constants");
exports.name = 'quanmian-qq-guanqun';
exports.Config = koishi_1.Schema.object({
    enableGroupManagement: koishi_1.Schema.boolean()
        .default(constants_1.DEFAULT_CONFIG.enableGroupManagement)
        .description('群管功能总开关'),
    superUsers: koishi_1.Schema.array(String)
        .default(constants_1.DEFAULT_CONFIG.superUsers)
        .description('超级管理员 QQ 列表（拥有全部权限）'),
    onebotFramework: koishi_1.Schema.union(['auto', 'napcat', 'llbot'])
        .default(constants_1.DEFAULT_CONFIG.onebotFramework)
        .description('OneBot 框架适配（自动检测 / NapCat / LLBot），用于适配不同框架的 OneBot 内置接口'),
}).description('全方面QQ群管（其余功能请进入控制台左侧「全局设置」页面配置）');
//# sourceMappingURL=config.js.map