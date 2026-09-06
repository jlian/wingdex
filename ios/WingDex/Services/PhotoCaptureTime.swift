import Foundation
import ImageIO

struct PhotoCaptureTime: Sendable, Equatable {
    let date: Date
    let timeZone: TimeZone
    var localDateTime: String?

    var storedValue: String {
        DateFormatting.storageString(date, timeZone: timeZone)
    }

    static func fromEXIF(
        _ metadata: [CFString: Any], fallbackTimeZone: TimeZone = .current
    ) -> PhotoCaptureTime? {
        guard let localDateTime = metadata[kCGImagePropertyExifDateTimeOriginal] as? String else {
            return nil
        }
        let explicitTimeZone = (metadata[kCGImagePropertyExifOffsetTimeOriginal] as? String)
            .flatMap { DateFormatting.offsetTimeZone($0) }
        let timeZone = explicitTimeZone ?? fallbackTimeZone
        guard let date = parse(localDateTime, timeZone: timeZone) else { return nil }
        return PhotoCaptureTime(
            date: date, timeZone: timeZone,
            localDateTime: explicitTimeZone == nil ? localDateTime : nil
        )
    }

    func resolved(in timeZone: TimeZone) -> PhotoCaptureTime {
        guard let localDateTime, let date = Self.parse(localDateTime, timeZone: timeZone) else {
            return self
        }
        return PhotoCaptureTime(date: date, timeZone: timeZone, localDateTime: localDateTime)
    }

    private static func parse(_ localDateTime: String, timeZone: TimeZone) -> Date? {
        guard localDateTime.range(
            of: #"^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$"#, options: .regularExpression
        ) != nil else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        formatter.isLenient = false
        return formatter.date(from: localDateTime)
    }
}
