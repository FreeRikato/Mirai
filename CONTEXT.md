# Mirai

A personal dashboard that watches a fleet of machines, tasks, pull requests, saved content and notes, with mirAI as the assistant that answers questions about all of it.

## Language

### mirAI

**mirAI**:
The assistant inside Mirai that answers questions about the fleet, tasks, pull requests, content and notes, with pi's full toolset (read, bash, edit, write, grep, find, ls) running unrestricted as the hub user on the hub machine, the same as pi coding agent. It writes to the llm-wiki directly, with no approval step.
_Avoid_: agent, bot, copilot, chat

**Thread**:
One continuous mirAI conversation that follows the user across every page until they start a new one.
_Avoid_: session, chat, conversation

**Thread history**:
The list of past Threads; opening one resumes it as the active Thread, keeping its earlier answers unchanged.
_Avoid_: session history, archive, chat log

**View**:
What the user was looking at (module plus host, board or item) at the moment they asked a question; every question carries its own View.
_Avoid_: context, page, route
