import SwiftUI

struct ContentView: View {
    @ObservedObject var model: WatchViewModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var showConnection = false

    var body: some View {
        NavigationStack {
            Group {
                if model.connectionReady { dashboard }
                else { welcome }
            }
            .navigationTitle("OpenGym")
            .toolbarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: $showConnection) { PairingConnectionView(model: model) }

        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await model.refresh()
        }
        // Poll progress only during an operation while the screen is active.
        // A view task alone need not stop when the wrist is lowered.
        .task(id: scenePhase == .active && model.busy) {
            guard scenePhase == .active && model.busy else { return }
            while !Task.isCancelled && model.busy {
                do { try await Task.sleep(for: .seconds(1)) } catch { break }
                guard !Task.isCancelled else { break }
                await model.refresh()
            }
        }
    }

    private var welcome: some View {
        ScrollView {
            VStack(spacing: 8) {
                Image(systemName: "heart.text.clipboard")
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(.green)
                    .frame(width: 42, height: 42)
                    .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                    .accessibilityHidden(true)
                VStack(spacing: 5) {
                    Text("训练与恢复")
                        .font(.headline)
                    Text("同步训练心率、睡眠与恢复")
                        .font(.caption2).foregroundStyle(.secondary)
                }.multilineTextAlignment(.center)
                Button { showConnection = true } label: {
                    Label("连接 OpenGym", systemImage: "qrcode.viewfinder")
                        .font(.footnote.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.green)
                .disabled(model.busy)
                .accessibilityIdentifier("connectOpenGym")
                if let error = model.error {
                    Text(error).font(.caption2).foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }
            }.frame(maxWidth: .infinity).padding(.horizontal, 6).padding(.vertical, 2)
        }
    }

    private var dashboard: some View {
        List {
            Section {
                Button { model.sync() } label: {
                    VStack(spacing: 6) {
                        if model.busy { ProgressView().accessibilityLabel("正在处理") }
                        else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                        Text(model.busy ? (model.snapshot.phase ?? "处理中…") : "立即同步")
                            .font(.headline).multilineTextAlignment(.center)
                    }.frame(maxWidth: .infinity).padding(.vertical, 8)
                }
                .listItemTint(Color.green.opacity(0.25)).disabled(model.busy)
                .accessibilityIdentifier("syncNow")
            } footer: {
                if let at = model.snapshot.state?.lastSuccess {
                    RelativeCheckTime(title: "上次同步", date: at)
                }
                Text("手动同步训练心率、睡眠、静息心率与 HRV。")
            }
            if let error = model.error ?? model.snapshot.state?.error {
                Text(error).font(.caption2).foregroundStyle(.orange)
                    .listRowBackground(Color.clear)
            }
            NavigationLink { DiagnosticsView(model: model) } label: {
                Label("本机数据概况", systemImage: "heart.text.clipboard")
            }
            NavigationLink { SyncDetailsView(model: model) } label: {
                Label("同步详情", systemImage: "clock.arrow.circlepath")
            }
            NavigationLink { ConnectionSettingsView(model: model) } label: {
                Label("连接设置", systemImage: "gearshape")
            }
        }
    }
}

private struct RelativeCheckTime: View {
    let title: String
    let date: Date
    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Text("\(title) · \(WatchRelativeTime.text(for: date, now: context.date))")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }
}

private struct DiagnosticsView: View {
    @ObservedObject var model: WatchViewModel
    var body: some View {
        List {
            if let at = model.snapshot.state?.inspectedAt {
                RelativeCheckTime(title: "最新检查时间", date: at).listRowBackground(Color.clear)
            }
            ForEach(model.snapshot.state?.summaries ?? []) { summary in
                VStack(alignment: .leading, spacing: 4) {
                    Label(summary.metric.title, systemImage: summary.metric.symbol).font(.headline)
                    Text("\(summary.count)\(summary.truncated ? "+" : "") 条可读样本")
                        .font(.footnote).monospacedDigit()
                    if let at = summary.latest {
                        RelativeCheckTime(title: "最近一条", date: at)
                    }
                }.accessibilityElement(children: .combine)
            }
            Section {
                Button { model.inspect() } label: {
                    HStack {
                        if model.busy { ProgressView() }
                        Text(model.busy ? "正在检查…" : "重新检查")
                    }.frame(maxWidth: .infinity)
                }.disabled(model.busy)
            } footer: {
                Text("最近 7 天。没有样本时，请检查健康读取权限。")
                Text("训练心率会匹配服务器上尚无心率的训练记录。空结果也可能代表未授予读取权限。")
                if let earliest = model.snapshot.state?.earliest {
                    Text("手表可读取 \(earliest.formatted(date: .abbreviated, time: .omitted)) 之后的数据；更早历史请用 iPhone 补传。")
                }
            }
        }
        .navigationTitle("本机数据")
        .task { model.inspect() }
    }
}

private struct SyncDetailsView: View {
    @ObservedObject var model: WatchViewModel
    var body: some View {
        List {
            if let at = model.snapshot.state?.lastSuccess {
                RelativeCheckTime(title: "上次同步", date: at).listRowBackground(Color.clear)
            }
            if let uploaded = model.snapshot.state?.uploaded, !uploaded.isEmpty {
                Section("本次已确认上传") {
                    ForEach(WatchMetric.uploads, id: \.self) { metric in
                        HStack {
                            Text(metric.title)
                            Spacer()
                            Text("\(uploaded[metric.rawValue, default: 0]) 条").monospacedDigit()
                        }.font(.footnote)
                    }
                }
            } else {
                Text("同步完成后可在这里查看上传结果。")
                    .font(.caption2).foregroundStyle(.secondary).listRowBackground(Color.clear)
            }
            if let stored = model.snapshot.state?.storedWorkouts {
                Section("训练心率") {
                    LabeledContent("已保存", value: "\(stored) 次")
                    LabeledContent("本次跳过", value: "\(model.snapshot.state?.skippedWorkouts ?? 0) 次")
                }
                Text("仅补传缺失心率的训练，已有心率不会覆盖。同日多条 OpenGym 训练需手动关联；未读到 Apple 训练或心率时，下次手动同步会再检查。")
                    .font(.caption2).foregroundStyle(.secondary).listRowBackground(Color.clear)
            }
            if model.snapshot.pendingCount > 0 {
                Text("有数据等待上传，下次同步时会重试。")
                    .font(.caption2).foregroundStyle(.secondary).listRowBackground(Color.clear)
            }
        }.navigationTitle("同步详情")
    }
}

private struct ConnectionSettingsView: View {
    @ObservedObject var model: WatchViewModel
    @State private var confirming = false
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            Section("服务器") { Text(model.snapshot.server ?? "未连接").font(.footnote) }
            Section("账户") { Text(model.snapshot.owner ?? "—").font(.caption2).privacySensitive() }
            Section {
                Button("解除连接", role: .destructive) { confirming = true }
            } footer: {
                Label("解除后需重新扫码连接。已上传的数据会保留。", systemImage: "info.circle")
                    .font(.caption2)
            }
        }
        .navigationTitle("连接设置")
        .alert("解除连接？", isPresented: $confirming) {
            Button("取消", role: .cancel) { }
            Button("解除连接", role: .destructive) { model.disconnect(); dismiss() }
        } message: { Text("手表上尚未上传的数据将被清除，服务器上的数据会保留。") }
    }
}
