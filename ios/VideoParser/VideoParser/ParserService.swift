import Foundation
import Photos
import SwiftUI
import UIKit

@MainActor
final class ParserViewModel: ObservableObject {
    @Published var input = ""
    @Published var apiBaseURL: String {
        didSet {
            UserDefaults.standard.set(apiBaseURL, forKey: Self.apiBaseKey)
        }
    }
    @Published var isParsing = false
    @Published var loadingStep = 0
    @Published var result: ParsedVideo?
    @Published var errorMessage: String?
    @Published var copiedURL: String?
    @Published var downloadedFileURL: URL?
    @Published var savedMessage: String?
    @Published var downloadStatuses: [String: DownloadStatus] = [:]

    private var loadingTask: Task<Void, Never>?
    private var downloadTasks: [String: Task<Void, Never>] = [:]
    private static let apiBaseKey = "apiBaseURL"

    init() {
        apiBaseURL = UserDefaults.standard.string(forKey: Self.apiBaseKey) ?? "http://127.0.0.1:3399"
    }

    var canParse: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isParsing
    }

    func parse() {
        guard canParse else { return }
        result = nil
        errorMessage = nil
        isParsing = true
        loadingStep = 0

        loadingTask?.cancel()
        loadingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(900))
                await MainActor.run {
                    guard let self, self.isParsing else { return }
                    withAnimation(.spring(response: 0.45, dampingFraction: 0.82)) {
                        self.loadingStep = min(self.loadingStep + 1, LoadingIndicator.steps.count - 1)
                    }
                }
            }
        }

        Task {
            do {
                let response = try await ParserService.parse(input: input, apiBaseURL: apiBaseURL)
                withAnimation(.spring(response: 0.55, dampingFraction: 0.86)) {
                    result = ParsedVideo(response: response)
                    isParsing = false
                }
            } catch {
                withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                    errorMessage = error.localizedDescription
                    isParsing = false
                }
            }
            loadingTask?.cancel()
            loadingTask = nil
        }
    }

    func clear() {
        withAnimation(.spring(response: 0.45, dampingFraction: 0.88)) {
            input = ""
            result = nil
            errorMessage = nil
            copiedURL = nil
            downloadedFileURL = nil
            savedMessage = nil
            downloadTasks.values.forEach { $0.cancel() }
            downloadTasks.removeAll()
            downloadStatuses = [:]
        }
    }

    func copy(_ url: String) {
        UIPasteboard.general.string = url
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            copiedURL = url
        }

        Task {
            try? await Task.sleep(for: .seconds(1.4))
            await MainActor.run {
                withAnimation(.easeOut(duration: 0.2)) {
                    if copiedURL == url {
                        copiedURL = nil
                    }
                }
            }
        }
    }

    func download(_ url: String) {
        guard downloadTasks[url] == nil else { return }
        errorMessage = nil
        downloadedFileURL = nil
        savedMessage = nil
        setDownloadStatus(.downloading(url: url, bytesReceived: 0, totalBytes: nil))

        let task = Task { [weak self] in
            guard let self else { return }
            do {
                let fileURL = try await ParserService.downloadVideo(from: url) { [weak self] bytesReceived, totalBytes in
                    Task { @MainActor in
                        self?.setDownloadStatus(.downloading(
                            url: url,
                            bytesReceived: bytesReceived,
                            totalBytes: totalBytes
                        ))
                    }
                }
                try Task.checkCancellation()
                self.setDownloadStatus(.saving(url: url))
                try await ParserService.saveVideoToPhotoLibrary(fileURL)
                withAnimation(.spring(response: 0.38, dampingFraction: 0.82)) {
                    self.downloadedFileURL = fileURL
                    self.savedMessage = "视频已保存到系统相册"
                    self.removeDownloadStatus(for: url)
                }
                self.downloadTasks[url] = nil
            } catch is CancellationError {
                self.removeDownloadStatus(for: url)
                self.downloadTasks[url] = nil
            } catch {
                withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                    self.errorMessage = "下载失败：\(error.localizedDescription)"
                    self.removeDownloadStatus(for: url)
                }
                self.downloadTasks[url] = nil
            }
        }
        downloadTasks[url] = task
    }

    func cancelDownload(_ url: String) {
        downloadTasks[url]?.cancel()
        downloadTasks[url] = nil
        removeDownloadStatus(for: url)
    }

    private func setDownloadStatus(_ status: DownloadStatus) {
        var statuses = downloadStatuses
        statuses[status.url] = status
        downloadStatuses = statuses
    }

    private func removeDownloadStatus(for url: String) {
        var statuses = downloadStatuses
        statuses.removeValue(forKey: url)
        downloadStatuses = statuses
    }
}

