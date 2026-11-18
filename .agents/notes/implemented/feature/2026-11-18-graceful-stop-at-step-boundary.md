# Agent Note: Graceful stop at the step boundary

Status: implemented

English | [中文](2026-11-18-graceful-stop-at-step-boundary.zh.md)

## Problem

The composer's stop action aborted the active model request through `Agent.cancel()`. An in-flight stream was cut mid-response, the delivered prefix was frozen as an `assistant/message` with `interrupted: true`, and the turn closed as `{ kind: 'aborted', reason }`. Users asking to pause a run got the same observable outcome as a crash-adjacent abort: truncated assistant text, undispatched tool calls that needed synthetic results, and a transcript that ended mid-thought. They asked for the Codex-style behaviour where pressing stop finishes the current work before the session settles. Freezing and later resuming a live provider stream is impossible here: the provider protocol has no pause/resume exchange, and the request is already being consumed.

## Decision

A stop request carries an ending boundary. `Agent.cancel(cause, { mode: 'graceful' })` never aborts the live signal: the driver finishes the current step — the in-flight model response is streamed to completion and recorded as an ordinary `assistant/message`, and every tool call that response requested settles and is recorded — then closes the turn as `{ kind: 'stopped' }`. `mode: 'immediate'` (the default, and what a Client that predates modes sends by omitting the field) keeps the abort path. `TurnEndReasonMap` gains the `stopped` variant so readers can distinguish a settled step boundary from a cancellation; the interrupted-prefix vocabulary is not reused.

The boundary is checked at the turn loop's step boundaries: before a step is claimed, after a step's `step/end` is appended, and before a retry dispatches another model request. A graceful request with no running turn is a no-op that arms nothing, and a maintenance task is unaffected because it owns no step. A second immediate cancel still aborts a graceful request in flight. Queued inbox work is not cleared or consumed by the ending turn: pre-existing entries stay parked until a later wake, while a waking delivery made after the request is classified for the next turn and starts one after the boundary. `agent/turn-stopping` is not dispatched for the stopped turn, so a plugin that would steer to continue cannot override the operator.

The transport is the ordinary Session Remote: `session.cancel` accepts `mode: 'graceful' | 'immediate'` and the Session Controller maps a graceful request to the Agent option. The Client `Session` snapshot exposes `stopRequested` while the Host-accepted request waits, and clears it when the running bit drops. The composer renders the stop seat as a split control: the primary button and the `Esc Esc` shortcut request the graceful mode and show the armed label while the step settles, while a caret menu in the same seat keeps the immediate stop available for a hung step or tool. Continuable subagent Sessions keep an immediate-only Stop, because `subagents.interruptByUser` is an activation-level signal shared with external backends and has no step boundary of its own.

## Alternatives considered

**Abort the stream but keep the delivered prefix marked as settled.** This keeps the existing transport and costs least, but the assistant message is still truncated mid-response and the model's requested tool calls remain unanswered, so the transcript would claim a completion that never happened. Rejected.

**A true pause that freezes and later resumes the provider stream.** No provider exchange supports it, the request cannot be replayed from a frozen point, and a paused-Agent state would have to survive disconnect and restart. Out of scope rather than deferred.

**A separate `Agent.requestGracefulStop()` method.** It reads better than an option on `cancel`, but it is a required member of a documented extension interface, so every custom `Agent` implementation and roughly fifty test stubs would break for one optional capability. `CancelOptions.mode` extends the existing stop vocabulary without widening the interface.

**Make the graceful mode the wire default (omission).** Old Clients omit the field and expect today's abort; changing the meaning of omission would silently alter their behaviour after a Host upgrade. Omission stays immediate and the new Client always sends its mode.

## Consequences

- A stopped turn's assistant message is complete and has no `interrupted` marker; `turn/end` reads `{ kind: 'stopped' }`. Session-query, ACP, goal rounds, and the transcript read the new variant; the goal round driver pauses the goal instead of scheduling another round, matching the user-abort path.
- The run keeps `status: 'running'` and consumes tokens until the current step settles. A long tool call delays the stop, which is why the immediate mode stays one click away.
- Pending queued work survives a graceful stop but does not run by itself; the next wake starts it. The same is true of today's immediate stop with `keepInbox`.
- A process loss during the graceful window still produces the crash-recovery `interrupted` closer, because no `turn/end` was committed.
