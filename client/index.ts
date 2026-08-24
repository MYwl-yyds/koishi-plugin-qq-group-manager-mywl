import { Context } from '@koishijs/client'
import './styles.css'
import App from './App.vue'

export default (ctx: Context) => {
  ctx.page({
    name: '全方面QQ群管',
    path: '/qq-guanqun',
    // 仅权限等级 >= 3（管理员）可见；未启用 auth 插件时无权限过滤，默认显示
    authority: 3,
    fields: ['qq-guanqun'],
    component: App,
  })
}