import Foundation

struct ParseResponse: Decodable {
    let success: Bool
    let error: String?
    let platform: String?
    let awemeId: String?
    let videoId: String?
    let title: String?
    let author: String?
    let cover: String?
    let dynamicCover: String?
    let duration: Int?
    let width: Int?
    let height: Int?
    let videoUrls: [String: [String]]?
}

struct VideoURLGroup: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let urls: [String]

    var isPrimary: Bool {
        name.contains("无水印")
    }
}

struct ParsedVideo: Identifiable {
    let id = UUID()
    let platform: String
    let sourceId: String
    let title: String
    let author: String
    let cover: URL?
    let duration: Int
    let width: Int
    let height: Int
    let groups: [VideoURLGroup]

    init(response: ParseResponse) {
        platform = response.platform ?? "unknown"
        sourceId = response.videoId ?? response.awemeId ?? ""
        title = response.title?.isEmpty == false ? response.title! : "未命名视频"
        author = response.author ?? ""
        cover = response.cover.flatMap(URL.init(string:))
        duration = response.duration ?? 0
        width = response.width ?? 0
        height = response.height ?? 0
        groups = (response.videoUrls ?? [:])
            .map { VideoURLGroup(name: $0.key, urls: $0.value) }
            .sorted { lhs, rhs in
                if lhs.isPrimary != rhs.isPrimary { return lhs.isPrimary }
                return lhs.name < rhs.name
            }
    }

    var platformName: String {
        platform == "douyin" ? "抖音" : platform == "jimeng" ? "即梦" : platform
    }

    var sizeText: String? {
        guard width > 0, height > 0 else { return nil }
        return "\(width)x\(height)"
    }

    var durationText: String? {
        guard duration > 0 else { return nil }
        let seconds = max(1, Int(round(Double(duration) / 1000.0)))
        return "\(seconds)s"
    }
}

struct ParserError: LocalizedError {
    let message: String

    var errorDescription: String? {
        message
    }
}
