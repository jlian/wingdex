import Foundation
import Observation

/// Serializes page presentation without delaying identification.
@MainActor
@Observable
final class PhotoConfirmationPresentation {
    struct Key: Hashable {
        let requestID: UUID
        let isIdentifying: Bool
    }

    struct Snapshot {
        let key: Key
        let photo: ProcessedPhoto?
        let candidates: [IdentifiedCandidate]
        let location: (lat: Double, lon: Double)?
        let useGeoContext: Bool
    }

    enum Phase { case idle, fadingOut, fadingIn }

    private(set) var displayed: Snapshot?
    private(set) var pending: Snapshot?
    private(set) var phase: Phase = .idle

    var isCurrent: Bool { displayed?.key == pending?.key && phase == .idle }

    func update(_ snapshot: Snapshot, reduceMotion: Bool) {
        pending = snapshot
        if reduceMotion {
            displayed = snapshot
            phase = .idle
        } else if displayed == nil {
            displayed = snapshot
        } else if displayed?.key != snapshot.key && phase == .idle {
            phase = .fadingOut
        }
    }

    func swapSnapshot() {
        guard phase == .fadingOut, let pending else { return }
        displayed = pending
        phase = .fadingIn
    }

    func finishTransition() {
        guard phase == .fadingIn else { return }
        phase = displayed?.key == pending?.key ? .idle : .fadingOut
    }
}
