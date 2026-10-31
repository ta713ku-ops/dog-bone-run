import Foundation
import StoreKit

/// Product IDs remain empty until real App Store Connect products exist.
/// Only non-consumable purchases are supported by this first bridge contract.
@MainActor
final class StoreKitService {
    typealias EntitlementsChanged = @MainActor ([String]) -> Void

    // Product identifiers come from the signed application's configuration.
    // An empty value keeps the store unavailable while the free trial works.
    private let configuredProductIDs: Set<String> = {
        let value = (Bundle.main.object(forInfoDictionaryKey: "JourneyDuskProductID") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains("$(") else { return [] }
        return [value]
    }()
    private var transactionUpdatesTask: Task<Void, Never>?

    func startTransactionUpdates(onChange: @escaping EntitlementsChanged) {
        guard transactionUpdatesTask == nil else { return }
        transactionUpdatesTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await verification in Transaction.updates {
                guard case .verified(let transaction) = verification,
                      self.configuredProductIDs.contains(transaction.productID),
                      transaction.productType == .nonConsumable else { continue }
                await transaction.finish()
                onChange(await self.currentEntitlements())
            }
        }
    }

    func handle(_ message: [String: Any]) async -> [String: Any] {
        guard let action = message["action"] as? String else {
            return failure(action: "unknown", code: "invalid_request")
        }
        switch action {
        case "products":
            return await productList()
        case "purchase":
            guard let productID = message["productId"] as? String else {
                return failure(action: action, code: "invalid_product_id")
            }
            return await purchase(productID: productID)
        case "restore":
            return await restore()
        case "entitlements":
            return ["ok": true, "action": action, "configured": !configuredProductIDs.isEmpty,
                    "entitlements": await currentEntitlements()]
        default:
            return failure(action: action, code: "unsupported_action")
        }
    }

    private func productList() async -> [String: Any] {
        guard !configuredProductIDs.isEmpty else {
            return ["ok": true, "action": "products", "configured": false,
                    "products": [], "entitlements": []]
        }
        do {
            let products = try await Product.products(for: Array(configuredProductIDs).sorted())
                .filter { configuredProductIDs.contains($0.id) && $0.type == .nonConsumable }
            return ["ok": true, "action": "products", "configured": true,
                    "contentProducts": configuredProductIDs.sorted().map { ["productId": $0, "contentId": "dusk-walks"] },
                    "products": products.map { [
                        "productId": $0.id,
                        "displayName": $0.displayName,
                        "displayPrice": $0.displayPrice,
                        "contentId": "dusk-walks",
                    ] },
                    "entitlements": await currentEntitlements()]
        } catch {
            // Verified cached ownership is independent from a network price lookup.
            return ["ok": true, "action": "products", "configured": true,
                    "catalogUnavailable": true, "products": [],
                    "contentProducts": configuredProductIDs.sorted().map { ["productId": $0, "contentId": "dusk-walks"] },
                    "entitlements": await currentEntitlements()]
        }
    }

    private func purchase(productID: String) async -> [String: Any] {
        guard configuredProductIDs.contains(productID) else {
            return failure(action: "purchase", code: "store_not_configured")
        }
        do {
            guard let product = try await Product.products(for: [productID]).first,
                  product.type == .nonConsumable else {
                return failure(action: "purchase", code: "product_unavailable")
            }
            switch try await product.purchase() {
            case .success(let verification):
                guard case .verified(let transaction) = verification,
                      transaction.productID == productID else {
                    return failure(action: "purchase", code: "verification_failed")
                }
                await transaction.finish()
                return ["ok": true, "action": "purchase", "status": "verified",
                        "productId": productID, "entitlements": await currentEntitlements()]
            case .pending:
                return ["ok": true, "action": "purchase", "status": "pending", "productId": productID]
            case .userCancelled:
                return ["ok": true, "action": "purchase", "status": "cancelled", "productId": productID]
            @unknown default:
                return failure(action: "purchase", code: "unknown_purchase_result")
            }
        } catch {
            return failure(action: "purchase", code: "store_unavailable")
        }
    }

    private func restore() async -> [String: Any] {
        guard !configuredProductIDs.isEmpty else {
            return failure(action: "restore", code: "store_not_configured")
        }
        do {
            // Call only after an explicit Restore action from the person.
            try await AppStore.sync()
            return ["ok": true, "action": "restore", "entitlements": await currentEntitlements()]
        } catch {
            return failure(action: "restore", code: "restore_failed")
        }
    }

    private func currentEntitlements() async -> [String] {
        var ids = Set<String>()
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  configuredProductIDs.contains(transaction.productID),
                  transaction.productType == .nonConsumable,
                  transaction.revocationDate == nil else { continue }
            ids.insert(transaction.productID)
        }
        return ids.sorted()
    }

    private func failure(action: String, code: String) -> [String: Any] {
        ["ok": false, "action": action, "code": code, "entitlements": []]
    }
}
