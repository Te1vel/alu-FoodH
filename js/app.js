const API = "https://world.openfoodfacts.org";
const LIST_KEY = "foodh_list";
const THEME_KEY = "foodh_theme";
const CACHE_PREFIX = "foodh_cache_";

let products = [];
let selectedCategory = "all";
let currentQuery = "milk";
let sortBy = "name";


const $ = id => document.getElementById(id);

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[char]));

const productName = p => p.product_name || "Unknown product";

const productImage = p =>
  p.image_front_small_url ||
  p.image_front_url ||
  "https://placehold.co/300x200?text=No+Image";

function getList() {
  try {
    const list = JSON.parse(localStorage.getItem(LIST_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveList(list) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
    return true;
  } catch {
    alert("Could not save your shopping list. Browser storage may be full.");
    return false;
  }
}

function setupTheme() {
  let savedTheme = null;

  try {
    savedTheme = localStorage.getItem(THEME_KEY);
  } catch {}

  const systemDark = window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (savedTheme === "dark" || (!savedTheme && systemDark)) {
    document.body.classList.add("dark-mode");
  }

  const button = document.createElement("button");
  button.id = "themeToggle";
  button.title = "Toggle dark mode";
  button.setAttribute("aria-label", "Toggle dark mode");

  document.body.appendChild(button);

  function updateButton() {
    button.textContent = document.body.classList.contains("dark-mode")
      ? "☀️"
      : "🌙";
  }

  updateButton();

  button.onclick = () => {
    document.body.classList.toggle("dark-mode");

    const theme = document.body.classList.contains("dark-mode")
      ? "dark"
      : "light";

    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}

    updateButton();
  };
}

function getCache(query) {
  try {
    const cached = JSON.parse(
      localStorage.getItem(CACHE_PREFIX + query) || "null"
    );

    if (cached && Date.now() - cached.time < 30 * 60 * 1000) {
      return cached.products;
    }
  } catch {}

  return null;
}

function saveCache(query, items) {
  try {
    const compact = items.slice(0, 12).map(p => ({
      code: p.code,
      product_name: p.product_name,
      brands: p.brands,
      image_front_small_url: p.image_front_small_url,
      nutriscore_grade: p.nutriscore_grade,
      categories_tags: p.categories_tags,
      quantity: p.quantity
    }));

    const key = CACHE_PREFIX + query;

    let keys = Object.keys(localStorage)
      .filter(k => k.startsWith(CACHE_PREFIX));

    if (!keys.includes(key) && keys.length >= 3) {
      keys.sort((a, b) => {
        try {
          return JSON.parse(localStorage.getItem(a)).time -
                 JSON.parse(localStorage.getItem(b)).time;
        } catch {
          return 0;
        }
      });

      localStorage.removeItem(keys[0]);
    }

    localStorage.setItem(key, JSON.stringify({
      time: Date.now(),
      products: compact
    }));
  } catch {
  }
}

function createControls() {
  const form = $("searchForm");

  if (!form || $("productFilters")) return;

  const controls = document.createElement("div");

  controls.id = "productFilters";

  controls.innerHTML = `
    <label>
      Category
      <select id="categoryFilter">
        <option value="all">All categories</option>
      </select>
    </label>

    <label>
      Sort by
      <select id="sortFilter">
        <option value="name">Name (A-Z)</option>
        <option value="name-desc">Name (Z-A)</option>
        <option value="score">Nutri-Score (best first)</option>
      </select>
    </label>
  `;

  form.after(controls);

  $("categoryFilter").onchange = event => {
    selectedCategory = event.target.value;
    renderProducts();
  };

  $("sortFilter").onchange = event => {
    sortBy = event.target.value;
    renderProducts();
  };
}

async function searchProducts(query = "milk") {
  const box = $("products");

  if (!box) return;

  currentQuery = query.trim();
  selectedCategory = "all";

  createControls();

  if ($("categoryFilter")) {
    $("categoryFilter").value = "all";
  }

  box.innerHTML = "<p>Searching for products...</p>";

  try {
    let results = getCache(currentQuery);

    if (!results) {
      const url =
        `${API}/cgi/search.pl?search_terms=${encodeURIComponent(currentQuery)}` +
        `&search_simple=1&action=process&json=1&page_size=12` +
        `&fields=code,product_name,brands,image_front_small_url,nutriscore_grade,categories_tags,quantity`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("API request failed");
      }

      const data = await response.json();

      if (!Array.isArray(data.products)) {
        throw new Error("Invalid API response");
      }

      results = data.products.filter(p => p.code);

      saveCache(currentQuery, results);
    }

    products = results;

    updateCategories();
    renderProducts();

  } catch (error) {
    console.error("Search error:", error);

    box.innerHTML = `
      <p>Could not load products. Check your internet connection.</p>
      <button id="retrySearch">Try again</button>
    `;

    $("retrySearch").onclick = () => searchProducts(currentQuery);
  }
}

