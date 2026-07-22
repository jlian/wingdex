import Foundation

enum ExportFileFactory {
    static func sightings(
        data: Data,
        date: Date = Date(),
        directory: URL = FileManager.default.temporaryDirectory
    ) throws -> ExportFileItem {
        let fileName = "wingdex-sightings-\(dateStamp(date)).csv"
        return try write(data, named: fileName, to: directory)
    }

    static func outing(
        data: Data,
        outing: Outing,
        directory: URL = FileManager.default.temporaryDirectory
    ) throws -> ExportFileItem {
        let date = String(outing.startTime.prefix(10))
        let fileName = "wingdex-outing-\(date).csv"
        return try write(data, named: fileName, to: directory)
    }

    private static func write(_ data: Data, named fileName: String, to directory: URL) throws -> ExportFileItem {
        let exportDirectory = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
        let url = exportDirectory.appendingPathComponent(fileName)
        try data.write(to: url, options: .atomic)
        return ExportFileItem(url: url, cleanupDirectory: exportDirectory)
    }

    private static func dateStamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}