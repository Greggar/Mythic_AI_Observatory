"""Embedding-based synesthesia classification using all-minilm similarity.
Replaces the LLM call in classifier_agent.py (qwen2.5:1.5b)."""

import json
import logging
import math
import os
from typing import Any

import httpx

from services import config_manager

logger = logging.getLogger("conductor")

def _get_embed_model() -> str:
    return config_manager.get_embedding_model()

INPUT_CATEGORIES: list[dict[str, Any]] = [
    {
        "cat": 0,
        "label": "Direct Command",
        "description": "An imperative order starting with an action verb commanding the assistant to do something.",
        "examples": "List all planets in the solar system. Write a haiku about autumn. Explain how photosynthesis works. Summarize this article. Show me the latest stock prices. Tell me a joke. Give me five ideas for a birthday party. Translate hello to Spanish. Create a meal plan. Define consciousness.",
    },
    {
        "cat": 1,
        "label": "Factual Question",
        "description": "An interrogative sentence seeking a fact, definition, or explanation. Usually starts with a question word (what, how, why, when, where, who) or ends with a question mark.",
        "examples": "What is the capital of Mongolia? How does gravity work? Why is the sky blue? When was the Eiffel Tower built? Who wrote Pride and Prejudice? What's the difference between HTTP and HTTPS? How far is the moon from Earth? What is machine learning? How do vaccines work? What year did World War II end?",
    },
    {
        "cat": 2,
        "label": "Creative Request",
        "description": "Explicitly asks for creative or artistic output. Contains keywords like poem, story, song, verse, creative, imagine, metaphor, narrative, tale, ballad, haiku, ode, sonnet, fiction, fantasy.",
        "examples": "Write a sonnet about a lost civilization. Tell me a story about a robot who learns to paint. Compose a haiku about winter morning. Imagine a world where humans can breathe underwater. Create a fantasy tale about a dragon librarian. Write a limerick about a programmer. Pen an ode to the internet. Compose a ballad about space exploration. Make up a fable about patience.",
    },
    {
        "cat": 3,
        "label": "Simple Query",
        "description": "A short, straightforward request or question (under ~12 words) with no strong command or creative signal. Could be a greeting, simple yes/no question, or brief request.",
        "examples": "Hello. What's up? Yes. OK. Is Paris in France? Thank you. What is 2+2? Hi there. Good morning. Tell me. What's the weather? Who are you? Can you help me? What time is it? I have a question.",
    },
    {
        "cat": 4,
        "label": "Complex Inquiry",
        "description": "A multi-sentence or multi-part request requiring synthesis across several dimensions. Longer than ~12 words, often with clauses, conditions, or nested questions.",
        "examples": "I'm trying to understand how neural networks work, specifically the difference between CNNs and RNNs. Can you compare the economic policies of Keynesianism and Monetarism? I need a business plan for a coffee shop that also sells books and hosts live music. What are the ethical implications of using AI in hiring, and how do different countries regulate this? Explain the plot of Inception and how the different dream layers work together.",
    },
]