function updateCategories() {
  const select = $("categoryFilter");

  if (!select) return;

  const categories = new Map();

  products.forEach(p => {
    (p.categories_tags || []).forEach(tag => {
      const label = tag.split(":").pop().replace(/-/g, " ");

      if (label.length > 2) {
        categories.set(tag, label);
      }
    });
  });

  select.innerHTML =
    `<option value="all">All categories</option>` +
    [...categories].slice(0, 30).map(([value, label]) =>
      `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`
    ).join("");
}

function renderProducts() {
  const box = $("products");

  if (!box) return;

  let filtered = products.filter(p =>
    selectedCategory === "all" ||
    (p.categories_tags || []).includes(selectedCategory)
  );

  filtered.sort((a, b) => {
    if (sortBy === "name-desc") {
      return productName(b).localeCompare(productName(a));
    }

    if (sortBy === "score") {
      const grades = ["a", "b", "c", "d", "e"];

      const scoreA = grades.indexOf(
        (a.nutriscore_grade || "").toLowerCase()
      );

      const scoreB = grades.indexOf(
        (b.nutriscore_grade || "").toLowerCase()
      );

      return (scoreA === -1 ? 99 : scoreA) -
             (scoreB === -1 ? 99 : scoreB);
    }

    return productName(a).localeCompare(productName(b));
  });

  if (!filtered.length) {
    box.innerHTML = "<p>No products found in this category.</p>";
    return;
  }

  box.innerHTML = filtered.map(p => `
    <article>
      <img
        src="${escapeHTML(productImage(p))}"
        alt="${escapeHTML(productName(p))}"
      >

      <h3>${escapeHTML(productName(p))}</h3>

      <p>${escapeHTML(p.brands || "Unknown brand")}</p>

      <p>
        Nutri-Score:
        ${escapeHTML((p.nutriscore_grade || "N/A").toUpperCase())}
      </p>

      <a href="product.html?barcode=${encodeURIComponent(p.code)}">
        View details
      </a>

      <button data-add="${escapeHTML(p.code)}">
        Add to list
      </button>
    </article>
  `).join("");

  box.querySelectorAll("[data-add]").forEach(button => {
    button.onclick = () => {
      const p = products.find(item => item.code === button.dataset.add);

      if (p) {
        addProduct({
          code: p.code,
          name: productName(p),
          image: productImage(p)
        });
      }
    };
  });
}

