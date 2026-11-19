// seller.js — Seller Dashboard Firebase logic
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc,
  doc, onSnapshot, arrayUnion, query, orderBy, setDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ── Init Firebase ─────────────────────────────────────────
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db  = getFirestore(app);

window.db = db;

// ── Auth Guard (Seller role required) ─────────────────────
function checkSellerAuth() {
  const saved = localStorage.getItem("makan_user");
  if (!saved) {
    window.location.href = "login.html";
    return null;
  }
  try {
    const user = JSON.parse(saved);
    if (user.role !== "seller" && !user.email.toLowerCase().endsWith("@admin.com")) {
      alert("Access denied! This page is for Seller accounts (@admin.com) only.");
      window.location.href = "index.html";
      return null;
    }
    window.currentUser = user;
    const nameEl = document.getElementById("seller-nav-username");
    if (nameEl) {
      nameEl.textContent = "👤 " + (user.name || user.email);
    }
    return user;
  } catch (e) {
    localStorage.removeItem("makan_user");
    window.location.href = "login.html";
    return null;
  }
}

const currentSeller = checkSellerAuth();

// ── Sign-out ──────────────────────────────────────────────
window.handleLogout = function() {
  localStorage.removeItem("makan_user");
  window.location.href = "login.html";
};

// ── Inventory ─────────────────────────────────────────────
let menuData = [];

window.toggleModal = function() {
  document.getElementById("menuModal").classList.toggle("hidden");
};

window.saveNewMenu = async function() {
  const name  = document.getElementById("newName").value.trim();
  const price = parseInt(document.getElementById("newPrice").value);
  const stock = parseInt(document.getElementById("newStock").value);
  const emoji = document.getElementById("newEmoji").value || "🍛";
  const tags  = document.getElementById("newTags").value.split(",").map(t => t.trim());

  if (!name || isNaN(price) || isNaN(stock)) {
    alert("Please fill in all fields correctly!");
    return;
  }

  try {
    await addDoc(collection(db, "products"), {
      name, price, stock, emoji, tags,
      createdAt: Date.now()
    });

    alert("Menu item added to Firebase successfully!");
    window.toggleModal();
    // clear input
    document.getElementById("newName").value = "";
    document.getElementById("newPrice").value = "";
    document.getElementById("newStock").value = "";
    loadInventory();
  } catch (err) {
    alert("Failed to add menu item: " + err.message);
  }
};

async function loadInventory() {
  try {
    const snapshot = await getDocs(collection(db, "products"));
    menuData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderInventory();
  } catch (err) {
    console.error("Error loading products:", err);
  }
}

window.editStock = async function(id) {
  const item  = menuData.find(m => m.id === id);
  if (!item) return;
  const input = prompt("Update stock " + item.name + ":", item.stock);
  if (input === null) return;
  const newStock = parseInt(input);
  if (isNaN(newStock)) return;

  try {
    await updateDoc(doc(db, "products", id), { stock: newStock });
    loadInventory();
  } catch (err) {
    alert("Failed to update stock: " + err.message);
  }
};

window.deleteProduct = async function(id) {
  const item = menuData.find(m => m.id === id);
  if (!item) return;

  const confirmed = confirm(`Delete "${item.name}" from the menu?\n\nThis will permanently remove the product from the database.`);
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "products", id));
    loadInventory();
  } catch (err) {
    alert("Failed to delete product: " + err.message);
  }
};

function renderInventory() {
  const tbody = document.getElementById("inventory-body");
  if (!tbody) return;

  let lowStock = 0, outOfStock = 0;

  tbody.innerHTML = menuData.map(item => {
    if (item.stock === 0)       outOfStock++;
    else if (item.stock <= 5)   lowStock++;

    return `
      <tr class="table-row">
        <td class="p-3 text-sm font-medium text-white">${item.emoji || "🍽️"} ${item.name}</td>
        <td class="p-3 text-sm text-gray-400">${(item.tags || []).join(", ")}</td>
        <td class="p-3 text-sm text-right font-medium text-cyan-400 font-semibold">Rp ${(item.price || 0).toLocaleString()}</td>
        <td class="p-3 text-sm text-center">
          ${item.stock === 0
            ? '<span class="badge-low">OUT</span>'
            : item.stock <= 5
              ? `<span class="badge-low">${item.stock}</span>`
              : item.stock}
        </td>
        <td class="p-3 text-right">
          <div class="flex items-center justify-end gap-1.5 flex-wrap">
            <button onclick="editStock('${item.id}')"
              class="btn-edit"
              title="Edit stock ${item.name}">
              Edit
            </button>
            <button onclick="deleteProduct('${item.id}')"
              class="btn-delete-product"
              title="Delete ${item.name}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Delete
            </button>
          </div>
        </td>
      </tr>`;
  }).join("");

  const totalEl = document.getElementById("total-items");
  const lowEl   = document.getElementById("low-stock-count");
  const outEl   = document.getElementById("out-of-stock-count");

  if (totalEl) totalEl.innerText = menuData.length;
  if (lowEl)   lowEl.innerText   = lowStock;
  if (outEl)   outEl.innerText   = outOfStock;
}

// ── Orders (Grouped by Customer) ──────────────────────────
window.activeOrders = {};
window.allIncomingOrders = [];
window.ordersSearchQuery = "";
window.ordersActiveFilter = "all";
window.customerAccordionState = {}; // customerKey -> boolean (true: open, false: closed)

function normalizeOrderStatus(rawStatus) {
  const s = (rawStatus || "Processing").toLowerCase().trim();
  if (s === "processing" || s === "pending" || s === "paid") return "pending";
  if (s === "preparing") return "preparing";
  if (s === "on the way" || s === "ready" || s === "shipping") return "ontheway";
  if (s === "delivered" || s === "selesai" || s === "completed") return "completed";
  if (s === "cancelled" || s === "rejected" || s === "batal") return "rejected";
  return "pending";
}

function getCustomerInfo(order) {
  let name = (order.customerName || order.userName || "").trim();
  let email = (order.customerEmail || order.userEmail || "").trim();
  let id = (order.customerId || order.userId || "").trim();

  if (!name && email) {
    const localPart = email.split('@')[0];
    name = localPart.charAt(0).toUpperCase() + localPart.slice(1);
  }
  if (!name && order.location?.address) {
    const parts = order.location.address.split(',');
    name = parts[0].trim();
  }
  if (!name) {
    name = "Customer #" + (order.id ? order.id.slice(-4).toUpperCase() : "GUEST");
  }

  const key = (email || id || name).toLowerCase().trim();

  // Generate 1-2 letter initials
  const initials = name.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || "👤";

  return { key, name, email, initials };
}

