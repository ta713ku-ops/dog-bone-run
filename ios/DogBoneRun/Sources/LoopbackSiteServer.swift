import Darwin
import Dispatch
import Foundation

enum LoopbackSiteError: LocalizedError {
    case missingSiteBundle
    case socketSetup(operation: String, code: Int32)

    var errorDescription: String? {
        switch self {
        case .missingSiteBundle:
            return "Site/index.html がありません。npm run build の後に scripts/prepare-ios.mjs を実行してください。"
        case let .socketSetup(operation, code):
            return "端末内ゲームサーバーを起動できませんでした（\(operation): \(String(cString: strerror(code)))）。"
        }
    }
}

/// Serves the bundled distribution only on IPv4 loopback. A fixed port keeps
/// the HTTP origin stable so the default WKWebsiteDataStore retains IndexedDB.
final class LoopbackSiteServer: @unchecked Sendable {
    static let shared = LoopbackSiteServer()
    static let port: UInt16 = 48_731

    private let lock = NSLock()
    private let queue = DispatchQueue(label: "jp.taku.honenoosanpo.loopback-accept", qos: .userInitiated)
    private var listenerFD: Int32 = -1
    private var listenerSource: DispatchSourceRead?
    private var siteRoot: URL?

    private init() {}

    var origin: String { "http://127.0.0.1:\(Self.port)" }

    func start(bundle: Bundle = .main) throws -> URL {
        lock.lock()
        defer { lock.unlock() }

        if listenerFD >= 0, let siteRoot {
            return URL(string: "\(origin)/")!
        }

        guard let root = bundle.resourceURL?.appendingPathComponent("Site", isDirectory: true),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            throw LoopbackSiteError.missingSiteBundle
        }

        let socketFD = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socketFD >= 0 else { throw LoopbackSiteError.socketSetup(operation: "socket", code: errno) }

