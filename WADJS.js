
// ===============================
// GLOBAL STATE
// ===============================
let cart = [];
let menuData = [];
let isCheckingOut = false; // prevent duplicate submissions
window.tempLat = -6.2856;
window.tempLng = 107.1706;
window.selectedLocation = null;

// ===============================
// FIRESTORE IMPORT (DYNAMIC) & CART PERSISTENCE
// ===============================
let db;

function getCustomerCartStorageKey() {
    const saved = window.currentUser || JSON.parse(localStorage.getItem("makan_user") || "{}");
    const key = (saved.email || saved.uid || "guest").toLowerCase().replace(/[^a-z0-9]/g, "_");
    return `makan_cart_${key}`;
}

function saveCartToStorage() {
    try {
        const key = getCustomerCartStorageKey();
        localStorage.setItem(key, JSON.stringify(cart));
    } catch(e) {
        console.error("Cart save error:", e);
    }
}

function loadCartFromStorage() {
    try {
        const key = getCustomerCartStorageKey();
        const saved = localStorage.getItem(key);
        if (saved) {
            cart = JSON.parse(saved);
        } else {
            cart = [];
        }
    } catch(e) {
        cart = [];
    }
}

window.addEventListener("load", async () => {
    db = window.db;
    loadCartFromStorage();
    updateCartBadge();
    loadMenuRealtime();
});

// ===============================
// LOCATION / MAP
// ===============================
window.confirmLocation = function(inputId) {
    const addressDetail = document.getElementById(inputId).value;
    if (window.tempLat && window.tempLng) {
        window.selectedLocation = {
            lat: window.tempLat,
            lng: window.tempLng,
            address: addressDetail || "No detail provided"
        };
        appendMessage(`✅ Location saved: ${window.selectedLocation.address}`);
        processCheckout();
    } else {
        alert("Location is not ready, please move the map pin.");
    }
};

// ===============================
// ADD TO CART (NO STOCK DEDUCTION)
// ===============================
window.addToCart = function(id, qty = 1) {
    const item = menuData.find(m => m.id === id);
    if (!item) return;

    // Check stock availability (read-only check, no deduction)
    const currentInCart = cart.find(c => c.id === id);
    const totalInCart = currentInCart ? currentInCart.quantity + qty : qty;
    if (item.stock !== undefined && totalInCart > item.stock) {
        showCartToast(`⚠️ Only ${item.stock} ${item.name} available`, "warning");
        return;
    }

    // Add to local cart array
    if (currentInCart) {
        currentInCart.quantity += qty;
    } else {
        cart.push({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: qty,
            emoji: item.emoji || "🍽️",
            image: item.image || null
        });
    }

    saveCartToStorage();
    updateCartBadge();
    showCartToast(`✓ ${item.emoji || "🍽️"} ${item.name} added to cart`, "success");

    // Animate the floating cart button
    const trigger = document.getElementById("cart-trigger");
    if (trigger) {
        trigger.classList.add("cart-bounce");
        setTimeout(() => trigger.classList.remove("cart-bounce"), 500);
    }
};

// Update qty directly
window.updateCartQty = function(id, delta) {
    const item = cart.find(c => c.id === id);
    if (!item) return;

    const menuItem = menuData.find(m => m.id === id);
    const newQty = item.quantity + delta;

    if (newQty <= 0) {
        removeFromCart(id);
        return;
    }

    // Stock validation
    if (menuItem && menuItem.stock !== undefined && newQty > menuItem.stock) {
        showCartToast(`⚠️ Max ${menuItem.stock} available for ${item.name}`, "warning");
        return;
    }

    item.quantity = newQty;
    saveCartToStorage();
    updateCartBadge();
    renderCartDrawer();
};

// Remove by product ID
window.removeFromCart = function(id) {
    const idx = cart.findIndex(c => c.id === id);
    if (idx === -1) return;
    const removed = cart.splice(idx, 1)[0];
    saveCartToStorage();
    updateCartBadge();
    renderCartDrawer();
    showCartToast(`${removed.name} removed from cart`, "info");
};

window.clearCart = function() {
    if (cart.length === 0) return;
    if (!confirm("Remove all items from cart?")) return;
    cart = [];
    saveCartToStorage();
    updateCartBadge();
    renderCartDrawer();
};

// ===============================
// CART BADGE & FLOATING BUTTON
// ===============================
function updateCartBadge() {
    const count = cart.reduce((s, i) => s + i.quantity, 0);
    const badge = document.getElementById("cart-count");
    const trigger = document.getElementById("cart-trigger");
    const navBadge = document.getElementById("nav-cart-badge");

    if (badge) badge.innerText = count;
    if (navBadge) {
        navBadge.innerText = count;
        navBadge.style.display = count > 0 ? "flex" : "none";
    }
    if (trigger) {
        if (count > 0) {
            trigger.classList.remove("hidden");
        } else {
            trigger.classList.add("hidden");
        }
    }
}
window.updateCartBadge = updateCartBadge;

