// buyer-firebase.js — Buyer page Firebase logic
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, doc,
  updateDoc, setDoc, onSnapshot, arrayUnion, query, orderBy, limit
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

// -- Buyer-to-Seller Chat (satu chat per buyer, bukan per order) --
// Firestore: collection "chats", doc id = email buyer (lowercase)
let buyerChatUnsubscribe = null;

function buyerChatKey() {
  const u = window.currentUser || JSON.parse(localStorage.getItem("makan_user") || "null");
  if (!u) return null;
  return String(u.email || u.id || u.name || "").toLowerCase().trim().replace(/\//g, "_") || null;
}

function escapeChatHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// orderId diabaikan (parameter dipertahankan agar tombol lama tetap kompatibel)
window.openBuyerChat = function() {
  const key = buyerChatKey();
  if (!key) { alert("Please log in first."); return; }
  const user = window.currentUser || {};

  document.getElementById("buyerChatModal").classList.remove("hidden");
  const label = document.getElementById("buyerChatOrderId");
  if (label) label.textContent = user.name || user.email || "";
  window._currentBuyerChatKey = key;
  hideBuyerChatBadge();

  if (buyerChatUnsubscribe) buyerChatUnsubscribe();
  buyerChatUnsubscribe = onSnapshot(doc(db, "chats", key), (snap) => {
    const msgs = snap.exists() ? (snap.data().messages || []) : [];
    const box  = document.getElementById("buyerChatBody");
    if (!msgs.length) {
      box.innerHTML = `<div style="text-align:center; color:#555; font-size:0.8rem; padding:1rem;">No messages yet. Start a conversation with the restaurant!</div>`;
      return;
    }
    box.innerHTML = msgs.map(m => {
      const isBuyer = m.sender === "buyer";
      const time = m.time ? new Date(m.time).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'}) : "";
      return `
      <div class="flex flex-col ${isBuyer ? "items-end" : "items-start"}">
        <span class="text-[8px] text-gray-500 mb-0.5">${isBuyer ? "YOU" : "RESTAURANT"} � ${time}</span>
        <div class="px-3 py-2 rounded-xl max-w-[80%] text-sm
          ${isBuyer
            ? "bg-gradient-to-r from-[#0284c7] to-[#00f2fe] text-white font-medium rounded-tr-sm shadow-md shadow-cyan-500/20"
            : "bg-white/10 text-white rounded-tl-sm"}">
          ${escapeChatHtml(m.text)}
        </div>
      </div>`;
    }).join("");
    box.scrollTop = box.scrollHeight;
  });
};

window.closeBuyerChat = function() {
  document.getElementById("buyerChatModal").classList.add("hidden");
  if (buyerChatUnsubscribe) buyerChatUnsubscribe();
  window._currentBuyerChatKey = null;
};

window.sendBuyerChat = async function() {
  const input = document.getElementById("buyerChatInput");
  const val   = input.value.trim();
  const key   = window._currentBuyerChatKey || buyerChatKey();
  if (!val || !key) return;
  input.value = "";
  const user = window.currentUser || {};
  const now = Date.now();
  await setDoc(doc(db, "chats", key), {
    buyerKey: key,
    buyerName: user.name || (user.email || "").split("@")[0] || "Buyer",
    buyerEmail: user.email || "",
    lastMessageAt: now,
    messages: arrayUnion({ sender: "buyer", text: val, time: now })
  }, { merge: true });
};

// -- Open Chat (navbar/FAB button) � langsung chat milik buyer --
window.openBuyerChatLatest = function() {
  window.openBuyerChat();
};

// -- Realtime notification: pesan baru dari seller ----------
let notifUnsubscribe = null;

function startSellerMsgNotifier() {
  const key = buyerChatKey();
  if (!key) return;
  notifUnsubscribe = onSnapshot(doc(db, "chats", key), (snap) => {
    const msgs = snap.exists() ? (snap.data().messages || []) : [];
    const lastIsSeller = msgs.length > 0 && msgs[msgs.length - 1].sender === "seller";
    const modalOpen = !document.getElementById("buyerChatModal")?.classList.contains("hidden");
    if (lastIsSeller && !modalOpen) showBuyerChatBadge();
    else hideBuyerChatBadge();
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

