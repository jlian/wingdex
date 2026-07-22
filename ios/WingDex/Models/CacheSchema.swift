import Foundation
import SwiftData

enum CacheSchemaV1: VersionedSchema {
    static let versionIdentifier = Schema.Version(1, 0, 0)
    static var models: [any PersistentModel.Type] {
        [CachedAccountSnapshot.self]
    }

    @Model
    final class CachedAccountSnapshot {
        @Attribute(.unique) var accountID: String
        var refreshedAt: Date
        @Attribute(.externalStorage) var payload: Data

        init(accountID: String, refreshedAt: Date, payload: Data) {
            self.accountID = accountID
            self.refreshedAt = refreshedAt
            self.payload = payload
        }
    }
}

enum CacheMigrationPlan: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] {
        [CacheSchemaV1.self]
    }

    static var stages: [MigrationStage] { [] }
}
