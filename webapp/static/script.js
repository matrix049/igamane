const FAVORITES_KEY = 'bookrec.likedIsbns.v1';

function loadLikedFromStorage() {
    try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

function saveLikedToStorage() {
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(likedIsbns));
    } catch {}
}

let likedIsbns = loadLikedFromStorage();
let booksCache = new Map();

const catalog = {
    search: "",
    genre: "",
    year_min: "",
    year_max: "",
    offset: 0,
    limit: 60,
    total: 0,
};

// ---------- Helpers ----------
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

const COVER_PALETTES = [
    ['#6366f1', '#8b5cf6'],
    ['#22d3ee', '#3b82f6'],
    ['#f472b6', '#a855f7'],
    ['#fb7185', '#f59e0b'],
    ['#34d399', '#14b8a6'],
    ['#a78bfa', '#ec4899'],
    ['#60a5fa', '#06b6d4'],
];

function coverFor(book) {
    const seed = (book.ISBN || book.Title || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const [a, b] = COVER_PALETTES[seed % COVER_PALETTES.length];
    const initial = (book.Title || '?').trim().charAt(0).toUpperCase();
    return `<div class="cover" style="background:linear-gradient(135deg,${a},${b})">${escapeHtml(initial)}</div>`;
}

function skeletonGrid(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `
        <div class="skeleton">
            <div class="sk-block sk-cover"></div>
            <div class="sk-block sk-line w-30"></div>
            <div class="sk-block sk-line w-90"></div>
            <div class="sk-block sk-line w-60"></div>
            <div class="sk-block sk-line w-50" style="margin-top:1rem"></div>
        </div>`;
    }
    return html;
}

// ---------- Toasts ----------
function showToast(message, kind = 'success') {
    const host = document.getElementById('toastHost');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = message;
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 350);
    }, 2400);
}

// ---------- Data ----------
async function loadFacets() {
    const res = await fetch('/facets');
    const data = await res.json();

    const genreSel = document.getElementById('filterGenre');
    data.genres.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        genreSel.appendChild(opt);
    });

    document.getElementById('filterYearMin').placeholder = `Année min (${data.year_min})`;
    document.getElementById('filterYearMax').placeholder = `Année max (${data.year_max})`;
}

async function fetchBooks(resetToFirstPage = true) {
    const grid = document.getElementById('booksGrid');
    if (resetToFirstPage) catalog.offset = 0;
    grid.innerHTML = skeletonGrid(8);

    const params = new URLSearchParams({
        search: catalog.search,
        genre: catalog.genre,
        offset: catalog.offset,
        limit: catalog.limit,
    });
    if (catalog.year_min) params.set('year_min', catalog.year_min);
    if (catalog.year_max) params.set('year_max', catalog.year_max);

    try {
        const res = await fetch(`/books?${params.toString()}`);
        const data = await res.json();

        catalog.total = data.total;
        data.books.forEach(b => booksCache.set(b.ISBN, b));

        grid.innerHTML = '';
        appendBooks(data.books, 'booksGrid');
        renderPagination();
        updateResultCount();
    } catch (err) {
        console.error('fetchBooks failed', err);
        grid.innerHTML = '<div class="empty-state error">Échec du chargement du catalogue.</div>';
    }
}

function updateResultCount() {
    const totalPages = Math.max(1, Math.ceil(catalog.total / catalog.limit));
    const currentPage = Math.floor(catalog.offset / catalog.limit) + 1;
    document.getElementById('resultCount').textContent =
        catalog.total === 0
            ? 'Aucun livre trouvé.'
            : `Page ${currentPage} / ${totalPages} · ${catalog.total} livres au total`;
}

function buildPageList(current, last) {
    // Always show first/last + window of 2 around current; "…" for gaps
    const pages = new Set([1, last, current, current - 1, current + 1, current - 2, current + 2]);
    const filtered = [...pages].filter(p => p >= 1 && p <= last).sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (const p of filtered) {
        if (prev && p - prev > 1) out.push('...');
        out.push(p);
        prev = p;
    }
    return out;
}

