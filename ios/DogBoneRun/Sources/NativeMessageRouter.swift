import Foundation
import UIKit
import WebKit

@MainActor
final class NativeMessageRouter: NSObject, WKScriptMessageHandlerWithReply {
    private static let maximumExportBytes = 8 * 1_024 * 1_024
    private static let allowedMimeTypes: Set<String> = ["application/json", "image/png", "image/jpeg"]

    private weak var presenter: UIViewController?
    private weak var activeWebView: WKWebView?
    private var pageIsReady = false
    private var queuedEntitlementIDs: [String]?
    private let storeKit = StoreKitService()

    init(presenter: UIViewController) {
        self.presenter = presenter
        super.init()
    }

    func connect(to webView: WKWebView) {
        activeWebView = webView
        storeKit.startTransactionUpdates { [weak self] productIDs in
            self?.publishEntitlements(productIDs)
        }
    }

    func pageDidLoad(_ webView: WKWebView) {
        guard activeWebView === webView,
              let url = webView.url,
              LoopbackSiteServer.shared.isLocalSiteURL(url) else { return }
        pageIsReady = true
        if let queuedEntitlementIDs {
            self.queuedEntitlementIDs = nil
            dispatchEntitlements(queuedEntitlementIDs, to: webView)
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard isAllowed(message) else {
            replyHandler(nil, "origin_not_allowed")
            return
        }
        guard let body = message.body as? [String: Any] else {
            replyHandler(nil, "invalid_message")
            return
        }

        switch message.name {
        case "storeKit":
            Task { @MainActor in
                replyHandler(await storeKit.handle(body), nil)
            }
        case "journeyFiles":
            shareFile(body, replyHandler: replyHandler)
        default:
            replyHandler(nil, "unknown_handler")
        }
    }

    private func isAllowed(_ message: WKScriptMessage) -> Bool {
        let origin = message.frameInfo.securityOrigin
        return message.frameInfo.isMainFrame
            && origin.protocol.lowercased() == "http"
            && origin.host.lowercased() == "127.0.0.1"
            && origin.port == Int(LoopbackSiteServer.port)
    }

    private func publishEntitlements(_ productIDs: [String]) {
        guard pageIsReady,
              let webView = activeWebView,
              let url = webView.url,
              LoopbackSiteServer.shared.isLocalSiteURL(url) else {
            queuedEntitlementIDs = productIDs
            return
        }
        dispatchEntitlements(productIDs, to: webView)
    }

    private func dispatchEntitlements(_ productIDs: [String], to webView: WKWebView) {
        let detail: [String: Any] = ["productIds": productIDs]
        guard JSONSerialization.isValidJSONObject(detail),
              let json = try? JSONSerialization.data(withJSONObject: detail) else { return }
        let encoded = json.base64EncodedString()
        let script = "window.dispatchEvent(new CustomEvent('journey:entitlements',{detail:JSON.parse(atob('\(encoded)'))}));"
        webView.evaluateJavaScript(script)
    }

    private func shareFile(_ body: [String: Any], replyHandler: @escaping (Any?, String?) -> Void) {
        guard let filename = body["filename"] as? String,
              let mimeType = body["mimeType"] as? String,
              let base64 = body["base64"] as? String,
              Self.allowedMimeTypes.contains(mimeType),
              base64.utf8.count <= ((Self.maximumExportBytes + 2) / 3) * 4,
              let data = Data(base64Encoded: base64), !data.isEmpty,
              data.count <= Self.maximumExportBytes,
              let safeName = safeFilename(filename, mimeType: mimeType) else {
            replyHandler(["ok": false, "code": "invalid_export"], nil)
            return
        }

        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("JourneyExports", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let fileURL = directory.appendingPathComponent("\(UUID().uuidString)-\(safeName)")
            try data.write(to: fileURL, options: .atomic)
            presentShareSheet(fileURL: fileURL, filename: safeName, replyHandler: replyHandler)
        } catch {
            replyHandler(["ok": false, "code": "export_unavailable"], nil)
        }
    }

    private func safeFilename(_ filename: String, mimeType: String) -> String? {
        guard !filename.isEmpty, filename.count <= 120,
              !filename.contains("/"), !filename.contains("\\"), !filename.contains("..") else { return nil }
        let filtered = String(filename.filter { $0.isLetter || $0.isNumber || ".-_".contains($0) })
        guard !filtered.isEmpty else { return nil }
        let extensionName = URL(fileURLWithPath: filtered).pathExtension.lowercased()
        switch mimeType {
        case "application/json": return extensionName == "json" ? filtered : nil
        case "image/png": return extensionName == "png" ? filtered : nil
        case "image/jpeg": return ["jpg", "jpeg"].contains(extensionName) ? filtered : nil
        default: return nil
        }
    }

    private func presentShareSheet(
        fileURL: URL,
        filename: String,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let presenter, presenter.viewIfLoaded?.window != nil else {
            try? FileManager.default.removeItem(at: fileURL)
            replyHandler(["ok": false, "code": "share_ui_unavailable"], nil)
            return
        }
        let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        activity.completionWithItemsHandler = { _, completed, _, error in
            try? FileManager.default.removeItem(at: fileURL)
            if let error {
                replyHandler(["ok": false, "code": "share_failed", "message": error.localizedDescription], nil)
            } else {
                replyHandler(["ok": true, "filename": filename, "completed": completed], nil)
            }
        }
        if let popover = activity.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        presenter.present(activity, animated: true)
    }
}
