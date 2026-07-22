import Foundation

enum SharePayload {
    static func species(_ entry: DexEntry) -> String {
        var lines = [getDisplayName(entry.speciesName)]
        if let scientificName = getScientificName(entry.speciesName) {
            lines.append(scientificName)
        }
        lines.append(
            "\(entry.totalCount) observed across \(entry.totalOutings) outing\(entry.totalOutings == 1 ? "" : "s")"
        )
        lines.append("First seen \(DateFormatting.formatDate(entry.firstSeenDate, style: .medium))")
        lines.append("Last seen \(DateFormatting.formatDate(entry.lastSeenDate, style: .medium))")
        lines.append("Shared from WingDex")
        return lines.joined(separator: "\n")
    }

    static func outing(_ outing: Outing, observations: [BirdObservation]) -> String {
        let confirmed = observations.filter { $0.certainty == .confirmed }
        let grouped = Dictionary(grouping: confirmed, by: \BirdObservation.speciesName)
        let species = grouped.keys.sorted {
            getDisplayName($0).localizedCaseInsensitiveCompare(getDisplayName($1)) == .orderedAscending
        }
        let totalBirds = confirmed.reduce(0) { $0 + $1.count }

        var lines = [
            outing.locationName,
            DateFormatting.formatDate(outing.startTime, style: .medium),
            "\(species.count) species, \(totalBirds) bird\(totalBirds == 1 ? "" : "s")",
        ]

        if !species.isEmpty {
            lines.append("")
            lines.append(contentsOf: species.map { speciesName in
                let count = grouped[speciesName, default: []].reduce(0) { $0 + $1.count }
                return "\(count)x \(getDisplayName(speciesName))"
            })
        }

        lines.append("")
        lines.append("Shared from WingDex")
        return lines.joined(separator: "\n")
    }
}