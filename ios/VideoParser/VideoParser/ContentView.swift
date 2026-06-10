import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = ParserViewModel()
    @Namespace private var namespace
    @FocusState private var inputFocused: Bool
    @State private var showSettings = false
    @State private var sharePayload: SharePayload?

    var body: some View {
        NavigationStack {
            ZStack {
                AppBackground()

                ScrollView(.vertical, showsIndicators: true) {
                    VStack(spacing: 18) {
                        HeaderView()
                            .padding(.top, 12)

                        InputCard(
                            input: $viewModel.input,
                            isFocused: $inputFocused,
                            isParsing: viewModel.isParsing,
                            canParse: viewModel.canParse,
                            parseAction: {
                                inputFocused = false
                                viewModel.parse()
                            },
                            clearAction: viewModel.clear
                        )
                        .matchedGeometryEffect(id: "input", in: namespace)

                        if !viewModel.history.isEmpty {
                            HistoryView(
                                items: viewModel.history,
                                restoreAction: viewModel.restoreHistory,
                                clearAction: viewModel.clearHistory
                            )
                            .transition(.move(edge: .top).combined(with: .opacity))
                        }

                        if viewModel.isParsing {
                            LoadingIndicator(step: viewModel.loadingStep)
                                .transition(.asymmetric(
                                    insertion: .scale(scale: 0.96).combined(with: .opacity),
                                    removal: .scale(scale: 0.98).combined(with: .opacity)
                                ))
                        }

                        if let error = viewModel.errorMessage {
                            ErrorBanner(message: error)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }

                        if !viewModel.downloadStatuses.isEmpty {
                            DownloadsPanel(
                                statuses: activeDownloadStatuses,
                                cancelAction: viewModel.cancelDownload
                            )
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }

                        if let savedMessage = viewModel.savedMessage {
                            SuccessBanner(message: savedMessage)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }

                        if let result = viewModel.result {
                            ResultView(
                                video: result,
                                copiedURL: viewModel.copiedURL,
                                downloadStatuses: viewModel.downloadStatuses,
                                copyAction: viewModel.copy,
                                downloadAction: viewModel.download,
                                cancelAction: viewModel.cancelDownload,
                                openAction: open,
                                shareAction: { url in
                                    sharePayload = SharePayload(title: "分享链接", items: [url])
                                }
                            )
                            .transition(.asymmetric(
                                insertion: .move(edge: .bottom).combined(with: .opacity),
                                removal: .opacity
                            ))
                        }

                        FooterView()
                            .padding(.top, 12)
                            .padding(.bottom, 72)
                    }
                    .padding(.horizontal, 18)
                }
                .scrollDismissesKeyboard(.interactively)
                .contentShape(Rectangle())
            }
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.black)
                            .frame(width: 38, height: 38)
                            .background(.white)
                            .clipShape(Circle())
                            .shadow(color: .black.opacity(0.08), radius: 14, x: 0, y: 8)
                    }
                    .buttonStyle(.plain)
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView(apiBaseURL: $viewModel.apiBaseURL)
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
            }
            .sheet(item: $sharePayload) { payload in
                NavigationStack {
                    ShareSheet(items: payload.items)
                        .navigationTitle(payload.title)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("关闭") {
                                    sharePayload = nil
                                }
                                .font(.system(size: 15, weight: .bold))
                            }
                        }
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
            .animation(.spring(response: 0.55, dampingFraction: 0.86), value: viewModel.isParsing)
            .animation(.spring(response: 0.55, dampingFraction: 0.86), value: viewModel.result?.id)
            .animation(.spring(response: 0.4, dampingFraction: 0.84), value: viewModel.errorMessage)
        }
    }

    private func open(_ url: String) {
        guard let target = URL(string: url) else { return }
        UIApplication.shared.open(target)
    }

    private var activeDownloadStatuses: [DownloadStatus] {
        viewModel.downloadStatuses.values.sorted { lhs, rhs in
            lhs.url < rhs.url
        }
    }
}

struct SharePayload: Identifiable {
    let id = UUID()
    let title: String
    let items: [Any]
}

struct AppBackground: View {
    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()

            LinearGradient(
                colors: [
                    Color(red: 0.98, green: 0.99, blue: 1.0),
                    Color.white,
                    Color(red: 0.96, green: 0.98, blue: 1.0)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        }
    }
}

