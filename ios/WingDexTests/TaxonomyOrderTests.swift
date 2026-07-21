@testable import WingDex
import XCTest

final class TaxonomyOrderTests: XCTestCase {
    func testTaxonomyOrderUsesBundledSequence() {
        XCTAssertLessThan(getTaxonomicOrder("Common Ostrich"), getTaxonomicOrder("Emu"))
    }

    func testTaxonomyOrderStripsScientificNameAndIgnoresCase() {
        XCTAssertEqual(
            getTaxonomicOrder("common ostrich (Struthio camelus)"),
            getTaxonomicOrder("Common Ostrich")
        )
    }

    func testUnknownSpeciesSortAfterKnownSpecies() {
        XCTAssertEqual(getTaxonomicOrder("Imaginary Bird"), Int.max)
        XCTAssertLessThan(getTaxonomicOrder("Common Ostrich"), getTaxonomicOrder("Imaginary Bird"))
    }

    func testUnknownSpeciesRemainLastInBothDirections() {
        let species = ["Imaginary Bird", "Common Ostrich", "Emu", "Another Mystery"]

        XCTAssertEqual(
            species.sorted { taxonomicSpeciesPrecedes($0, $1, ascending: true) },
            ["Common Ostrich", "Emu", "Another Mystery", "Imaginary Bird"]
        )
        XCTAssertEqual(
            species.sorted { taxonomicSpeciesPrecedes($0, $1, ascending: false) },
            ["Emu", "Common Ostrich", "Another Mystery", "Imaginary Bird"]
        )
    }
}