// ===============================
// TOAST NOTIFICATION
// ===============================
function showCartToast(message, type = "success") {
    // Remove any existing toast
    const existing = document.getElementById("cart-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "cart-toast";
    toast.className = `cart-toast cart-toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add("cart-toast-show");
    });

    setTimeout(() => {
        toast.classList.remove("cart-toast-show");
        toast.classList.add("cart-toast-hide");
        setTimeout(() => toast.remove(), 300);
    }, 2200);
}

// ===============================
// CART DRAWER (SLIDE-IN PANEL)
// ===============================
window.viewCart = function() {
    const drawer = document.getElementById("cart-drawer");
    if (!drawer) return;
    renderCartDrawer();
    drawer.classList.remove("hidden");
    drawer.classList.add("cart-drawer-open");
    document.body.style.overflow = "hidden";
};

window.closeCartDrawer = function() {
    const drawer = document.getElementById("cart-drawer");
    if (!drawer) return;
    drawer.classList.remove("cart-drawer-open");
    drawer.classList.add("cart-drawer-closing");
    setTimeout(() => {
        drawer.classList.add("hidden");
        drawer.classList.remove("cart-drawer-closing");
        document.body.style.overflow = "";
    }, 280);
};

function renderCartDrawer() {
    const body = document.getElementById("cart-drawer-body");
    const footer = document.getElementById("cart-drawer-footer");
    const countEl = document.getElementById("cart-drawer-count");
    if (!body) return;

    const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
    const totalPrice = cart.reduce((s, i) => s + (i.price * i.quantity), 0);

    if (countEl) countEl.innerText = totalItems;

    if (cart.length === 0) {
        body.innerHTML = `
            <div class="cart-empty-state">
                <div class="cart-empty-icon">🛒</div>
                <h3 class="cart-empty-title">Your cart is empty</h3>
                <p class="cart-empty-desc">Browse our delicious menu and add items to get started!</p>
                <button onclick="closeCartDrawer(); setQuery('📖 Menu');" class="btn-pill btn-orange mt-4" style="padding:10px 24px;">
                    🍽️ Explore Menu
                </button>
            </div>
        `;
        if (footer) footer.style.display = "none";
        return;
    }

    if (footer) footer.style.display = "";

    body.innerHTML = cart.map(item => {
        const subtotal = item.price * item.quantity;
        const menuItem = menuData.find(m => m.id === item.id);
        const maxStock = menuItem ? menuItem.stock : 999;
        const imgSrc = resolveImage(item);

        return `
            <div class="cart-item" data-id="${item.id}">
                <img src="${imgSrc}" alt="${item.name}" class="cart-item-img" onerror="this.style.display='none'">
                <div class="cart-item-details">
                    <div class="cart-item-top-row">
                        <div>
                            <span class="cart-item-name">${item.emoji} ${item.name}</span>
                            <span class="cart-item-unit-price">Rp ${item.price.toLocaleString()} each</span>
                        </div>
                        <button class="cart-item-remove" onclick="removeFromCart('${item.id}')" title="Remove item">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="cart-item-bottom-row">
                        <div class="cart-qty-controls">
                            <button class="cart-qty-btn" onclick="updateCartQty('${item.id}', -1)" ${item.quantity <= 1 ? '' : ''}>−</button>
                            <span class="cart-qty-value">${item.quantity}</span>
                            <button class="cart-qty-btn" onclick="updateCartQty('${item.id}', 1)" ${item.quantity >= maxStock ? 'disabled' : ''}>+</button>
                        </div>
                        <span class="cart-item-subtotal">Rp ${subtotal.toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Update footer totals
    const totalEl = document.getElementById("cart-drawer-total");
    const totalItemsEl = document.getElementById("cart-drawer-total-items");
    if (totalEl) totalEl.innerText = `Rp ${totalPrice.toLocaleString()}`;
    if (totalItemsEl) totalItemsEl.innerText = `${totalItems} item${totalItems > 1 ? 's' : ''}`;
}

const DEFAULT_MENU_CATALOG = [
    // ── FOOD ────────────────────────────────────────────────
    {
        name: "Nasi Goreng Spesial",
        category: "food",
        price: 22000,
        stock: 25,
        emoji: "🍳",
        tags: ["food", "savory", "spicy"],
        image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Chaufa_salvaje_Selva_17042010.JPG/330px-Chaufa_salvaje_Selva_17042010.JPG"
    },
    {
        name: "Ayam Geprek Sambal Matah",
        category: "food",
        price: 18000,
        stock: 30,
        emoji: "🍗",
        tags: ["food", "spicy", "cheap"],
        image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Ayam_sambal_matah_dan_tempe_goreng.jpg/330px-Ayam_sambal_matah_dan_tempe_goreng.jpg"
    },
    {
        name: "Bakso Mercon Pedas",
        category: "food",
        price: 16000,
        stock: 30,
        emoji: "🍲",
        tags: ["food", "spicy", "cheap"],
        image: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Bakso_mi_bihun.jpg/330px-Bakso_mi_bihun.jpg"
    },
    {
        name: "Mie Ayam Jamur",
        category: "food",
        price: 15000,
        stock: 35,
        emoji: "🍜",
        tags: ["food", "savory", "cheap"],
        image: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Mi_ayam_jamur.JPG/330px-Mi_ayam_jamur.JPG"
    },
    {
        name: "Sate Ayam Madura",
        category: "food",
        price: 28000,
        stock: 20,
        emoji: "🍢",
        tags: ["food", "sweet", "savory"],
        image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Sate_Ponorogo.jpg/330px-Sate_Ponorogo.jpg"
    },
    {
        name: "Ayam Bakar Madu",
        category: "food",
        price: 30000,
        stock: 20,
        emoji: "🍗",
        tags: ["food", "sweet", "savory"],
        image: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Ayam_bakar_bumbu_rujak.jpg/330px-Ayam_bakar_bumbu_rujak.jpg"
    },
    {
        name: "Rendang Daging Padang",
        category: "food",
        price: 35000,
        stock: 15,
        emoji: "🥩",
        tags: ["food", "spicy", "savory"],
        image: "https://images.unsplash.com/photo-1548943487-a2e4142f6f96?auto=format&fit=crop&w=400&q=80"
    },

    // ── DRINKS ──────────────────────────────────────────────
    {
        name: "Es Teh Manis",
        category: "drink",
        price: 6000,
        stock: 50,
        emoji: "🧋",
        tags: ["drink", "sweet", "cheap"],
        image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/ES_TEH_MANIS.jpg/330px-ES_TEH_MANIS.jpg"
    },
    {
        name: "Es Jeruk Peras",
        category: "drink",
        price: 10000,
        stock: 40,
        emoji: "🍊",
        tags: ["drink", "sweet", "cheap"],
        image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Orangejuice.jpg/330px-Orangejuice.jpg"
    },
    {
        name: "Es Kopi Susu Gula Aren",
        category: "drink",
        price: 18000,
        stock: 30,
        emoji: "☕",
        tags: ["drink", "sweet", "cheap"],
        image: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=400&q=80"
    },
    {
        name: "Matcha Latte Iced",
        category: "drink",
        price: 25000,
        stock: 25,
        emoji: "🍵",
        tags: ["drink", "sweet"],
        image: "https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=400&q=80"
    },
    {
        name: "Mango Smoothie",
        category: "drink",
        price: 24000,
        stock: 20,
        emoji: "🥭",
        tags: ["drink", "sweet"],
        image: "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?auto=format&fit=crop&w=400&q=80"
    },

    // ── DESSERT ─────────────────────────────────────────────
    {
        name: "Es Cendol Dawet",
        category: "dessert",
        price: 12000,
        stock: 25,
        emoji: "🍧",
        tags: ["dessert", "sweet", "cheap"],
        image: "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=400&q=80"
    },
    {
        name: "Pisang Goreng Cokelat Keju",
        category: "dessert",
        price: 14000,
        stock: 30,
        emoji: "🍌",
        tags: ["dessert", "sweet", "cheap"],
        image: "https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?auto=format&fit=crop&w=400&q=80"
    },
    {
        name: "Martabak Mini Manis",
        category: "dessert",
        price: 15000,
        stock: 25,
        emoji: "🥞",
        tags: ["dessert", "sweet", "cheap"],
        image: "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=400&q=80"
    },
    {
        name: "Vanilla Gelato Scoop",
        category: "dessert",
        price: 18000,
        stock: 20,
        emoji: "🍨",
        tags: ["dessert", "sweet", "cheap"],
        image: "https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=400&q=80"
    },
    {
        name: "Chocolate Lava Cake",
        category: "dessert",
        price: 28000,
        stock: 15,
        emoji: "🍫",
        tags: ["dessert", "sweet"],
        image: "https://images.unsplash.com/photo-1624353365286-3f8d62daad51?auto=format&fit=crop&w=400&q=80"
    },
    {
        name: "Classic Tiramisu Cup",
        category: "dessert",
        price: 32000,
        stock: 15,
        emoji: "🍰",
        tags: ["dessert", "sweet"],
        image: "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=400&q=80"
    }
];

function inferCategory(item) {
    const explicit = (item.category || "").toLowerCase().trim();
    if (explicit === "food" || explicit === "drink" || explicit === "dessert") return explicit;
    if (explicit === "drinks" || explicit === "beverage" || explicit === "beverages") return "drink";

    const tags = (item.tags || []).map(t => String(t).toLowerCase().trim());
    if (tags.includes("dessert")) return "dessert";
    if (tags.includes("drink") || tags.includes("drinks") || tags.includes("beverage")) return "drink";
    if (tags.includes("food")) return "food";

    const name = (item.name || "").toLowerCase();
    if (/(cendol|pisang|martabak|gelato|ice cream|cake|tiramisu|pudding|brownie|donut|waffle|dessert|kue|klepon)/.test(name)) {
        return "dessert";
    }
    if (/(es teh|es jeruk|teh|kopi|coffee|latte|matcha|juice|jus|smoothie|boba|milk|susu|air|water|soda|drink|minum)/.test(name)) {
        return "drink";
    }
    if (tags.includes("sweet") && !tags.includes("savory") && !tags.includes("spicy")) {
        return "dessert";
    }
    return "food";
}

function matchesFlavorFilter(item, filterKey) {
    if (!filterKey || filterKey === "all") return true;
    const tags = (item.tags || []).map(t => String(t).toLowerCase().trim());
    const name = (item.name || "").toLowerCase();
    if (filterKey === "cheap") {
        return tags.includes("cheap") || Number(item.price || 0) <= 20000;
    }
    if (filterKey === "spicy") {
        return tags.includes("spicy") || /(pedas|mercon|geprek|sambal|balado|rendang|rica)/.test(name);
    }
    if (filterKey === "sweet") {
        return tags.includes("sweet") || /(manis|madu|gula|cokelat|chocolate|vanilla|tiramisu|matcha|mango|smoothie|cendol|cake|gelato|martabak)/.test(name);
    }
    return tags.includes(filterKey);
}

function resolveFallbackImage(item) {
    const cat = inferCategory(item);
    if (cat === "dessert") return "images/sweets.jpg.webp";
    if (matchesFlavorFilter(item, "spicy")) return "images/spicy.jpg";
    if (matchesFlavorFilter(item, "cheap")) return "images/cheap.jpg";
    return "images/savory.jpg";
}

function resolveImage(item) {
    if (item.image) return item.image;
    const name = (item.name || "food").toLowerCase().trim();
    const FOOD_MAP = [
        { key: "nasi goreng", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Chaufa_salvaje_Selva_17042010.JPG/330px-Chaufa_salvaje_Selva_17042010.JPG" },
        { key: "nasi", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Chaufa_salvaje_Selva_17042010.JPG/330px-Chaufa_salvaje_Selva_17042010.JPG" },
        { key: "sate", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Sate_Ponorogo.jpg/330px-Sate_Ponorogo.jpg" },
        { key: "ayam bakar", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Ayam_bakar_bumbu_rujak.jpg/330px-Ayam_bakar_bumbu_rujak.jpg" },
        { key: "ayam geprek", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Ayam_sambal_matah_dan_tempe_goreng.jpg/330px-Ayam_sambal_matah_dan_tempe_goreng.jpg" },
        { key: "ayam", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Ayam_sambal_matah_dan_tempe_goreng.jpg/330px-Ayam_sambal_matah_dan_tempe_goreng.jpg" },
        { key: "sop iga", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Sop_Iga.jpg/330px-Sop_Iga.jpg" },
        { key: "iga", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Sop_Iga.jpg/330px-Sop_Iga.jpg" },
        { key: "bakso", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Bakso_mi_bihun.jpg/330px-Bakso_mi_bihun.jpg" },
        { key: "tempe", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Tempeh_%288681605421%29.jpg/330px-Tempeh_%288681605421%29.jpg" },
        { key: "soto", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Soto_Betawi_Daging_Sapi.jpg/330px-Soto_Betawi_Daging_Sapi.jpg" },
        { key: "es jeruk", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Orangejuice.jpg/330px-Orangejuice.jpg" },
        { key: "jeruk", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Orangejuice.jpg/330px-Orangejuice.jpg" },
        { key: "es teh", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/ES_TEH_MANIS.jpg/330px-ES_TEH_MANIS.jpg" },
        { key: "teh", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/ES_TEH_MANIS.jpg/330px-ES_TEH_MANIS.jpg" },
        { key: "kopi", url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=400&q=80" },
        { key: "coffee", url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=400&q=80" },
        { key: "mango", url: "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?auto=format&fit=crop&w=400&q=80" },
        { key: "smoothie", url: "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?auto=format&fit=crop&w=400&q=80" },
        { key: "cendol", url: "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=400&q=80" },
        { key: "pisang", url: "https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?auto=format&fit=crop&w=400&q=80" },
        { key: "martabak", url: "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=400&q=80" },
        { key: "gelato", url: "https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=400&q=80" },
        { key: "lava cake", url: "https://images.unsplash.com/photo-1624353365286-3f8d62daad51?auto=format&fit=crop&w=400&q=80" },
        { key: "tiramisu", url: "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=400&q=80" },
        { key: "cake", url: "https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=400&q=80" },
        { key: "gado", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Gado_gado.jpg/330px-Gado_gado.jpg" },
        { key: "burger", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/NCI_Visuals_Food_Hamburger.jpg/330px-NCI_Visuals_Food_Hamburger.jpg" },
        { key: "batagor", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Batagor.jpg/330px-Batagor.jpg" },
        { key: "mie", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Mi_ayam_jamur.JPG/330px-Mi_ayam_jamur.JPG" },
        { key: "jagung", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Jagung_bakar.jpg/330px-Jagung_bakar.jpg" },
        { key: "matcha", url: "https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=400&q=80" },
        { key: "rendang", url: "https://images.unsplash.com/photo-1548943487-a2e4142f6f96?auto=format&fit=crop&w=400&q=80" }
    ];
    for (const m of FOOD_MAP) {
        if (name.includes(m.key)) return m.url;
    }
    return resolveFallbackImage(item);
}

// ===============================
// CHECKOUT (from Cart Drawer)
// ===============================
window.startCheckout = function() {
    if (cart.length === 0) return;
    closeCartDrawer();
    setTimeout(() => {
        processCheckout();
    }, 300);
};

window.processCheckout = function() {
    if (cart.length === 0) {
        appendMessage("Your cart is still empty. Let's choose a menu first!");
        return;
    }

    // Validate delivery location
    if (!selectedLocation) {
        appendMessage("📍 <b>Delivery location not set.</b><br>Please pin your location on the map before checking out.");
        showMap();
        return;
    }

    // Validate stock at checkout time
    for (const cartItem of cart) {
        const menuItem = menuData.find(m => m.id === cartItem.id);
        if (menuItem && menuItem.stock !== undefined && cartItem.quantity > menuItem.stock) {
            appendMessage(`⚠️ Sorry, <b>${cartItem.name}</b> only has ${menuItem.stock} in stock, but you requested ${cartItem.quantity}. Please adjust your cart.`);
            viewCart();
            return;
        }
    }

    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const chat = document.getElementById("chat-window");

    const checkoutDiv = document.createElement("div");
    checkoutDiv.className = "msg-bot animate-in";

    let itemsHtml = cart.map(item => `
        <div class="flex justify-between items-center text-xs py-1.5 border-b border-white/5">
            <span class="text-white/90 font-medium">${item.emoji || "🍽️"} ${item.name} <span class="text-gray-400">×${item.quantity}</span></span>
            <span class="text-cyan-400 font-semibold">Rp ${(item.price * item.quantity).toLocaleString()}</span>
        </div>
    `).join('');

    checkoutDiv.innerHTML = `
        <div class="bot-avatar">🧾</div>
        <div class="bubble-bot" style="min-width: 280px; max-width: 380px;">
            <span class="sender-name">Order Summary</span>
            <div class="flex items-center gap-1.5 text-[10px] text-cyan-400 mb-2.5 bg-cyan-500/10 border border-cyan-500/25 px-2.5 py-1.5 rounded-lg">
                <span>📍</span>
                <span class="truncate">${selectedLocation.address || "Location set"}</span>
            </div>
            <div class="my-3 text-gray-300">
                ${itemsHtml}
                <div class="flex justify-between items-center font-extrabold mt-3 text-white border-t border-cyan-500/30 pt-2.5">
                    <span class="text-xs uppercase tracking-wide text-gray-300">Total</span>
                    <span class="text-base text-cyan-400 font-extrabold">Rp ${total.toLocaleString()}</span>
                </div>
            </div>
            <p class="text-[10px] uppercase tracking-wider font-bold mb-2 text-gray-400">Select Payment Method:</p>
            <div class="flex flex-col gap-2">
                <button onclick="handlePayment('QRIS')" class="payment-btn">
                    <span>QRIS (Automatic Scan)</span><span>🖼️</span>
                </button>
                <button onclick="handlePayment('E-Wallet')" class="payment-btn">
                    <span>OVO / GoPay / Dana</span><span>📱</span>
                </button>
                <button onclick="handlePayment('Cash')" class="payment-btn">
                    <span>Cash on Delivery</span><span>💵</span>
                </button>
            </div>
        </div>
    `;
    chat.appendChild(checkoutDiv);
    chat.scrollTop = chat.scrollHeight;
};

// ===============================
// PAYMENT & ORDER FINALIZATION
// ===============================
window.handlePayment = async function(method) {
    if (cart.length === 0) return;
    if (isCheckingOut) {
        showCartToast("⏳ Order is being processed, please wait...", "warning");
        return;
    }

    appendMessage(`Processing your <b>${method}</b> payment...`);

    if (method === 'QRIS') {
        appendMessage(`
            <div class="bg-white p-3 rounded-xl flex flex-col items-center gap-2">
                <p class="text-black text-xs font-bold">Scan to Pay</p>
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MakanAI-Order" alt="QRIS" class="w-32 h-32">
                <button onclick="finalizeOrder('QRIS')" class="btn-pill btn-orange w-full">I Have Paid</button>
            </div>
        `, true);
    } else {
        finalizeOrder(method);
    }
};

window.finalizeOrder = async function(method) {
    if (isCheckingOut) return;
    isCheckingOut = true;

    try {
        const { collection, addDoc, serverTimestamp, doc, updateDoc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");

        // Final stock validation & deduction at order time
        for (const cartItem of cart) {
            const productRef = doc(window.db, "products", cartItem.id);
            const snap = await getDoc(productRef);
            if (snap.exists()) {
                const currentStock = snap.data().stock;
                if (currentStock !== undefined && cartItem.quantity > currentStock) {
                    appendMessage(`⚠️ Sorry, <b>${cartItem.name}</b> is now out of stock (only ${currentStock} left). Please adjust your cart.`);
                    isCheckingOut = false;
                    viewCart();
                    return;
                }
            }
        }

        // Deduct stock NOW (at successful order time, not at add-to-cart)
        for (const cartItem of cart) {
            const productRef = doc(window.db, "products", cartItem.id);
            const snap = await getDoc(productRef);
            if (snap.exists()) {
                const currentStock = snap.data().stock;
                if (currentStock !== undefined) {
                    await updateDoc(productRef, { stock: currentStock - cartItem.quantity });
                }
            }
        }

        const savedUser = window.currentUser || JSON.parse(localStorage.getItem("makan_user") || "{}");
        const customerName = savedUser.displayName || savedUser.name || (savedUser.email ? savedUser.email.split('@')[0] : "Customer");
        const customerEmail = savedUser.email || "";
        const customerId = savedUser.uid || savedUser.id || "";

        const orderData = {
            items: cart,
            totalPrice: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            method: method,
            location: window.selectedLocation || { address: "Location not specified" },
            status: "Processing",
            timestamp: serverTimestamp(),
            customerName: customerName,
            customerEmail: customerEmail,
            customerId: customerId,
            notes: window.tempOrderNotes || ""
        };

        await addDoc(collection(window.db, "orders"), orderData);

        // Success
        appendMessage(`✅ <b>Order Successful!</b><br>Method: ${method}<br>Your food is being prepared. 🍳`);
        showCartToast("🎉 Order placed successfully!", "success");

        cart = [];
        saveCartToStorage();
        updateCartBadge();

    } catch (error) {
        console.error("Order Error:", error);
        appendMessage("❌ Error processing your order. Please try again.");
    } finally {
        isCheckingOut = false;
    }
};

// ===============================
// CHATBOT INPUT
// ===============================
window.sendMessage = async function () {
    const input = document.getElementById("chat-input");
    const msg = input.value.trim();
    if (!msg) return;

    appendMessage(msg, false);
    const text = msg.toLowerCase();
    input.value = "";

    // ALL MENU
    if (text === "menu" || text.includes("all menu") || text.includes("semua menu") || text.includes("daftar menu") || text.includes("list menu")) {
        if (menuData.length === 0) {
            appendMessage("Sorry, there are currently no menus available in the database.");
        } else {
            appendMessage("Here is our entire menu list (Food, Drinks & Dessert):");
            displayFoodCards(menuData, { category: "all", title: "All Menu Catalog" });
        }
    }
    else if (text.includes("lokasi") || text.includes("map") || text.includes("peta")) {
        appendMessage("Please specify the delivery location on the map:");
        showMap();
    }
    else if (text.includes("keranjang") || text.includes("cart")) {
        viewCart();
    }
    else if (text.includes("checkout") || text.includes("bayar")) {
        processCheckout();
    }
    else if (text.includes("history") || text.includes("riwayat")) {
        showHistory();
    }
    else if (text === "admin" || text === "seller") {
        showSellerLink();
    }
    else {
        // NATURAL LANGUAGE CART PARSER
        let matchedItemsForCart = [];
        let addedNames = new Set();

        menuData.forEach(item => {
            const itemName = (item.name || "").toLowerCase().trim();
            if (itemName && itemName.length > 2 && text.includes(itemName) && !addedNames.has(itemName)) {
                const escapedName = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(\\d+)\\s*(?:porsi\\s*|x\\s*)?${escapedName}|${escapedName}\\s*(?:x\\s*)?(\\d+)`, 'i');
                const match = text.match(regex);

                let qty = 1;
                if (match) {
                    if (match[1]) qty = parseInt(match[1]);
                    else if (match[2]) qty = parseInt(match[2]);
                }

                matchedItemsForCart.push({ item: item, quantity: qty });
                addedNames.add(itemName);
            }
        });

        if (matchedItemsForCart.length > 0) {
            matchedItemsForCart.forEach(match => {
                addToCart(match.item.id, match.quantity);
            });

            const addedText = matchedItemsForCart.map(m => `<b>${m.quantity}x ${m.item.name}</b>`).join(", ");
            appendMessage(`✅ Added ${addedText} to your cart!`);
            return;
        }

        // 3-CATEGORY MENU ROUTING (Food, Drinks, Dessert) + Flavor Filter
        let targetCat = null;
        if (/\b(food|foods|makanan|makan)\b/.test(text)) targetCat = "food";
        else if (/\b(drink|drinks|beverage|beverages|minuman|minum)\b/.test(text)) targetCat = "drink";
        else if (/\b(dessert|desserts|pencuci mulut)\b/.test(text)) targetCat = "dessert";

        const flavorTags = ["cheap", "spicy", "sweet", "savory"];
        const detectedFlavors = flavorTags.filter(tag => text.includes(tag));

        if (targetCat) {
            let results = menuData.filter(item => inferCategory(item) === targetCat);
            if (detectedFlavors.length > 0) {
                results = results.filter(item => detectedFlavors.some(f => matchesFlavorFilter(item, f)));
            }
            const catMeta = {
                food:    { label: "Food Menu",    emoji: "🍛" },
                drink:   { label: "Drinks Menu",  emoji: "🥤" },
                dessert: { label: "Dessert Menu", emoji: "🍰" }
            }[targetCat];

            if (results.length > 0) {
                appendMessage(`${catMeta.emoji} Here is our <b>${catMeta.label}</b> — use the filter pills below to find <b>Cheap</b>, ${targetCat === "food" ? "<b>Spicy</b>, " : ""}or <b>Sweet</b> items:`);
                displayFoodCards(results, { category: targetCat, title: `${catMeta.emoji} ${catMeta.label}` });
            } else {
                appendMessage(`Sorry, no items found in ${catMeta.label}.`);
            }
            return;
        }

        // FLAVOR / TAG SEARCH FALLBACK
        if (detectedFlavors.length > 0) {
            const results = menuData.filter(item =>
                detectedFlavors.some(tag => matchesFlavorFilter(item, tag))
            );
            if (results.length > 0) {
                appendMessage(`Found menu matching <b>${detectedFlavors.join(", ")}</b>:`);
                displayFoodCards(results, { category: "all", title: `Filtered: ${detectedFlavors.join(", ")}` });
            } else {
                appendMessage("Sorry, that category is currently empty.");
            }
        } else {
            // Name search fallback
            const searchResults = menuData.filter(item => {
                const itemName = (item.name || "").toLowerCase();
                return itemName && (itemName.includes(text) || text.includes(itemName));
            });
            if (searchResults.length > 0) {
                appendMessage(`Here are the menus for "${msg}":`);
                displayFoodCards(searchResults, { category: "all", title: `Search: ${msg}` });
            } else {
                appendMessage("Sorry, I didn't quite catch that. Try choosing <b>Food</b>, <b>Drinks</b>, or <b>Dessert</b>, or type your order (e.g., '2 bakso')!");
            }
        }
    }
};

// ===============================
// REALTIME MENU LOADER
// ===============================
let hasSeededDefaultMenu = false;

async function loadMenuRealtime() {
    const { collection, onSnapshot, addDoc } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
    const q = collection(window.db, "products");
    onSnapshot(q, async (snapshot) => {
        const docs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Seed curated Food, Drinks & Dessert items if missing in Firestore (once per session)
        if (!hasSeededDefaultMenu) {
            hasSeededDefaultMenu = true;
            const existingNames = new Set(docs.map(d => (d.name || "").toLowerCase().trim()));
            const missing = DEFAULT_MENU_CATALOG.filter(item => !existingNames.has(item.name.toLowerCase().trim()));
            if (missing.length > 0) {
                for (const item of missing) {
                    try {
                        await addDoc(q, { ...item, createdAt: Date.now() });
                    } catch (seedErr) {
                        console.warn("Could not seed menu item:", item.name, seedErr);
                    }
                }
            }
        }

        menuData = docs.map(item => ({
            ...item,
            category: inferCategory(item)
        }));
        console.log("Menu data loaded:", menuData.length, "items");
    }, (error) => {
        console.error("Failed to load menu:", error);
    });
}

// ===============================
// CHAT HELPERS
// ===============================
function appendMessage(text, isBot = true) {
    const chat = document.getElementById("chat-window");
    const div = document.createElement("div");
    div.className = isBot ? "msg-bot animate-in" : "msg-user animate-in";

    div.innerHTML = isBot ? `
        <div class="bot-avatar">🤖</div>
        <div class="bubble-bot">
            <span class="sender-name">Assistant Bot</span>
            <p>${text}</p>
        </div>
    ` : `
        <div class="bubble-user">
            <p>${text}</p>
        </div>
    `;

    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

// ===============================
// FOOD CARD DISPLAY + SUB-FILTERS
// ===============================
window._catalogCache = window._catalogCache || {};

function buildFoodCardsHtml(items) {
    if (!items || items.length === 0) {
        return `<div style="padding:1rem; text-align:center; color:rgba(255,255,255,0.45); font-size:0.78rem; background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.12); border-radius:1rem;">No items match this filter yet.</div>`;
    }
    return items.map(item => {
        const isOutOfStock = item.stock <= 0;
        const inCart = cart.find(c => c.id === item.id);
        const qtyInCart = inCart ? inCart.quantity : 0;
        const imgUrl = resolveImage(item);
        const fallbackImg = resolveFallbackImage(item);
        const cat = inferCategory(item);
        const catLabel = cat === "drink" ? "Drinks" : cat === "dessert" ? "Dessert" : "Food";
        const flavorBadges = [];
        if (matchesFlavorFilter(item, "cheap")) flavorBadges.push(`<span class="tag-badge" style="background:rgba(34,197,94,0.14); color:#4ade80; border:1px solid rgba(34,197,94,0.3);">💸 Cheap</span>`);
        if (cat === "food" && matchesFlavorFilter(item, "spicy")) flavorBadges.push(`<span class="tag-badge" style="background:rgba(239,68,68,0.14); color:#f87171; border:1px solid rgba(239,68,68,0.3);">🔥 Spicy</span>`);
        if (matchesFlavorFilter(item, "sweet")) flavorBadges.push(`<span class="tag-badge" style="background:rgba(245,158,11,0.14); color:#fbbf24; border:1px solid rgba(245,158,11,0.3);">🍯 Sweet</span>`);

        return `
        <div class="food-card mb-2">
            <img src="${imgUrl}" alt="${item.name || 'Menu'}" class="menu-img" onerror="this.onerror=null; this.src='${fallbackImg}';">
            <div class="flex flex-col flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="sender-name" style="font-size:0.78rem; white-space:normal; word-break:break-word; line-height:1.3;">${item.emoji || ""} ${item.name || "Unnamed Menu"}</span>
                </div>
                <div class="flex gap-1.5 mt-1 items-center flex-wrap">
                    <span class="tag-badge">${catLabel}</span>
                    ${flavorBadges.join("")}
                    <span class="text-[10px] text-gray-400">Stock: ${item.stock ?? "∞"}</span>
                    ${qtyInCart > 0 ? `<span class="tag-badge" style="background:rgba(0,242,254,0.15); color:#00f2fe; border:1px solid rgba(0,242,254,0.3);">🛒 ${qtyInCart} in cart</span>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
                <div class="price-container">
                    <span class="price-label">Price</span>
                    <span class="price-value">Rp ${Number(item.price).toLocaleString()}</span>
                </div>
                ${isOutOfStock
                    ? '<button class="btn-pill btn-orange opacity-50 cursor-not-allowed" disabled>Sold Out</button>'
                    : `<div class="food-card-add-group">
                        <button onclick="addToCart('${item.id}')" class="btn-pill btn-orange food-card-add-btn">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            Add
                        </button>
                       </div>`
                }
            </div>
        </div>`;
    }).join("");
}

window.filterCatalogCards = function(catalogId, filterKey) {
    const entry = window._catalogCache[catalogId];
    if (!entry) return;

    const filtered = entry.items.filter(item => matchesFlavorFilter(item, filterKey));
    const listEl = document.getElementById(`cards-list-${catalogId}`);
    if (listEl) listEl.innerHTML = buildFoodCardsHtml(filtered);

    const barEl = document.getElementById(`subfilter-${catalogId}`);
    if (barEl) {
        barEl.querySelectorAll("button").forEach(btn => {
            const active = btn.dataset.filter === filterKey;
            btn.style.background = active ? "rgba(0, 242, 254, 0.25)" : "rgba(255, 255, 255, 0.06)";
            btn.style.borderColor = active ? "#00f2fe" : "rgba(255, 255, 255, 0.14)";
            btn.style.color = active ? "#ffffff" : "#94a3b8";
        });
    }
};

function displayFoodCards(items, options = {}) {
    const chat = document.getElementById("chat-window");
    const catalogId = "cat-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    const category = options.category || "all";
    const title = options.title || "Menu Catalog";

    window._catalogCache[catalogId] = { items, category };

    // Build sub-filters: Cheap & Sweet for all categories, Spicy specifically for Food (and All)
    const subFilters = [
        { key: "all",   label: "All" },
        { key: "cheap", label: "💸 Cheap" }
    ];
    if (category === "food" || category === "all") {
        subFilters.push({ key: "spicy", label: "🔥 Spicy" });
    }
    subFilters.push({ key: "sweet", label: "🍯 Sweet" });

    const subFilterHtml = `
        <div id="subfilter-${catalogId}" class="flex gap-1.5 flex-wrap my-2.5">
            ${subFilters.map((f, idx) => `
                <button type="button" data-filter="${f.key}" onclick="window.filterCatalogCards('${catalogId}', '${f.key}')"
                    style="font-size:0.7rem; font-weight:700; padding:5px 11px; border-radius:99px; cursor:pointer; transition:all 0.2s; border:1px solid ${idx === 0 ? '#00f2fe' : 'rgba(255,255,255,0.14)'}; background:${idx === 0 ? 'rgba(0,242,254,0.25)' : 'rgba(255,255,255,0.06)'}; color:${idx === 0 ? '#ffffff' : '#94a3b8'};">
                    ${f.label}
                </button>
            `).join("")}
        </div>
    `;

    const msgDiv = document.createElement("div");
    msgDiv.className = "msg-bot animate-in";
    msgDiv.innerHTML = `
        <div class="bot-avatar">🤖</div>
        <div class="bubble-bot" style="max-width: 90%;">
            <span class="sender-name">${title}</span>
            <p>Choose your favorite — tap <b>+ Add</b> to put items in your cart:</p>
            ${subFilterHtml}
            <div id="cards-list-${catalogId}" class="results-container animate-in">
                ${buildFoodCardsHtml(items)}
            </div>
        </div>
    `;

    chat.appendChild(msgDiv);
    chat.scrollTop = chat.scrollHeight;
}

// ===============================
// MAP HELPERS
// ===============================
window.buyerMapInstances = {};

window.performGeocode = async function(inputId, mapId) {
    const q = document.getElementById(inputId).value;
    if(!q) return;
    try {
        const btn = document.getElementById('search-btn-' + mapId);
        btn.innerText = "⏳";
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if(data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            window.tempLat = lat;
            window.tempLng = lon;
            const instance = window.buyerMapInstances[mapId];
            if(instance) {
                instance.map.flyTo([lat, lon], 17);
                instance.marker.setLatLng([lat, lon]);
            }
            btn.innerText = "✅";
            setTimeout(() => { btn.innerText = "🔍"; }, 2000);
        } else {
            btn.innerText = "❌";
            alert("Location not found! Try searching for a street or city name.");
            setTimeout(() => { btn.innerText = "🔍"; }, 2000);
        }
    } catch(e) { console.error(e); }
};

function showMap() {
    const mapId = "map-" + Date.now();
    const addressInputId = "addr-" + Date.now();
    const searchInputId = "search-" + Date.now();

    appendMessage(`
        <div class="bg-white/5 p-4 rounded-2xl border border-white/10 shadow-lg">
            <div class="flex items-center justify-between mb-2.5">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">📍 Set Shipping Address Pin:</span>
                <span class="text-[10px] text-cyan-400 font-medium">Drag pin to set exact spot</span>
            </div>
            <div class="flex gap-2 mb-2.5">
                <input type="text" id="${searchInputId}" placeholder="Search place or street name..." class="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-400 transition-colors" onkeypress="if(event.key === 'Enter') window.performGeocode('${searchInputId}', '${mapId}')">
                <button id="search-btn-${mapId}" onclick="window.performGeocode('${searchInputId}', '${mapId}')" class="bg-gradient-to-r from-[#0284c7] to-[#00f2fe] text-white font-bold px-3.5 rounded-xl flex items-center justify-center text-xs hover:opacity-95 shadow-md shadow-cyan-500/25 transition-all">🔍</button>
            </div>
            <div id="${mapId}" style="height: 190px; width: 100%; border-radius: 12px; margin-bottom: 10px; border: 1px solid rgba(0,242,254,0.18);"></div>
            <input type="text" id="${addressInputId}"
                placeholder="House Details (e.g., Black Gate)"
                class="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white mb-2.5 outline-none focus:border-cyan-400 transition-colors">
            <button onclick="window.confirmLocation('${addressInputId}')" class="btn-pill btn-orange w-full py-2.5 font-extrabold text-xs">
                Confirm Location
            </button>
        </div>
    `, true);

    setTimeout(() => {
        const map = L.map(mapId).setView([window.tempLat, window.tempLng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        const marker = L.marker([window.tempLat, window.tempLng], { draggable: true }).addTo(map);
        window.buyerMapInstances[mapId] = { map, marker };
        marker.on('dragend', function (e) {
            const pos = marker.getLatLng();
            window.tempLat = pos.lat;
            window.tempLng = pos.lng;
        });
        map.invalidateSize();
    }, 500);
}

// ===============================
// ORDER HISTORY
// ===============================
async function showHistory() {
    const { collection, query, getDocs, orderBy, limit } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
    appendMessage("🔎 Fetching your recent order history...");

    try {
        const q = query(collection(db, "orders"), orderBy("timestamp", "desc"), limit(5));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            appendMessage("No order history found yet.");
            return;
        }

        let historyHtml = `<div class="space-y-3 mt-2.5 max-w-md">`;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const orderId = doc.id;
            const date = data.timestamp?.toDate().toLocaleString('en-US', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) || "Just now";
            const status = data.status || "Processing";

            let statusPillClass = "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
            if (status === "Preparing") statusPillClass = "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
            else if (status === "On the Way") statusPillClass = "bg-blue-500/15 text-blue-400 border-blue-500/30";
            else if (status === "Delivered" || status === "Selesai") statusPillClass = "bg-green-500/15 text-green-400 border-green-500/30";

            historyHtml += `
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 text-left transition-all hover:border-cyan-500/30">
                    <div class="flex justify-between items-center mb-2.5 pb-2 border-b border-white/5">
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-mono font-bold text-gray-300">#${orderId.slice(-5).toUpperCase()}</span>
                            <span class="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border ${statusPillClass}">${status}</span>
                        </div>
                        <span class="text-[9px] text-gray-400">${date}</span>
                    </div>
                    <div class="text-xs text-gray-200 mb-2.5 space-y-1">
                        ${(data.items || []).map(i => `<div class="flex justify-between text-xs"><span>${i.name} ×${i.quantity}</span><span class="text-gray-400">Rp ${(i.price * i.quantity).toLocaleString()}</span></div>`).join('')}
                    </div>
                    <div class="flex justify-between items-center border-t border-white/5 pt-2.5 mt-1">
                        <div>
                            <span class="text-[9px] text-gray-400 uppercase tracking-wider block">Total</span>
                            <span class="text-sm font-extrabold text-cyan-400">Rp ${(data.totalPrice || 0).toLocaleString()}</span>
                        </div>
                        <button onclick="window.openBuyerChat('${orderId}')" class="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/25 px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5">
                            💬 Chat
                        </button>
                    </div>
                </div>
            `;
        });
        historyHtml += `</div>`;
        appendMessage(`<b>Order History 🧾</b>${historyHtml}`);

    } catch (error) {
        console.error("Error fetching history:", error);
        appendMessage("Failed to load history. Please try again later.");
    }
}
window.showHistory = showHistory;

// ===============================
// LIVE ORDER TRACKER
// ===============================
window.trackLatestOrderInChat = async function(forcedOrderId) {
    try {
        const { collection, getDocs, onSnapshot, doc } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");

        const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
        const rp  = (n) => "Rp " + (Number(n) || 0).toLocaleString("en-US");
        const tsToDate = (t) => {
            if (!t) return null;
            if (t.toDate) return t.toDate();
            if (t.seconds) return new Date(t.seconds * 1000);
            if (typeof t === "number") return new Date(t);
            return null;
        };
        const fmtTime = (d) => d ? d.toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
        const normStatus = (s) => {
            const v = String(s || "Processing").toLowerCase().trim();
            if (["processing", "pending", "paid"].includes(v)) return "Processing";
            if (v === "preparing") return "Preparing";
            if (["on the way", "ready", "shipping"].includes(v)) return "On the Way";
            if (["delivered", "selesai", "completed"].includes(v)) return "Delivered";
            if (["cancelled", "rejected", "batal"].includes(v)) return "Rejected";
            return "Processing";
        };

        // Only orders belonging to the logged-in buyer
        const user  = window.currentUser || JSON.parse(localStorage.getItem("makan_user") || "null");
        const email = (user?.email || "").toLowerCase().trim();
        const snapAll = await getDocs(collection(window.db, "orders"));
        const mine = snapAll.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(o => !email || (o.customerEmail || "").toLowerCase().trim() === email)
            .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        if (mine.length === 0) {
            appendMessage("🕵️‍♂️ You haven't placed any orders yet.");
            return;
        }

        const orderId = forcedOrderId || mine[0].id;
        const containerId = "tracker-live-" + orderId + "-" + Date.now();

        // Picker when there is more than one order
        const pickerHtml = mine.length > 1 ? `
            <div class="flex gap-1.5 flex-wrap mt-2">
                ${mine.slice(0, 6).map(o => {
                    const ns = normStatus(o.status);
                    const active = o.id === orderId;
                    return `<button onclick="window.trackLatestOrderInChat('${o.id}')"
                        class="text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${active ? 'bg-cyan-500/25 border-cyan-400 text-cyan-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-cyan-500/40'}">
                        #${o.id.slice(-5).toUpperCase()} · ${ns}</button>`;
                }).join("")}
            </div>` : "";

        appendMessage(`🔍 <b>Live Order Status:</b>${pickerHtml}
            <div id="${containerId}" class="mt-2 text-sm text-gray-400">Connecting to live feed...</div>`);

        if (window.buyerTrackerUnsubscribe) window.buyerTrackerUnsubscribe();
        if (window.buyerDeliveryMap) { try { window.buyerDeliveryMap.remove(); } catch (e) {} window.buyerDeliveryMap = null; }

        const steps = [
            { key: "Processing", label: "Order Placed",       icon: "🧾", desc: "Order received, waiting for restaurant confirmation" },
            { key: "Preparing",  label: "Preparing",          icon: "👨‍🍳", desc: "The restaurant is preparing your food" },
            { key: "On the Way", label: "On the Way",         icon: "🛵", desc: "The driver is heading to your location" },
            { key: "Delivered",  label: "Delivered",          icon: "✅", desc: "Your order has arrived. Enjoy your meal!" }
        ];

        window.buyerTrackerUnsubscribe = onSnapshot(doc(window.db, "orders", orderId), (docSnap) => {
            if (!docSnap.exists()) return;
            const order = docSnap.data();
            const el = document.getElementById(containerId);
            if (!el) return;

            const status = normStatus(order.status);
            const rejected = status === "Rejected";
            const currentIdx = rejected ? -1 : steps.findIndex(s => s.key === status);
            const progress = rejected ? 100 : ((currentIdx + 1) / steps.length) * 100;
            const showMap = status === "On the Way";
            const mapContainerId = "map-tracker-" + orderId + "-" + Date.now();

            // Time of each stage (from statusHistory recorded by the seller)
            const history = order.statusHistory || [];
            const timeFor = (key) => {
                const entries = history.filter(h => normStatus(h.status) === key);
                if (entries.length) return new Date(entries[entries.length - 1].time);
                if (key === "Processing") return tsToDate(order.timestamp);
                return null;
            };
            const rejectedAt = (() => {
                const e = history.filter(h => normStatus(h.status) === "Rejected");
                return e.length ? new Date(e[e.length - 1].time) : null;
            })();

            const items = order.items || [];
            const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
            const total = order.totalPrice || subtotal;
            const address = order.location?.address || "-";
            const addrDetail = order.location?.details || "";
            const orderDate = fmtTime(tsToDate(order.timestamp));

            const badgeClass = {
                "Processing": "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
                "Preparing":  "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
                "On the Way": "bg-blue-500/15 text-blue-300 border-blue-500/30",
                "Delivered":  "bg-green-500/15 text-green-300 border-green-500/30",
                "Rejected":   "bg-red-500/15 text-red-300 border-red-500/30"
            }[status];

            const headline = {
                "Processing": "Waiting for restaurant confirmation…",
                "Preparing":  "Your food is being prepared 🍳",
                "On the Way": "Your order is on its way 🛵",
                "Delivered":  "Your order has arrived 🎉",
                "Rejected":   "Order cancelled by the restaurant"
            }[status];

            const timelineHtml = rejected ? `
                <div class="bg-red-500/10 border border-red-500/25 rounded-xl p-3 mb-4 text-xs text-red-300">
                    <div class="font-bold mb-0.5">❌ Order Cancelled</div>
                    <div class="text-red-300/80">Sorry, the restaurant could not process this order.${rejectedAt ? " (" + fmtTime(rejectedAt) + ")" : ""} Please contact the merchant or place a new order.</div>
                </div>` : `
                <div class="mb-4">
                    ${steps.map((step, idx) => {
                        const done = idx < currentIdx || (idx === currentIdx && status === "Delivered");
                        const active = idx === currentIdx && status !== "Delivered";
                        const reached = idx <= currentIdx;
                        const t = timeFor(step.key);
                        const last = idx === steps.length - 1;
                        return `
                        <div class="flex gap-3">
                            <div class="flex flex-col items-center">
                                <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                                    done ? 'bg-cyan-400 text-black font-bold' :
                                    active ? 'bg-cyan-500/20 border border-cyan-400 shadow-[0_0_10px_#00f2fe] animate-pulse' :
                                    'bg-white/5 border border-white/10 grayscale opacity-50'}">${done ? '✓' : step.icon}</div>
                                ${last ? '' : `<div class="w-0.5 flex-1 min-h-[22px] ${idx < currentIdx ? 'bg-cyan-400' : 'bg-white/10'}"></div>`}
                            </div>
                            <div class="pb-4 -mt-0.5">
                                <div class="text-xs ${reached ? 'text-white font-bold' : 'text-gray-500'}">${step.label}
                                    ${active ? '<span class="ml-1 text-[9px] text-cyan-300 font-bold">● NOW</span>' : ''}</div>
                                <div class="text-[10px] ${reached ? 'text-gray-400' : 'text-gray-600'}">${step.desc}</div>
                                ${reached && t ? `<div class="text-[9px] text-cyan-400/80 mt-0.5">${fmtTime(t)}</div>` : ''}
                            </div>
                        </div>`;
                    }).join("")}
                </div>`;

            el.innerHTML = `
                <div class="bg-white/5 border border-white/10 rounded-2xl p-4 w-full max-w-sm shadow-xl">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Live Tracker 🛵</span>
                        <span class="text-[10px] text-gray-500 font-mono">#${orderId.slice(-5).toUpperCase()}</span>
                    </div>
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-[10px] text-gray-500">${orderDate || ""}</span>
                        <span class="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border ${badgeClass}">${status}</span>
                    </div>
                    <div class="text-sm font-bold text-white mb-2">${headline}</div>
                    <div class="relative h-1.5 bg-white/10 rounded-full mb-5 overflow-hidden">
                        <div class="absolute top-0 left-0 h-full ${rejected ? 'bg-red-500' : 'bg-gradient-to-r from-[#0284c7] to-[#00f2fe]'} rounded-full transition-all duration-1000" style="width:${progress}%"></div>
                    </div>

                    ${timelineHtml}

                    ${showMap ? `
                        <div class="bg-black/40 px-3 py-2 rounded-xl mb-2 border border-white/10 flex items-center gap-2">
                            <span class="bg-cyan-500/20 text-cyan-300 p-1.5 rounded-full text-[10px]">🛵</span>
                            <span class="text-[11px] font-bold text-white tracking-wide" id="eta-display-${mapContainerId}">Calculating ETA...</span>
                        </div>
                        <div id="${mapContainerId}" class="w-full h-36 rounded-xl bg-black/40 border border-white/10 mb-4 z-0 relative overflow-hidden"></div>
                    ` : ''}

                    <!-- Order details -->
                    <div class="border-t border-white/10 pt-3 mt-1">
                        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Order Details</div>
                        <div class="space-y-1 mb-2">
                            ${items.map(i => `
                                <div class="flex justify-between text-[11px] text-gray-200 gap-2">
                                    <span>${esc(i.emoji || "🍽️")} ${esc(i.name)} <span class="text-gray-500">×${i.quantity || 1}</span></span>
                                    <span class="text-gray-400 whitespace-nowrap">${rp((i.price || 0) * (i.quantity || 1))}</span>
                                </div>`).join("") || '<div class="text-[11px] text-gray-500">-</div>'}
                        </div>
                        <div class="flex justify-between items-center border-t border-white/5 pt-2 mb-3">
                            <span class="text-[10px] text-gray-400 uppercase tracking-wider">Total</span>
                            <span class="text-sm font-extrabold text-cyan-400">${rp(total)}</span>
                        </div>
                        <div class="text-[10px] text-gray-400 space-y-1">
                            <div class="flex gap-2"><span>💳</span><span>${esc(order.method || order.paymentMethod || "QRIS")}</span></div>
                            <div class="flex gap-2"><span>📍</span><span>${esc(address)}${addrDetail ? " — " + esc(addrDetail) : ""}</span></div>
                            ${order.notes ? `<div class="flex gap-2"><span>📝</span><span>${esc(order.notes)}</span></div>` : ""}
                        </div>
                    </div>

                    <button onclick="window.openBuyerChat()" class="w-full mt-3 bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 font-bold py-2 rounded-xl text-xs hover:bg-cyan-500/20 transition-all">
                        💬 Chat with Merchant
                    </button>
                </div>
            `;

            if (showMap && window.L) {
                setTimeout(() => {
                    const driverLat = order.driverLat || -6.2849;
                    const driverLng = order.driverLng || 107.1706;
                    const homeLat = order.location?.lat || -6.2856;
                    const homeLng = order.location?.lng || 107.1710;

                    if (window.buyerDeliveryMap) { try { window.buyerDeliveryMap.remove(); } catch (e) {} }
                    const map = L.map(mapContainerId, { zoomControl: false }).setView([driverLat, driverLng], 15);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                    const driverIcon = L.divIcon({ className: 'bg-transparent', html: '<div class="text-xl">🛵</div>', iconSize: [24, 24] });
                    const homeIcon   = L.divIcon({ className: 'bg-transparent', html: '<div class="text-xl">🏠</div>', iconSize: [24, 24] });
                    L.marker([driverLat, driverLng], { icon: driverIcon }).addTo(map);
                    L.marker([homeLat, homeLng], { icon: homeIcon }).addTo(map);
                    L.polyline([[driverLat, driverLng], [homeLat, homeLng]], { color: '#00f2fe', weight: 3, dashArray: '5, 5' }).addTo(map);
                    window.buyerDeliveryMap = map;

                    const distMeters = map.distance([driverLat, driverLng], [homeLat, homeLng]);
                    const etaBox = document.getElementById(`eta-display-${mapContainerId}`);
                    if (etaBox) {
                        if (distMeters < 50) {
                            etaBox.innerText = "The driver has arrived at your location!";
                            etaBox.classList.add("text-green-400");
                        } else {
                            const mins = Math.max(1, Math.ceil(distMeters / ((30 * 1000) / 60)));
                            etaBox.innerText = `Arriving in ~${mins} min (${(distMeters / 1000).toFixed(1)} km)`;
                        }
                    }
                    map.fitBounds(L.latLngBounds([[driverLat, driverLng], [homeLat, homeLng]]), { padding: [15, 15] });
                    map.invalidateSize();
                }, 100);
            }
        });

    } catch (error) {
        console.error("Tracking Error:", error);
        appendMessage("❌ Could not retrieve tracking info. Please try again.");
    }
};

// ===============================
// BUYER-SELLER CHAT
// ===============================
window.currentBuyerChatId = null;

window.openBuyerChat = function(orderId) {
    document.getElementById("buyerChatModal").classList.remove("hidden");
    document.getElementById("buyerChatOrderId").innerText = orderId.slice(0,5);
    window.currentBuyerChatId = orderId;

    if (window.buyerChatUnsubscribe) window.buyerChatUnsubscribe();
    import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js").then(({ doc, onSnapshot }) => {
        window.buyerChatUnsubscribe = onSnapshot(doc(window.db, "orders", orderId), (docSnap) => {
            if(!docSnap.exists()) return;
            const msgs = docSnap.data().chatMessages || [];
            const box = document.getElementById("buyerChatBody");
            box.innerHTML = msgs.map(m => `
                <div class="flex flex-col ${m.sender === 'buyer' ? 'items-end' : 'items-start'}">
                    <span class="text-[8px] text-gray-500 mb-0.5">${m.sender === 'buyer' ? 'YOU' : 'RESTAURANT'}</span>
                    <div class="px-3 py-2 rounded-xl max-w-[80%] text-sm ${m.sender === 'buyer' ? 'bg-gradient-to-r from-[#0284c7] to-[#00f2fe] text-white font-medium rounded-tr-sm shadow-md shadow-cyan-500/20' : 'bg-white/10 text-white rounded-tl-sm'}">
                        ${m.text}
                    </div>
                </div>
            `).join("");
            box.scrollTop = box.scrollHeight;
        });
    });
};

window.closeBuyerChat = function() {
    document.getElementById("buyerChatModal").classList.add("hidden");
};

window.sendBuyerChat = async function() {
    const input = document.getElementById("buyerChatInput");
    const val = input.value.trim();
    if(!val || !window.currentBuyerChatId) return;
    input.value = "";
    const { doc, updateDoc, arrayUnion } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
    await updateDoc(doc(window.db, "orders", window.currentBuyerChatId), {
        chatMessages: arrayUnion({ sender: 'buyer', text: val, time: Date.now() })
    });
};

// ===============================
// SELLER LINK
// ===============================
function showSellerLink() {
    appendMessage(`
        <div class="bg-white/5 p-3 rounded-xl border border-white/10">
            <p class="text-xs mb-2">Merchant Access:</p>
            <a href="seller.html" class="btn-pill btn-outline block text-center text-[10px]">
                Go to Seller Dashboard ➔
            </a>
        </div>
    `);
}
