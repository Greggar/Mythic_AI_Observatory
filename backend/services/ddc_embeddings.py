"""Embedding-based DDC classification using all-minilm similarity."""

import json
import logging
import math
from typing import Any

import httpx

from models.trace import DdcMetadata, DdcEntry

logger = logging.getLogger("conductor")

OLLAMA_URL = "http://127.0.0.1:11434"
EMBED_MODEL = "all-minilm:22m"

DDC_CATEGORIES: list[dict[str, Any]] = [
    {"code": "000", "label": "Computer Science & General Works", "description": "Computer science, information systems, general encyclopedias, knowledge organization, books, writing systems, reference works, facts, trivia, general questions, how things work"},
    {"code": "004", "label": "Data Processing & Computer Science", "description": "Data processing, computer science, programming, algorithms, software engineering, operating systems, data structures, computing fundamentals"},
    {"code": "005", "label": "Computer Programming", "description": "Computer programming, programming languages, software development, coding, scripts, functions, code examples, program design"},
    {"code": "005.1", "label": "Programming Languages", "description": "Programming languages, compilers, interpreters, language syntax, code generation, language features, syntax"},
    {"code": "005.3", "label": "Software Systems", "description": "Software systems, programs, applications, databases, user interfaces, APIs, software architecture, system administration"},
    {"code": "006.3", "label": "Artificial Intelligence", "description": "Artificial intelligence, machine learning, neural networks, natural language processing, expert systems, AI agents, chatbots, reasoning"},
    {"code": "006.7", "label": "Multimedia & Web Systems", "description": "Multimedia systems, web applications, internet services, social media, digital content, websites, video, audio processing"},
    {"code": "010", "label": "Bibliography", "description": "Bibliographies, catalogs, document collections, references, citations, metadata, indexes, library catalogs"},
    {"code": "020", "label": "Library & Information Science", "description": "Library science, information management, archives, classification systems, records management, information retrieval"},
    {"code": "030", "label": "General Encyclopedic Works", "description": "Encyclopedias, general reference works, almanacs, factual compilations, world records, general knowledge, miscellaneous facts"},
    {"code": "100", "label": "Philosophy & Psychology", "description": "Philosophy, psychology, logic, ethics, metaphysics, epistemology, consciousness, mind, thought, reasoning about existence"},
    {"code": "110", "label": "Metaphysics", "description": "Metaphysics, ontology, being, existence, reality, time, space, cosmology, nature of reality, first principles"},
    {"code": "120", "label": "Epistemology", "description": "Epistemology, knowledge, belief, truth, justification, reasoning, evidence, how we know things, theory of knowledge"},
    {"code": "150", "label": "Psychology", "description": "Psychology, behavior, cognition, emotion, perception, personality, mental processes, mental health, human mind, brain function"},
    {"code": "160", "label": "Logic", "description": "Logic, reasoning, argumentation, deduction, induction, fallacies, critical thinking, valid arguments, sound reasoning"},
    {"code": "170", "label": "Ethics", "description": "Ethics, morality, values, right and wrong, virtues, moral philosophy, conduct, good and evil, moral dilemmas"},
    {"code": "200", "label": "Religion", "description": "Religion, theology, spirituality, beliefs, worship, sacred texts, religious practice, faith, prayer, god, gods, scripture, church, ritual"},
    {"code": "300", "label": "Social Sciences", "description": "Social sciences, sociology, anthropology, society, culture, social structures, human relationships, community, demographics"},
    {"code": "310", "label": "Statistics", "description": "Statistics, data analysis, probability, statistical methods, numerical data, surveys, averages, distributions, graphs, charts"},
    {"code": "320", "label": "Political Science", "description": "Political science, government, politics, public policy, political systems, law, elections, voting, democracy, governance"},
    {"code": "330", "label": "Economics", "description": "Economics, finance, trade, markets, commerce, business, investment, economic theory, supply and demand, money, banking"},
    {"code": "340", "label": "Law", "description": "Law, legal systems, legislation, regulation, compliance, rights, justice, courts, contracts, legal procedures"},
    {"code": "360", "label": "Social Problems & Services", "description": "Social services, welfare, social problems, public safety, emergency services, counseling, social work, community services"},
    {"code": "370", "label": "Education", "description": "Education, teaching, learning, instruction, curriculum, pedagogy, training, schools, tutoring, academic subjects, studying"},
    {"code": "400", "label": "Language", "description": "Language, linguistics, grammar, vocabulary, syntax, translation, communication, languages, speech, words, meaning"},
    {"code": "410", "label": "Linguistics", "description": "Linguistics, phonology, morphology, syntax, semantics, language theory, grammar, language structure, comparative linguistics"},
    {"code": "420", "label": "English & Old English", "description": "English language, English grammar, English vocabulary, writing in English, style, English usage, spelling, pronunciation"},
    {"code": "500", "label": "Pure Science", "description": "Pure sciences, natural sciences, scientific method, research, experimentation, observation, hypothesis, scientific inquiry"},
    {"code": "510", "label": "Mathematics", "description": "Mathematics, arithmetic, algebra, geometry, calculus, number theory, mathematical analysis, numbers, equations, formulas, computation"},
    {"code": "520", "label": "Astronomy & Space", "description": "Astronomy, celestial bodies, stars, planets, galaxies, astrophysics, cosmology, space, moon, sun, solar system, universe, sky, light, colours of rainbow, optics"},
    {"code": "530", "label": "Physics", "description": "Physics, mechanics, thermodynamics, electromagnetism, quantum physics, relativity, energy, forces, motion, waves, light, optics, sound, electricity"},
    {"code": "540", "label": "Chemistry", "description": "Chemistry, elements, compounds, chemical reactions, molecules, atoms, materials science, periodic table, substances"},
    {"code": "550", "label": "Earth Sciences", "description": "Earth sciences, geology, meteorology, paleontology, oceanography, natural disasters, weather, climate, rocks, fossils, earthquakes, volcanos"},
    {"code": "570", "label": "Biology & Life Sciences", "description": "Biology, life sciences, organisms, cells, genetics, evolution, ecology, biochemistry, animals, plants, living things, anatomy, physiology"},
    {"code": "600", "label": "Technology & Applied Sciences", "description": "Technology, engineering, applied sciences, inventions, technical processes, innovation, practical applications"},
    {"code": "610", "label": "Medicine & Health", "description": "Medicine, health, diseases, treatments, healthcare, pharmacology, anatomy, diagnosis, medical conditions, wellness, body"},
    {"code": "620", "label": "Engineering", "description": "Engineering, mechanics, construction, design, manufacturing, industrial processes, bridges, machines, electronics, circuits"},
    {"code": "630", "label": "Agriculture", "description": "Agriculture, farming, crops, livestock, gardening, forestry, food production, soil, plants cultivation, harvesting"},
    {"code": "640", "label": "Home & Family Management", "description": "Home economics, cooking, nutrition, childcare, domestic management, lifestyle, food preparation, recipes, household"},
    {"code": "650", "label": "Management & Business", "description": "Management, business, administration, organization, leadership, entrepreneurship, planning, strategy, human resources, marketing"},
    {"code": "660", "label": "Chemical Engineering", "description": "Chemical engineering, industrial chemistry, manufacturing processes, biotechnology, food processing, materials production"},
    {"code": "680", "label": "Manufacturing", "description": "Manufacturing, fabrication, production, machinery, tools, industrial equipment, assembly, mass production, workshops"},
    {"code": "690", "label": "Construction", "description": "Construction, buildings, architecture, structural engineering, building materials, carpentry, plumbing, electrical work"},
    {"code": "700", "label": "Arts & Recreation", "description": "Arts, recreation, creative works, entertainment, leisure activities, hobbies, fine arts, performing arts, visual arts"},
    {"code": "710", "label": "Urban & Landscape Planning", "description": "Urban planning, landscape architecture, civic design, parks, public spaces, city planning, land use, community design"},
    {"code": "720", "label": "Architecture", "description": "Architecture, buildings, structures, design, architectural styles, monuments, building design, construction design"},
    {"code": "740", "label": "Drawing & Decorative Arts", "description": "Drawing, painting, decorative arts, design, crafts, textile arts, visual arts, illustration, printmaking, sculpture"},
    {"code": "780", "label": "Music", "description": "Music, musical composition, performance, instruments, theory, songs, recordings, singing, bands, orchestra, melody, rhythm"},
    {"code": "790", "label": "Recreation & Sports", "description": "Recreation, sports, games, exercise, outdoor activities, physical fitness, team sports, athletics, swimming, running, ball games"},
    {"code": "800", "label": "Literature", "description": "Literature, literary works, poems, stories, novels, writing, literary criticism, fiction, poetry, prose, creative writing, haiku, sonnets"},
    {"code": "808", "label": "Writing & Rhetoric", "description": "Writing, rhetoric, composition, creative writing, technical writing, authorship, essay writing, style, persuasive writing"},
    {"code": "900", "label": "History & Geography", "description": "History, geography, exploration, travel, biographies, historical events, civilizations, timelines, historical figures"},
    {"code": "910", "label": "Geography & Travel", "description": "Geography, travel, exploration, maps, places, regions, cultures, tourism, countries, capitals, landmarks, locations"},
    {"code": "920", "label": "Biography & Genealogy", "description": "Biographies, memoirs, personal narratives, genealogy, family histories, life stories, autobiographies, personal accounts"},
    {"code": "930", "label": "Ancient History", "description": "Ancient history, classical civilizations, archaeology, prehistory, early societies, ancient cultures, historical artifacts"},
]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(av * bv for av, bv in zip(a, b))
    na = math.sqrt(sum(v * v for v in a))
    nb = math.sqrt(sum(v * v for v in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _infer_action(text: str) -> str:
    t = text.lower().strip()
    verbs = {
        "write": ["write", "create", "implement", "generate", "produce", "code", "script", "program"],
        "Analyzing": ["analyze", "evaluate", "assess", "examine", "study", "review", "inspect", "audit", "debug", "test"],
        "Explaining": ["explain", "describe", "define", "clarify", "elaborate", "illustrate", "demonstrate"],
        "Answering": ["answer", "respond", "reply", "tell", "what is", "who is", "when did", "how does", "question"],
        "Debugging": ["debug", "fix", "error", "bug", "issue", "problem", "broken", "wrong", "incorrect", "fail"],
        "Optimizing": ["optimize", "improve", "refactor", "enhance", "speed up", "faster", "better", "upgrade"],
        "Summarizing": ["summarize", "summarise", "brief", "overview", "tl;dr", "recap", "synopsis", "digest"],
        "Translating": ["translate", "convert", "port", "migrate", "transform", "transpile"],
        "Searching": ["search", "find", "look up", "retrieve", "locate", "query", "search for"],
        "Teaching": ["teach", "tutor", "learn", "guide", "walk through", "tutorial", "lesson", "instruct"],
        "Configuring": ["configure", "setup", "install", "deploy", "set up", "setup", "server", "config"],
        "Questioning": ["?", "query", "ask", "inquire", "wonder", "curious"],
    }
    for action, patterns in verbs.items():
        for p in patterns:
            if p in t:
                return action
    return "Processing"


def _infer_domain(code: str) -> str:
    # derive main class (first digit + "00") from DDC code
    main = code[0] + "00"
    domains = {
        "000": "Computer Science",
        "100": "Philosophy",
        "200": "Religion",
        "300": "Social Sciences",
        "400": "Language",
        "500": "Science",
        "600": "Technology",
        "700": "Arts",
        "800": "Literature",
        "900": "History",
    }
    return domains.get(main, "General")


def _build_lineage(code: str, label: str) -> list[dict[str, Any]]:
    parts = code.split(".")
    result: list[dict[str, Any]] = []
    for i in range(len(parts)):
        tier_code = parts[0] if i == 0 else f"{parts[0]}.{parts[i]}"
        # find by prefix
        tier_label = label if tier_code == code else ""
        for cat in DDC_CATEGORIES:
            if cat["code"] == tier_code:
                tier_label = cat["label"]
                break
        if not tier_label:
            tier_label = f"{tier_code}..."
        result.append({"tier": i + 1, "code": tier_code, "label": tier_label})
    return result


_embeddings_cache: dict[str, list[float]] | None = None


async def _compute_embedding(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text[:512]},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("embedding", [])


async def _get_category_embeddings() -> dict[str, list[float]]:
    global _embeddings_cache
    if _embeddings_cache is not None:
        return _embeddings_cache
    
    cache_file = "/tmp/ddc_category_embeddings.json"
    try:
        with open(cache_file) as f:
            _embeddings_cache = json.load(f)
            logger.info("Loaded %d DDC category embeddings from cache", len(_embeddings_cache))
            return _embeddings_cache
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    _embeddings_cache = {}
    for cat in DDC_CATEGORIES:
        text = f"{cat['code']} {cat['label']}: {cat['description']}"
        emb = await _compute_embedding(text)
        _embeddings_cache[cat["code"]] = emb

    with open(cache_file, "w") as f:
        json.dump(_embeddings_cache, f)
    logger.info("Computed and cached %d DDC category embeddings", len(_embeddings_cache))
    return _embeddings_cache


async def classify_multi(text: str, top_n: int = 3, is_empty: bool = False) -> list[DdcEntry]:
    """Return top-N DDC classifications above threshold."""
    if is_empty or not text or len(text.strip()) < 10:
        return []

    category_embs = await _get_category_embeddings()
    text_emb = await _compute_embedding(text)
    if not text_emb:
        return []

    scores: list[tuple[float, str]] = []
    for code, cat_emb in category_embs.items():
        score = _cosine_similarity(text_emb, cat_emb)
        scores.append((score, code))
    scores.sort(reverse=True, key=lambda x: x[0])

    results: list[DdcEntry] = []
    for score, code in scores:
        if score < 0.10:
            break
        cat = next((c for c in DDC_CATEGORIES if c["code"] == code), None)
        if not cat:
            continue
        results.append(DdcEntry(
            code=code,
            label=cat["label"],
            action=_infer_action(text),
            domain=_infer_domain(code),
            lineage=_build_lineage(code, cat["label"]),
        ))
        if len(results) >= top_n:
            break
    return results


async def classify(text: str, is_empty: bool = False) -> DdcEntry | None:
    if is_empty or not text or len(text.strip()) < 10:
        return None

    category_embs = await _get_category_embeddings()
    text_emb = await _compute_embedding(text)
    if not text_emb:
        return None

    best_code = "000"
    best_score = -1.0
    for code, cat_emb in category_embs.items():
        score = _cosine_similarity(text_emb, cat_emb)
        if score > best_score:
            best_score = score
            best_code = code

    if best_score < 0.10:
        return None

    cat = next((c for c in DDC_CATEGORIES if c["code"] == best_code), None)
    if not cat:
        return None

    action = _infer_action(text)
    domain = _infer_domain(best_code)
    lineage = _build_lineage(best_code, cat["label"])

    return DdcEntry(
        code=best_code,
        label=cat["label"],
        action=action,
        domain=domain,
        lineage=lineage,
    )


async def classify_ddc(prompt: str, output: str | None) -> DdcMetadata:
    prompt_entry = await classify(prompt)
    output_text = (output or "").strip()
    response_entry = await classify(output_text, is_empty=not output_text)
    return DdcMetadata(prompt=prompt_entry, response=response_entry)
