---
description: "从会话日志读取的每日、每个模型的 Token 用量，按服务商设置的只提醒、不拦截的 5 小时、每周和每月滚动 Token 预算，以及 DeepSeek 账户余额。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage

[English](README.md) | 中文

## 概述

Harness 已经在会话日志里记录了每一次计费的模型调用，但没有任何地方汇总它们。本包负责汇总，并在设置中新增“用量”分区。

分区展示三部分内容：

1. **余额。** 通过官方 `GET /user/balance` 接口读取 DeepSeek 账户余额，使用与 DeepSeek 路由相同的凭据。其他服务商没有公开余额接口，因此只显示用量。
2. **预算。** 可为每个服务商分别设置最近 5 小时、7 天和 30 天的 Token 预算（可选）。预算只做提醒：达到 80% 时进度条变黄，达到 100% 时变红，每越过一个阈值弹出一次提示。请求不会被拦截。
3. **统计。** 最近 7 天或 30 天内按本地日期和模型统计的 Token，拆分为未缓存输入、缓存命中、缓存写入和输出，并附调用次数与合计。

所有数字都是根据日志估算的，并非服务商账单。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 profile 中挂载插件：

```yaml
- insert:
    - id: usage
      name: '@deepseek-ai/dsh-usage'
      config:
        ledgerFile: usage-ledger.json
        deepseek: { apiKeyEnv: DEEPSEEK_API_KEY, baseURL: https://api.deepseek.com }
        limits:
          deepseek: { fiveHours: 2000000, month: 50000000 }
```

行 id 必须是 `usage`：设置分区通过 `usage` 设置表单读写 `limits`。`ledgerFile` 相对于 profile 目录解析。未配置 DeepSeek 密钥时，余额卡片会说明这一点，页面其余部分照常工作。

`limits` 以服务商路由 id 为键，是可实时修改的设置字段：页面写入时无需重新加载插件，手动编辑效果相同。没有设置任何窗口的预算会被移除。

<a id="understand-the-implementation"></a>
## 实现说明

Host 部分由三块组成：

1. **折叠。** `fold.ts` 按 token-meter 的 `tokenUsage` 投影规则重放一份原始会话日志。`request/context` 指定下一次调用的服务商和模型。每次助手结算贡献其尝试的最后一个用量样本，同一尝试中较晚的样本会替换较早的样本。`llm/retry-started` 开启新的尝试，因此每次计费的重试都单独计数。读取的是原始事件，所以被回退撤销的轮次仍会计入。
2. **账本。** `ledger.ts` 按会话保存折叠后的调用，每次刷新只读取上次之后新增的事件。上次读取时已不处于活跃状态的会话不会再被读取。分叉继承的前缀只用于初始化折叠状态，因此父会话的调用不会被重复计算。账本以原子方式持久化，仅所有者可访问；版本不同的文件按空账本读取并重建。
3. **Remote。** `UsageService` 提供 `view(since)`（自 `since` 起的每 15 分钟数据行，以及截至当前的滚动合计）和 `balance()`（缓存 60 秒，超时 10 秒）。

`src/client/` 中的浏览器部分注册一个 `settings.section` 和一个 `shell.overlay` 提示。`UsageController` 按查看者所在时区把 15 分钟数据行汇总为本地日期，通过设置表单写入预算，并在应用打开期间每 5 分钟重新读取一次用量，因此即使没有打开该分区，也能发现越过的阈值。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **是估算，不是账单。** Token 来自服务商流式返回的用量；没有报告用量的尝试不计入。预算统计全部四类 Token（包括缓存命中），尽管服务商对它们的定价不同。
- **只有 DeepSeek 有余额。** 其他服务商没有公开的余额接口。
- **预算只做提醒。** 拦截超出预算的请求需要在请求管线中加钩子，不在本包范围内。
- **不在默认发行组合中。** 默认产品隔离规则禁止实验包进入 `packages/bundle/web-app`；需要的 profile 自行添加该行。

<a id="further-exploration"></a>
## 延伸阅读

- [`@deepseek-ai/dsh-session-query`](../../session-query/session-query/README.zh.md) — 账本所依赖的会话日志读取。
- [`@deepseek-ai/dsh-llm-deepseek`](../../llm/llm-deepseek/README.zh.md) — 余额读取共用的凭据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
