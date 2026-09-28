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

### Content

**Content**:
The page that holds everything saved to read or watch later: articles, papers, posts, PDFs and videos.
_Avoid_: later, read-later, Later Module

**Content item**:
One saved article, paper, post, PDF or video in Content.
_Avoid_: later item, bookmark, link

**Queue**:
The ordered list of Content items still waiting to be read or watched.
_Avoid_: backlog, reading list

### Surfaces

**Desktop app**:
Mirai opened as its own app window on an Omarchy machine, launched and managed like any other Omarchy app.
_Avoid_: native app, webapp, Chromium window

**Browser tab**:
Mirai opened in an ordinary browser on any machine.
_Avoid_: web app, website

**PWA**:
Mirai installed to a phone's home screen.
_Avoid_: mobile app

**System theme**:
The Omarchy theme and monospace font currently set on the machine a Desktop app runs on. The Desktop app follows it live, except for status colors (ok, warn, bad), which always stay Mirai's own; the Browser tab and PWA ignore it.
_Avoid_: Mirai theme, hub theme
