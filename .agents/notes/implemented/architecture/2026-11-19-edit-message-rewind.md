# Agent Note: Editing a sent message rewinds the Session through an empty surface replacement

Status: implemented

English | [中文](2026-11-19-edit-message-rewind.zh.md)

## Problem

The pencil under a sent user message opened an in-place editor whose Save only wrote the edited text into the composer draft. Sending it then appended an ordinary prompt after the existing conversation: the model still saw the original message and every reply to it, and Chat kept both versions. Users expect an edit to replace the message and everything after it, as in other chat products. The Session log is append-only, released logs cannot change shape, and the model-visible history must remain reconstructable from the log.

## Decision

`session/editMessage({ requestId, sessionId, seq, text })` rewinds an idle ordinary Session to one sent turn-opening `user/message` and queues the edited text as a new Turn. Inside `agent.runMaintenance()`, with no pending inbox input, the Session API appends one empty `user/message` whose `source.kind` is `rewind` and whose surface operation replaces the edited Turn's first model-visible node through the current last node; `sourceEventSeqs` lists every shadowed node. It then calls `agent.followup()` with the edited text merged into the original content blocks, so attachments stay, and with the same request identity. The latched wake starts the new Turn when maintenance ends.

### An existing surface operation, not a new event

Surface replacement already lets any producer shadow a range of model-visible nodes; compaction relies on it, and older readers fold it. A rewind is that operation with no replacement content, so the log keeps every retracted record, no event type or `SESSION_FORMAT_VERSION` change is required, and replay reproduces the same model history. The retraction is recognizable by its `rewind` source, which consumers that do not know it fall through.

### Empty user nodes send nothing

`deriveEventMessage` now projects an empty-content `user/message` to no message, as it already did for empty system, developer, and assistant nodes. The retraction therefore adds no wire message, and an empty manual-continuation input no longer sends a content-less user turn that some providers reject. Both keep their surface positions.

### The edited message travels the ordinary prompt path

Queuing the edited text as a follow-up reuses prompt admission, request-identity deduplication, continuation eligibility, Turn boundaries, and the Chat exchange grouping for a turn-opening message. Neither AgentLoop nor the inbox learns about edits. Maintenance ownership excludes a running Turn, so the retraction never races a model request.

### Chat hides the retracted span

The Conversation assembler drops, for every View, each retraction's span from the start of the edited Turn (or the loaded window's start when that start is not loaded) through the retraction. Inbox splices stay in the window: they render nothing, and Chat folds them as one ordered index history that a gap would corrupt. A live retraction or an older page in a window that holds one replays the loaded window. The Trajectory and exports still read the complete log.

## Alternatives considered

**Seed the composer and let the user resend.** This was the shipped behavior; it leaves the original exchange model-visible, which is what users reported as broken.

**Branch into a new Session with `fork`.** Forking at the event before the message works today but leaves the original Session beside the branch and changes the Session the user is looking at. Users asked for the edit to happen in place.

**A dedicated rewind event type.** A new type needs a format decision, reader support in every consumer, and migration rules, while surface replacement already expresses "these nodes no longer reach the model".

**Carry the replacement intent through the inbox and append the edited message as the replacement.** That puts the edit into AgentLoop admission and the inbox schema, both core seams, for no change in model-visible history.

**A replacement user message holding the edited text, then an empty continuation to wake the Turn.** The edited text would sit outside any Turn, so Chat could not group it as the next exchange, and the waking input would need its own presentation.

## Consequences

- Files changed by tool calls in the retracted Turns are not restored; the editor states this beside its actions.
- The edit is refused with `session/edit-unavailable` when the event is not a sent user message that opened its Turn (`NOT_A_USER_MESSAGE`), when the message no longer reaches the model, for example after compaction or an earlier retraction (`NOT_ON_SURFACE`), and while queued input is pending (`PENDING_INPUT`); a running Session answers `session/agent-busy`, so Chat disables the pencil during any run.
- The system prompt head at surface node 0 is never shadowed; an edit of the first Turn retracts from node 1.
- A retraction outside the loaded window's earliest Turn hides older events of that Turn only once its start loads; until then the window hides everything it holds before the retraction.
- Liveshare classifies `session/editMessage` as owner-only.
