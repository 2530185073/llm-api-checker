# 计费基准采集（billing-baseline-v1）

成分检测里的「计费真实性」用例不需要官方 Key：它把渠道上报的 usage 与仓库自带的官方计费基准
`src/data/billing-baseline/<模型>.json` 比对。本目录是生成这份基准的工具，只有维护者在以下情况需要运行：

- 新增一个模型的基准；
- 官方更新了分词器或计费规则；
- 修改了请求构造规范（`blspec.py` / `src/lib/composition/billing/spec.ts`）或任何素材文件。

## 原理

1. `blspec.py` 按固定规则构造 Claude Code 形态的请求：三段 system（约 1.8 万 token 的工作说明与项目文档）、14 个工具定义、
   带 `cache_control` 的用户消息，并附加指定长度的代码 / 中文 / 英文 / JSON 上下文；要求模型给出**逐字固定**的输出
   （`OK`、one～twenty、one～three hundred、one～one thousand），或用 `max_tokens` 截断。
2. 每个请求开头有一个由 6 个单 token 英文词组成的测试编号，换编号几乎不改变 token 数（实测差异 ≤ 2），
   冷启动请求因此不会命中之前的缓存。
3. 去掉测试编号后，请求体规范化 JSON 的 sha256（`template_sha256`）是该请求的身份。TypeScript 实现
   `spec.ts` 与 `blspec.py` 必须产生相同的 sha256；检测时若找不到对应基准，用例会跳过并提示素材或规范被改动。
4. 输入逐字相同、输出逐字相同时，官方的上下文 token 数和 output token 数是确定的（output 只有思考 token 的少量波动），
   所以测一次即可作为基准；检测渠道时只需拿它上报的 usage 对照。

## 采集维度

| 维度 | 取值 |
| --- | --- |
| 额外上下文（代码） | 0 / 1 万 / 3 万 / 6 万 / 10 万 / 16 万 token |
| 输出 | 极短 OK / 短 / 中（约 2,200 token）/ 长（约 8,700 token）/ `max_tokens` 截断 64、512、4096 |
| 缓存状态 | 冷启动 / 原样重发 / 同前缀不同结尾 / 不带缓存标记 / 1 小时 TTL |
| 内容类型 | 代码 / 中文散文 / 英文散文 / JSON（约 3 万 token） |
| 传输 | 流式 / 非流式 |
| 多轮 Agent | 8 轮工具调用历史，逐轮增长（9 个请求） |
| 重复 | 核心网格与内容类型各 2 次，多轮 Agent 2 次 |

共 26 组 108 个请求。

## 运行

基准必须用**如实计费**的接口采集：Anthropic 官方 API，或经过官方交叉验证、逐 token 一致的接口。

```bash
cd scripts/billing-baseline
PAR=3 python3 capture.py https://api.anthropic.com "$ANTHROPIC_API_KEY" out      # 约 40 分钟，按官方价约 $10～15
python3 aggregate.py out/samples.jsonl ../../src/data/billing-baseline/claude-opus-5.5.json out/samples-raw.jsonl
```

`capture.py` 可断点续跑：中断后用同一个输出目录再执行一次即可。`aggregate.py` 会剔除输出与期望不一致的样本并打印出来。

## 计价口径

- 上下文总量（`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`）与缓存状态无关，是比对的核心。
- 「真实账单」按官方规则计算：冷启动（以及 Agent 第 0 轮）视为全新会话、全部写入缓存；原样重发、同前缀请求与 Agent 后续轮次
  使用实测的官方缓存拆分；不带缓存标记的请求全部按输入价计费。
- 价格写在基准文件的 `pricing_usd_per_mtok` 中（Claude Opus 5.5：input $4、output $20、5 分钟缓存写入 $5、
  1 小时缓存写入 $8、缓存读取 $0.20，每百万 token）。
