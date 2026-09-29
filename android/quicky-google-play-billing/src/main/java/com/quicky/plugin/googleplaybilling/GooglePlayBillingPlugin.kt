package com.quicky.plugin.googleplaybilling

import android.app.Activity
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * Quicky — Google Play Billing (Monetization PRD §5.3).
 *
 * Exposed to the WebView as window.Capacitor.Plugins.GooglePlayBilling with
 * three promise-based methods:
 *
 *   initialize()                                   → { ok: Boolean }
 *   queryProductDetails({ productIds, productType }) → { productDetailsList: [...] }
 *   launchBillingFlow({ productId, productType })    → { purchaseList: [...] }
 *
 * Each purchase item: { productId, purchaseToken, purchaseState, orderId,
 * purchaseTime, acknowledged }. USER_CANCELED resolves with an EMPTY list.
 * purchaseState 1 = PENDING (cash at a store, confirmed later by Google) —
 * the web layer surfaces it without calling verify (the server credits only
 * on the confirmed purchase, per the PRD).
 *
 * Division of responsibility: this plugin is a thin sheet-runner. The server
 * verifies the purchase token with the Play Developer API, credits through
 * the wallet ledger, and acknowledges/consumes — nothing client-side can
 * move currency.
 */
@CapacitorPlugin(name = "GooglePlayBilling")
class GooglePlayBillingPlugin : Plugin() {

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /** Single BillingClient for the plugin's lifetime. */
    private var billingClient: BillingClient? = null

    /** Ongoing connection attempt, shared by concurrent method calls. */
    private var connectAttempt: CompletableDeferred<Boolean>? = null

    /** The launchBillingFlow in-flight purchase result. */
    private var purchaseResult: CompletableDeferred<List<Purchase>>? = null

