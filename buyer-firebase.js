// buyer-firebase.js — Buyer page Firebase logic
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, doc,
  updateDoc, onSnapshot, arrayUnion, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ── Init Firebase (reuse if already initialized) ───────────
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db  = getFirestore(app);

// expose globally so WADJS.js and inline scripts can use them
window.db = db;

// ── Auth Guard via localStorage ────────────────────────────
function checkAuth() {
  const saved = localStorage.getItem("makan_user");
  if (!saved) {
    window.location.href = "login.html";
    return null;
  }
  try {
    const user = JSON.parse(saved);
    window.currentUser = user;
    const nameEl = document.getElementById("nav-username");
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

// Run auth check
const currentBuyer = checkAuth();

// ── Sign-out helper ───────────────────────────────────────
window.handleLogout = function() {
  localStorage.removeItem("makan_user");
  window.location.href = "login.html";
};

// ── Buyer-to-Seller Chat ──────────────────────────────────
let buyerChatUnsubscribe = null;

window.openBuyerChat = function(orderId) {
  document.getElementById("buyerChatModal").classList.remove("hidden");
  document.getElementById("buyerChatOrderId").textContent = orderId.slice(-5).toUpperCase();
  window._currentBuyerChatOrderId = orderId;

  // Hide unread badge when chat opened
  hideBuyerChatBadge();

  if (buyerChatUnsubscribe) buyerChatUnsubscribe();
  buyerChatUnsubscribe = onSnapshot(doc(db, "orders", orderId), (snap) => {
    if (!snap.exists()) return;
    const msgs = snap.data().chatMessages || [];
    const box  = document.getElementById("buyerChatBody");
    box.innerHTML = msgs.map(m => {
      const isBuyer = m.sender === "buyer";
      const time = m.time ? new Date(m.time).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'}) : "";
      return `
      <div class="flex flex-col ${isBuyer ? "items-end" : "items-start"}">
        <span class="text-[8px] text-gray-500 mb-0.5">${isBuyer ? "YOU" : "RESTAURANT"} · ${time}</span>
        <div class="px-3 py-2 rounded-xl max-w-[80%] text-sm
          ${isBuyer
            ? "bg-gradient-to-r from-[#0284c7] to-[#00f2fe] text-white font-medium rounded-tr-sm shadow-md shadow-cyan-500/20"
            : "bg-white/10 text-white rounded-tl-sm"}">
          ${m.text}
        </div>
      </div>`;
    }).join("");
    box.scrollTop = box.scrollHeight;
  });
};

window.closeBuyerChat = function() {
  document.getElementById("buyerChatModal").classList.add("hidden");
  if (buyerChatUnsubscribe) buyerChatUnsubscribe();
};

window.sendBuyerChat = async function() {
  const input   = document.getElementById("buyerChatInput");
  const val     = input.value.trim();
  const orderId = window._currentBuyerChatOrderId;
  if (!val || !orderId) return;
  input.value = "";
  await updateDoc(doc(db, "orders", orderId), {
    chatMessages: arrayUnion({ sender: "buyer", text: val, time: Date.now() })
  });
};

// ── Open Chat from Latest Order (navbar/FAB button) ────────
window.openBuyerChatLatest = async function() {
  try {
    const snap   = await getDocs(collection(db, "orders"));
    const orders = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

    if (!orders.length) {
      // Show friendly message in chat window instead of alert
      if (typeof appendMessage === "function") {
        appendMessage("💬 You don't have any orders yet. Place an order first to chat with the merchant!", true);
      } else {
        alert("No orders found. Place an order first to chat with the restaurant.");
      }
      return;
    }

    // Open chat for the most recent order
    window.openBuyerChat(orders[0].id);
  } catch (err) {
    console.error("Chat open error:", err);
  }
};

// ── Realtime notification: detect new seller messages ──────
let lastKnownSellerMsgCount = 0;
let notifUnsubscribe = null;

function startSellerMsgNotifier() {
  // Listen to all orders for new messages from seller
  notifUnsubscribe = onSnapshot(collection(db, "orders"), (snap) => {
    // Count total seller messages across all orders
    let totalSellerMsgs = 0;
    let hasNewSellerMsg  = false;

    snap.docs.forEach(d => {
      const msgs = d.data().chatMessages || [];
      const sellerMsgs = msgs.filter(m => m.sender === "seller");
      totalSellerMsgs += sellerMsgs.length;

      // If last message is from seller = unread
      if (msgs.length > 0 && msgs[msgs.length - 1].sender === "seller") {
        // Check if chat modal is NOT currently open for this order
        const modalOpen = !document.getElementById("buyerChatModal")?.classList.contains("hidden")
                          && window._currentBuyerChatOrderId === d.id;
        if (!modalOpen) hasNewSellerMsg = true;
      }
    });

    // Show/hide badge
    if (hasNewSellerMsg) {
      showBuyerChatBadge();
    } else {
      hideBuyerChatBadge();
    }
  });
}

function showBuyerChatBadge() {
  const navBadge = document.getElementById("buyer-chat-badge");
  const fabBadge = document.getElementById("chat-fab-badge");
  if (navBadge) navBadge.classList.remove("hidden");
  if (fabBadge) fabBadge.classList.remove("hidden");
}

function hideBuyerChatBadge() {
  const navBadge = document.getElementById("buyer-chat-badge");
  const fabBadge = document.getElementById("chat-fab-badge");
  if (navBadge) navBadge.classList.add("hidden");
  if (fabBadge) fabBadge.classList.add("hidden");
}

// ── Track Order ───────────────────────────────────────────
window.trackLatestOrder = async function() {
  const user = window.currentUser || JSON.parse(localStorage.getItem("makan_user") || "null");
  if (!user) {
    alert("Please log in first.");
    return;
  }

  const snap = await getDocs(collection(db, "orders"));
  const orders = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

  if (!orders.length) {
    alert("No orders found yet.");
    return;
  }

  const latest = orders[0];

  // Use the WADJS trackLatestOrder if available, else open chat
  if (typeof window._wadTrackOrder === "function") {
    window._wadTrackOrder(latest.id);
  } else {
    // Fall back to inline tracking in chat (via WADJS.js)
    if (typeof window.trackLatestOrderInChat === "function") {
      window.trackLatestOrderInChat();
    }
  }
};

// Start notifier after page load
window.addEventListener("load", () => {
  startSellerMsgNotifier();
});
