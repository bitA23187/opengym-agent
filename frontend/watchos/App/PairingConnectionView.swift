import SwiftUI

struct PairingConnectionView: View {
    @ObservedObject var model: WatchViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var lastSession: WatchPairingSession?
    @State private var showInstructions = false

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.periodic(from: .now, by: 1)) { timeline in
                let session = model.pairing ?? lastSession
                let seconds = max(0, Int(ceil(session?.expiresAt.timeIntervalSince(timeline.date) ?? 0)))
                let success = model.pairingFeedback == "connected"
                let expired = seconds == 0 && !success
                ScrollView {
                    VStack(spacing: 6) {
                        if let session {
                            if success {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 46)).foregroundStyle(.green)
                                Text("连接成功").font(.headline)
                            } else if expired {
                                Image(systemName: "qrcode")
                                    .font(.system(size: 24)).foregroundStyle(.secondary)
                                    .accessibilityHidden(true)
                                Text("二维码已过期").font(.headline)
                                Text("生成新二维码后再扫码")
                                    .font(.caption2).foregroundStyle(.secondary)
                                Button(model.busy ? "正在生成…" : "重新生成") {
                                    model.startPairing(server: session.server)
                                }
                                .buttonStyle(.borderedProminent).tint(.green)
                                .font(.footnote.weight(.semibold)).disabled(model.busy)
                            } else {
                                let side = max(1, min(geometry.size.width - 8, geometry.size.height - 28))
                                QRModules(rows: session.qr)
                                    .frame(width: side, height: side)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                                    .accessibilityLabel("用手机相机扫描二维码")
                                Text(model.pairingFeedback == "scanned" || model.pairingFeedback == "connecting"
                                     ? "已扫码 · 请在手机绑定" : "手机扫码后绑定 · \(seconds)秒")
                                    .font(.caption2).monospacedDigit().foregroundStyle(.secondary)
                                    .lineLimit(1).minimumScaleFactor(0.85)

                            }
                        } else if model.busy {
                            ProgressView("生成二维码…")
                        } else {
                            Text(model.error ?? "无法生成二维码").font(.caption2).multilineTextAlignment(.center)
                            Button("重试") { model.startPairing(server: model.defaultServer) }
                                .buttonStyle(.borderedProminent)
                        }
                    }.frame(maxWidth: .infinity).padding(.vertical, 4)
                }

            }
        }
        .navigationTitle("扫码连接").toolbarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("连接说明", systemImage: "info.circle") { showInstructions = true }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .tint(.white)
                    .foregroundStyle(.white)
                    .symbolRenderingMode(.monochrome)
                    .accessibilityLabel("连接说明")
            }
        }
        .alert("连接说明", isPresented: $showInstructions) {
            Button("知道了", role: .cancel) { }
        } message: {
            Text("用手机相机扫描二维码，登录 OpenGym 网页后点“绑定这块手表”。保持手表上的 OpenGym 打开，连接会自动完成。")
        }
        .task {
            lastSession = model.pairing
            if model.pairing != nil { model.resumePairing() }
            else { model.startPairing(server: model.defaultServer) }
        }
        .onChange(of: model.pairing?.deviceCode) { _, _ in
            if let session = model.pairing { lastSession = session }
        }
        .task(id: model.connectionReady) {
            if model.connectionReady {
                do { try await Task.sleep(for: .seconds(1.3)); dismiss() } catch { }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, model.pairing != nil { model.resumePairing() }
            else if phase != .active { model.pausePairing() }
        }
        .onDisappear { model.pausePairing() }
        .alert("连接未完成", isPresented: Binding(get: { model.error != nil && model.pairing != nil && !(model.pairing?.expired ?? true) }, set: { if !$0 { model.error = nil } })) {
            Button("重试") { model.resumePairing() }
            Button("取消", role: .cancel) { }
        } message: { Text(model.error ?? "") }
    }
}

struct QRModules: View {
    let rows: [String]
    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.white))
            let modules = rows.count + 8
            let cell = floor(min(size.width, size.height) / CGFloat(modules))
            guard cell >= 1 else { return }
            let origin = CGPoint(x: floor((size.width - CGFloat(modules) * cell) / 2), y: floor((size.height - CGFloat(modules) * cell) / 2))
            var path = Path()
            for (y, row) in rows.enumerated() {
                for (x, value) in row.enumerated() where value == "1" {
                    path.addRect(CGRect(x: origin.x + CGFloat(x + 4) * cell, y: origin.y + CGFloat(y + 4) * cell, width: cell, height: cell))
                }
            }
            context.fill(path, with: .color(.black), style: FillStyle(antialiased: false))
        }
    }
}