    private val purchasesUpdatedListener = PurchasesUpdatedListener { result: BillingResult, purchases: List<Purchase>? ->
        val deferred = purchaseResult ?: return@PurchasesUpdatedListener
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK ->
                deferred.complete(purchases ?: emptyList())
            BillingClient.BillingResponseCode.USER_CANCELED ->
                deferred.complete(emptyList())
            else ->
                deferred.completeExceptionally(PlayBillingException(result.responseCode, result.debugMessage))
        }
    }

    class PlayBillingException(val code: Int, debugMessage: String) :
        Exception("billing_$code: $debugMessage")

    // ── lifecycle ───────────────────────────────────────────────────────────

    override fun handleOnDestroy() {
        mainScope.cancel()
        billingClient?.endConnection()
        billingClient = null
        connectAttempt = null
        purchaseResult = null
        super.handleOnDestroy()
    }

    // ── connection ──────────────────────────────────────────────────────────

    private fun createClient(): BillingClient {
        return BillingClient.newBuilder(getContext())
            .setListener(purchasesUpdatedListener)
            // Pending one-time purchases (e.g. cash at a store) must be
            // supported: they surface as purchaseState=PENDING and are
            // credited only when Google later confirms them (RTDN).
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .build()
    }

    /**
     * Ensure a connected BillingClient, (re)connecting when needed. Runs on
     * the main thread — all BillingClient calls go through it for a single
     * consistent thread, as Google requires.
     */
    private suspend fun ensureConnected(): Boolean = withContext(Dispatchers.Main) {
        val existing = billingClient
        if (existing != null && existing.isReady) return@withContext true

        // A connection attempt is already running — ride along with it.
        val inFlight = connectAttempt
        if (inFlight != null && inFlight.isActive) {
            return@withContext inFlight.await() && (billingClient?.isReady ?: false)
        }

        // Replace a dead client before reconnecting.
        billingClient?.endConnection()
        val client = createClient()
        billingClient = client

        val deferred = CompletableDeferred<Boolean>()
        connectAttempt = deferred
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                deferred.complete(result.responseCode == BillingClient.BillingResponseCode.OK)
            }

            override fun onBillingServiceDisconnected() {
                // The next method call reconnects via ensureConnected(). Any
                // in-flight purchase flow is failed — the user can retry.
                purchaseResult?.completeExceptionally(
                    PlayBillingException(-1, "billing_service_disconnected")
                )
                purchaseResult = null
            }
        })
        val ok = deferred.await()
        connectAttempt = null
        ok
    }

    // ── product details ─────────────────────────────────────────────────────

    /**
     * Query one product. Throws [PlayBillingException] on non-OK responses
     * (ITEM_UNAVAILABLE, DEVELOPER_ERROR, …); returns null when the product
     * simply is not in the response list.
     */
    private suspend fun queryDetails(productId: String, productType: String): ProductDetails? {
        val client = billingClient ?: throw PlayBillingException(-1, "client_not_initialized")
        if (!client.isReady) throw PlayBillingException(-1, "client_not_ready")

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(productType)
                        .build()
                )
            )
            .build()

        return withContext(Dispatchers.Main) {
            suspendCancellableCoroutine { cont ->
                client.queryProductDetailsAsync(params) { result: BillingResult, detailsList: List<ProductDetails>? ->
                    if (!cont.isActive) return@queryProductDetailsAsync
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                        val match = detailsList?.firstOrNull { it.productId == productId }
                        cont.resumeWith(Result.success(match))
                    } else {
                        cont.resumeWith(
                            Result.failure(PlayBillingException(result.responseCode, result.debugMessage))
                        )
                    }
                }
            }
        }
    }

    private fun productDetailsJson(d: ProductDetails): JSObject {
        val o = JSObject()
        o.put("productId", d.productId)
        o.put("title", d.title)
        o.put("description", d.description)
        o.put("productType", d.productType)
        d.oneTimePurchaseOfferDetails?.let { one ->
            o.put("formattedPrice", one.formattedPrice)
            o.put("priceAmountMicros", one.priceAmountMicros)
            o.put("priceCurrencyCode", one.priceCurrencyCode)
        }
        return o
    }

    private fun purchaseJson(p: Purchase, fallbackProductId: String): JSObject {
        val o = JSObject()
        o.put("productId", p.products.firstOrNull() ?: fallbackProductId)
        o.put("purchaseToken", p.purchaseToken)
        o.put("purchaseState", p.purchaseState)
        o.put("orderId", p.orderId)
        o.put("purchaseTime", p.purchaseTime)
        o.put("acknowledged", p.isAcknowledged)
        return o
    }

    // ── plugin methods ──────────────────────────────────────────────────────

    /** Connect the BillingClient. Idempotent — safe to call on every screen. */
    @PluginMethod
    fun initialize(call: PluginCall) {
        mainScope.launch {
            try {
                val ok = ensureConnected()
                val o = JSObject()
                o.put("ok", ok)
                call.resolve(o)
            } catch (e: Exception) {
                call.reject(e.message ?: "billing_init_failed")
            }
        }
    }

    /**
     * Pre-check that products exist in Play Console before showing the pay
     * sheet. Resolves with the details that were found (never rejects for a
     * missing id — an empty list is a valid answer).
     */
    @PluginMethod
    fun queryProductDetails(call: PluginCall) {
        mainScope.launch {
            try {
                if (!ensureConnected()) {
                    call.reject("billing_unavailable")
                    return@launch
                }

                val ids = ArrayList<String>()
                call.getArray("productIds")?.let { arr ->
                    for (i in 0 until arr.length()) {
                        arr.optString(i, null)?.let { id -> if (id.isNotBlank()) ids.add(id) }
                    }
                }
                call.getString("productId")?.let { single ->
                    if (!ids.contains(single)) ids.add(single)
                }
                if (ids.isEmpty()) {
                    call.reject("productIds required")
                    return@launch
                }
                val productType = call.getString("productType") ?: BillingClient.ProductType.INAPP

                val out = JSArray()
                for (id in ids) {
                    try {
                        queryDetails(id, productType)?.let { out.put(productDetailsJson(it)) }
                    } catch (e: PlayBillingException) {
                        // One bad id should not sink the whole query.
                        android.util.Log.w("GooglePlayBilling", "queryDetails($id): ${e.message}")
                    }
                }
                val o = JSObject()
                o.put("productDetailsList", out)
                call.resolve(o)
            } catch (e: Exception) {
                call.reject(e.message ?: "query_failed")
            }
        }
    }

    /**
     * Run the Play purchase sheet for one product. Resolves with the
     * resulting purchase(s); USER_CANCELED resolves with an empty list (the
     * web layer maps that to "purchase_cancelled"). PENDING purchases are
     * resolved normally with purchaseState=1 — Google confirms them later
     * (RTDN) and only then does the server credit.
     */
    @PluginMethod
    fun launchBillingFlow(call: PluginCall) {
        mainScope.launch {
            try {
                val productId = call.getString("productId")
                if (productId.isNullOrBlank()) {
                    call.reject("productId required")
                    return@launch
                }
                val productType = call.getString("productType") ?: BillingClient.ProductType.INAPP

                if (!ensureConnected()) {
                    call.reject("billing_unavailable")
                    return@launch
                }

                val details = try {
                    queryDetails(productId, productType)
                } catch (e: PlayBillingException) {
                    null
                }
                if (details == null) {
                    call.reject("product_not_found")
                    return@launch
                }

                val activity: Activity? = getActivity()
                if (activity == null) {
                    call.reject("no_activity")
                    return@launch
                }

                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(
                        listOf(
                            BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(details)
                                .build()
                        )
                    )
                    .build()

                val deferred = CompletableDeferred<List<Purchase>>()
                purchaseResult = deferred

                val launchResult = withContext(Dispatchers.Main) {
                    billingClient?.launchBillingFlow(activity, flowParams)
                }
                if (launchResult == null ||
                    launchResult.responseCode != BillingClient.BillingResponseCode.OK
                ) {
                    purchaseResult = null
                    val code = launchResult?.responseCode ?: -1
                    val msg = launchResult?.debugMessage ?: "launch_failed"
                    if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
                        val o = JSObject()
                        o.put("purchaseList", JSArray())
                        call.resolve(o)
                    } else {
                        call.reject("launch_failed($code): $msg")
                    }
                    return@launch
                }

                val purchases = deferred.await()
                purchaseResult = null

                val arr = JSArray()
                purchases.forEach { p -> arr.put(purchaseJson(p, productId)) }
                val o = JSObject()
                o.put("purchaseList", arr)
                call.resolve(o)
            } catch (e: Exception) {
                purchaseResult = null
                call.reject(e.message ?: "billing_error")
            }
        }
    }
}
