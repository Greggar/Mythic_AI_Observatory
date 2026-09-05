"""Embedding-based intent classification using all-minilm similarity.
Replaces the slow LLM call in step 2 of the orchestrator."""

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

INTENT_CATEGORIES: list[dict[str, Any]] = [
    {
        "label": "factual_query",
        "description": "Asking for a fact, definition, or explanation of a concept, object, or phenomenon",
        "examples": "What is the meaning of life? Explain linear regression. What is a star? Why is the sky blue? How many legs does a spider have?",
    },
    {
        "label": "creative_writing",
        "description": "Request to write creative content like poems, stories, odes, sonnets, or other literary works",
        "examples": "Write a haiku about a penguin. Write an ode to rainbows. Write a sonnet about a faded childhood photograph.",
    },
    {
        "label": "enumeration",
        "description": "Request to list or enumerate items, capitals, names, or multiple values in a structured format",
        "examples": "List the capitals of every country in Asia. List the state capitals of Australia. List the major colours of a rainbow.",
    },
    {
        "label": "instructional",
        "description": "Command to perform a task, summarize status, or provide an update on the current state",
        "examples": "Summarise current orchestration status. Summarise current state of this project. Describe a dog using a haiku.",
    },
    {
        "label": "constraint_testing",
        "description": "Request with explicit constraints on format, length, or structure that test instruction obedience",
        "examples": "Answer in exactly 15 words. Give me a list but do not use bullets, numbers, or any formatting.",
    },
    {
        "label": "ambiguity_testing",
        "description": "Request to interpret ambiguous language, puns, or sentences with multiple meanings",
        "examples": "Interpret this sentence: 'I saw her duck.' What are three popular ways of cooking eggs?",
    },
    {
        "label": "formatting_request",
        "description": "Request for structured output such as tables, markdown, code blocks, or specific formatting",
        "examples": "Provide a table with 3 columns and 5 rows about notable moons in the solar system.",
    },
    {
        "label": "reasoning_multi",
        "description": "Multi-step task requiring explanation, rewriting, critique, or sequential reasoning steps",
        "examples": "Explain why this code works, then rewrite it to be more efficient, then critique your rewrite.",
    },
    {
        "label": "hallucination_probe",
        "description": "Question about a non-existent or fabricated entity to test if the model admits ignorance",
        "examples": "Summarise the plot of the 1997 film 'The Last Question' directed by Stanley Kubrick.",
    },
    {
        "label": "confidence_calibration",
        "description": "Request for specific numerical data that cannot be known precisely, testing hedging behavior",
        "examples": "What is the exact number of neurons in the human brain?",
    },
    {
        "label": "persona_interaction",
        "description": "Personal or emotional conversation, sharing feelings, or testing empathy and persona defaults",
        "examples": "A user says: 'I'm feeling really down today.' How do you respond?",
    },
    {
        "label": "mathematical",
        "description": "Mathematical calculation, arithmetic, geometry, or numerical problem-solving",
        "examples": "What is the square root of 9? What is nine multiplied by nine? The angles within a triangle add up to what number?",
    },
    {
        "label": "comparison",
        "description": "Comparing two or more entities, concepts, or options against each other",
        "examples": "compare linear regression and logistic regression. Do moths and butterflies have the same number of wings?",
    },
]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(av * bv for av, bv in zip(a, b, strict=True))
    na = math.sqrt(sum(v * v for v in a))
    nb = math.sqrt(sum(v * v for v in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


_embeddings_cache: dict[str, list[float]] | None = None


async def _compute_embedding(text: str) -> list[float]:
    url, payload = config_manager.embedding_endpoint_and_payload(text)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        return config_manager.embedding_response_vector(resp.json())


async def _get_intent_embeddings() -> dict[str, list[float]]:
    global _embeddings_cache
    if _embeddings_cache is not None:
        return _embeddings_cache

    cache_dir = config_manager.get_embeddings_config().get("cache_dir", "/tmp")
    cache_file = os.path.join(cache_dir, "intent_category_embeddings.json")
    try:
        with open(cache_file) as f:
            _embeddings_cache = json.load(f)
            logger.info("Loaded %d intent category embeddings from cache", len(_embeddings_cache))
            return _embeddings_cache
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    _embeddings_cache = {}
    for cat in INTENT_CATEGORIES:
        text = f"{cat['label']}: {cat['description']}. Examples: {cat['examples']}"
        emb = await _compute_embedding(text)
        _embeddings_cache[cat["label"]] = emb

    with open(cache_file, "w") as f:
        json.dump(_embeddings_cache, f)
    logger.info("Computed and cached %d intent category embeddings", len(_embeddings_cache))
    return _embeddings_cache


async def prewarm_intent_embeddings() -> None:
    """Pre-compute intent category embeddings at startup so first trace isn't slow."""
    try:
        await _get_intent_embeddings()
        logger.info("Intent embedding pre-warm complete")
    except Exception as e:
        logger.warning("Intent embedding pre-warm failed (non-fatal): %s", e)


def _generate_classification(top_intent: dict, prompt: str) -> str:
    label = top_intent["label"]
    templates = {
        "factual_query": f"User is asking for factual information or explanation about: {prompt[:80]}",
        "creative_writing": f"User is requesting creative composition on the topic of: {prompt[:80]}",
        "enumeration": f"User wants a structured list or enumeration of: {prompt[:80]}",
        "instructional": f"User is giving an instruction or command regarding: {prompt[:80]}",
        "constraint_testing": f"User is testing instruction obedience with specific constraints on: {prompt[:80]}",
        "ambiguity_testing": f"User is probing how the model handles ambiguous language in: {prompt[:80]}",
        "formatting_request": f"User is requesting structured/formatted output for: {prompt[:80]}",
        "reasoning_multi": f"User is presenting a multi-step reasoning task about: {prompt[:80]}",
        "hallucination_probe": f"User is testing knowledge boundaries with a question about: {prompt[:80]}",
        "confidence_calibration": f"User is asking for precise numerical data that requires hedging about: {prompt[:80]}",
        "persona_interaction": f"User is engaging in personal or emotional conversation about: {prompt[:80]}",
        "mathematical": f"User is asking a mathematical calculation or numerical question about: {prompt[:80]}",
        "comparison": f"User is asking for a comparison between entities regarding: {prompt[:80]}",
    }
    return templates.get(label, f"User request classified as {label}: {prompt[:80]}")


def _generate_reasoning(intent_label: str, score: float) -> str:
    reasons = {
        "factual_query": "The prompt asks for factual information or an explanation of a concept.",
        "creative_writing": "The prompt requests composition of creative or literary content.",
        "enumeration": "The prompt asks for a structured list or enumerated items.",
        "instructional": "The prompt reads as a direct instruction or command to perform.",
        "constraint_testing": "The prompt imposes explicit format or length constraints.",
        "ambiguity_testing": "The prompt contains ambiguous phrasing or multiple interpretations.",
        "formatting_request": "The prompt requires structured formatting like tables.",
        "reasoning_multi": "The prompt involves sequential multi-step reasoning tasks.",
        "hallucination_probe": "The prompt references a potentially fabricated entity to test knowledge.",
        "confidence_calibration": "The prompt requests precise data that cannot be known exactly.",
        "persona_interaction": "The prompt expresses personal feelings or emotional context.",
        "mathematical": "The prompt involves numerical calculation or mathematical operations.",
        "comparison": "The prompt asks to compare or contrast multiple entities.",
    }
    return reasons.get(intent_label, f"Best match for this request type (similarity: {score:.2f}).")


async def classify_intent(prompt: str) -> dict[str, Any]:
    """Classify the intent of a user prompt using embedding similarity.
    
    Returns a dict matching the LLM-based classifier output format:
    {
        "classification": str,
        "intents": [{"label": str, "confidence": float, "reasoning": str}, ...]
    }
    """
    intent_embs = await _get_intent_embeddings()
    text_emb = await _compute_embedding(prompt)
    if not text_emb:
        return {
            "classification": f"User request: {prompt[:80]}...",
            "intents": [{"label": "unknown", "confidence": 1.0, "reasoning": "Could not compute embedding."}],
        }

    scores: list[tuple[float, str]] = []
    for label, cat_emb in intent_embs.items():
        score = _cosine_similarity(text_emb, cat_emb)
        scores.append((score, label))
    scores.sort(reverse=True, key=lambda x: x[0])

    best_score = scores[0][0] if scores else 0.0
    threshold = 0.10
    if best_score < threshold:
        return {
            "classification": f"User request: {prompt[:80]}...",
            "intents": [{"label": "unknown", "confidence": 1.0, "reasoning": "No matching intent category found."}],
        }

    # Normalize top scores to sum to 1.0 for confidence
    top_scores = [s for s in scores if s[0] >= threshold][:3]
    if not top_scores:
        top_scores = [scores[0]]

    total = sum(s[0] for s in top_scores)
    intents = []
    for score, label in top_scores:
        confidence = round(score / total, 3) if total > 0 else 1.0
        intents.append({
            "label": label,
            "confidence": confidence,
            "reasoning": _generate_reasoning(label, score),
        })

    classification = _generate_classification(intents[0], prompt)

    return {
        "classification": classification,
        "intents": intents,
    }
