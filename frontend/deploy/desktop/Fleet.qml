import QtQuick
import Quickshell
import Quickshell.Io
import "fleet.mjs" as Fleet

Item {
  id: root

  property var bar
  property string moduleName: "mirai.fleet"
  property var settings
  property string hubUrl: settings && settings.hub ? settings.hub : ""
  property var snapshot: ({ fleet: null, events: null, badge: null })
  property var limits: ({ tempHotC: 80, diskFullPct: 85, loadHotPct: 80 })
  property var model: Fleet.view(snapshot, limits)
  property int lastSeenId: -1
  property string tooltipText: "Mirai: hub unreachable"

  implicitWidth: label.implicitWidth + 14
  implicitHeight: bar ? bar.barSize : 26

  function poll() {
    if (!hubUrl || pollProcess.running) return
    pollOutput.text = ""
    pollProcess.running = true
    stallTimer.restart()
  }

  function applyPoll() {
    try {
      const next = JSON.parse(pollOutput.text)
      if (next.settings?.fleet?.tempHotC !== undefined) limits = next.settings.fleet
      snapshot = next
      const result = Fleet.notifications(lastSeenId < 0 ? null : lastSeenId, next.events)
      lastSeenId = result.lastSeenId === null || result.lastSeenId === undefined ? lastSeenId : result.lastSeenId
      for (const notice of result.notify) {
        if (bar) bar.run(`notify-send -u critical ${JSON.stringify(notice.title)} ${JSON.stringify(notice.body)}`)
      }
      const current = Fleet.view(next, limits)
      tooltipText = current.unreachable
        ? "Mirai: hub unreachable"
        : `fleet ${current.label}\n${current.rows.map(row => `${row.machine}  ${cell(row.cpu)} ${cell(row.mem)} ${cell(row.temp)} ${cell(row.disk)}`).join("\n")}\n${current.events.map(event => event.message).join("\n")}`
    } catch (error) {
      snapshot = ({ fleet: null, events: null, badge: null })
      tooltipText = "Mirai: hub unreachable"
    }
  }

  function cell(value) {
    return value === null ? "--" : `${Math.round(value.value)}${value.tone === "ok" ? "" : "!"}`
  }

  Timer {
    interval: 10000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.poll()
  }

  Timer {
    id: stallTimer
    interval: 6000
    repeat: false
    onTriggered: if (pollProcess.running) pollProcess.running = false
  }

  Process {
    id: pollProcess
    running: false
    command: ["bash", "-c", "set -e; hub=$1; fleet=$(curl --fail --silent --show-error --max-time 5 \"$hub/api/fleet\"); events=$(curl --fail --silent --show-error --max-time 5 \"$hub/api/events\"); badge=$(curl --fail --silent --show-error --max-time 5 \"$hub/api/ship/badge\"); settings=$(curl --fail --silent --show-error --max-time 5 \"$hub/api/settings\" 2>/dev/null || printf '{}'); printf '{\\\"fleet\\\":%s,\\\"events\\\":%s,\\\"badge\\\":%s,\\\"settings\\\":%s}' \"$fleet\" \"$events\" \"$badge\" \"$settings\"", "mirai-fleet", root.hubUrl]
    stdout: StdioCollector { id: pollOutput; waitForEnd: true }
    onExited: {
      stallTimer.stop()
      if (exitCode === 0) root.applyPoll()
      else root.snapshot = ({ fleet: null, events: null, badge: null })
    }
  }

  Rectangle {
    id: dot
    width: 6
    height: 6
    radius: 3
    anchors.left: parent.left
    anchors.leftMargin: 5
    anchors.verticalCenter: parent.verticalCenter
    color: root.model.dot === "bad" ? (bar ? bar.urgent : "#ff5a4e") : root.model.dot === "warn" ? "#f4b63f" : root.model.dot === "unreachable" ? "#777777" : "#5fd08a"
  }

  Text {
    id: label
    anchors.left: dot.right
    anchors.leftMargin: 5
    anchors.verticalCenter: parent.verticalCenter
    text: `󰣇 ${root.model.label}`
    color: bar ? bar.foreground : "white"
    font.family: bar ? bar.fontFamily : "monospace"
    font.pixelSize: 12
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    onEntered: if (root.bar) root.bar.showTooltip(root, root.tooltipText)
    onExited: if (root.bar) root.bar.hideTooltip(root)
    onClicked: if (root.bar) root.bar.run("mirai-desktop-open /machines")
  }
}