async function showProduct() {
  const box = $("product");

  const barcode = new URLSearchParams(location.search).get("barcode");

  if (!barcode) {
    box.innerHTML = "<p>No product selected.</p>";
    return;
  }

  box.innerHTML = "<p>Loading product details...</p>";

  try {
    const response = await fetch(
      `${API}/api/v3/product/${encodeURIComponent(barcode)}.json`
    );

    if (!response.ok) {
      throw new Error("API request failed");
    }

    const data = await response.json();
    const p = data.product;

    if (!p) {
      box.innerHTML = "<p>Product not found.</p>";
      return;
    }

    const nutrients = p.nutriments || {};

    box.innerHTML = `
      <article>
        <img
          src="${escapeHTML(p.image_front_url || productImage(p))}"
          alt="${escapeHTML(productName(p))}"
        >

        <h2>${escapeHTML(productName(p))}</h2>

        <p><strong>Brand:</strong> ${escapeHTML(p.brands || "Unknown")}</p>

        <p><strong>Barcode:</strong> ${escapeHTML(p.code || barcode)}</p>

        <p><strong>Quantity:</strong> ${escapeHTML(p.quantity || "Not available")}</p>

        <p>
          <strong>Nutri-Score:</strong>
          ${escapeHTML((p.nutriscore_grade || "N/A").toUpperCase())}
        </p>

        <h3>Nutrition per 100g / 100ml</h3>

        <p>Energy: ${escapeHTML(nutrients["energy-kcal_100g"] ?? "N/A")} kcal</p>
        <p>Fat: ${escapeHTML(nutrients.fat_100g ?? "N/A")} g</p>
        <p>Sugars: ${escapeHTML(nutrients.sugars_100g ?? "N/A")} g</p>
        <p>Salt: ${escapeHTML(nutrients.salt_100g ?? "N/A")} g</p>
        <p>Proteins: ${escapeHTML(nutrients.proteins_100g ?? "N/A")} g</p>

        <h3>Ingredients</h3>

        <p>${escapeHTML(p.ingredients_text || "Not available")}</p>

        <button id="addProduct">Add to shopping list</button>
      </article>
    `;

    $("addProduct").onclick = () => {
      addProduct({
        code: p.code || barcode,
        name: productName(p),
        image: p.image_front_url || ""
      });
    };

  } catch (error) {
    console.error("Product details error:", error);

    box.innerHTML = `
      <p>Could not load product details.</p>
      <button id="retryProduct">Try again</button>
    `;

    $("retryProduct").onclick = showProduct;
  }
}

function addProduct(product) {
  const list = getList();

  const existing = list.find(p => p.code === product.code);

  if (existing) {
    existing.quantity++;
  } else {
    list.push({
      ...product,
      quantity: 1,
      purchased: false
    });
  }

  if (saveList(list)) {
    alert("Product added to your shopping list!");
  }
}

function showList() {
  const box = $("shoppingList");

  if (!box) return;

  const list = getList();
  const purchased = list.filter(p => p.purchased).length;

  if (!list.length) {
    box.innerHTML = "<p>Your shopping list is empty. Add some products!</p>";
    return;
  }

  box.innerHTML = `
    <p>${list.length} products · ${purchased} purchased</p>

    ${list.map(p => `
      <article>
        <input
          type="checkbox"
          data-purchased="${escapeHTML(p.code)}"
          ${p.purchased ? "checked" : ""}
          aria-label="Mark ${escapeHTML(p.name)} as purchased"
        >

        <img
          src="${escapeHTML(p.image || "https://placehold.co/80")}"
          alt="${escapeHTML(p.name)}"
        >

        <span>${escapeHTML(p.name)}</span>

        <input
          type="number"
          min="1"
          value="${Math.max(1, Number(p.quantity) || 1)}"
          data-quantity="${escapeHTML(p.code)}"
          aria-label="Quantity for ${escapeHTML(p.name)}"
        >

        <button data-remove="${escapeHTML(p.code)}">
          Remove
        </button>
      </article>
    `).join("")}

    <button id="clearPurchased">
      Remove purchased items
    </button>
  `;

  box.querySelectorAll("[data-purchased]").forEach(input => {
    input.onchange = () => {
      const items = getList();

      const item = items.find(
        p => p.code === input.dataset.purchased
      );

      if (item) {
        item.purchased = input.checked;
        saveList(items);
        showList();
      }
    };
  });

  box.querySelectorAll("[data-quantity]").forEach(input => {
    input.onchange = () => {
      const items = getList();

      const item = items.find(
        p => p.code === input.dataset.quantity
      );

      if (item) {
        item.quantity = Math.max(1, Number(input.value) || 1);
        saveList(items);
        showList();
      }
    };
  });

  box.querySelectorAll("[data-remove]").forEach(button => {
    button.onclick = () => {
      const updated = getList().filter(
        p => p.code !== button.dataset.remove
      );

      if (saveList(updated)) showList();
    };
  });

  $("clearPurchased").onclick = () => {
    const updated = getList().filter(p => !p.purchased);

    if (saveList(updated)) showList();
  };
}

setupTheme();

if ($("searchForm")) {
  createControls();
  searchProducts("milk");

  $("searchForm").onsubmit = event => {
    event.preventDefault();

    const query = $("searchInput").value.trim();

    if (query) {
      searchProducts(query);
    }
  };
}

if ($("product")) {
  showProduct();
}

if ($("shoppingList")) {
  showList();
}