import AVFoundation
import CoreTransferable
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A photo or video picked for a post, already converted to what Meta accepts:
/// JPEG (Instagram takes no other format) or H.264 MP4.
struct MediaFile: Identifiable, Equatable {
    enum Kind: String { case image, video }

    let id = UUID()
    let kind: Kind
    let file: URL
    let preview: UIImage
    /// Seconds, for videos.
    let duration: Double?

    var contentType: String { kind == .video ? "video/mp4" : "image/jpeg" }
    var size: Int64 { (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize).map { Int64($0 ?? 0) } ?? 0 }
}

/// A movie handed over by the photo picker as a file.
private struct PickedMovie: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
            let dst = MediaProcessor.tempURL(ext: received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: dst)
            return PickedMovie(url: dst)
        }
    }
}

enum MediaProcessor {
    /// Instagram feed photos must be between 4:5 and 1.91:1; wider or taller ones are centre-cropped.
    static let feedAspect: ClosedRange<CGFloat> = 0.8...1.91
    /// Instagram's feed width.
    static let maxFeedWidth: CGFloat = 1440
    static let maxStorySide: CGFloat = 1920

    static func tempURL(ext: String) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("media", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
    }

    static func clearTemp() {
        try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("media"))
    }

    static func load(_ item: PhotosPickerItem, for kind: PostKind) async throws -> MediaFile {
        let isVideo = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
        if isVideo {
            guard let movie = try await item.loadTransferable(type: PickedMovie.self) else { throw failed }
            defer { try? FileManager.default.removeItem(at: movie.url) }
            return try await video(from: movie.url)
        }
        guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { throw failed }
        return try photo(image, story: kind == .story)
    }

    private static let failed = APIError(message: "Не вдалося відкрити файл з галереї.", status: nil)

    static func photo(_ image: UIImage, story: Bool) throws -> MediaFile {
        let out = prepare(image, story: story)
        guard let data = out.jpegData(compressionQuality: 0.9) else { throw failed }
        let url = tempURL(ext: "jpg")
        try data.write(to: url)
        return MediaFile(kind: .image, file: url, preview: out.preparingThumbnail(of: fit(out.size, max: 600)) ?? out, duration: nil)
    }

    /// Upright, cropped to Instagram's feed range (not for stories) and scaled down.
    static func prepare(_ image: UIImage, story: Bool) -> UIImage {
        var size = image.size
        var crop = CGRect(origin: .zero, size: size)
        if !story {
            let aspect = size.width / size.height
            if aspect < feedAspect.lowerBound {
                let h = size.width / feedAspect.lowerBound
                crop = CGRect(x: 0, y: (size.height - h) / 2, width: size.width, height: h)
            } else if aspect > feedAspect.upperBound {
                let w = size.height * feedAspect.upperBound
                crop = CGRect(x: (size.width - w) / 2, y: 0, width: w, height: size.height)
            }
        }
        size = crop.size
        let scale = story ? min(1, maxStorySide / max(size.width, size.height)) : min(1, maxFeedWidth / size.width)
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(x: -crop.minX * scale, y: -crop.minY * scale, width: image.size.width * scale, height: image.size.height * scale))
        }
    }

    static func video(from source: URL) async throws -> MediaFile {
        let asset = AVURLAsset(url: source)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1920x1080) else { throw failed }
        let out = tempURL(ext: "mp4")
        export.outputURL = out
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            export.exportAsynchronously { c.resume() }
        }
        guard export.status == .completed else {
            throw APIError(message: "Не вдалося підготувати відео: \(export.error?.localizedDescription ?? "невідома помилка")", status: nil)
        }
        let result = AVURLAsset(url: out)
        let duration = try await result.load(.duration).seconds
        let gen = AVAssetImageGenerator(asset: result)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 600, height: 600)
        let frame = try await gen.image(at: CMTime(seconds: min(0.5, duration / 2), preferredTimescale: 600)).image
        return MediaFile(kind: .video, file: out, preview: UIImage(cgImage: frame), duration: duration)
    }

    /// ~360 px JPEG for the server-side list preview (kept after the originals are deleted).
    static func thumbBase64(_ image: UIImage) -> String? {
        let small = image.preparingThumbnail(of: fit(image.size, max: 360)) ?? image
        return small.jpegData(compressionQuality: 0.6)?.base64EncodedString()
    }

    static func fit(_ size: CGSize, max side: CGFloat) -> CGSize {
        let s = min(1, side / Swift.max(size.width, size.height))
        return CGSize(width: (size.width * s).rounded(), height: (size.height * s).rounded())
    }
}