function renderPagination() {
    const nav = document.getElementById('pagination');
    const totalPages = Math.max(1, Math.ceil(catalog.total / catalog.limit));
    const currentPage = Math.floor(catalog.offset / catalog.limit) + 1;

    if (totalPages <= 1) {
        nav.innerHTML = '';
        return;
    }

    const parts = [];
    parts.push(`<button class="pg-btn pg-nav" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}" aria-label="Page précédente">‹</button>`);

    for (const p of buildPageList(currentPage, totalPages)) {
        if (p === '...') {
            parts.push('<span class="pg-ellipsis">…</span>');
        } else {
            parts.push(`<button class="pg-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`);
        }
    }

    parts.push(`<button class="pg-btn pg-nav" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}" aria-label="Page suivante">›</button>`);

    nav.innerHTML = parts.join('');

    nav.querySelectorAll('.pg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page, 10);
            if (!page || page < 1 || page > totalPages) return;
            catalog.offset = (page - 1) * catalog.limit;
            fetchBooks(false);
            document.getElementById('catalogHeader')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

async function fetchRecommendations() {
    const grid = document.getElementById('recommendationsGrid');
    if (likedIsbns.length === 0) {
        grid.innerHTML = '<div class="empty-state">Aimez quelques livres pour voir des recommandations personnalisées.</div>';
        return;
    }
    grid.innerHTML = skeletonGrid(6);
    try {
        const res = await fetch('/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ liked_isbns: likedIsbns })
        });
        if (!res.ok) {
            const text = await res.text();
            console.error('Recommend error', res.status, text);
            grid.innerHTML = `<div class="empty-state error">Erreur ${res.status} — vérifiez la console.</div>`;
            return;
        }
        const data = await res.json();
        grid.innerHTML = '';
        if (!Array.isArray(data) || data.length === 0) {
            grid.innerHTML = '<div class="empty-state">Pas de recommandations disponibles pour ces livres.</div>';
            return;
        }
        appendBooks(data, 'recommendationsGrid', true);
    } catch (err) {
        console.error('Recommend fetch failed', err);
        grid.innerHTML = '<div class="empty-state error">Échec de la requête — vérifiez la console.</div>';
    }
}

function appendBooks(books, containerId, isRec = false) {
    const container = document.getElementById(containerId);

    if (container.children.length === 0 && books.length === 0) {
        container.innerHTML = '<div class="empty-state">Aucun livre trouvé.</div>';
        return;
    }

    books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';
        card.dataset.genre = book.Genre || 'Fiction';
        card.title = "Cliquez pour voir l'analyse GPT";
        card.addEventListener('click', () => showGPT(book.ISBN));

        const explanationHtml = book.explanation
            ? `<p class="explanation">✨ ${escapeHtml(book.explanation)}</p>` : '';

        const recBadge = isRec ? '<span class="badge-gpt">AI Match</span>' : '';
        const genreBadge = book.Genre
            ? `<span class="badge-genre">${escapeHtml(book.Genre)}</span>` : '';
        const yearText = book.Year ? `· ${escapeHtml(String(book.Year))}` : '';

        const liked = likedIsbns.includes(book.ISBN);

        card.innerHTML = `
            ${recBadge}
            ${coverFor(book)}
            <div class="card-meta">${genreBadge}<span class="card-year">${yearText}</span></div>
            <h3>${escapeHtml(book.Title)}</h3>
            <p class="author">${escapeHtml(book.Author)}</p>
            <p class="publisher">${escapeHtml(book.Publisher || '')}</p>
            ${explanationHtml}
            <div class="card-actions">
                <button class="btn-like ${liked ? 'active' : ''}" data-isbn="${escapeHtml(book.ISBN)}">
                    ${liked ? '♥ Aimé' : "♡ J'aime"}
                </button>
                <span class="card-hint">Analyse GPT →</span>
            </div>
        `;

        const likeBtn = card.querySelector('.btn-like');
        likeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLike(book.ISBN);
        });

        container.appendChild(card);
    });
}

