# Agent Note: 在步骤边界优雅停止

Status: implemented

[English](2026-11-18-graceful-stop-at-step-boundary.md) | 中文

## Problem

输入框的停止操作通过 `Agent.cancel()` 中止当前模型请求。进行中的流会被截断，已送达的前缀被冻结为带 `interrupted: true` 的 `assistant/message`，轮次以 `{ kind: 'aborted', reason }` 收口。用户想暂停一次运行时，得到的结果与接近崩溃的中止相同：assistant 文本被截断、未分发的工具调用需要合成结果、transcript 停在半句话上。用户要求类似 Codex 的行为：按下停止后先完成当前工作，再让会话结算。冻结并在之后恢复实时 provider 流在此不可行：provider 协议没有暂停/恢复交换，而且该请求已经被消费。

## Decision

停止请求携带结束边界。`Agent.cancel(cause, { mode: 'graceful' })` 绝不上抛中止信号：驱动器完成当前步骤——进行中的模型响应完整流入并作为普通 `assistant/message` 记录，该响应请求的每个工具调用结算并记录——然后以 `{ kind: 'stopped' }` 关闭轮次。`mode: 'immediate'`（默认值，也是尚无模式概念的 Client 省略该字段时发送的值）保留中止路径。`TurnEndReasonMap` 新增 `stopped` 变体，使读取方能区分已结算的步骤边界与取消；不复用中断前缀词汇。

边界在轮次循环的步骤边界处检查：领取步骤之前、追加该步骤的 `step/end` 之后，以及重试再发起一次模型请求之前。没有运行中轮次时，优雅请求是空操作，不会为后续工作预置状态；maintenance 任务不受影响，因为它不拥有步骤。优雅请求在途时，第二次立即取消仍会中止。inbox 中排队的工作不会被结束中的轮次清除或消费：既有条目留待之后的唤醒，而请求之后到达的唤醒投递会被归类到下一轮，并在边界之后启动它。停止的轮次不派发 `agent/turn-stopping`，因此会 steer 让循环继续的插件无法覆盖操作者意图。

传输沿用普通 Session Remote：`session.cancel` 接受 `mode: 'graceful' | 'immediate'`，Session Controller 将优雅请求映射到 Agent 选项。Host 接受请求后等待期间，Client 的 `Session` 快照暴露 `stopRequested`，并在运行位下落时清除。composer 将停止位置渲染为拆分控件：主按钮与 `Esc Esc` 快捷键请求优雅模式，并在步骤结算期间显示预置标签；同一位置的插入符菜单保留立即停止，用于卡住的步骤或工具。可继续的子代理 Session 只保留立即停止，因为 `subagents.interruptByUser` 是与外部后端共享的 activation 级信号，自身没有步骤边界。

## Alternatives considered

**中止流，但把已送达前缀标记为已结算。** 这能保留现有传输且改动最小，但 assistant 消息仍在响应中途被截断，模型请求的工具调用仍无结果，transcript 会声称完成了一件没有发生的事。已拒绝。

**真正冻结并稍后恢复 provider 流的暂停。** 没有 provider 交换支持它，请求无法从冻结点重放，而暂停中的 Agent 状态还必须跨断连与重启存活。超出范围，而不是推迟。

**新增独立的 `Agent.requestGracefulStop()` 方法。** 它比 `cancel` 上的选项读起来更清楚，但会成为文档化扩展接口的必需成员，为了一个可选能力破坏每个自定义 `Agent` 实现和约五十个测试桩。`CancelOptions.mode` 扩展既有停止词汇，不扩大接口。

**让优雅模式成为线上默认（省略字段）。** 旧 Client 省略该字段并期待今天的中止；改变省略的含义会在 Host 升级后静默改变它们的行为。省略仍为立即，新 Client 总是发送自己的模式。

## Consequences

- 停止的轮次中 assistant 消息完整且没有 `interrupted` 标记；`turn/end` 读出 `{ kind: 'stopped' }`。session-query、ACP、goal 轮次与 transcript 读取新变体；goal round driver 会暂停目标而不是安排下一轮，与用户中止路径一致。
- 运行保持 `status: 'running'` 并持续消耗 token，直到当前步骤结算。长工具调用会推迟停止，因此立即模式保持一键可达。
- 排队中的工作会在优雅停止后保留，但不会自行运行；下一次唤醒会启动它。今天的立即停止配合 `keepInbox` 也是如此。
- 在优雅窗口内发生进程丢失时，仍会产生崩溃恢复的 `interrupted` 收口，因为没有提交 `turn/end`。
