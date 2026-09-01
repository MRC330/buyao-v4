import Foundation
import Darwin

/// 极简本地 HTTP 服务器
///
/// 存在的理由：OCR 用的 tesseract.js 需要加载 worker 与 wasm 文件。
/// 若用 file:// 直接加载，WKWebView 的同源策略会拦截 worker，
/// 导致识别功能不可用。改用 http://127.0.0.1 同源加载即可绕过。
///
/// 只监听回环地址，不对外暴露；零第三方依赖。
final class LocalServer {

    static let shared = LocalServer()

    private var serverFD: Int32 = -1
    private var root: URL?
    private(set) var port: UInt16 = 0
    private let queue = DispatchQueue(label: "com.buyao.localserver", attributes: .concurrent)
    private var running = false

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "htm": "text/html; charset=utf-8",
        "js": "application/javascript; charset=utf-8",
        "mjs": "application/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "svg": "image/svg+xml",
        "ico": "image/x-icon",
        "wasm": "application/wasm",
        "gz": "application/octet-stream",
        "data": "application/octet-stream",
        "txt": "text/plain; charset=utf-8"
    ]

    private init() {}

    /// 启动服务，返回实际监听端口
    @discardableResult
    func start(root: URL) throws -> UInt16 {
        guard !running else { return port }
        self.root = root

        serverFD = socket(AF_INET, SOCK_STREAM, 0)
        guard serverFD >= 0 else { throw ServerError.socketFailed }

        var reuse: Int32 = 1
        setsockopt(serverFD, SOL_SOCKET, SO_REUSEADDR, &reuse,
                   socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0 // 交给系统分配空闲端口
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)

        let bindOK = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(serverFD, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindOK == 0 else { throw ServerError.bindFailed }

        guard listen(serverFD, 32) == 0 else { throw ServerError.listenFailed }

        // 取系统实际分配的端口
        var actual = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameOK = withUnsafeMutablePointer(to: &actual) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.getsockname(serverFD, sockPtr, &len)
            }
        }
        guard nameOK == 0 else { throw ServerError.portQueryFailed }
        port = UInt16(bigEndian: actual.sin_port)

        running = true
        queue.async { [weak self] in self?.acceptLoop() }
        return port
    }

    func stop() {
        running = false
        if serverFD >= 0 {
            shutdown(serverFD, SHUT_RDWR)
            close(serverFD)
            serverFD = -1
        }
    }

    // MARK: - 接受连接

    private func acceptLoop() {
        while running {
            var clientAddr = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let fd = withUnsafeMutablePointer(to: &clientAddr) { ptr -> Int32 in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    Darwin.accept(serverFD, sockPtr, &len)
                }
            }
            guard fd >= 0 else {
                if running { usleep(50_000) }
                continue
            }
            queue.async { [weak self] in
                self?.handle(fd: fd)
            }
        }
    }

    // MARK: - 处理单次请求

    private func handle(fd: Int32) {
        defer { shutdown(fd, SHUT_RDWR); close(fd) }

        var buffer = [UInt8](repeating: 0, count: 8192)
        let n = buffer.withUnsafeMutableBytes { recv(fd, $0.baseAddress, 8192, 0) }
        guard n > 0 else { return }

        guard let request = String(bytes: buffer[0..<n], encoding: .utf8),
              let firstLine = request.components(separatedBy: "\r\n").first else { return }

        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" else {
            send(fd: fd, status: "405 Method Not Allowed", body: Data())
            return
        }

        let rawPath = String(parts[1])
        serve(fd: fd, path: rawPath)
    }

    private func serve(fd: Int32, path: String) {
        guard let root = root else { return }

        // 去掉 query 与 fragment，做 URL 解码
        var rel = path.components(separatedBy: "?").first ?? path
        rel = rel.components(separatedBy: "#").first ?? rel
        rel = rel.removingPercentEncoding ?? rel
        if rel == "/" || rel.isEmpty { rel = "/index.html" }

        // 防目录穿越
        var safe = rel
        while safe.contains("..") { safe = safe.replacingOccurrences(of: "..", with: "") }
        safe = safe.trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        let fileURL = root.appendingPathComponent(safe)
        guard FileManager.default.fileExists(atPath: fileURL.path),
              let data = try? Data(contentsOf: fileURL) else {
            let body = "404 Not Found: \(safe)".data(using: .utf8) ?? Data()
            send(fd: fd, status: "404 Not Found", body: body,
                 contentType: "text/plain; charset=utf-8")
            return
        }

        let ext = (fileURL.pathExtension).lowercased()
        let mime = LocalServer.mimeTypes[ext] ?? "application/octet-stream"
        send(fd: fd, status: "200 OK", body: data, contentType: mime)
    }

    private func send(fd: Int32, status: String, body: Data,
                      contentType: String = "text/html; charset=utf-8") {
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "Connection: close\r\n\r\n"

        var response = header.data(using: .utf8)!
        response.append(body)

        response.withUnsafeBytes { ptr in
            guard let base = ptr.baseAddress else { return }
            var sent = 0
            let total = response.count
            while sent < total {
                let w = Darwin.send(fd, base.advanced(by: sent), total - sent, 0)
                if w <= 0 { break }
                sent += w
            }
        }
    }

    enum ServerError: Error {
        case socketFailed, bindFailed, listenFailed, portQueryFailed
    }
}