struct HeaderView: View {
    @State private var pulse = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "sparkles")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .scaleEffect(pulse ? 1.04 : 1.0)

                Spacer()

                HStack(spacing: 8) {
                    PlatformPill(text: "抖音")
                    PlatformPill(text: "即梦")
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("视频原始链接解析")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(.black)
                    .tracking(0)

                Text("粘贴分享文案，提取无水印 CDN 播放地址。")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineSpacing(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.35).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}

struct PlatformPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.black.opacity(0.72))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.white)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(.black.opacity(0.06), lineWidth: 1))
            .shadow(color: .black.opacity(0.05), radius: 10, x: 0, y: 5)
    }
}

struct InputCard: View {
    @Binding var input: String
    var isFocused: FocusState<Bool>.Binding
    let isParsing: Bool
    let canParse: Bool
    let parseAction: () -> Void
    let clearAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("分享链接或完整文案", systemImage: "link")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if !input.isEmpty {
                    Text("\(input.count)")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
            }

            TextEditor(text: $input)
                .focused(isFocused)
                .font(.system(size: 15, weight: .regular))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 128)
                .padding(12)
                .background(Color(red: 0.975, green: 0.977, blue: 0.982))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if input.isEmpty {
                        Text("例如：https://jimeng.jianying.com/s/...\n也可以直接粘贴整段分享文字")
                            .font(.system(size: 15))
                            .foregroundStyle(.secondary.opacity(0.7))
                            .padding(.horizontal, 18)
                            .padding(.vertical, 20)
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    }
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(isFocused.wrappedValue ? .black.opacity(0.22) : .black.opacity(0.06), lineWidth: 1)
                }

            HStack(spacing: 10) {
                Button(action: parseAction) {
                    HStack(spacing: 8) {
                        if isParsing {
                            ProgressView()
                                .tint(.white)
                                .scaleEffect(0.82)
                        } else {
                            Image(systemName: "wand.and.stars")
                        }
                        Text(isParsing ? "解析中" : "开始解析")
                    }
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(canParse ? .black : .black.opacity(0.28))
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: canParse ? .black.opacity(0.16) : .clear, radius: 18, x: 0, y: 9)
                    .scaleEffect(isParsing ? 0.985 : 1)
                }
                .disabled(!canParse)
                .buttonStyle(.plain)

                Button(action: clearAction) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.black.opacity(0.7))
                        .frame(width: 52, height: 52)
                        .background(Color(red: 0.96, green: 0.965, blue: 0.972))
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(18)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.black.opacity(0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.07), radius: 26, x: 0, y: 15)
    }
}

struct LoadingIndicator: View {
    static let steps = ["提取分享链接", "跟踪短链跳转", "请求平台接口", "筛选无水印 CDN"]

    let step: Int
    @State private var sweep = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(Self.steps[min(step, Self.steps.count - 1)])
                    .font(.system(size: 15, weight: .bold))
                    .contentTransition(.numericText())
                Spacer()
                Text("\(min(step + 1, Self.steps.count))/\(Self.steps.count)")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.black.opacity(0.08))
                    Capsule()
                        .fill(.black)
                        .frame(width: proxy.size.width * CGFloat(min(step + 1, Self.steps.count)) / CGFloat(Self.steps.count))
                        .overlay(alignment: .trailing) {
                            Capsule()
                                .fill(.white.opacity(0.6))
                                .frame(width: 38)
                                .offset(x: sweep ? 28 : -28)
                                .blur(radius: 5)
                        }
                }
            }
            .frame(height: 9)

            HStack(spacing: 8) {
                ForEach(Self.steps.indices, id: \.self) { index in
                    Circle()
                        .fill(index <= step ? .black : .black.opacity(0.12))
                        .frame(width: index == step ? 10 : 7, height: index == step ? 10 : 7)
                        .scaleEffect(index == step ? 1.12 : 1)
                        .animation(.spring(response: 0.35, dampingFraction: 0.65), value: step)
                }
            }
        }
        .padding(18)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.black.opacity(0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.06), radius: 20, x: 0, y: 12)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: false)) {
                sweep = true
            }
        }
    }
}

