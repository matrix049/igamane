let likedIsbns = [];
let booksCache = new Map(); // Use Map for better lookup

async function fetchBooks(search = "") {
    const res = await fetch(`/books?search=${search}`);
    const data = await res.json();
    
    // Update cache with any new books found
    data.forEach(book => booksCache.set(book.ISBN, book));
    
    renderBooks(data, 'booksGrid');
}

async function fetchRecommendations() {
    if (likedIsbns.length === 0) {
        document.getElementById('recommendationsGrid').innerHTML = '<p style="color: var(--text-dim)">Aimez quelques livres pour voir des recommandations personnalisées.</p>';
        return;
    }
    const res = await fetch('/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liked_isbns: likedIsbns })
    });
    const data = await res.json();
    renderBooks(data, 'recommendationsGrid', true);
}

function renderBooks(books, containerId, isRec = false) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if (books.length === 0) {
        container.innerHTML = '<p style="color: var(--text-dim); padding: 1rem;">Aucun livre trouvé.</p>';
        return;
    }

    books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';
        if(isRec) card.innerHTML += '<span class="badge-gpt">AI Match</span>';
        
        const explanationHtml = book.explanation ? `<p style="font-size: 0.75rem; color: var(--accent); margin-top: 10px; font-style: italic;">✨ ${book.explanation}</p>` : '';

        card.innerHTML += `
            <h3>${book.Title}</h3>
            <p>${book.Author}</p>
            <p style="font-size: 0.8rem; margin-top: 5px; opacity: 0.6;">${book.Publisher}</p>
            ${explanationHtml}
            <div style="margin-top: 1rem;">
                <button class="btn-like ${likedIsbns.includes(book.ISBN) ? 'active' : ''}" 
                        onclick="toggleLike('${book.ISBN}', event)">
                    ${likedIsbns.includes(book.ISBN) ? '♥ Aimé' : '♡ J\'aime'}
                </button>
                <button class="btn-like" style="margin-left: 5px; color: var(--accent)" 
                        onclick="showGPT('${book.ISBN}', event)">
                    🤖 GPT
                </button>
            </div>
        `;
        
        container.appendChild(card);
    });
}

function toggleLike(isbn, event) {
    if (event) event.stopPropagation();
    
    const index = likedIsbns.indexOf(isbn);
    if (index === -1) {
        likedIsbns.push(isbn);
    } else {
        likedIsbns.splice(index, 1);
    }
    
    // Update UI Visibility
    const favoritesSection = document.getElementById('favoritesSection');
    if (likedIsbns.length > 0) {
        favoritesSection.style.display = 'block';
        renderFavorites();
    } else {
        favoritesSection.style.display = 'none';
    }
    
    // Refresh grids to update button states
    const currentSearch = document.getElementById('searchInput').value;
    fetchBooks(currentSearch);
    fetchRecommendations();
}

function renderFavorites() {
    const favoriteBooks = likedIsbns.map(isbn => booksCache.get(isbn)).filter(b => b);
    renderBooks(favoriteBooks, 'favoritesGrid');
}

async function showGPT(isbn, event) {
    event.stopPropagation();
    const modal = document.getElementById('gptModal');
    const body = document.getElementById('modalBody');
    body.innerHTML = 'Chargement de l\'analyse sémantique...';
    modal.style.display = 'flex';
    
    const res = await fetch(`/simulate_gpt/${isbn}`);
    const data = await res.json();
    
    body.innerHTML = `
        <p style="margin-bottom: 1.5rem; line-height: 1.6;">${data.summary}</p>
        <h4 style="color: var(--primary); margin-bottom: 0.5rem;">Thèmes extraits :</h4>
        <div style="display: flex; gap: 10px; margin-bottom: 1.5rem;">
            ${data.themes.map(t => `<span style="background: rgba(99,102,241,0.2); padding: 5px 15px; border-radius: 50px; font-size: 0.8rem;">${t}</span>`).join('')}
        </div>
        <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 15px; border-left: 4px solid var(--accent);">
            <p><strong>Recommandation personnalisée :</strong> ${data.recommendation}</p>
        </div>
    `;
}

function closeModal() {
    document.getElementById('gptModal').style.display = 'none';
}

document.getElementById('searchInput').addEventListener('input', (e) => {
    fetchBooks(e.target.value);
});

// Initial load
fetchBooks();
fetchRecommendations();
