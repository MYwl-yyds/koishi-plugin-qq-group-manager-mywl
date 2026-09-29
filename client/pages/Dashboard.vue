<!--
  已废弃：原「看板」页面，功能已拆分到 `Overview.vue`（总览）与 `Logs.vue`（记录中心）。
  保留此文件仅为兼容历史引用；App.vue 不再加载它。请勿在此新增功能。
-->
<template>
  <EmptyState text="该页面已废弃" sub="请使用左侧「总览」与「记录中心 → 操作记录」" icon="📦" />
</template>

<script setup lang="ts">
import EmptyState from '../components/EmptyState.vue'
</script>
