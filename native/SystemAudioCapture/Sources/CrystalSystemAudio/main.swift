import Foundation
import CoreMedia
import ScreenCaptureKit
import AudioToolbox

// MARK: - Errors

struct CaptureError: Error, LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

// MARK: - Capture state

/// Captures the system audio output (everything except the Crystal app) via
/// ScreenCaptureKit and writes raw interleaved Float32 PCM to stdout.
///
/// Protocol on stdout:
///   - one JSON control line first: `{"event":"start","sampleRate":48000,"channels":2}`
///     or `{"event":"error","message":"..."}`
///   - then raw bytes, little-endian interleaved Float32, `channels` per frame.
final class Capturer: NSObject, SCStreamDelegate, SCStreamOutput {
    private var stream: SCStream?
    private let excluded: Set<String>
    private let sampleRate: Int
    private let channels: Int
    private let appName: String
    private let output = FileHandle.standardOutput

    init(excluded: Set<String>, sampleRate: Int, channels: Int, appName: String) {
        self.excluded = excluded
        self.sampleRate = sampleRate
        self.channels = channels
        self.appName = appName
        super.init()
    }

    func start() async throws {
        // Attempting the actual capture triggers the Screen Recording prompt the
        // first time (attributed to the responsible process, i.e. the app that
        // spawned this helper), and throws -3801 if the user declines.
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
        } catch {
            let ns = error as NSError
            if ns.domain == SCStreamErrorDomain as String && ns.code == -3801 {
                throw CaptureError(
                    "\(appName) needs Screen Recording permission. Enable it in " +
                    "System Settings → Privacy & Security → Screen Recording, then try again."
                )
            }
            throw CaptureError("Failed to access system audio: \(error.localizedDescription)")
        }
        guard let display = content.displays.first else {
            throw CaptureError("No display available to capture system audio.")
        }

        // Exclude the Crystal/Electron app from the captured content. This keeps
        // its audio (remote participants, ringers, etc.) out of the shared stream.
        var excludedApps: [SCRunningApplication] = []
        for app in content.applications {
            if excluded.contains(app.bundleIdentifier) || excluded.contains(app.applicationName) {
                excludedApps.append(app)
            }
        }
        let filter = SCContentFilter(
            display: display,
            excludingApplications: excludedApps,
            exceptingWindows: []
        )

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = sampleRate
        config.channelCount = channels
        // Belt and suspenders: the helper itself never produces audio.
        config.excludesCurrentProcessAudio = true
        config.queueDepth = 8

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        self.stream = stream
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInteractive))
        try await stream.startCapture()

        emit(["event": "start", "sampleRate": sampleRate, "channels": channels])
    }

    func stop() async {
        try? await stream?.stopCapture()
        stream = nil
    }

    // MARK: SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emit(["event": "error", "message": error.localizedDescription])
        try? output.synchronize()
    }

    // MARK: SCStreamOutput

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .audio else { return }
        guard let data = Self.audioData(from: sampleBuffer) else { return }
        autoreleasepool {
            do {
                try output.write(contentsOf: data)
            } catch {
                // EPIPE: Electron closed the pipe; stop capture.
                Task { await self.stop() }
            }
        }
    }

    // MARK: PCM extraction

    private static func audioData(from sampleBuffer: CMSampleBuffer) -> Data? {
        var bufferListSize = 0
        var status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &bufferListSize,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            blockBufferOut: nil
        )
        guard status == noErr else { return nil }

        // Reserve room for up to 8 audio buffers; the struct is variable-length.
        let bufferList = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer<AudioBufferList>.allocate(capacity: 8)
        )
        defer { bufferList.unsafeMutablePointer.deallocate() }
        var blockBuffer: CMBlockBuffer?
        status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: bufferList.unsafeMutablePointer,
            bufferListSize: bufferListSize,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard status == noErr else { return nil }

        let numBuffers = Int(bufferList.unsafeMutablePointer.pointee.mNumberBuffers)
        guard numBuffers > 0 else { return nil }

        if numBuffers == 1, let mData = bufferList[0].mData {
            // Already interleaved.
            let byteCount = Int(bufferList[0].mDataByteSize)
            guard byteCount > 0 else { return nil }
            return Data(bytes: mData, count: byteCount)
        }

        // Non-interleaved (one AudioBuffer per channel) → interleave to Float32.
        let frameCount = Int(CMSampleBufferGetNumSamples(sampleBuffer))
        guard frameCount > 0, frameCount < 1_000_000 else { return nil }

        var out = Data(capacity: frameCount * numBuffers * 4)
        for frame in 0..<frameCount {
            for channel in 0..<numBuffers {
                let buf = bufferList[channel]
                guard let mData = buf.mData else {
                    var zero: Float = 0
                    out.append(Data(bytes: &zero, count: 4))
                    continue
                }
                let ptr = mData
                    .advanced(by: frame * MemoryLayout<Float>.size)
                    .assumingMemoryBound(to: Float.self)
                var sample = ptr.pointee
                out.append(Data(bytes: &sample, count: 4))
            }
        }
        return out
    }

    // MARK: Control line

    private func emit(_ dict: [String: Any]) {
        guard
            let json = try? JSONSerialization.data(withJSONObject: dict),
            var line = String(data: json, encoding: .utf8)
        else { return }
        line += "\n"
        try? output.write(contentsOf: Data(line.utf8))
    }
}

// MARK: - Entry point

let args = ProcessInfo.processInfo.arguments
var excluded = Set<String>()
var rate = 48000
var channels = 2
var appName = "Crystal"

var i = 1
while i < args.count {
    switch args[i] {
    case "--exclude":
        if i + 1 < args.count {
            excluded = Set(args[i + 1].split(separator: ",").map(String.init))
            i += 1
        }
    case "--rate":
        if i + 1 < args.count, let v = Int(args[i + 1]) { rate = v; i += 1 }
    case "--channels":
        if i + 1 < args.count, let v = Int(args[i + 1]) { channels = v; i += 1 }
    case "--app-name":
        if i + 1 < args.count { appName = args[i + 1]; i += 1 }
    default:
        break
    }
    i += 1
}

if excluded.isEmpty {
    excluded.insert("com.github.Electron")
    excluded.insert("Electron")
}

let capturer = Capturer(excluded: excluded, sampleRate: rate, channels: channels, appName: appName)

// Signal handling so Electron can stop us cleanly with SIGTERM.
let sigTermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
sigTermSource.setEventHandler {
    Task {
        await capturer.stop()
        exit(0)
    }
}
sigTermSource.resume()

Task {
    do {
        try await capturer.start()
    } catch {
        let message = error.localizedDescription
        if let json = try? JSONSerialization.data(withJSONObject: ["event": "error", "message": message]),
           var line = String(data: json, encoding: .utf8) {
            line += "\n"
            try? FileHandle.standardOutput.write(contentsOf: Data(line.utf8))
        }
        exit(1)
    }
}

RunLoop.main.run()