OUTPUT_CATEGORIES: list[dict[str, Any]] = [
    {
        "cat": 0,
        "label": "Concise List/Facts",
        "description": "Short, direct answer under ~30 words. Gets straight to the point without explanation. Often a single sentence, name, number, or short fact.",
        "examples": "Paris. The speed of light is 299,792,458 meters per second. It's 42. Yes, Paris is in France. William Shakespeare wrote Hamlet. The square root of 144 is 12. December 25th. Blue. Albert Einstein. About 384,400 kilometers.",
    },
    {
        "cat": 1,
        "label": "Prose Explanation",
        "description": "Continuous paragraph(s) that explain, describe, or discuss a topic. Full sentences forming coherent paragraphs. May be multiple paragraphs. No bullet points, no list formatting.",
        "examples": "Photosynthesis is the process by which plants convert sunlight into chemical energy. It occurs in the chloroplasts, where chlorophyll absorbs light energy. Gravity is a fundamental force of nature that causes objects with mass to attract one another. On Earth, this gives weight to physical objects.",
    },
    {
        "cat": 2,
        "label": "Creative/Verse",
        "description": "Poetic or artistic response. Contains stanzas, rhyme, meter, archaic vocabulary (thee, thou, thine), or title-cased lines. Includes poems, songs, ballads, haikus, limericks, odes, and fictional narratives with literary style.",
        "examples": "Upon a peak where ancients trod, A city sleeps beneath the clod. Autumn leaves fall gently down, Painting gold upon the ground. There once was a coder from Kent Whose code was magnificently bent.",
    },
    {
        "cat": 3,
        "label": "Bulleted List",
        "description": "Response formatted as a list using bullets (-), numbers (1.), or colon-separated entries (Name: value) across 3+ lines. Each line is a distinct item.",
        "examples": "- Mercury\n- Venus\n- Earth\n- Mars\n\nName: Alice\nRole: Engineer\nLocation: New York\n\n1. Preheat the oven\n2. Mix flour and sugar\n3. Add eggs",
    },
    {
        "cat": 4,
        "label": "Technical/Code",
        "description": "Response containing code blocks (```), inline code, or structured technical output (SQL, JSON, Python, config files). May include shell commands or configuration snippets.",
        "examples": "Use the `os` module to list files: `import os; os.listdir('.')`. Run `npm install express`. def hello():\n    print('Hello, world!'). SELECT * FROM users WHERE active = true.",
    },
]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(av * bv for av, bv in zip(a, b))
    na = math.sqrt(sum(v * v for v in a))
    nb = math.sqrt(sum(v * v for v in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


_input_emb_cache: dict[str, list[float]] | None = None
_output_emb_cache: dict[str, list[float]] | None = None


async def _compute_embedding(text: str) -> list[float]:
    base_url = config_manager.get_embedding_url()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{base_url}/api/embeddings",
            json={"model": _get_embed_model(), "prompt": text[:512]},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("embedding", [])


async def _get_input_embeddings() -> dict[int, list[float]]:
    global _input_emb_cache
    if _input_emb_cache is not None:
        return _input_emb_cache

    cache_dir = config_manager.get_embeddings_config().get("cache_dir", "/tmp")
    cache_file = os.path.join(cache_dir, "synesth_input_embeddings.json")
    try:
        with open(cache_file) as f:
            _input_emb_cache = {int(k): v for k, v in json.load(f).items()}
            logger.info("Loaded %d synesth input embeddings from cache", len(_input_emb_cache))
            return _input_emb_cache
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    _input_emb_cache = {}
    for cat in INPUT_CATEGORIES:
        text = f"Category {cat['cat']} - {cat['label']}: {cat['description']} Examples: {cat['examples']}"
        emb = await _compute_embedding(text)
        _input_emb_cache[cat["cat"]] = emb

    with open(cache_file, "w") as f:
        json.dump({str(k): v for k, v in _input_emb_cache.items()}, f)
    logger.info("Computed and cached %d synesth input embeddings", len(_input_emb_cache))
    return _input_emb_cache


async def _get_output_embeddings() -> dict[int, list[float]]:
    global _output_emb_cache
    if _output_emb_cache is not None:
        return _output_emb_cache

    cache_dir = config_manager.get_embeddings_config().get("cache_dir", "/tmp")
    cache_file = os.path.join(cache_dir, "synesth_output_embeddings.json")
    try:
        with open(cache_file) as f:
            _output_emb_cache = {int(k): v for k, v in json.load(f).items()}
            logger.info("Loaded %d synesth output embeddings from cache", len(_output_emb_cache))
            return _output_emb_cache
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    _output_emb_cache = {}
    for cat in OUTPUT_CATEGORIES:
        text = f"Category {cat['cat']} - {cat['label']}: {cat['description']} Examples: {cat['examples']}"
        emb = await _compute_embedding(text)
        _output_emb_cache[cat["cat"]] = emb

    with open(cache_file, "w") as f:
        json.dump({str(k): v for k, v in _output_emb_cache.items()}, f)
    logger.info("Computed and cached %d synesth output embeddings", len(_output_emb_cache))
    return _output_emb_cache


async def classify_synesth(prompt: str, response: str | None) -> dict[str, list[float]] | None:
    """Classify prompt + response into synesthesia categories using embedding similarity.

    Returns {"input_probs": [5 floats 0.0-1.0], "output_probs": [5 floats 0.0-1.0]}
    or None if classification fails. Values are cosine similarity scores (not normalized).
    """
    if not prompt or not response:
        return None

    input_embs = await _get_input_embeddings()
    output_embs = await _get_output_embeddings()

    prompt_emb = await _compute_embedding(prompt)
    response_emb = await _compute_embedding(response)

    if not prompt_emb or not response_emb:
        return None

    # Score all input categories
    num_input = max(input_embs.keys()) + 1 if input_embs else 5
    input_scores = [0.0] * num_input
    for cat, cat_emb in input_embs.items():
        input_scores[cat] = _cosine_similarity(prompt_emb, cat_emb)

    # Score all output categories
    num_output = max(output_embs.keys()) + 1 if output_embs else 5
    output_scores = [0.0] * num_output
    for cat, cat_emb in output_embs.items():
        output_scores[cat] = _cosine_similarity(response_emb, cat_emb)

    # Clamp below-threshold scores to 0.0 so they don't contribute noise
    threshold = 0.10
    for i in range(num_input):
        if input_scores[i] < threshold:
            input_scores[i] = 0.0
    for i in range(num_output):
        if output_scores[i] < threshold:
            output_scores[i] = 0.0

    logger.info("Synesth probs — input: %s, output: %s",
                [round(s, 3) for s in input_scores],
                [round(s, 3) for s in output_scores])
    return {"input_probs": input_scores, "output_probs": output_scores}
