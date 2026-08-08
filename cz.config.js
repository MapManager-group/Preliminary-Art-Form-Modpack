/** @type {import('cz-git').UserConfig} */
module.exports = {
  // 类型
  types: [
    {
      value: "feat",
      name: "✨ feat: 新功能"
    },
    {
      value: "fix",
      name: "🐛 fix: Bug 修复"
    },
    {
      value: "docs",
      name: "📝 docs: 文档修改"
    },
    {
      value: "style",
      name: "🎨 style: 格式调整"
    },
    {
      value: "refactor",
      name: "♻️ refactor: 重构代码"
    },
    {
      value: "perf",
      name: "⚡ perf: 性能优化"
    },
    {
      value: "test",
      name: "✅ test: 测试相关"
    },
    {
      value: "build",
      name: "📦 build: 构建相关"
    },
    {
      value: "ci",
      name: "👷 ci: CI/CD"
    },
    {
      value: "chore",
      name: "🔧 chore: 其他修改"
    }
  ],


  // scope
  scopes: [
    {
      name: "packwiz"
    },
    {
      name: "mod"
    },
    {
      name: "resource"
    },
    {
      name: "config"
    },
    {
      name: "mrpack"
    },
    {
      name: "fabric"
    },
    {
      name: "ci"
    },
    {
      name: "github"
    },
    {
      name: "docs"
    }
  ],


  // 开启emoji前缀
  enableEmoji: true,


  // emoji格式
  emojiAlign: "center",


  // subject格式
  subjectLimit: 72,


  // 提交格式
  upperCaseSubject: false,


  // 允许自定义scope
  allowCustomScopes: true,


  // 允许破坏性更新
  allowBreakingChanges: [
    "feat",
    "fix"
  ]
}