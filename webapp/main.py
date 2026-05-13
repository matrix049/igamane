import pandas as pd
import numpy as np
import re
import string
import nltk
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from pydantic import BaseModel
from typing import List

app = FastAPI()

# Enable CORS for frontend interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load and Preprocess Data (Sample for performance)
print("Loading data...")
try:
    books_df = pd.read_csv('../data/Books.csv', sep=';', encoding='latin-1', on_bad_lines='skip', low_memory=False).head(5000)
except:
    books_df = pd.read_csv('data/Books.csv', sep=';', encoding='latin-1', on_bad_lines='skip', low_memory=False).head(5000)

books_df = books_df.fillna('')

def clean_text(text):
    text = str(text).lower()
    text = text.translate(str.maketrans('', '', string.punctuation))
    text = re.sub(r'\d+', '', text)
    return text

print("Vectorizing...")
books_df['clean_content'] = (books_df['Title'] + " " + books_df['Author']).apply(clean_text)
vectorizer = TfidfVectorizer(max_features=5000, stop_words='english')
tfidf_matrix = vectorizer.fit_transform(books_df['clean_content'])
cosine_sim = cosine_similarity(tfidf_matrix)

class UserProfile(BaseModel):
    liked_isbns: List[str]

@app.get("/books")
def get_books(search: str = ""):
    if search:
        results = books_df[books_df['Title'].str.contains(search, case=False)].head(20)
    else:
        results = books_df.head(20)
    return results[['ISBN', 'Title', 'Author', 'Publisher']].to_dict(orient='records')

@app.post("/recommend")
def recommend_personalized(profile: UserProfile):
    # CASE 1: COLD START (No likes)
    if not profile.liked_isbns:
        # Return popular books as fallback
        popular = books_df.head(6).to_dict(orient='records')
        for b in popular: b['explanation'] = "Basé sur la popularité globale (Cold Start)"
        return popular

    # CASE 2: PERSONALIZED
    indices = books_df[books_df['ISBN'].isin(profile.liked_isbns)].index.tolist()
    
    # Calculate user profile vector
    user_vector = np.asarray(tfidf_matrix[indices].mean(axis=0))
    sim_scores = cosine_similarity(user_vector, tfidf_matrix).flatten()
    
    # Get top recommendations
    rec_indices = sim_scores.argsort()[::-1]
    final_recs = []
    
    feature_names = vectorizer.get_feature_names_out()
    
    for idx in rec_indices:
        book = books_df.iloc[idx]
        if book['ISBN'] not in profile.liked_isbns:
            # EXPLICABILITY: Find shared keywords
            book_vec = tfidf_matrix[idx].toarray().flatten()
            user_vec_flat = user_vector.flatten()
            
            # Intersection of weights
            shared_weights = np.multiply(book_vec, user_vec_flat)
            top_shared_indices = shared_weights.argsort()[-3:][::-1]
            keywords = [feature_names[i] for i in top_shared_indices if shared_weights[i] > 0]
            
            book_dict = book.to_dict()
            book_dict['explanation'] = f"Partage ces thèmes avec vos goûts : {', '.join(keywords)}" if keywords else "Recommandation sémantique globale"
            final_recs.append(book_dict)
            
        if len(final_recs) >= 6:
            break
            
    return final_recs

@app.get("/simulate_gpt/{isbn}")
def simulate_gpt(isbn: str):
    book = books_df[books_df['ISBN'] == isbn].iloc[0]
    return {
        "summary": f"This book '{book['Title']}' by {book['Author']} is a deep exploration of its themes, providing a rich narrative that resonates with fans of this genre.",
        "themes": ["Drama", "Philosophy", "Human Nature"],
        "recommendation": "Because you enjoy complex narratives and well-developed characters, this LLM-enriched analysis suggests this book fits your intellectual profile perfectly."
    }

# Serve static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")