function toggleLike(isbn) {
    const index = likedIsbns.indexOf(isbn);
    const wasAdded = index === -1;
    if (wasAdded) likedIsbns.push(isbn);
    else likedIsbns.splice(index, 1);

    saveLikedToStorage();

    const book = booksCache.get(isbn);
    const title = book ? book.Title : 'Livre';
    showToast(
        wasAdded ? `Ajouté aux favoris : ${title}` : `Retiré des favoris : ${title}`,
        wasAdded ? 'success' : 'danger'
    );

    const favoritesSection = document.getElementById('favoritesSection');
    if (likedIsbns.length > 0) {
        favoritesSection.style.display = 'block';
        renderFavorites();
    } else {
        favoritesSection.style.display = 'none';
    }

    fetchBooks(true);
    fetchRecommendations().then(() => {
        if (wasAdded) {
            const recsHeader = document.getElementById('recsHeader');
            if (recsHeader) recsHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
}

function renderFavorites() {
    const favoriteBooks = likedIsbns.map(isbn => booksCache.get(isbn)).filter(b => b);
    document.getElementById('favoritesGrid').innerHTML = '';
    appendBooks(favoriteBooks, 'favoritesGrid');
}

async function showGPT(isbn) {
    const modal = document.getElementById('gptModal');
    const body = document.getElementById('modalBody');
    const title = document.getElementById('modalTitle');
    const book = booksCache.get(isbn);
    title.textContent = book ? `Analyse — ${book.Title}` : 'Analyse';
    body.innerHTML = `
        <div class="sk-block sk-line w-90" style="height:14px;margin-bottom:.6rem"></div>
        <div class="sk-block sk-line w-60" style="height:14px;margin-bottom:1.4rem"></div>
        <div class="sk-block sk-line w-30" style="height:12px;margin-bottom:.8rem"></div>
        <div class="sk-block" style="height:70px;border-radius:14px"></div>
    `;
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    try {
        const res = await fetch(`/simulate_gpt/${isbn}`);
        const data = await res.json();

        body.innerHTML = `
            <p style="margin-bottom: 1.5rem; line-height: 1.65; color: #cbd5e1;">${escapeHtml(data.summary)}</p>
            <h4 style="color: var(--primary); margin-bottom: 0.6rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em;">Thèmes extraits</h4>
            <div style="display: flex; gap: 8px; margin-bottom: 1.5rem; flex-wrap: wrap;">
                ${data.themes.map(t => `<span style="background: rgba(99,102,241,0.18); border: 1px solid rgba(99,102,241,0.3); padding: 5px 14px; border-radius: 999px; font-size: 0.78rem;">${escapeHtml(t)}</span>`).join('')}
            </div>
            <div style="background: rgba(34,211,238,0.08); padding: 1.2rem 1.4rem; border-radius: 14px; border-left: 3px solid var(--accent);">
                <p style="font-size: 0.9rem; line-height: 1.6;"><strong style="color: var(--accent);">Pour vous : </strong>${escapeHtml(data.recommendation)}</p>
            </div>
        `;
    } catch (err) {
        body.innerHTML = '<div class="empty-state error">Impossible de charger l\'analyse.</div>';
    }
}

function closeModal() {
    const modal = document.getElementById('gptModal');
    modal.classList.remove('show');
    document.body.style.overflow = '';
}

// ---------- Wiring ----------
function triggerSearch() {
    catalog.search = document.getElementById('searchInput').value;
    fetchBooks(true);
}

document.getElementById('searchBtn').addEventListener('click', triggerSearch);
document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        triggerSearch();
    }
});

document.getElementById('filterGenre').addEventListener('change', (e) => {
    catalog.genre = e.target.value;
    fetchBooks(true);
});

document.getElementById('filterYearMin').addEventListener('change', (e) => {
    catalog.year_min = e.target.value;
    fetchBooks(true);
});

document.getElementById('filterYearMax').addEventListener('change', (e) => {
    catalog.year_max = e.target.value;
    fetchBooks(true);
});

document.getElementById('clearFilters').addEventListener('click', () => {
    catalog.search = "";
    catalog.genre = "";
    catalog.year_min = "";
    catalog.year_max = "";
    document.getElementById('searchInput').value = "";
    document.getElementById('filterGenre').value = "";
    document.getElementById('filterYearMin').value = "";
    document.getElementById('filterYearMax').value = "";
    fetchBooks(true);
});

document.getElementById('gptModal').addEventListener('click', (e) => {
    if (e.target.id === 'gptModal') closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

async function restoreFavoritesOnLoad() {
    if (likedIsbns.length === 0) return;
    try {
        const r = await fetch(`/books?isbns=${encodeURIComponent(likedIsbns.join(','))}&limit=${likedIsbns.length}`);
        const d = await r.json();
        (d.books || []).forEach(b => booksCache.set(b.ISBN, b));
    } catch {}
    likedIsbns = likedIsbns.filter(isbn => booksCache.has(isbn));
    saveLikedToStorage();
    if (likedIsbns.length > 0) {
        document.getElementById('favoritesSection').style.display = 'block';
        renderFavorites();
    }
}

// Initial load
loadFacets();
fetchBooks(true);
restoreFavoritesOnLoad().then(() => fetchRecommendations());
