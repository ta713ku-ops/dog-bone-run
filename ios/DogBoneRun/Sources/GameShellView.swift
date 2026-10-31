import SwiftUI
import UIKit
import WebKit

struct GameShellView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> GameViewController {
        GameViewController()
    }

    func updateUIViewController(_ controller: GameViewController, context: Context) {}
}

@MainActor
final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView?
    private var messageRouter: NativeMessageRouter?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 1, green: 0.976, blue: 0.941, alpha: 1)

        do {
            let startURL = try LoopbackSiteServer.shared.start()
            let controller = WKUserContentController()
            let router = NativeMessageRouter(presenter: self)
            controller.addScriptMessageHandler(router, contentWorld: .page, name: "storeKit")
            controller.addScriptMessageHandler(router, contentWorld: .page, name: "journeyFiles")

            let configuration = WKWebViewConfiguration()
            configuration.userContentController = controller
            configuration.websiteDataStore = .default()
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

            let webView = WKWebView(frame: .zero, configuration: configuration)
            webView.navigationDelegate = self
            webView.uiDelegate = self
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.allowsBackForwardNavigationGestures = false
            webView.translatesAutoresizingMaskIntoConstraints = false
            router.connect(to: webView)
            view.addSubview(webView)
            NSLayoutConstraint.activate([
                webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                webView.topAnchor.constraint(equalTo: view.topAnchor),
                webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
            self.webView = webView
            self.messageRouter = router
            webView.load(URLRequest(url: startURL, cachePolicy: .reloadIgnoringLocalCacheData))
        } catch {
            showStartupFailure(error.localizedDescription)
        }
    }

    func webView(
        _ webView: WKWebView,
        didFinish navigation: WKNavigation!
    ) {
        messageRouter?.pageDidLoad(webView)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if LoopbackSiteServer.shared.isLocalSiteURL(url) {
            decisionHandler(.allow)
            return
        }

        if navigationAction.navigationType == .linkActivated,
           url.scheme?.lowercased() == "https" {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil,
              let url = navigationAction.request.url else { return nil }
        if LoopbackSiteServer.shared.isLocalSiteURL(url) {
            webView.load(URLRequest(url: url))
        } else if url.scheme?.lowercased() == "https" {
            UIApplication.shared.open(url)
        }
        return nil
    }

    private func showStartupFailure(_ detail: String) {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = UIColor(red: 0.31, green: 0.24, blue: 0.17, alpha: 1)
        label.font = .systemFont(ofSize: 17, weight: .medium)
        label.text = "ゲームデータを読み込めませんでした。\nアプリの準備手順を確認してください。\n\n\(detail)"
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }
}