        var noSigPipe: Int32 = 1
        _ = withUnsafePointer(to: &noSigPipe) {
            setsockopt(socketFD, SOL_SOCKET, SO_NOSIGPIPE, $0, socklen_t(MemoryLayout<Int32>.size))
        }
        var reuseAddress: Int32 = 1
        _ = withUnsafePointer(to: &reuseAddress) {
            setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, $0, socklen_t(MemoryLayout<Int32>.size))
        }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(Self.port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bindResult = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socketFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            let code = errno
            Darwin.close(socketFD)
            throw LoopbackSiteError.socketSetup(operation: "bind", code: code)
        }
        guard Darwin.listen(socketFD, SOMAXCONN) == 0 else {
            let code = errno
            Darwin.close(socketFD)
            throw LoopbackSiteError.socketSetup(operation: "listen", code: code)
        }

        listenerFD = socketFD
        siteRoot = root.standardizedFileURL
        let source = DispatchSource.makeReadSource(fileDescriptor: socketFD, queue: queue)
        source.setEventHandler { [weak self] in self?.acceptPendingConnections() }
        source.setCancelHandler { Darwin.close(socketFD) }
        listenerSource = source
        source.resume()
        return URL(string: "\(origin)/")!
    }

    func isLocalSiteURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "http"
            && url.host?.lowercased() == "127.0.0.1"
            && url.port == Int(Self.port)
    }

    private func acceptPendingConnections() {
        guard listenerFD >= 0 else { return }
        while true {
            var address = sockaddr_in()
            var length = socklen_t(MemoryLayout<sockaddr_in>.size)
            let clientFD = withUnsafeMutablePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.accept(listenerFD, $0, &length)
                }
            }
            if clientFD < 0 {
                if errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR { return }
                return
            }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.serve(clientFD: clientFD)
            }
        }
    }

    private func serve(clientFD: Int32) {
        defer { Darwin.close(clientFD) }
        var requestTimeout = timeval(tv_sec: 5, tv_usec: 0)
        _ = withUnsafePointer(to: &requestTimeout) {
            setsockopt(clientFD, SOL_SOCKET, SO_RCVTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }
        _ = withUnsafePointer(to: &requestTimeout) {
            setsockopt(clientFD, SOL_SOCKET, SO_SNDTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }
        guard let request = readRequestHeader(from: clientFD),
              let firstLine = String(data: request, encoding: .utf8)?.components(separatedBy: "\r\n").first else {
            respond(status: "400 Bad Request", body: Data(), mimeType: "text/plain", to: clientFD)
            return
        }
        let fields = firstLine.split(separator: " ", omittingEmptySubsequences: true)
        guard fields.count >= 2, fields[0] == "GET" || fields[0] == "HEAD" else {
            respond(status: "405 Method Not Allowed", body: Data(), mimeType: "text/plain", to: clientFD,
                    extraHeaders: ["Allow: GET, HEAD"])
            return
        }
        let isHead = fields[0] == "HEAD"
        guard let fileURL = resolveRequestTarget(String(fields[1])) else {
            respond(status: "400 Bad Request", body: Data(), mimeType: "text/plain", to: clientFD,
                    includeBody: !isHead)
            return
        }
        guard let body = try? Data(contentsOf: fileURL, options: .mappedIfSafe) else {
            respond(status: "404 Not Found", body: Data("Not found".utf8), mimeType: "text/plain; charset=utf-8",
                    to: clientFD, includeBody: !isHead)
            return
        }
        respond(status: "200 OK", body: body, mimeType: mimeType(for: fileURL.pathExtension), to: clientFD,
                includeBody: !isHead, includeCSP: fileURL.pathExtension.lowercased() == "html")
    }

    private func readRequestHeader(from socketFD: Int32) -> Data? {
        var data = Data()
        var chunk = [UInt8](repeating: 0, count: 2048)
        let boundary = Data("\r\n\r\n".utf8)
        while data.count < 8_192 {
            let count = chunk.withUnsafeMutableBytes { bytes in
                Darwin.recv(socketFD, bytes.baseAddress, bytes.count, 0)
            }
            guard count > 0 else { return nil }
            data.append(contentsOf: chunk.prefix(count))
            if data.range(of: boundary) != nil { return data }
        }
        return nil
    }

    private func resolveRequestTarget(_ target: String) -> URL? {
        guard target.hasPrefix("/"), !target.contains("#"),
              let components = URLComponents(string: "\(origin)\(target)"),
              components.host == "127.0.0.1", components.port == Int(Self.port),
              let decodedPath = components.percentEncodedPath.removingPercentEncoding,
              !decodedPath.contains("\\"), !decodedPath.contains("\0"),
              let root = siteRoot else { return nil }

        let segments = decodedPath.split(separator: "/", omittingEmptySubsequences: true)
        guard !segments.contains(where: { $0 == "." || $0 == ".." }) else { return nil }
        let relativePath = segments.isEmpty ? "index.html" : segments.joined(separator: "/")
        var fileURL = root.appendingPathComponent(relativePath).standardizedFileURL
        guard fileURL.path.hasPrefix(root.path + "/") else { return nil }
        if !FileManager.default.fileExists(atPath: fileURL.path), fileURL.pathExtension.isEmpty {
            fileURL = root.appendingPathComponent("index.html")
        }
        return fileURL
    }

    private func mimeType(for extensionName: String) -> String {
        switch extensionName.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json": "application/json; charset=utf-8"
        case "webmanifest": "application/manifest+json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "webp": "image/webp"
        case "jpg", "jpeg": "image/jpeg"
        case "mp3": "audio/mpeg"
        case "wav": "audio/wav"
        case "woff": "font/woff"
        case "woff2": "font/woff2"
        case "ico": "image/x-icon"
        default: "application/octet-stream"
        }
    }

    private func respond(
        status: String,
        body: Data,
        mimeType: String,
        to socketFD: Int32,
        includeBody: Bool = true,
        includeCSP: Bool = false,
        extraHeaders: [String] = []
    ) {
        var lines = [
            "HTTP/1.1 \(status)",
            "Content-Type: \(mimeType)",
            "Content-Length: \(body.count)",
            "Connection: close",
            "Cache-Control: no-cache",
            "X-Content-Type-Options: nosniff",
            "Referrer-Policy: no-referrer",
            "X-Frame-Options: DENY",
        ]
        if includeCSP {
            lines.append("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'")
        }
        lines.append(contentsOf: extraHeaders)
        let header = Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
        writeAll(header, to: socketFD)
        if includeBody { writeAll(body, to: socketFD) }
    }

    private func writeAll(_ data: Data, to socketFD: Int32) {
        data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return }
            var offset = 0
            while offset < bytes.count {
                let sent = Darwin.send(socketFD, base.advanced(by: offset), bytes.count - offset, 0)
                guard sent > 0 else { return }
                offset += sent
            }
        }
    }
}
