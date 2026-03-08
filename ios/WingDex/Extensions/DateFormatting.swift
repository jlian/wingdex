import Foundation

/// Helpers for formatting offset-aware ISO 8601 date strings stored by the API.
///
/// Stored dates look like "2024-01-15T17:00:00-10:00". The offset encodes the
/// original local timezone, so we display the local datetime components directly
/// (formatted via UTC to avoid the device timezone shifting them).
enum DateFormatting {

    // MARK: - Date Only

    /// Format a stored date string for display (e.g. "Jan 15, 2024").
    static func formatDate(_ timeStr: String, style: DateFormatter.Style = .medium) -> String {
        guard let comps = parseLocalComponents(timeStr) else {
            return timeStr // un-parseable, return raw
        }
        let utcDate = comps.asUTCDate
        let fmt = DateFormatter()
        fmt.dateStyle = style
        fmt.timeStyle = .none
        fmt.timeZone = TimeZone(identifier: "UTC")
        return fmt.string(from: utcDate)
    }

    /// Short relative-style date: "Today", "Yesterday", or "Jan 15".
    static func relativeDate(_ timeStr: String) -> String {
        guard let comps = parseLocalComponents(timeStr) else { return timeStr }
        let utcDate = comps.asUTCDate

        let now = Date.now
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: now)
        let eventDay = calendar.startOfDay(for: utcDate)

        // Compare using the UTC date components (the "local" day in the original timezone)
        let dayDiff = calendar.dateComponents([.day], from: eventDay, to: todayStart).day ?? 0

        if dayDiff == 0 { return "Today" }
        if dayDiff == 1 { return "Yesterday" }

        let fmt = DateFormatter()
        fmt.dateFormat = "MMM d"
        fmt.timeZone = TimeZone(identifier: "UTC")
        return fmt.string(from: utcDate)
    }

    // MARK: - Time

    /// Format a stored time for display (e.g. "5:00 PM").
    static func formatTime(_ timeStr: String) -> String {
        guard let comps = parseLocalComponents(timeStr) else { return "" }
        let utcDate = comps.asUTCDate
        let fmt = DateFormatter()
        fmt.dateStyle = .none
        fmt.timeStyle = .short
        fmt.timeZone = TimeZone(identifier: "UTC")
        return fmt.string(from: utcDate)
    }

    // MARK: - Duration

    /// Compute a human-readable duration between two stored date strings.
    static func duration(from startStr: String, to endStr: String) -> String? {
        guard let start = parseLocalComponents(startStr),
              let end = parseLocalComponents(endStr)
        else { return nil }

        let startDate = start.asUTCDate
        let endDate = end.asUTCDate
        let seconds = endDate.timeIntervalSince(startDate)
        guard seconds > 0 else { return nil }

        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60

        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }

    // MARK: - Sorting

    /// Parse a stored date string into a Date for sorting purposes.
    /// Falls back to .distantPast if unparseable.
    static func sortDate(_ timeStr: String) -> Date {
        // Try ISO8601 with offset first
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: timeStr) { return date }

        // Try with fractional seconds
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: timeStr) { return date }

        return .distantPast
    }

    // MARK: - Internals

    private struct LocalComponents {
        let year: Int, month: Int, day: Int
        let hour: Int, minute: Int, second: Int

        /// Create a Date using UTC so that formatting with UTC timezone
        /// reproduces the original local wall-clock time.
        var asUTCDate: Date {
            var comps = DateComponents()
            comps.year = year
            comps.month = month
            comps.day = day
            comps.hour = hour
            comps.minute = minute
            comps.second = second
            comps.timeZone = TimeZone(identifier: "UTC")
            return Calendar.current.date(from: comps) ?? .distantPast
        }
    }

    /// Extract the local datetime components from an offset-aware ISO string.
    /// "2024-01-15T17:00:00-10:00" -> year=2024, month=1, day=15, hour=17, min=0, sec=0
    private static func parseLocalComponents(_ timeStr: String) -> LocalComponents? {
        // Strip timezone offset to get local datetime
        let localPart: String
        if let plusRange = timeStr.range(of: #"[+-]\d{2}:\d{2}$"#, options: .regularExpression) {
            localPart = String(timeStr[..<plusRange.lowerBound])
        } else if timeStr.hasSuffix("Z") {
            localPart = String(timeStr.dropLast())
        } else {
            localPart = timeStr
        }

        // Parse "2024-01-15T17:00:00" or "2024-01-15 17:00:00"
        let normalized = localPart.replacingOccurrences(of: "T", with: " ")
        let parts = normalized.split(separator: " ")
        guard parts.count >= 1 else { return nil }

        let dateParts = parts[0].split(separator: "-").compactMap { Int($0) }
        guard dateParts.count == 3 else { return nil }

        var hour = 0, minute = 0, second = 0
        if parts.count >= 2 {
            let timeParts = parts[1].split(separator: ":").compactMap { Int($0) }
            if timeParts.count >= 1 { hour = timeParts[0] }
            if timeParts.count >= 2 { minute = timeParts[1] }
            if timeParts.count >= 3 { second = timeParts[2] }
        }

        return LocalComponents(
            year: dateParts[0], month: dateParts[1], day: dateParts[2],
            hour: hour, minute: minute, second: second
        )
    }
}

// MARK: - Display Name Helpers

/// Extract the common name from "Common Name (Scientific Name)" format.
/// e.g. "Northern Cardinal (Cardinalis cardinalis)" -> "Northern Cardinal"
func getDisplayName(_ speciesName: String) -> String {
    guard let parenRange = speciesName.range(of: " (") else { return speciesName }
    return String(speciesName[..<parenRange.lowerBound])
}

/// Extract the scientific name from "Common Name (Scientific Name)" format.
/// e.g. "Northern Cardinal (Cardinalis cardinalis)" -> "Cardinalis cardinalis"
func getScientificName(_ speciesName: String) -> String? {
    guard let openParen = speciesName.range(of: "("),
          let closeParen = speciesName.range(of: ")", range: openParen.upperBound..<speciesName.endIndex)
    else { return nil }
    return String(speciesName[openParen.upperBound..<closeParen.lowerBound])
}

private let ebirdCodeLookup: [String: String] = {
    guard let url = Bundle.main.url(forResource: "taxonomy", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let rawEntries = try? JSONSerialization.jsonObject(with: data) as? [[Any]]
    else {
        return [:]
    }

    var lookup: [String: String] = [:]
    lookup.reserveCapacity(rawEntries.count)

    for entry in rawEntries {
        guard entry.count > 2,
              let commonName = entry[0] as? String,
              let ebirdCode = entry[2] as? String,
              !ebirdCode.isEmpty
        else { continue }

        lookup[commonName.lowercased()] = ebirdCode
    }

    return lookup
}()

/// Build the eBird species URL for a stored species name.
func getEbirdURL(for speciesName: String) -> URL? {
    let commonName = getDisplayName(speciesName).trimmingCharacters(in: .whitespacesAndNewlines)
    guard let ebirdCode = ebirdCodeLookup[commonName.lowercased()] else { return nil }
    return URL(string: "https://ebird.org/species/\(ebirdCode)")
}
