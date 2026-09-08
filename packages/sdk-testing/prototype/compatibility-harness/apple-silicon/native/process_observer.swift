import AppKit
import CoreGraphics
import Darwin
import Foundation

guard CommandLine.arguments.count == 2,
      let pid = pid_t(CommandLine.arguments[1]) else {
    exit(2)
}

let startedAt = Date().timeIntervalSince1970
var samples = 0
var activeSamples = 0
var frontmostSamples = 0
var unavailableSamples = 0
var onscreenWindowSamples = 0
var maxOnscreenWindowArea = 0.0
var frontmostTransitions: [[String: Any]] = []
var processTransitions: [[String: Any]] = []
var windowTransitions: [[String: Any]] = []
var priorFrontmost = ""
var priorProcess = ""
var priorWindowState = ""

func visibleWindows(_ pid: pid_t) -> [[String: Any]] {
    let options: CGWindowListOption = [.optionAll, .excludeDesktopElements]
    guard let entries = CGWindowListCopyWindowInfo(options, kCGNullWindowID)
        as? [[String: Any]] else {
        return []
    }
    return entries.compactMap { entry in
        guard (entry[kCGWindowOwnerPID as String] as? pid_t) == pid,
              (entry[kCGWindowLayer as String] as? Int ?? 1) == 0,
              (entry[kCGWindowIsOnscreen as String] as? Int ?? 0) == 1 else {
            return nil
        }
        return [
            "number": entry[kCGWindowNumber as String] ?? NSNull(),
            "alpha": entry[kCGWindowAlpha as String] ?? NSNull(),
            "bounds": entry[kCGWindowBounds as String] ?? NSNull(),
        ]
    }
}

func processExists(_ pid: pid_t) -> Bool {
    if kill(pid, 0) == 0 {
        return true
    }
    return errno == EPERM
}

while processExists(pid) {
    autoreleasepool {
        let now = Date().timeIntervalSince1970
        let frontmost = NSWorkspace.shared.frontmostApplication
        let frontmostIdentity = "\(frontmost?.processIdentifier ?? 0)|\(frontmost?.bundleIdentifier ?? "")"
        if frontmostIdentity != priorFrontmost {
            frontmostTransitions.append([
                "time": now,
                "pid": frontmost?.processIdentifier ?? 0,
                "bundleIdentifier": frontmost?.bundleIdentifier ?? "",
                "localizedName": frontmost?.localizedName ?? "",
            ])
            priorFrontmost = frontmostIdentity
        }
        let windows = visibleWindows(pid)
        if !windows.isEmpty {
            onscreenWindowSamples += 1
        }
        for window in windows {
            if let bounds = window["bounds"] as? [String: Any],
               let width = bounds["Width"] as? Double,
               let height = bounds["Height"] as? Double {
                maxOnscreenWindowArea = max(maxOnscreenWindowArea, width * height)
            }
        }
        let windowState = String(describing: windows)
        if windowState != priorWindowState {
            windowTransitions.append([
                "time": now,
                "windows": windows,
            ])
            priorWindowState = windowState
        }
        if let target = NSRunningApplication(processIdentifier: pid), !target.isTerminated {
            let processIdentity = "available|\(target.isActive)|\(target.isHidden)|\(target.isFinishedLaunching)"
            if processIdentity != priorProcess {
                processTransitions.append([
                    "time": now,
                    "available": true,
                    "active": target.isActive,
                    "hidden": target.isHidden,
                    "finishedLaunching": target.isFinishedLaunching,
                ])
                priorProcess = processIdentity
            }
            if target.isActive { activeSamples += 1 }
        } else {
            unavailableSamples += 1
            if priorProcess != "unavailable" {
                processTransitions.append([
                    "time": now,
                    "available": false,
                ])
                priorProcess = "unavailable"
            }
        }
        samples += 1
        if frontmost?.processIdentifier == pid { frontmostSamples += 1 }
    }
    Thread.sleep(forTimeInterval: 0.025)
}

let result: [String: Any] = [
    "startedAt": startedAt,
    "completedAt": Date().timeIntervalSince1970,
    "samples": samples,
    "activeSamples": activeSamples,
    "unavailableSamples": unavailableSamples,
    "onscreenWindowSamples": onscreenWindowSamples,
    "maxOnscreenWindowArea": maxOnscreenWindowArea,
    "targetFrontmostSamples": frontmostSamples,
    "frontmostTransitions": frontmostTransitions,
    "processTransitions": processTransitions,
    "windowTransitions": windowTransitions,
    "terminated": true,
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