function formatOrderDate(timestamp) {
  if (!timestamp) return "Recent";
  const date = timestamp.toDate ? timestamp.toDate() : new Date((timestamp.seconds || 0) * 1000);
  if (isNaN(date.getTime())) return "Recent";
  
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  
  return date.toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderStatusBadge(status) {
  const norm = normalizeOrderStatus(status);
  if (norm === "pending") {
    return `<span class="status-badge status-processing"><span class="orders-live-dot" style="margin-right:5px;background:#a5b4fc;"></span>Processing</span>`;
  } else if (norm === "preparing") {
    return `<span class="status-badge status-preparing">👨‍🍳 Preparing</span>`;
  } else if (norm === "ontheway") {
    return `<span class="status-badge status-onway">🛵 On the Way</span>`;
  } else if (norm === "completed") {
    return `<span class="status-badge status-delivered">✅ Delivered</span>`;
  } else if (norm === "rejected") {
    return `<span class="status-badge status-cancelled">✕ Rejected</span>`;
  }
  return `<span class="status-badge status-processing">${status || "Processing"}</span>`;
}

function renderActionButtons(order) {
  const norm = normalizeOrderStatus(order.status);
  const orderId = order.id;

  let html = `<div class="order-actions-group">`;

  // Always offer Chat Buyer button
  html += `
    <button type="button" onclick="openChatModal('${orderId}')"
      class="action-btn-chat" title="Chat Buyer">
      💬
    </button>`;

  // Always offer Print Receipt button
  html += `
    <button type="button" onclick="openReceiptModal('${orderId}')"
      class="action-btn-receipt" title="View & Print Receipt">
      🧾
    </button>`;

  if (norm === "pending") {
    html += `
      <button type="button" onclick="rejectOrder('${orderId}')"
        class="action-btn action-btn-reject" title="Reject this order">
        ✕ Reject
      </button>
      <button type="button" onclick="updateOrderStatus('${orderId}','Preparing')"
        class="action-btn action-btn-accept" title="Accept and start preparing">
        ✓ Accept & Prepare
      </button>`;
  } else if (norm === "preparing") {
    html += `
      <button type="button" onclick="rejectOrder('${orderId}')"
        class="action-btn action-btn-reject" title="Cancel/Reject this order">
        ✕ Cancel
      </button>
      <button type="button" onclick="updateOrderStatus('${orderId}','On the Way')"
        class="action-btn action-btn-ship" title="Mark order as ready and dispatch driver">
        🛵 Ready & Ship It
      </button>`;
  } else if (norm === "ontheway") {
    html += `
      <button type="button" onclick="openTrackerModal('${orderId}')"
        class="action-btn-track" title="Track driver live coordinates">
        📍 Track GPS
      </button>
      <button type="button" onclick="updateOrderStatus('${orderId}','Delivered')"
        class="action-btn action-btn-finish" title="Mark order as completed/delivered">
        ✓ Mark Completed
      </button>`;
  } else if (norm === "completed") {
    html += `<span class="status-badge status-delivered">Completed ✓</span>`;
  } else if (norm === "rejected") {
    html += `<span class="status-badge status-cancelled">Rejected ✕</span>`;
  }

  html += `</div>`;
  return html;
}

// ── Receipt / Payment Slip ────────────────────────────
window.openReceiptModal = function(orderId) {
  const order = window.activeOrders[orderId];
  if (!order) { alert("Order data not found."); return; }

  const modal = document.getElementById("receiptModal");
  if (!modal) return;

  // Populate receipt content
  _buildReceiptHTML(order);
  modal.classList.remove("hidden");
};

window.closeReceiptModal = function() {
  const modal = document.getElementById("receiptModal");
  if (modal) modal.classList.add("hidden");
};

function _buildReceiptHTML(order) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const orderId     = (order.id || "").slice(-8).toUpperCase();
  const items       = order.items || [];
  const totalPrice  = order.totalPrice || items.reduce((s, i) => s + ((i.price||0)*(i.quantity||1)), 0);
  const address     = order.location?.address || "No address";
  const notes       = order.notes || order.location?.details || "";
  const payMethod   = order.method || order.paymentMethod || "QRIS";
  const customerName = (order.customerName || order.userName || "Customer").trim();
  const customerEmail= (order.customerEmail || order.userEmail || "");
  const status      = order.status || "Processing";

  // Prepare order timestamp
  let orderTimestamp = "";
  if (order.timestamp) {
    const ts = order.timestamp.toDate ? order.timestamp.toDate() : new Date((order.timestamp.seconds||0)*1000);
    orderTimestamp = ts.toLocaleString("en-US", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  } else {
    orderTimestamp = dateStr;
  }

  const subtotal   = items.reduce((s, i) => s + ((i.price||0)*(i.quantity||1)), 0);
  const taxRate    = 0; // Change here if tax applies
  const taxAmount  = Math.round(subtotal * taxRate);
  const grandTotal = subtotal + taxAmount;

  // Status label
  const statusLabels = {
    pending: "⏳ Awaiting Confirmation",
    preparing: "👨‍🍳 Being Prepared",
    ontheway: "🛵 On the Way",
    completed: "✅ Completed / Delivered",
    rejected: "❌ Cancelled"
  };
  const normStatus = normalizeOrderStatus(status);
  const statusLabel = statusLabels[normStatus] || status;

  // Build items rows
  const itemsHTML = items.length > 0
    ? items.map(item => {
        const subtotalItem = (item.price||0) * (item.quantity||1);
        return `
          <tr class="receipt-item-row">
            <td class="receipt-td-name">${item.emoji||"🍽️"} ${item.name}</td>
            <td class="receipt-td-qty">${item.quantity}x</td>
            <td class="receipt-td-price">Rp ${(item.price||0).toLocaleString("en-US")}</td>
            <td class="receipt-td-subtotal">Rp ${subtotalItem.toLocaleString("en-US")}</td>
          </tr>`;
      }).join("")
    : `<tr><td colspan="4" style="text-align:center; color:#999; padding:8px 0; font-style:italic;">No items</td></tr>`;

  const receiptHTML = `
    <div class="receipt-wrapper" id="receipt-printable">
      <!-- Store Header -->
      <div class="receipt-store-header">
        <div class="receipt-logo-text">🍽️ makan.ai</div>
        <div class="receipt-store-tagline">Online Food Ordering Platform</div>
        <div class="receipt-store-contact">support@makan.ai · makan.ai</div>
        <div class="receipt-divider-dashed"></div>
      </div>

      <!-- Receipt Title -->
      <div class="receipt-title-block">
        <span class="receipt-title-label">PAYMENT RECEIPT</span>
        <div class="receipt-order-id">#${orderId}</div>
      </div>

      <div class="receipt-divider-dashed"></div>

      <!-- Order Info -->
      <table class="receipt-info-table">
        <tr>
          <td class="receipt-info-label">Order Date</td>
          <td class="receipt-info-colon">:</td>
          <td class="receipt-info-value">${orderTimestamp}</td>
        </tr>
        <tr>
          <td class="receipt-info-label">Print Date</td>
          <td class="receipt-info-colon">:</td>
          <td class="receipt-info-value">${dateStr}</td>
        </tr>
        <tr>
          <td class="receipt-info-label">Print Time</td>
          <td class="receipt-info-colon">:</td>
          <td class="receipt-info-value">${timeStr}</td>
        </tr>
        <tr>
          <td class="receipt-info-label">Customer</td>
          <td class="receipt-info-colon">:</td>
          <td class="receipt-info-value">${customerName}${customerEmail ? ` (${customerEmail})` : ""}</td>
        </tr>
        <tr>
          <td class="receipt-info-label">Address</td>
          <td class="receipt-info-colon">:</td>
          <td class="receipt-info-value">${address}</td>
        </tr>
        ${notes ? `
        <tr>
          <td class="receipt-info-label">Notes</td>
          <td class="receipt-info-colon">:</td>
          <td class="receipt-info-value receipt-notes-val">${notes}</td>
        </tr>` : ""}
        <tr>
          <td class="receipt-info-label">Payment</td>
          <td class="receipt-info-colon">:</td>
          <td class="receipt-info-value"><strong>${payMethod}</strong></td>
        </tr>
        <tr>
          <td class="receipt-info-label">Status</td>
          <td class="receipt-info-colon">:</td>
          <td class="receipt-info-value"><strong>${statusLabel}</strong></td>
        </tr>
      </table>

      <div class="receipt-divider-dashed"></div>

      <!-- Items Table -->
      <div class="receipt-items-title">ORDER DETAILS</div>
      <table class="receipt-items-table">
        <thead>
          <tr class="receipt-items-thead">
            <th class="receipt-th-name">Item</th>
            <th class="receipt-th-qty">Qty</th>
            <th class="receipt-th-price">Price</th>
            <th class="receipt-th-subtotal">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHTML}
        </tbody>
      </table>

      <div class="receipt-divider-dashed"></div>

      <!-- Totals -->
      <table class="receipt-totals-table">
        <tr>
          <td class="receipt-total-label">Subtotal</td>
          <td class="receipt-total-value">Rp ${subtotal.toLocaleString("en-US")}</td>
        </tr>
        ${taxAmount > 0 ? `
        <tr>
          <td class="receipt-total-label">Tax (${taxRate*100}%)</td>
          <td class="receipt-total-value">Rp ${taxAmount.toLocaleString("en-US")}</td>
        </tr>` : ""}
        <tr>
          <td class="receipt-total-label">Delivery Fee</td>
          <td class="receipt-total-value">Rp 0</td>
        </tr>
      </table>

      <div class="receipt-grand-total-row">
        <span class="receipt-grand-label">TOTAL</span>
        <span class="receipt-grand-amount">Rp ${grandTotal.toLocaleString("en-US")}</span>
      </div>

      <div class="receipt-payment-row">
        <span>Payment Method</span>
        <span><strong>${payMethod}</strong></span>
      </div>

      <div class="receipt-divider-dashed"></div>

      <!-- Footer -->
      <div class="receipt-footer">
        <div class="receipt-footer-emoji">🙏</div>
        <div class="receipt-footer-thanks">Thank you for your order!</div>
        <div class="receipt-footer-sub">Delicious food, best service.</div>
        <div class="receipt-footer-brand">— makan.ai —</div>
        <div class="receipt-barcode-visual">
          ||||| || ||||| | || ||||| || ||| ||||
        </div>
        <div class="receipt-barcode-num">${orderId}</div>
      </div>
    </div>
  `;

  const container = document.getElementById("receipt-content-area");
  if (container) container.innerHTML = receiptHTML;
}

window.printReceipt = function() {
  const printContent = document.getElementById("receipt-printable");
  if (!printContent) return;

  const printWindow = window.open("", "_blank", "width=420,height=700");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Payment Receipt - makan.ai</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body {
          font-family: 'Courier New', Courier, monospace;
          background: #fff;
          color: #111;
          font-size: 13px;
          padding: 0;
        }
        .receipt-wrapper {
          width: 320px;
          margin: 0 auto;
          padding: 18px 16px;
          background: #fff;
        }
        /* Store Header */
        .receipt-store-header { text-align: center; margin-bottom: 10px; }
        .receipt-logo-text { font-size: 20px; font-weight: 900; letter-spacing: -0.5px; margin-bottom: 2px; }
        .receipt-store-tagline { font-size: 10px; color: #555; margin-bottom: 2px; }
        .receipt-store-contact { font-size: 9px; color: #888; }
        /* Title */
        .receipt-title-block { text-align: center; margin: 8px 0; }
        .receipt-title-label { font-size: 11px; font-weight: 900; letter-spacing: 2px; display: block; }
        .receipt-order-id { font-size: 18px; font-weight: 900; letter-spacing: 1px; margin-top: 2px; }
        /* Dividers */
        .receipt-divider-dashed { border: none; border-top: 1px dashed #bbb; margin: 8px 0; }
        /* Info table */
        .receipt-info-table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0; }
        .receipt-info-label { color: #555; padding: 2px 0; vertical-align: top; white-space: nowrap; width: 95px; }
        .receipt-info-colon { padding: 2px 4px; vertical-align: top; }
        .receipt-info-value { color: #111; padding: 2px 0; vertical-align: top; word-break: break-word; }
        .receipt-notes-val { font-style: italic; color: #555; }
        /* Items */
        .receipt-items-title { font-weight: 900; font-size: 10px; letter-spacing: 1.5px; text-align: center; margin: 6px 0 4px; }
        .receipt-items-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .receipt-items-thead th { border-bottom: 1px solid #ccc; padding: 3px 0; font-weight: 900; font-size: 10px; text-align: left; }
        .receipt-th-name { width: 44%; }
        .receipt-th-qty { width: 10%; text-align: center; }
        .receipt-th-price { width: 22%; text-align: right; }
        .receipt-th-subtotal { width: 24%; text-align: right; }
        .receipt-item-row td { padding: 3px 0; vertical-align: top; }
        .receipt-td-name { }
        .receipt-td-qty { text-align: center; }
        .receipt-td-price { text-align: right; white-space: nowrap; }
        .receipt-td-subtotal { text-align: right; white-space: nowrap; font-weight: 700; }
        /* Totals */
        .receipt-totals-table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0; }
        .receipt-totals-table tr td { padding: 2px 0; }
        .receipt-total-label { color: #555; }
        .receipt-total-value { text-align: right; }
        /* Grand total */
        .receipt-grand-total-row {
          display: flex; justify-content: space-between; align-items: center;
          border-top: 2px solid #111; border-bottom: 2px solid #111;
          margin: 6px 0; padding: 5px 0; font-weight: 900; font-size: 15px;
        }
        .receipt-payment-row {
          display: flex; justify-content: space-between; font-size: 11px; color: #555; margin-top: 4px;
        }
        /* Footer */
        .receipt-footer { text-align: center; margin-top: 10px; }
        .receipt-footer-emoji { font-size: 18px; }
        .receipt-footer-thanks { font-weight: 900; font-size: 12px; margin-top: 4px; }
        .receipt-footer-sub { font-size: 10px; color: #777; margin-top: 2px; }
        .receipt-footer-brand { font-size: 11px; font-weight: 700; margin-top: 4px; letter-spacing: 1px; }
        .receipt-barcode-visual {
          font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 2px;
          margin-top: 10px; color: #333; word-spacing: -2px;
        }
        .receipt-barcode-num { font-size: 9px; color: #888; letter-spacing: 3px; margin-top: 2px; }
        @media print {
          body { background: #fff !important; }
          .receipt-wrapper { width: 100%; }
        }
      </style>
    </head>
    <body>
      ${printContent.outerHTML}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    // printWindow.close(); // uncomment jika ingin auto close setelah print
  }, 400);
};

window.toggleCustomerGroup = function(customerKey) {
  const current = window.customerAccordionState[customerKey] !== false; // default true
  window.customerAccordionState[customerKey] = !current;
  renderCustomerOrders();
};

window.setOrdersFilter = function(filterName) {
  window.ordersActiveFilter = filterName;

  // Update tab buttons
  document.querySelectorAll(".orders-tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-filter") === filterName);
  });

  // Update summary card highlight
  document.querySelectorAll(".orders-summary-card").forEach(card => {
    card.classList.remove("active-filter");
  });
  const activeCard = document.getElementById(`summary-card-${filterName}`);
  if (activeCard) activeCard.classList.add("active-filter");

  renderCustomerOrders();
};

window.handleOrdersSearch = function(query) {
  window.ordersSearchQuery = (query || "").trim().toLowerCase();
  const clearBtn = document.getElementById("orders-search-clear");
  if (clearBtn) clearBtn.style.display = window.ordersSearchQuery ? "flex" : "none";
  renderCustomerOrders();
};

window.clearOrdersSearch = function() {
  const input = document.getElementById("orders-search-input");
  const clearBtn = document.getElementById("orders-search-clear");
  if (input) input.value = "";
  if (clearBtn) clearBtn.style.display = "none";
  window.ordersSearchQuery = "";
  renderCustomerOrders();
};

window.rejectOrder = async function(orderId) {
  const confirmed = confirm("Are you sure you want to reject/cancel this order? The customer will see the rejected status.");
  if (!confirmed) return;
  await window.updateOrderStatus(orderId, "Rejected");
};

function renderCustomerOrders() {
  const container = document.getElementById("customer-orders-container");
  if (!container) return;

  const orders = window.allIncomingOrders || [];

  // Compute overall status counts
  const counts = { total: orders.length, pending: 0, preparing: 0, ontheway: 0, completed: 0, rejected: 0 };
  orders.forEach(o => {
    const norm = normalizeOrderStatus(o.status);
    if (counts[norm] !== undefined) counts[norm]++;
  });

  // Update summary numbers
  const totalEl     = document.getElementById("orders-count-total");
  const pendingEl   = document.getElementById("orders-count-pending");
  const preparingEl = document.getElementById("orders-count-preparing");
  const onthewayEl  = document.getElementById("orders-count-ontheway");
  const completedEl = document.getElementById("orders-count-completed");
  const newBadgeEl  = document.getElementById("orders-badge-new");

  if (totalEl)     totalEl.innerText     = counts.total;
  if (pendingEl)   pendingEl.innerText   = counts.pending;
  if (preparingEl) preparingEl.innerText = counts.preparing;
  if (onthewayEl)  onthewayEl.innerText  = counts.ontheway;
  if (completedEl) completedEl.innerText = counts.completed;
  if (newBadgeEl)  newBadgeEl.style.display = counts.pending > 0 ? "inline-block" : "none";

  // Update tab counts
  const tabAll       = document.getElementById("tab-count-all");
  const tabPending   = document.getElementById("tab-count-pending");
  const tabPreparing = document.getElementById("tab-count-preparing");
  const tabOntheway  = document.getElementById("tab-count-ontheway");
  const tabCompleted = document.getElementById("tab-count-completed");
  const tabRejected  = document.getElementById("tab-count-rejected");

  if (tabAll)       tabAll.innerText       = counts.total;
  if (tabPending)   tabPending.innerText   = counts.pending;
  if (tabPreparing) tabPreparing.innerText = counts.preparing;
  if (tabOntheway)  tabOntheway.innerText  = counts.ontheway;
  if (tabCompleted) tabCompleted.innerText = counts.completed;
  if (tabRejected)  tabRejected.innerText  = counts.rejected;

  // Group orders by Customer
  const customerMap = new Map();
  orders.forEach(order => {
    const info = getCustomerInfo(order);
    if (!customerMap.has(info.key)) {
      customerMap.set(info.key, {
        key: info.key,
        name: info.name,
        email: info.email,
        initials: info.initials,
        orders: [],
        latestTimestamp: 0,
        hasPending: false
      });
    }
    const group = customerMap.get(info.key);
    group.orders.push(order);
    const ts = order.timestamp?.seconds || 0;
    if (ts > group.latestTimestamp) group.latestTimestamp = ts;
    if (normalizeOrderStatus(order.status) === "pending") group.hasPending = true;
  });

  const query = (window.ordersSearchQuery || "").toLowerCase();
  const filter = window.ordersActiveFilter || "all";

  // Filter groups
  const filteredGroups = [];
  customerMap.forEach(group => {
    // Filter matching orders inside group
    const matchingOrders = group.orders.filter(order => {
      // 1. Status Filter
      if (filter !== "all") {
        const norm = normalizeOrderStatus(order.status);
        if (norm !== filter) return false;
      }

      // 2. Search Query Filter
      if (query) {
        const orderIdMatch   = (order.id || "").toLowerCase().includes(query);
        const nameMatch      = group.name.toLowerCase().includes(query);
        const emailMatch     = group.email.toLowerCase().includes(query);
        const addressMatch   = (order.location?.address || "").toLowerCase().includes(query);
        const itemsMatch     = (order.items || []).some(item => (item.name || "").toLowerCase().includes(query));
        const statusMatch    = (order.status || "").toLowerCase().includes(query);
        if (!orderIdMatch && !nameMatch && !emailMatch && !addressMatch && !itemsMatch && !statusMatch) {
          return false;
        }
      }

      return true;
    });

    if (matchingOrders.length > 0) {
      filteredGroups.push({
        ...group,
        displayOrders: matchingOrders
      });
    }
  });

  // Sort groups: customers with pending orders first, then by latest order timestamp
  filteredGroups.sort((a, b) => {
    if (a.hasPending && !b.hasPending) return -1;
    if (!a.hasPending && b.hasPending) return 1;
    return b.latestTimestamp - a.latestTimestamp;
  });

  // Empty state handling
  if (filteredGroups.length === 0) {
    const isSearching = query.length > 0;
    const isFiltered = filter !== "all";
    container.innerHTML = `
      <div class="orders-empty-state">
        <div class="orders-empty-icon">${isSearching ? "🔍" : isFiltered ? "📋" : "🍽️"}</div>
        <div class="text-white/80 font-bold text-sm">
          ${isSearching
            ? `No orders found matching "${window.ordersSearchQuery}"`
            : isFiltered
              ? `No ${filter} orders found`
              : "No incoming orders yet"}
        </div>
        <div class="text-white/40 text-xs mt-1">
          ${isSearching || isFiltered
            ? `<button onclick="setOrdersFilter('all'); clearOrdersSearch();" class="text-cyan-400 hover:underline mt-2 inline-block">Reset search & filters</button>`
            : "When buyers place food orders, they will appear here grouped by customer in real-time."}
        </div>
      </div>`;
    return;
  }

  // Render Groups
  container.innerHTML = filteredGroups.map(group => {
    // Accordion state: default open if undefined
    const isOpen = window.customerAccordionState[group.key] !== false;
    const totalGroupOrders = group.orders.length;
    const displayCount = group.displayOrders.length;
    const latestOrder = group.orders[0];
    const latestTimeStr = formatOrderDate(latestOrder.timestamp);

    // Summary of statuses for this customer
    const customerStatusCounts = {};
    group.orders.forEach(o => {
      const norm = normalizeOrderStatus(o.status);
      customerStatusCounts[norm] = (customerStatusCounts[norm] || 0) + 1;
    });

    let statusPills = [];
    if (customerStatusCounts.pending)   statusPills.push(`<span class="status-badge status-processing text-[10px] py-0.5">${customerStatusCounts.pending} Pending</span>`);
    if (customerStatusCounts.preparing) statusPills.push(`<span class="status-badge status-preparing text-[10px] py-0.5">${customerStatusCounts.preparing} Preparing</span>`);
    if (customerStatusCounts.ontheway)  statusPills.push(`<span class="status-badge status-onway text-[10px] py-0.5">${customerStatusCounts.ontheway} On the Way</span>`);
    if (customerStatusCounts.completed) statusPills.push(`<span class="status-badge status-delivered text-[10px] py-0.5">${customerStatusCounts.completed} Done</span>`);
    if (customerStatusCounts.rejected)  statusPills.push(`<span class="status-badge status-cancelled text-[10px] py-0.5">${customerStatusCounts.rejected} Rejected</span>`);

    return `
      <div class="customer-group-card ${group.hasPending ? 'has-pending' : ''}">
        <!-- Customer Card Header -->
        <div class="customer-card-header" onclick="toggleCustomerGroup('${group.key}')">
          <div class="customer-info-left">
            <div class="customer-avatar">${group.initials}</div>
            <div class="customer-details">
              <div class="customer-name-row">
                <span class="customer-name">${group.name}</span>
                <span class="customer-orders-badge">${totalGroupOrders} ${totalGroupOrders > 1 ? 'Orders' : 'Order'}</span>
                ${group.hasPending ? '<span class="orders-new-pill">NEW</span>' : ''}
              </div>
              <div class="customer-meta-sub">
                ${group.email ? `<span>${group.email}</span> · ` : ''}
                <span>Latest: ${latestTimeStr}</span>
              </div>
            </div>
          </div>

          <div class="customer-header-right">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${statusPills.join('')}
            </div>
            <button type="button" class="customer-chevron ${isOpen ? 'open' : ''}" aria-label="Toggle orders">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
          </div>
        </div>

        <!-- Customer Orders Body -->
        ${isOpen ? `
          <div class="customer-orders-body">
            ${group.displayOrders.map(order => {
              const norm = normalizeOrderStatus(order.status);
              const orderTime = formatOrderDate(order.timestamp);
              const items = order.items || [];
              const address = order.location?.address || "No address provided";
              const notes = order.notes || order.location?.details || "";
              const paymentMethod = order.method || order.paymentMethod || "QRIS";
              const totalPrice = order.totalPrice || 0;

              return `
                <div class="order-card order-card-${norm}">
                  <!-- Order Top Bar -->
                  <div class="order-top-bar">
                    <div class="flex items-center gap-2">
                      <span class="order-id-badge">#${order.id.slice(-5).toUpperCase()}</span>
                      <span class="text-xs text-white/50">${orderTime}</span>
                    </div>
                    <div class="order-meta-info">
                      <span class="order-payment-pill">💳 ${paymentMethod}</span>
                      ${renderStatusBadge(order.status)}
                    </div>
                  </div>

                  <!-- Order Items List -->
                  <div class="order-items-grid">
                    ${items.length > 0 ? items.map(item => `
                      <div class="order-item-row">
                        <div class="order-item-name-col">
                          <span class="order-item-qty">${item.quantity}x</span>
                          <span>${item.emoji || "🍽️"} ${item.name}</span>
                        </div>
                        <span class="order-item-price">Rp ${((item.price || 0) * (item.quantity || 1)).toLocaleString()}</span>
                      </div>
                    `).join('') : '<div class="text-xs text-white/40 italic">No items listed in order</div>'}
                  </div>

                  <!-- Address & Notes -->
                  <div class="order-details-grid">
                    <div>
                      <div class="order-address-box">
                        <span style="color:#00f2fe; flex-shrink:0;">📍</span>
                        <span>${address}</span>
                      </div>
                      ${notes ? `
                        <div class="order-notes-box">
                          <span>📝</span>
                          <span><strong>Note:</strong> ${notes}</span>
                        </div>
                      ` : ''}
                    </div>
                  </div>

                  <!-- Order Footer & Management Actions -->
                  <div class="order-footer">
                    <div class="order-total-amount">
                      <span>Total:</span>
                      Rp ${totalPrice.toLocaleString()}
                    </div>
                    ${renderActionButtons(order)}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function loadOrders() {
  onSnapshot(collection(db, "orders"), (snap) => {
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.activeOrders = orders.reduce((acc, o) => { acc[o.id] = o; return acc; }, {});

    orders.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    window.allIncomingOrders = orders;

    // Render grouped customer UI
    renderCustomerOrders();
  });
}

// Attach Search input listener
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("orders-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      window.ordersSearchQuery = e.target.value.trim().toLowerCase();
      const clearBtn = document.getElementById("orders-search-clear");
      if (clearBtn) clearBtn.style.display = window.ordersSearchQuery ? "flex" : "none";
      renderCustomerOrders();
    });
  }
});

window.updateOrderStatus = async function(orderId, status) {
  try {
    await updateDoc(doc(db, "orders", orderId), {
      status,
      statusHistory: arrayUnion({ status, time: Date.now() })
    });
    if (status === "On the Way") {
      await updateDoc(doc(db, "orders", orderId), {
        driverLat: -6.2849,
        driverLng: 107.1706
      });
    }
  } catch (e) {
    console.error("Error updating status:", e);
    alert("Failed to update status: " + e.message);
  }
};

// ── Seller Chat Modal ─────────────────────────────────────
window.activeChatUnsubscribe = null;
window.currentChatOrderId    = null;

// Chat = satu thread per buyer (collection "chats", id = email buyer)
function chatKeyForOrder(order) {
  return getCustomerInfo(order).key.replace(/\//g, "_");
}
function chatEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
async function sendSellerChatTo(key, order, text) {
  const info = order ? getCustomerInfo(order) : null;
  const now = Date.now();
  const data = { buyerKey: key, lastMessageAt: now, messages: arrayUnion({ sender: "seller", text, time: now }) };
  if (info) { data.buyerName = info.name; data.buyerEmail = info.email; }
  await setDoc(doc(db, "chats", key), data, { merge: true });
}

window.openChatModal = function(orderId) {
  const order = window.activeOrders[orderId];
  if (!order) return;
  const key = chatKeyForOrder(order);
  document.getElementById("chatModal").classList.remove("hidden");
  document.querySelector(".order-id-label").innerText = `Buyer: ${getCustomerInfo(order).name}`;
  window.currentChatOrderId = orderId;
  window.currentChatKey = key;
  markChatRead(key);

  if (window.activeChatUnsubscribe) window.activeChatUnsubscribe();
  window.activeChatUnsubscribe = onSnapshot(doc(db, "chats", key), (snap) => {
    const msgs = snap.exists() ? (snap.data().messages || []) : [];
    const box  = document.getElementById("chatBody");
    box.innerHTML = msgs.map(m => `
      <div class="flex flex-col ${m.sender === "seller" ? "items-end" : "items-start"}">
        <span class="text-[8px] text-gray-500 mb-0.5">${m.sender.toUpperCase()}</span>
        <div class="px-3 py-2 rounded-xl max-w-[80%] text-sm
          ${m.sender === "seller"
            ? "bg-gradient-to-r from-[#0284c7] to-[#00f2fe] text-white font-medium rounded-tr-sm shadow-sm"
            : "bg-white/10 text-white rounded-tl-sm"}">
          ${chatEsc(m.text)}
        </div>
      </div>`).join("");
    box.scrollTop = box.scrollHeight;
  });
};

window.closeChatModal = function() {
  document.getElementById("chatModal").classList.add("hidden");
  if (window.activeChatUnsubscribe) window.activeChatUnsubscribe();
};

document.getElementById("sendChatBtn")?.addEventListener("click", async () => {
  const input = document.getElementById("chatInput");
  const val   = input.value.trim();
  if (!val || !window.currentChatKey) return;
  input.value = "";
  await sendSellerChatTo(window.currentChatKey, window.activeOrders[window.currentChatOrderId], val);
});

// ── Map Tracker ───────────────────────────────────────────
let driverMarker = null, driverMap = null;
window.currentMapOrderId = null;

window.openTrackerModal = function(orderId) {
  document.getElementById("trackerModal").classList.remove("hidden");
  window.currentMapOrderId = orderId;

  const order = window.activeOrders[orderId];
  if (!driverMap) {
    driverMap   = L.map("sellerMap").setView([-6.2849, 107.1706], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(driverMap);
    driverMarker = L.marker([-6.2849, 107.1706], { draggable: true }).addTo(driverMap);

    driverMarker.on("dragend", async () => {
      if (!window.currentMapOrderId) return;
      const pos = driverMarker.getLatLng();
      await updateDoc(doc(db, "orders", window.currentMapOrderId), {
        driverLat: pos.lat, driverLng: pos.lng
      });
    });
  }

  const lat = order?.driverLat || -6.2849;
  const lng = order?.driverLng || 107.1706;
  driverMarker.setLatLng([lat, lng]);
  driverMap.setView([lat, lng], 15);
  setTimeout(() => driverMap.invalidateSize(), 200);
};

window.closeTrackerModal = function() {
  document.getElementById("trackerModal").classList.add("hidden");
  window.currentMapOrderId = null;
};

// Start loading when page ready
if (currentSeller) {
  loadInventory();
  loadOrders();
}

// ── Chat Inbox (Seller Private Chat Panel) — satu thread per buyer ──
let inboxUnsubscribe       = null;
let currentInboxChatKey    = null;
let inboxChatUnsubscribe   = null;
let inboxChatsCache        = [];

/** Realtime listener: collection "chats" (1 dokumen = 1 buyer) */
function initChatInbox() {
  inboxUnsubscribe = onSnapshot(collection(db, "chats"), (snap) => {
    inboxChatsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderChatInboxSection(inboxChatsCache);
    updateUnreadBadge(inboxChatsCache);
    if (!document.getElementById("chatInboxPanel")?.classList.contains("hidden")) {
      renderInboxConvoList(inboxChatsCache);
    }
  });
}

function lastMsg(chat) { return (chat.messages || []).at(-1); }

/** Number of buyer messages not yet read by the seller (after sellerReadAt) */
function unreadCount(chat) {
  const readAt = chat.sellerReadAt || 0;
  return (chat.messages || []).filter(m => m.sender === "buyer" && (m.time || 0) > readAt).length;
}

async function markChatRead(key) {
  try { await setDoc(doc(db, "chats", key), { sellerReadAt: Date.now() }, { merge: true }); }
  catch (e) { console.error("markChatRead:", e); }
}

let inboxFilter = "all";   // all | unread
let inboxSearch = "";

window.setInboxFilter = function(f) {
  inboxFilter = f;
  document.querySelectorAll(".inbox-filter-btn").forEach(b => {
    const on = b.dataset.f === f;
    b.style.background = on ? "rgba(0,242,254,0.2)" : "rgba(255,255,255,0.05)";
    b.style.color = on ? "#00f2fe" : "rgba(255,255,255,0.55)";
  });
  renderInboxConvoList(inboxChatsCache);
};
window.setInboxSearch = function(v) {
  inboxSearch = (v || "").trim().toLowerCase();
  renderInboxConvoList(inboxChatsCache);
};
window.markAllInboxRead = async function() {
  const now = Date.now();
  await Promise.all(inboxChatsCache.filter(c => unreadCount(c) > 0)
    .map(c => setDoc(doc(db, "chats", c.id), { sellerReadAt: now }, { merge: true })));
};

function filteredInboxChats(chats) {
  return sortedChats(chats).filter(c => {
    if (inboxFilter === "unread" && unreadCount(c) === 0) return false;
    if (inboxSearch) {
      const hay = (chatDisplayName(c) + " " + (c.buyerEmail || "") + " " +
        (c.messages || []).map(m => m.text).join(" ")).toLowerCase();
      if (!hay.includes(inboxSearch)) return false;
    }
    return true;
  });
}

function sortedChats(chats) {
  return chats.filter(c => (c.messages || []).length > 0)
    .sort((a, b) => (lastMsg(b)?.time || 0) - (lastMsg(a)?.time || 0));
}

function chatDisplayName(chat) {
  return chat.buyerName || chat.buyerEmail || chat.id;
}

function updateUnreadBadge(chats) {
  const unread = chats.reduce((s, c) => s + unreadCount(c), 0);
  const navBadge  = document.getElementById("chat-unread-badge");
  const inboxPill = document.getElementById("inbox-unread-pill");
  if (navBadge) {
    navBadge.textContent = unread;
    navBadge.style.display = unread > 0 ? "flex" : "none";
    navBadge.classList.toggle("hidden", unread === 0);
  }
  if (inboxPill) {
    inboxPill.textContent = `${unread} unread`;
    inboxPill.classList.toggle("hidden", unread === 0);
  }
}

function buyerOrderCount(chat) {
  const key = chat.id;
  return (window.allIncomingOrders || []).filter(o => chatKeyForOrder(o) === key).length;
}

function renderChatInboxSection(chats) {
  const listEl = document.getElementById("chat-inbox-list");
  if (!listEl) return;
  const withChat = sortedChats(chats);

  if (withChat.length === 0) {
    listEl.innerHTML = `<div style="padding:2rem; text-align:center; color:#555; font-size:0.85rem;">No buyer messages yet. When a buyer sends a message, it will appear here.</div>`;
    return;
  }

  listEl.innerHTML = withChat.map(chat => {
    const msgs = chat.messages || [];
    const last = lastMsg(chat);
    const unreadN = unreadCount(chat);
    const isUnread = unreadN > 0;
    const time = last?.time ? new Date(last.time).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'}) : "";
    const preview = chatEsc(last?.text && last.text.length > 50 ? last.text.slice(0, 50) + "…" : last?.text || "");
    const senderLabel = last?.sender === "buyer" ? "Buyer" : "You";
    const orders = buyerOrderCount(chat);

    return `
      <div onclick="openInboxDetail('${chatEsc(chat.id)}')" style="display:flex; align-items:center; gap:12px; padding:0.9rem 1rem; border-bottom:1px solid rgba(255,255,255,0.05); cursor:pointer; transition:background 0.2s; ${isUnread ? 'background:rgba(0,242,254,0.06);' : ''}" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='${isUnread ? 'rgba(0,242,254,0.06)' : 'transparent'}'">
        <div style="width:40px; height:40px; border-radius:50%; background:${isUnread ? 'rgba(0,242,254,0.2)' : 'rgba(255,255,255,0.05)'}; display:flex; align-items:center; justify-content:center; font-size:1.1rem; flex-shrink:0; border:1px solid ${isUnread ? 'rgba(0,242,254,0.35)' : 'rgba(255,255,255,0.08)'}">🧑‍💻</div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
            <span style="font-size:0.8rem; font-weight:${isUnread ? '800' : '600'}; color:${isUnread ? 'white' : 'rgba(255,255,255,0.7)'};">${chatEsc(chatDisplayName(chat))}</span>
            <span style="font-size:0.65rem; color:#555;">${time}</span>
          </div>
          <div style="font-size:0.72rem; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            <span style="color:${isUnread ? '#00f2fe' : '#666'};">${senderLabel}:</span> ${preview}
          </div>
          <div style="margin-top:3px; font-size:0.65rem; color:#555;">${orders} order · ${msgs.length} message${msgs.length !== 1 ? 's' : ''}</div>
        </div>
        ${isUnread ? `<div style="min-width:20px; height:20px; padding:0 5px; border-radius:99px; background:#00f2fe; color:#030717; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${unreadN}</div>` : ''}
      </div>`;
  }).join("");
}

window.refreshChatInbox = function() {
  renderChatInboxSection(inboxChatsCache);
  updateUnreadBadge(inboxChatsCache);
};

window.openChatInbox = function() {
  const panel = document.getElementById("chatInboxPanel");
  const inner = document.getElementById("chatInboxPanelInner");
  if (!panel || !inner) return;
  panel.classList.remove("hidden");
  setTimeout(() => { inner.style.transform = "translateX(0)"; }, 10);
  renderInboxConvoList(inboxChatsCache);
};

window.closeChatInbox = function() {
  const inner = document.getElementById("chatInboxPanelInner");
  if (inner) inner.style.transform = "translateX(100%)";
  setTimeout(() => {
    const panel = document.getElementById("chatInboxPanel");
    if (panel) panel.classList.add("hidden");
    closeInboxDetailSilent();
  }, 350);
};

window.closeChatInboxOnBg = function(e) {
  if (e.target === document.getElementById("chatInboxPanel")) window.closeChatInbox();
};

function renderInboxConvoList(chats) {
  const listEl = document.getElementById("inboxConvoList");
  if (!listEl) return;
  const withChat = filteredInboxChats(chats);

  if (withChat.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding:3rem 1rem; color:#555; font-size:0.82rem; line-height:1.6;">
      <div style="font-size:2rem; margin-bottom:0.5rem;">💬</div>
      ${inboxSearch || inboxFilter === "unread" ? "No conversations match." : "No buyer messages yet.<br>Messages will appear here when a buyer contacts you."}
    </div>`;
    return;
  }

  listEl.innerHTML = withChat.map(chat => {
    const last = lastMsg(chat);
    const unreadN = unreadCount(chat);
    const isUnread = unreadN > 0;
    const time = last?.time ? new Date(last.time).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'}) : "";
    const preview = chatEsc(last?.text && last.text.length > 45 ? last.text.slice(0, 45) + "…" : last?.text || "");
    const senderLabel = last?.sender === "buyer" ? "Buyer" : "You";

    return `
      <div onclick="openInboxDetail('${chatEsc(chat.id)}')" style="display:flex; align-items:center; gap:12px; padding:0.85rem; border-radius:12px; cursor:pointer; transition:background 0.15s; margin-bottom:4px; ${isUnread ? 'background:rgba(0,242,254,0.08); border:1px solid rgba(0,242,254,0.25);' : 'background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05);'}" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='${isUnread ? 'rgba(0,242,254,0.08)' : 'rgba(255,255,255,0.03)'}'">
        <div style="width:42px; height:42px; border-radius:50%; background:${isUnread ? 'rgba(0,242,254,0.25)' : 'rgba(255,255,255,0.08)'}; display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0;">🧑‍💻</div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
            <span style="font-size:0.8rem; font-weight:${isUnread ? '800' : '600'}; color:${isUnread ? 'white' : 'rgba(255,255,255,0.65)'};">${chatEsc(chatDisplayName(chat))}</span>
            <span style="font-size:0.62rem; color:#555;">${time}</span>
          </div>
          <div style="font-size:0.7rem; color:#777; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            <span style="color:${isUnread ? '#00f2fe' : '#555'};">${senderLabel}:</span> ${preview || 'No messages'}
          </div>
        </div>
        ${isUnread ? `<div style="min-width:20px; height:20px; padding:0 5px; border-radius:99px; background:#00f2fe; color:#030717; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${unreadN}</div>` : ''}
      </div>`;
  }).join("");
}

window.openInboxDetail = function(chatKey) {
  const panel = document.getElementById("chatInboxPanel");
  if (panel && panel.classList.contains("hidden")) window.openChatInbox();
  currentInboxChatKey = chatKey;
  markChatRead(chatKey);
  const detailEl = document.getElementById("inboxChatDetail");
  const titleEl  = document.getElementById("inboxDetailTitle");
  const subEl    = document.getElementById("inboxDetailSub");
  if (!detailEl) return;

  const chat = inboxChatsCache.find(c => c.id === chatKey) || { id: chatKey };
  titleEl.textContent = chatDisplayName(chat);
  subEl.textContent = (chat.buyerEmail || "") + (buyerOrderCount(chat) ? ` · ${buyerOrderCount(chat)} order` : "");

  detailEl.style.display = "flex";
  detailEl.classList.remove("hidden");

  if (inboxChatUnsubscribe) inboxChatUnsubscribe();
  inboxChatUnsubscribe = onSnapshot(doc(db, "chats", chatKey), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    const msgs = d.messages || [];
    renderInboxMessages(msgs);
    // new message while conversation is open -> mark as read immediately
    const l = msgs.at(-1);
    if (l && l.sender === "buyer" && (l.time || 0) > (d.sellerReadAt || 0) && currentInboxChatKey === chatKey) markChatRead(chatKey);
  });

  document.getElementById("inboxChatInput")?.focus();
};

function renderInboxMessages(msgs) {
  const box = document.getElementById("inboxChatBody");
  if (!box) return;

  if (msgs.length === 0) {
    box.innerHTML = `<div style="text-align:center; color:#555; font-size:0.8rem; padding:2rem;">No messages yet. Start the conversation!</div>`;
    return;
  }

  box.innerHTML = msgs.map(m => {
    const isSeller = m.sender === "seller";
    const time = m.time ? new Date(m.time).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'}) : "";
    return `
      <div style="display:flex; flex-direction:column; align-items:${isSeller ? 'flex-end' : 'flex-start'};">
        <span style="font-size:0.6rem; color:#555; margin-bottom:3px; padding-right:4px; padding-left:4px;">${isSeller ? 'YOU' : 'BUYER'} · ${time}</span>
        <div style="max-width:80%; padding:0.6rem 0.9rem; border-radius:${isSeller ? '14px 14px 2px 14px' : '14px 14px 14px 2px'}; font-size:0.82rem; line-height:1.4; ${isSeller ? 'background:linear-gradient(135deg,#0284c7,#00f2fe); color:#030717; font-weight:700;' : 'background:rgba(255,255,255,0.08); color:white;'}">
          ${chatEsc(m.text)}
        </div>
      </div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}

window.sendInboxReply = async function() {
  const input = document.getElementById("inboxChatInput");
  if (!input) return;
  const val = input.value.trim();
  if (!val || !currentInboxChatKey) return;
  input.value = "";
  await sendSellerChatTo(currentInboxChatKey, null, val);
};

window.closeInboxDetail = function() {
  closeInboxDetailSilent();
  renderInboxConvoList(inboxChatsCache);
};

function closeInboxDetailSilent() {
  const detailEl = document.getElementById("inboxChatDetail");
  if (detailEl) { detailEl.style.display = "none"; detailEl.classList.add("hidden"); }
  if (inboxChatUnsubscribe) { inboxChatUnsubscribe(); inboxChatUnsubscribe = null; }
  currentInboxChatKey = null;
}

// Start inbox listener after all inbox state is declared
if (currentSeller) initChatInbox();

