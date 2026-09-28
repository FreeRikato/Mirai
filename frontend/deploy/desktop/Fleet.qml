import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
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
  property bool hovering: false
  property var pendingNotices: []
  property var activeNotice: null

  implicitWidth: label.implicitWidth + 14
  implicitHeight: bar ? bar.barSize : 26

  function resetView() {
    snapshot = ({ fleet: null, events: null, badge: null })
    limits = ({ tempHotC: 80, diskFullPct: 85, loadHotPct: 80 })
    lastSeenId = -1
  }

  function startNotification() {
    if (notificationProcess.running || activeNotice || pendingNotices.length === 0) return
    activeNotice = pendingNotices[0]
    pendingNotices = pendingNotices.slice(1)
    notificationOutput.text = ""
    notificationProcess.command = ["bash", "-c", "notify-send -u critical -A open=Open \"$1\" \"$2\"", "mirai-notification", activeNotice.title, activeNotice.body]
    notificationProcess.running = true
    notificationStall.restart()
  }

  function runNoticeCommand(notice) {
    if (!notice || !notice.command) return
    if (bar) bar.run(notice.command.join(" "))
    else Quickshell.execDetached(notice.command)
  }

  function applyPoll() {
    try {
      const next = JSON.parse(pollOutput.text)
      if (next.settings?.fleet?.tempHotC !== undefined) limits = next.settings.fleet
      snapshot = next
      const result = Fleet.notifications(lastSeenId < 0 ? null : lastSeenId, next.events)
      lastSeenId = result.lastSeenId === null || result.lastSeenId === undefined ? lastSeenId : result.lastSeenId
      pendingNotices = pendingNotices.concat(result.notify)
      startNotification()
    } catch (error) {
      resetView()
    }
  }

  function poll() {
    if (!hubUrl || pollProcess.running) return
    pollOutput.text = ""
    pollProcess.running = true
    pollStall.restart()
  }

  function metricText(cell) {
    return cell === null ? "--" : `${Math.round(cell.value)}${cell.tone === "ok" ? "" : "!"}`
  }

  function metricColor(cell) {
    return cell === null ? (bar ? bar.foreground : "#888888") : cell.tone === "bad" ? "#ff5a4e" : bar ? bar.foreground : "#fefefe"
  }

  function machineColor(value) {
    return typeof value === "string" && value.charAt(0) === "#" ? value : "#ac637f"
  }

  Timer {
    interval: 10000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.poll()
  }

  Timer {
    id: pollStall
    interval: 6000
    repeat: false
    onTriggered: if (pollProcess.running) { root.resetView(); pollProcess.running = false; }
  }

  Process {
    id: pollProcess
    running: false
    command: ["bash", "-c", "set -e; hub=$1; fleet=$(curl --fail --silent --show-error --max-time 5 \"$hub/api/fleet\"); events=$(curl --fail --silent --show-error --max-time 5 \"$hub/api/events\"); badge=$(curl --fail --silent --show-error --max-time 5 \"$hub/api/ship/badge\"); settings=$(curl --fail --silent --show-error --max-time 5 \"$hub/api/settings\" 2>/dev/null || printf '{}'); printf '{\\\"fleet\\\":%s,\\\"events\\\":%s,\\\"badge\\\":%s,\\\"settings\\\":%s}' \"$fleet\" \"$events\" \"$badge\" \"$settings\"", "mirai-fleet", root.hubUrl]
    stdout: StdioCollector { id: pollOutput; waitForEnd: true }
    onExited: {
      pollStall.stop()
      if (exitCode === 0) root.applyPoll()
      else root.resetView()
    }
  }

  Timer {
    id: notificationStall
    interval: 6000
    repeat: false
    onTriggered: {
      if (!notificationProcess.running) return
      notificationProcess.running = false
      notificationOutput.text = ""
      root.activeNotice = null
      root.startNotification()
    }
  }

  Process {
    id: notificationProcess
    running: false
    stdout: StdioCollector { id: notificationOutput; waitForEnd: true }
    onExited: {
      notificationStall.stop()
      const notice = root.activeNotice
      root.activeNotice = null
      if (exitCode === 0 && notificationOutput.text.trim() === "open") root.runNoticeCommand(notice)
      notificationOutput.text = ""
      root.startNotification()
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
    color: root.model.dot === "bad" ? "#ff5a4e" : root.model.dot === "warn" ? "#f4b63f" : root.model.dot === "unreachable" ? "#777777" : "#5fd08a"
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
    onEntered: root.hovering = true
    onExited: root.hovering = false
    onClicked: if (root.bar) root.bar.run("mirai-desktop-open /machines")
  }

  PopupCard {
    id: popup
    anchorItem: root
    bar: root.bar
    owner: root
    triggerMode: "hover"
    open: root.hovering
    contentWidth: popup.fittedContentWidth(Style.space(400))
    contentHeight: popup.fittedContentHeight(contents.implicitHeight, Style.space(520))

    Column {
      id: contents
      anchors.fill: parent
      spacing: 8

      Item {
        width: parent.width
        implicitHeight: Math.max(title.implicitHeight, waiting.implicitHeight)

        Text {
          id: title
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          text: root.model.unreachable ? "Mirai: hub unreachable" : `fleet ${root.model.label}`
          color: root.bar ? root.bar.foreground : "#fefefe"
          font.family: root.bar ? root.bar.fontFamily : "monospace"
          font.pixelSize: 12
        }

        Text {
          id: waiting
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: root.model.unreachable ? "" : `${root.snapshot.badge?.waiting ?? 0} PRs waiting`
          color: "#888888"
          font.family: root.bar ? root.bar.fontFamily : "monospace"
          font.pixelSize: 11
        }
      }

      Column {
        visible: !root.model.unreachable
        width: parent.width
        spacing: 2

        Row {
          width: parent.width
          Text { width: 132; text: "machine"; color: "#888888"; font.pixelSize: 11 }
          Text { width: 48; text: "cpu"; color: "#888888"; font.pixelSize: 11; horizontalAlignment: Text.AlignRight }
          Text { width: 48; text: "mem"; color: "#888888"; font.pixelSize: 11; horizontalAlignment: Text.AlignRight }
          Text { width: 48; text: "temp"; color: "#888888"; font.pixelSize: 11; horizontalAlignment: Text.AlignRight }
          Text { width: 48; text: "disk"; color: "#888888"; font.pixelSize: 11; horizontalAlignment: Text.AlignRight }
        }

        Repeater {
          model: root.model.rows
          delegate: Row {
            required property var modelData
            width: parent.width
            height: 20
            Text { width: 132; text: `■ ${modelData.machine}`; color: root.machineColor(modelData.color); font.pixelSize: 11 }
            Text { width: 48; text: root.metricText(modelData.cpu); color: root.metricColor(modelData.cpu); font.pixelSize: 11; horizontalAlignment: Text.AlignRight }
            Text { width: 48; text: root.metricText(modelData.mem); color: root.metricColor(modelData.mem); font.pixelSize: 11; horizontalAlignment: Text.AlignRight }
            Text { width: 48; text: root.metricText(modelData.temp); color: root.metricColor(modelData.temp); font.pixelSize: 11; horizontalAlignment: Text.AlignRight }
            Text { width: 48; text: root.metricText(modelData.disk); color: root.metricColor(modelData.disk); font.pixelSize: 11; horizontalAlignment: Text.AlignRight }
          }
        }
      }

      Column {
        visible: !root.model.unreachable && root.model.events.length > 0
        width: parent.width
        spacing: 3
        Text { text: "events"; color: "#888888"; font.pixelSize: 11 }
        Repeater {
          model: root.model.events
          delegate: Text {
            required property var modelData
            width: parent.width
            text: `${modelData.machine}: ${modelData.message}`
            color: modelData.severity === "bad" ? "#ff5a4e" : modelData.severity === "warn" ? "#f4b63f" : "#888888"
            font.pixelSize: 11
            elide: Text.ElideRight
          }
        }
      }
    }
  }
}
