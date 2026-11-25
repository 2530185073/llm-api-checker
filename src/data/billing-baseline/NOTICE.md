# 基准素材来源与许可

| 文件 | 内容 | 来源与许可 |
|---|---|---|
| claude-opus-5.5.json | 官方计费基准（每个固定请求的上下文 / output / 思考 token 与缓存拆分） | 见 scripts/billing-baseline/README.md |
| base.json | 系统提示词与工具定义 | 原创撰写；其中「Project documentation」段落为 python-tabulate v0.9.0 的 README.md，MIT License，Copyright (c) 2011-2020 Sergey Astanin and contributors |
| corpus-code.json | 代码语料 | CPython 3.9 标准库顶层模块（__future__.py … aifc.py，共 20 个文件的前 520,000 字符），Python Software Foundation License |
| corpus-zh.json | 中文散文与小说 | 由 Claude Opus 5.5 生成的原创文本 |
| corpus-en.json | 英文散文 | 由 Claude Opus 5.5 生成的原创文本 |
| corpus-json.json | JSON 记录 | 固定随机种子（20261125）程序生成 |
| agent-script.json | 多轮 Agent 会话剧本 | 原创；工具结果截取自 corpus-code.json |