struct HistoryView: View {
    let items: [VideoHistoryItem]
    let restoreAction: (VideoHistoryItem) -> Void
    let clearAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("最近解析", systemImage: "clock.arrow.circlepath")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.black)
                Spacer()
                Button("清空", action: clearAction)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.secondary)
                    .buttonStyle(.plain)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(items) { item in
                        Button {
                            restoreAction(item)
                        } label: {
                            HStack(spacing: 10) {
                                AsyncImage(url: URL(string: item.cover)) { phase in
                                    switch phase {
                                    case .success(let image):
                                        image.resizable().scaledToFill()
                                    default:
                                        Color.black.opacity(0.06)
                                    }
                                }
                                .frame(width: 44, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.title)
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundStyle(.black)
                                        .lineLimit(1)
                                    Text(item.platform == "douyin" ? "抖音" : "即梦")
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(.secondary)
                                }
                                .frame(width: 112, alignment: .leading)
                            }
                            .padding(10)
                            .background(Color(red: 0.975, green: 0.977, blue: 0.982))
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(16)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.black.opacity(0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.05), radius: 18, x: 0, y: 10)
    }
}

struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.red.opacity(0.88))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(Color.red.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.red.opacity(0.16), lineWidth: 1)
        }
    }
}

struct DownloadsPanel: View {
    let statuses: [DownloadStatus]
    let cancelAction: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("下载任务", systemImage: "arrow.down.circle.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.black)
                Spacer()
                Text("\(statuses.count)")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            ForEach(statuses, id: \.url) { status in
                DownloadBanner(status: status, cancelAction: { cancelAction(status.url) })
            }
        }
        .padding(14)
        .background(Color.black.opacity(0.045))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct DownloadBanner: View {
    let status: DownloadStatus
    let cancelAction: () -> Void

    var title: String {
        status.phase == .saving ? "正在保存到相册" : "正在下载视频"
    }

    var host: String {
        URL(string: status.url)?.host ?? "CDN"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 10) {
                ProgressView()
                    .tint(.black)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.black)
                    Text("\(host) · \(status.detailText)")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if let percentText = status.percentText {
                    Text(percentText)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(.black)
                }

                if status.phase == .downloading {
                    Button(action: cancelAction) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.black)
                            .frame(width: 28, height: 28)
                            .background(.white)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                }
            }

            if let progress = status.progress {
                ProgressView(value: progress)
                    .tint(.black)
            } else if status.phase == .downloading {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.black.opacity(0.08))
                        Capsule()
                            .fill(.black.opacity(0.72))
                            .frame(width: max(28, proxy.size.width * 0.22))
                    }
                }
                .frame(height: 5)
            }
        }
        .padding(12)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct SuccessBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.green)
            Text(message)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.black)
            Spacer()
        }
        .padding(16)
        .background(Color.green.opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.green.opacity(0.18), lineWidth: 1)
        }
    }
}

struct ResultView: View {
    let video: ParsedVideo
    let copiedURL: String?
    let downloadStatuses: [String: DownloadStatus]
    let copyAction: (String) -> Void
    let downloadAction: (String) -> Void
    let cancelAction: (String) -> Void
    let openAction: (String) -> Void
    let shareAction: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ResultHeader(video: video)

            ForEach(video.groups) { group in
                URLGroupView(
                    group: group,
                    copiedURL: copiedURL,
                    downloadStatuses: downloadStatuses,
                    copyAction: copyAction,
                    downloadAction: downloadAction,
                    cancelAction: cancelAction,
                    openAction: openAction,
                    shareAction: shareAction
                )
            }
        }
        .padding(18)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(.black.opacity(0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.08), radius: 30, x: 0, y: 18)
    }
}

struct ResultHeader: View {
    let video: ParsedVideo

    var body: some View {
        HStack(spacing: 14) {
            AsyncImage(url: video.cover) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    ZStack {
                        Color.black.opacity(0.05)
                        Image(systemName: "play.rectangle.fill")
                            .font(.system(size: 26))
                            .foregroundStyle(.black.opacity(0.35))
                    }
                }
            }
            .frame(width: 78, height: 78)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                Text(video.title)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.black)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    InfoChip(text: video.platformName, icon: "rectangle.stack.fill")
                    if !video.author.isEmpty {
                        InfoChip(text: "@\(video.author)", icon: "person.fill")
                    }
                }

                HStack(spacing: 6) {
                    if let size = video.sizeText {
                        InfoChip(text: size, icon: "aspectratio.fill")
                    }
                    if let duration = video.durationText {
                        InfoChip(text: duration, icon: "clock.fill")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct InfoChip: View {
    let text: String
    let icon: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .bold))
            Text(text)
                .lineLimit(1)
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(.black.opacity(0.68))
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Color.black.opacity(0.045))
        .clipShape(Capsule())
    }
}

