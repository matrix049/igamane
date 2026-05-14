import pandas as pd
import numpy as np
import re
import string
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Loading data...")
try:
    books_df = pd.read_csv('../data/Books.csv', sep=';', encoding='latin-1', on_bad_lines='skip', low_memory=False).head(5000)
except Exception:
    books_df = pd.read_csv('data/Books.csv', sep=';', encoding='latin-1', on_bad_lines='skip', low_memory=False).head(5000)

books_df = books_df.fillna('')

# Derive a heuristic Genre from title keywords (the source dataset has no genre column).
GENRE_RULES = [
    ("Romance",   re.compile(r"\b(love|romance|heart|kiss|wedding|bride|lover|passion)\b", re.I)),
    ("Mystery",   re.compile(r"\b(mystery|murder|detective|crime|secret|killer|missing|clue|spy)\b", re.I)),
    ("Fantasy",   re.compile(r"\b(magic|dragon|wizard|witch|fairy|kingdom|sword|elven|enchant)\b", re.I)),
    ("Sci-Fi",    re.compile(r"\b(space|alien|future|robot|cyber|galaxy|planet|star|time)\b", re.I)),
    ("History",   re.compile(r"\b(war|history|battle|empire|civil|ancient|revolution|napoleon|roman|world war|wwii|wwi)\b", re.I)),
    ("Thriller",  re.compile(r"\b(thriller|escape|hunt|chase|danger|silent|dark|shadow|night)\b", re.I)),
    ("Horror",    re.compile(r"\b(horror|ghost|vampire|haunt|demon|blood|fear|dead)\b", re.I)),
    ("Children",  re.compile(r"\b(harry potter|narnia|bear|bunny|dr\.? seuss|fairy tale|kid|child)\b", re.I)),
    ("Cooking",   re.compile(r"\b(cookbook|recipe|cooking|kitchen|food|cuisine|baking|chef)\b", re.I)),
    ("Reference", re.compile(r"\b(guide|handbook|dictionary|encyclopedia|introduction|how to|manual|complete)\b", re.I)),
    ("Biography", re.compile(r"\b(biography|memoir|life of|autobiography|diary|journal)\b", re.I)),
    ("Religion",  re.compile(r"\b(bible|god|jesus|prayer|spiritual|christian|buddhist|muslim|holy)\b", re.I)),
    ("Business",  re.compile(r"\b(business|money|wealth|invest|market|economic|leader|management|success)\b", re.I)),
]

def infer_genre(title: str, author: str) -> str:
    text = f"{title} {author}"
    for genre, pattern in GENRE_RULES:
        if pattern.search(text):
            return genre
    return "Fiction"

books_df['Genre'] = books_df.apply(lambda r: infer_genre(r['Title'], r['Author']), axis=1)
# Normalize Year to int when possible (some rows are strings or junk)
def safe_year(v):
    try:
        y = int(str(v).strip())
        return y if 1000 < y < 2100 else 0
    except Exception:
        return 0
books_df['YearInt'] = books_df['Year'].apply(safe_year)

def clean_text(text):
    text = str(text).lower()
    text = text.translate(str.maketrans('', '', string.punctuation))
    text = re.sub(r'\d+', '', text)
    return text

print("Vectorizing...")
books_df['clean_content'] = (books_df['Title'] + " " + books_df['Author'] + " " + books_df['Genre']).apply(clean_text)
vectorizer = TfidfVectorizer(max_features=5000, stop_words='english')
tfidf_matrix = vectorizer.fit_transform(books_df['clean_content'])

class UserProfile(BaseModel):
    liked_isbns: List[str]

BOOK_FIELDS = ['ISBN', 'Title', 'Author', 'Publisher', 'Year', 'Genre']

@app.get("/facets")
def facets():
    """Return distinct values for dropdown filters."""
    genres = sorted(books_df['Genre'].dropna().unique().tolist())
    years = sorted({y for y in books_df['YearInt'].tolist() if y})
    return {
        "genres": genres,
        "year_min": int(years[0]) if years else 0,
        "year_max": int(years[-1]) if years else 0,
    }

@app.get("/books")
def get_books(
    search: str = "",
    genre: str = "",
    year_min: Optional[int] = None,
    year_max: Optional[int] = None,
    isbns: str = "",
    limit: int = Query(60, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    df = books_df
    if isbns:
        wanted = [s.strip() for s in isbns.split(',') if s.strip()]
        df = df[df['ISBN'].isin(wanted)]
    if search:
        s = search.lower()
        mask = (
            df['Title'].str.lower().str.contains(s, na=False)
            | df['Author'].str.lower().str.contains(s, na=False)
            | df['Publisher'].str.lower().str.contains(s, na=False)
        )
        df = df[mask]
    if genre:
        df = df[df['Genre'] == genre]
    if year_min:
        df = df[df['YearInt'] >= year_min]
    if year_max:
        df = df[df['YearInt'] <= year_max]

    total = len(df)
    page = df.iloc[offset:offset + limit]
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "books": page[BOOK_FIELDS].to_dict(orient='records'),
    }

@app.post("/recommend")
def recommend_personalized(profile: UserProfile):
    if not profile.liked_isbns:
        popular = books_df.head(6)[BOOK_FIELDS].to_dict(orient='records')
        for b in popular:
            b['explanation'] = "Basé sur la popularité globale (Cold Start)"
        return popular

    indices = books_df[books_df['ISBN'].isin(profile.liked_isbns)].index.tolist()
    if not indices:
        return []

    user_vector = np.asarray(tfidf_matrix[indices].mean(axis=0))
    sim_scores = cosine_similarity(user_vector, tfidf_matrix).flatten()
    rec_indices = sim_scores.argsort()[::-1]

    feature_names = vectorizer.get_feature_names_out()
    user_vec_flat = user_vector.flatten()
    liked_set = set(profile.liked_isbns)

    chosen_idx = []
    chosen_keywords = []
    for idx in rec_indices:
        isbn = books_df.iloc[idx]['ISBN']
        if isbn in liked_set:
            continue
        book_vec = tfidf_matrix[idx].toarray().flatten()
        shared_weights = np.multiply(book_vec, user_vec_flat)
        top_shared_indices = shared_weights.argsort()[-3:][::-1]
        keywords = [feature_names[i] for i in top_shared_indices if shared_weights[i] > 0]
        chosen_idx.append(int(idx))
        chosen_keywords.append(keywords)
        if len(chosen_idx) >= 6:
            break

    rows = books_df.iloc[chosen_idx][BOOK_FIELDS].to_dict(orient='records')
    for row, kws in zip(rows, chosen_keywords):
        row['explanation'] = (
            f"Partage ces thèmes avec vos goûts : {', '.join(kws)}"
            if kws else "Recommandation sémantique globale"
        )
    return rows

@app.get("/simulate_gpt/{isbn}")
def simulate_gpt(isbn: str):
    rows = books_df[books_df['ISBN'] == isbn]
    if rows.empty:
        raise HTTPException(404, "Book not found")
    book = rows.iloc[0]
    return {
        "summary": f"This book '{book['Title']}' by {book['Author']} is a deep exploration of its themes, providing a rich narrative that resonates with fans of this genre.",
        "themes": [book['Genre'], "Philosophy", "Human Nature"],
        "recommendation": "Because you enjoy complex narratives and well-developed characters, this LLM-enriched analysis suggests this book fits your intellectual profile perfectly."
    }

app.mount("/", StaticFiles(directory="static", html=True), name="static")
