module.exports = {
  extends: ["@commitlint/config-conventional"],
  parserPreset: {
    parserOpts: {
      headerPattern: /^(?:\p{Extended_Pictographic}\uFE0F?\s*)?(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/u,
      headerCorrespondence: ["type", "scope", "breaking", "subject"]
    }
  },
  rules: {
    "header-max-length": [2, "always", 72],
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "release"]
    ]
  }
};
