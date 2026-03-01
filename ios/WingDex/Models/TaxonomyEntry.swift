import Foundation

/// A single entry from the bundled eBird taxonomy JSON.
///
/// The taxonomy is stored as an array of arrays:
/// `[commonName, scientificName, ebirdCode, wikiTitle, thumbnailPath]`
struct TaxonomyEntry: Identifiable {
    let common: String
    let scientific: String
    let ebirdCode: String
    let wikiTitle: String
    let thumbnailPath: String

    var id: String { ebirdCode }

    /// Load the bundled taxonomy from Resources/taxonomy.json.
    static func loadBundled() -> [TaxonomyEntry] {
        guard let url = Bundle.main.url(forResource: "taxonomy", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [[Any]]
        else {
            return []
        }

        return raw.compactMap { entry in
            guard entry.count >= 5,
                  let common = entry[0] as? String,
                  let scientific = entry[1] as? String,
                  let code = entry[2] as? String,
                  let wiki = entry[3] as? String,
                  let thumb = entry[4] as? String
            else {
                return nil
            }
            return TaxonomyEntry(
                common: common,
                scientific: scientific,
                ebirdCode: code,
                wikiTitle: wiki,
                thumbnailPath: thumb
            )
        }
    }
}