struct DownloadStatus {
    let url: String
    let phase: DownloadPhase
    let bytesReceived: Int64
    let totalBytes: Int64?

    static func downloading(url: String, bytesReceived: Int64, totalBytes: Int64?) -> DownloadStatus {
        DownloadStatus(url: url, phase: .downloading, bytesReceived: bytesReceived, totalBytes: totalBytes)
    }

    static func saving(url: String) -> DownloadStatus {
        DownloadStatus(url: url, phase: .saving, bytesReceived: 0, totalBytes: nil)
    }

    var progress: Double? {
        guard phase == .downloading else { return nil }
        guard let totalBytes, totalBytes > 0 else { return nil }
        return min(1, Double(bytesReceived) / Double(totalBytes))
    }

    var detailText: String {
        if phase == .saving {
            return "正在写入系统相册"
        }

        let received = Self.formatBytes(bytesReceived)
        guard let totalBytes, totalBytes > 0 else {
            return "\(received) 已下载"
        }
        return "\(received) / \(Self.formatBytes(totalBytes))"
    }

    var percentText: String? {
        guard phase == .downloading else { return nil }
        guard let progress else { return nil }
        return "\(Int((progress * 100).rounded()))%"
    }

    private static func formatBytes(_ bytes: Int64) -> String {
        let value = Double(bytes)
        if value >= 1024 * 1024 {
            return String(format: "%.1f MB", value / 1024 / 1024)
        }
        if value >= 1024 {
            return String(format: "%.0f KB", value / 1024)
        }
        return "\(bytes) B"
    }
}

enum DownloadPhase {
    case downloading
    case saving
}

enum ParserService {
    static func parse(input: String, apiBaseURL: String) async throws -> ParseResponse {
        let cleanBase = apiBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let url = URL(string: "\(cleanBase)/api/parse") else {
            throw ParserError(message: "服务地址无效")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 35
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["url": input])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ParserError(message: "服务请求失败")
        }

        let decoded = try JSONDecoder().decode(ParseResponse.self, from: data)
        guard decoded.success else {
            throw ParserError(message: decoded.error ?? "解析失败")
        }
        return decoded
    }

    static func downloadVideo(
        from urlString: String,
        progress: @escaping @Sendable (Int64, Int64?) -> Void
    ) async throws -> URL {
        guard let url = URL(string: urlString) else {
            throw ParserError(message: "下载地址无效")
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 120
        request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", forHTTPHeaderField: "User-Agent")
        request.setValue("https://jimeng.jianying.com/", forHTTPHeaderField: "Referer")

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ParserError(message: "CDN 下载请求失败")
        }

        let fileName = "video-\(Int(Date().timeIntervalSince1970)).mp4"
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }

        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let fileHandle = try FileHandle(forWritingTo: destination)
        defer {
            try? fileHandle.close()
        }

        let totalBytes = http.expectedContentLength > 0 ? http.expectedContentLength : nil
        var bytesReceived: Int64 = 0
        var buffer = [UInt8]()
        buffer.reserveCapacity(64 * 1024)
        progress(0, totalBytes)

        do {
            for try await byte in bytes {
                try Task.checkCancellation()
                buffer.append(byte)
                bytesReceived += 1

                if buffer.count >= 64 * 1024 {
                    try fileHandle.write(contentsOf: Data(buffer))
                    buffer.removeAll(keepingCapacity: true)
                    progress(bytesReceived, totalBytes)
                }
            }

            if !buffer.isEmpty {
                try fileHandle.write(contentsOf: Data(buffer))
            }
        } catch {
            try? fileHandle.close()
            try? FileManager.default.removeItem(at: destination)
            throw error
        }

        progress(bytesReceived, totalBytes)

        guard bytesReceived > 0 else {
            throw ParserError(message: "CDN 没有返回视频数据")
        }
        return destination
    }

    static func saveVideoToPhotoLibrary(_ fileURL: URL) async throws {
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        let authorizationStatus: PHAuthorizationStatus
        if status == .notDetermined {
            authorizationStatus = await requestPhotoLibraryAuthorization()
        } else {
            authorizationStatus = status
        }

        guard authorizationStatus == .authorized || authorizationStatus == .limited else {
            throw ParserError(message: "没有相册写入权限")
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
            } completionHandler: { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: ParserError(message: "保存到相册失败"))
                }
            }
        }
    }

    private static func requestPhotoLibraryAuthorization() async -> PHAuthorizationStatus {
        await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                continuation.resume(returning: status)
            }
        }
    }
}