struct URLGroupView: View {
    let group: VideoURLGroup
    let copiedURL: String?
    let downloadStatuses: [String: DownloadStatus]
    let copyAction: (String) -> Void
    let downloadAction: (String) -> Void
    let cancelAction: (String) -> Void
    let openAction: (String) -> Void
    let shareAction: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: group.isPrimary ? "checkmark.seal.fill" : "info.circle.fill")
                    .foregroundStyle(group.isPrimary ? .green : .black.opacity(0.5))
                Text(group.name)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.black)
                Spacer()
                Text("\(group.urls.count)")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            ForEach(Array(group.urls.enumerated()), id: \.offset) { _, url in
                URLRow(
                    url: url,
                    isCopied: copiedURL == url,
                    downloadStatus: downloadStatuses[url],
                    copyAction: { copyAction(url) },
                    downloadAction: { downloadAction(url) },
                    cancelAction: { cancelAction(url) },
                    openAction: { openAction(url) },
                    shareAction: { shareAction(url) }
                )
            }
        }
        .padding(14)
        .background(Color(red: 0.975, green: 0.977, blue: 0.982))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

struct URLRow: View {
    let url: String
    let isCopied: Bool
    let downloadStatus: DownloadStatus?
    let copyAction: () -> Void
    let downloadAction: () -> Void
    let cancelAction: () -> Void
    let openAction: () -> Void
    let shareAction: () -> Void

    var host: String {
        URL(string: url)?.host ?? "CDN"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "server.rack")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text(host)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.black.opacity(0.78))
                    .lineLimit(1)
                Spacer()
                if isCopied {
                    Label("已复制", systemImage: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.green)
                        .transition(.scale.combined(with: .opacity))
                }
            }

            Text(url)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(2)

            if let downloadStatus {
                HStack {
                    Text(downloadStatus.detailText)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                    Spacer()
                    if let percentText = downloadStatus.percentText {
                        Text(percentText)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(.black)
                    }
                }

                if let progress = downloadStatus.progress {
                    ProgressView(value: progress)
                        .tint(.black)
                }
            }

            HStack(spacing: 8) {
                ActionButton(title: "复制", icon: isCopied ? "checkmark" : "doc.on.doc", action: copyAction)
                if let downloadStatus, downloadStatus.phase == .downloading {
                    ActionButton(title: "取消", icon: "xmark.circle", action: cancelAction)
                } else if downloadStatus?.phase == .saving {
                    ActionButton(title: "保存中", icon: "photo", isDisabled: true, action: {})
                } else {
                    ActionButton(title: "存相册", icon: "photo.badge.plus", action: downloadAction)
                }
                ActionButton(title: "打开", icon: "safari", action: openAction)
                ActionButton(title: "分享", icon: "square.and.arrow.up", action: shareAction)
            }
        }
        .padding(12)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(isCopied ? Color.green.opacity(0.35) : Color.black.opacity(0.05), lineWidth: 1)
        }
        .scaleEffect(isCopied ? 1.012 : 1)
        .animation(.spring(response: 0.28, dampingFraction: 0.68), value: isCopied)
    }
}

struct ActionButton: View {
    let title: String
    let icon: String
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(isDisabled ? Color.secondary : Color.black)
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .background(Color.black.opacity(isDisabled ? 0.035 : 0.055))
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .disabled(isDisabled)
        .buttonStyle(.plain)
    }
}

struct SettingsView: View {
    @Binding var apiBaseURL: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("解析服务地址")
                        .font(.system(size: 22, weight: .bold))
                    Text("本地调试可用 http://127.0.0.1:3399，线上使用你的 HTTPS 域名。")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineSpacing(3)
                }

                TextField("https://your-domain.com", text: $apiBaseURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .padding(14)
                    .background(Color.black.opacity(0.045))
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                Button {
                    apiBaseURL = "http://127.0.0.1:3399"
                } label: {
                    Label("使用本地服务", systemImage: "macbook.and.iphone")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.black.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)

                Spacer()
            }
            .padding(22)
            .background(Color.white)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .font(.system(size: 15, weight: .bold))
                }
            }
        }
    }
}

struct FooterView: View {
    var body: some View {
        Text("仅用于解析你自己创作或有权使用的视频。CDN 链接有时效性，请及时保存。")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .lineSpacing(4)
            .padding(.horizontal, 20)
    }
}

#Preview {
    ContentView()
}
