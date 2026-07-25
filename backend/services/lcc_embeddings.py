"""Embedding-based LCC classification using all-minilm similarity."""

import json
import logging
import math
import os
from typing import Any

import httpx

from models.trace import LccMetadata, LccEntry
from services import config_manager

logger = logging.getLogger("conductor")

EMBED_MODEL = os.environ.get("EMBEDDING_MODEL") or config_manager.get_embeddings_config().get("model", "all-minilm:22m")

LCC_CATEGORIES: list[dict[str, Any]] = [
    {"code": "AC", "label": "Collections & Series", "description": "Collected works, series, monographic series, collected papers, anthologies, general collections"},
    {"code": "AE", "label": "Encyclopedias", "description": "General encyclopedias, reference works, factual compilations, world almanacs, general knowledge"},
    {"code": "AG", "label": "Dictionaries & Reference", "description": "General reference works, dictionaries, handbooks, fact books, quick reference, general information"},
    {"code": "AI", "label": "Indexes", "description": "General indexes, bibliographic indexes, citation indexes, reference finding aids"},
    {"code": "AM", "label": "Museums", "description": "Museums, collections, curatorship, museum studies, exhibit design, collections management, museology"},

    {"code": "B1", "label": "Philosophy General", "description": "Philosophy, philosophical systems, history of philosophy, ancient philosophy, modern philosophy, Eastern philosophy, Western philosophy"},
    {"code": "BC", "label": "Logic", "description": "Logic, reasoning, argumentation, deduction, induction, syllogism, logical fallacies, critical thinking, valid arguments, formal logic, logical proofs, premises, conclusions, rationality"},
    {"code": "BD", "label": "Metaphysics & Epistemology", "description": "Metaphysics, ontology, epistemology, knowledge, truth, belief, reality, existence, consciousness, philosophy of mind"},
    {"code": "BF", "label": "Psychology", "description": "Psychology, behavior, cognition, emotion, perception, personality, mental processes, mental health, brain, mind, neuroscience"},
    {"code": "BJ", "label": "Ethics", "description": "Ethics, morality, values, right and wrong, virtues, moral philosophy, conduct, good and evil, moral dilemmas, applied ethics"},
    {"code": "BL", "label": "Religions", "description": "Religion, religious beliefs, world religions, comparative religion, mythology, spirituality, religious practice, sacred texts"},
    {"code": "BM", "label": "Judaism", "description": "Judaism, Jewish studies, Torah, Talmud, Jewish history, Jewish culture, Hebrew Bible, rabbinic literature, Jewish law"},
    {"code": "BP", "label": "Islam", "description": "Islam, Islamic studies, Quran, hadith, Islamic law, sharia, Islamic philosophy, Sufism, Muslim culture, Islamic history"},
    {"code": "BQ", "label": "Buddhism", "description": "Buddhism, Buddhist philosophy, dharma, meditation, Buddhist texts, Zen, Theravada, Mahayana, Buddhist practice"},
    {"code": "BR", "label": "Christianity", "description": "Christianity, Christian theology, church history, Christian doctrine, ecumenism, Christian denominations, church, gospel"},
    {"code": "BS", "label": "Bible", "description": "Bible, biblical studies, Old Testament, New Testament, scripture, exegesis, biblical criticism, biblical interpretation"},
    {"code": "BT", "label": "Doctrinal Theology", "description": "Christian doctrine, systematic theology, Christology, soteriology, eschatology, creation, atonement, trinity"},
    {"code": "BV", "label": "Practical Theology", "description": "Practical theology, worship, liturgy, preaching, pastoral care, ministry, evangelism, Christian education, prayer"},
    {"code": "BX", "label": "Christian Denominations", "description": "Christian denominations, Catholic Church, Protestantism, Orthodox Church, Anglican, Lutheran, Reformed, church governance"},

    {"code": "CB", "label": "History of Civilization", "description": "History of civilization, cultural history, world history, historical periods, historical analysis, progress, civilization studies"},
    {"code": "CC", "label": "Archaeology", "description": "Archaeology, archaeological methods, excavation, artifacts, ancient remains, archaeological sites, material culture, stratigraphy"},

    {"code": "DA", "label": "Great Britain History", "description": "British history, English history, UK history, British Empire, United Kingdom history, England, Scotland, Wales, Ireland"},
    {"code": "DC", "label": "France History", "description": "French history, France history, French Revolution, Napoleonic era, French Republic, French Empire"},
    {"code": "DD", "label": "Germany History", "description": "German history, Germany history, Holy Roman Empire, German unification, Nazi era, divided Germany, modern Germany"},
    {"code": "DK", "label": "Russia & Eastern Europe", "description": "Russian history, Eastern European history, Soviet Union, Communist era, Slavic history, Baltic states, Ukraine, Poland"},
    {"code": "DS", "label": "Asia History", "description": "Asian history, China history, Japan history, India history, Southeast Asia, Middle East history, ancient civilizations"},


    {"code": "GA", "label": "Cartography", "description": "Cartography, mathematical geography, mapmaking, surveying, mapping, GIS, topographic mapping, navigation charts"},
    {"code": "GB", "label": "Physical Geography", "description": "Physical geography, landforms, natural features, climatology, geomorphology, hydrology, landscapes, environmental processes"},
    {"code": "GC", "label": "Oceanography", "description": "Oceanography, ocean science, marine geology, ocean currents, sea, marine biology, coastal processes, ocean circulation"},
    {"code": "GE", "label": "Environmental Science", "description": "Environmental sciences, ecology, environmental studies, sustainability, climate change, conservation, natural resources, ecosystems"},
    {"code": "GN", "label": "Anthropology", "description": "Anthropology, cultural anthropology, physical anthropology, ethnography, human evolution, indigenous peoples, social customs"},
    {"code": "GV", "label": "Recreation & Sports", "description": "Recreation, sports, games, physical fitness, exercise, athletics, team sports, individual sports, outdoor activities, leisure"},

    {"code": "HA", "label": "Statistics", "description": "Statistics, statistical methods, data analysis, probability, surveys, censuses, numerical data, distributions, graphs, charts, regression, linear regression, correlation, statistical modeling, hypothesis testing, statistical inference, variables, prediction"},
    {"code": "HB", "label": "Economic Theory", "description": "Economics, economic theory, microeconomics, macroeconomics, supply and demand, markets, economic models, economic thought, inflation, unemployment, gdp, fiscal policy, monetary policy, trade, prices"},
    {"code": "HC", "label": "Economic History", "description": "Economic history, economic conditions, economic development, industrial history, economic policy, economic growth"},
    {"code": "HD", "label": "Industry & Labor", "description": "Industry, labor, management, industrial organization, production, employment, labor relations, manufacturing, business"},
    {"code": "HF", "label": "Commerce & Business", "description": "Commerce, business, marketing, trade, accounting, finance, management, entrepreneurship, business administration"},
    {"code": "HG", "label": "Finance", "description": "Finance, banking, investment, money, credit, stock market, financial markets, monetary policy, financial institutions"},
    {"code": "HM", "label": "Sociology", "description": "Sociology, social theory, social structure, social groups, social institutions, community, society, social change, social dynamics"},
    {"code": "HQ", "label": "Family & Gender", "description": "Family, marriage, gender studies, women, children, human sexuality, reproduction, family life, parenting, gender roles"},
    {"code": "HV", "label": "Social Welfare", "description": "Social welfare, social problems, criminology, social services, public welfare, charities, corrections, social pathology"},

    {"code": "JA", "label": "Political Theory", "description": "Political theory, political philosophy, democracy, liberty, justice, rights, governance theories, political thought"},
    {"code": "JC", "label": "Political Institutions", "description": "Political institutions, constitutional law, state government, sovereignty, political systems, comparative government"},
    {"code": "JK", "label": "US Politics", "description": "United States politics, US government, Congress, presidency, Supreme Court, elections, American political parties, federal government"},
    {"code": "JN", "label": "European Politics", "description": "European politics, European Union, European government, British politics, French politics, German politics, European institutions"},
    {"code": "JZ", "label": "International Relations", "description": "International relations, foreign policy, diplomacy, international security, global governance, peace studies, international organizations"},

    {"code": "KD", "label": "UK Law", "description": "United Kingdom law, English law, British legal system, common law, UK courts, British legislation, legal history"},
    {"code": "KF", "label": "US Law", "description": "United States law, American legal system, US Constitution, federal law, Supreme Court, US courts, American legislation"},

    {"code": "LA", "label": "History of Education", "description": "History of education, educational systems, educational history, schooling history, educational reform, education development"},
    {"code": "LB", "label": "Teaching & Learning", "description": "Teaching, learning, educational theory, curriculum, instruction, classroom management, educational psychology, pedagogy, assessment"},
    {"code": "LC", "label": "Special Education", "description": "Special aspects of education, adult education, higher education, distance education, literacy, educational equity, social aspects"},

    {"code": "ML", "label": "Music Literature", "description": "Music literature, music history, music criticism, musicology, composer studies, music analysis, music scholarship"},
    {"code": "MT", "label": "Music Instruction", "description": "Music instruction, music education, musical training, instrument instruction, vocal training, music theory education, ear training"},

    {"code": "NA", "label": "Architecture", "description": "Architecture, building design, architectural history, urban design, landscape architecture, structures, monuments, architectural styles"},
    {"code": "NB", "label": "Sculpture", "description": "Sculpture, sculpting, statues, carving, three-dimensional art, sculptural techniques, installation art, ceramics sculpture"},

    {"code": "PA", "label": "Classical Philology", "description": "Classical languages, Latin, Greek, classical literature, ancient texts, classical studies, Greek literature, Roman literature"},
    {"code": "PE", "label": "English Language", "description": "English language, English grammar, English vocabulary, writing in English, English usage, English linguistics"},
    {"code": "PJ", "label": "Oriental Languages", "description": "Oriental languages, Middle Eastern languages, Semitic languages, Arabic, Hebrew, Persian, Turkish, Asian languages"},
    {"code": "PL", "label": "East Asian Languages", "description": "East Asian languages, Chinese, Japanese, Korean, Southeast Asian languages, Pacific languages, Asian linguistics"},
    {"code": "PN", "label": "Literature General", "description": "Literature, literary theory, literary criticism, drama, theater, authorship, literary genres, rhetoric, poetry, fiction, prose"},
    {"code": "PQ", "label": "Romance Literature", "description": "Romance literature, French literature, Italian literature, Spanish literature, Portuguese literature, Latin American literature"},
    {"code": "PR", "label": "English Literature", "description": "English literature, British literature, English poetry, English fiction, English drama, Shakespeare, literary authors, works"},
    {"code": "PS", "label": "American Literature", "description": "American literature, US literature, American poetry, American fiction, American drama, American authors, literary works"},
    {"code": "PT", "label": "German Literature", "description": "German literature, German poetry, German fiction, Austrian literature, German authors, Germanic literature"},

    {"code": "QA", "label": "Mathematics & Computing", "description": "Mathematics, arithmetic, algebra, geometry, calculus, number theory, statistics, computer science, programming, algorithms, computing, functions, regression, linear algebra, mathematical analysis, discrete mathematics"},
    {"code": "QB", "label": "Astronomy", "description": "Astronomy, celestial bodies, stars, planets, galaxies, astrophysics, cosmology, space, solar system, universe, observation, sky, colours of rainbow, light, optics, celestial mechanics"},
    {"code": "QC", "label": "Physics", "description": "Physics, mechanics, thermodynamics, electromagnetism, quantum physics, relativity, energy, forces, motion, waves, optics, light, colour, refraction, rainbow, spectrum, electromagnetic radiation"},
    {"code": "QD", "label": "Chemistry", "description": "Chemistry, elements, compounds, chemical reactions, molecules, atoms, materials science, periodic table, laboratory, substances"},
    {"code": "QE", "label": "Geology", "description": "Geology, earth sciences, rocks, minerals, fossils, plate tectonics, volcanoes, earthquakes, paleontology, geological time"},
    {"code": "QH", "label": "Natural History & Biology", "description": "Natural history, biology, life sciences, ecology, evolution, genetics, cells, organisms, biodiversity, nature study"},
    {"code": "QK", "label": "Botany", "description": "Botany, plants, plant biology, plant taxonomy, flowers, trees, vegetation, plant physiology, plant ecology, agriculture"},
    {"code": "QL", "label": "Zoology", "description": "Zoology, animals, animal behavior, animal classification, vertebrates, invertebrates, mammals, birds, fish, insects"},
    {"code": "QM", "label": "Human Anatomy", "description": "Human anatomy, body, organs, tissues, skeletal system, muscular system, human body structure, anatomical systems"},
    {"code": "QP", "label": "Physiology", "description": "Physiology, body functions, organ systems, nervous system, cardiovascular system, metabolism, cell physiology, human biology"},
    {"code": "QR", "label": "Microbiology", "description": "Microbiology, bacteria, viruses, fungi, microorganisms, immunology, infectious diseases, pathogens, microbial ecology"},

    {"code": "RA", "label": "Public Health", "description": "Public health, epidemiology, health policy, environmental health, preventive medicine, health education, disease prevention"},
    {"code": "RC", "label": "Internal Medicine", "description": "Internal medicine, diseases, diagnosis, treatment, pathology, clinical medicine, medical conditions, patient care, therapy"},
    {"code": "RD", "label": "Surgery", "description": "Surgery, surgical procedures, operative techniques, surgical specialties, anesthesia, surgical care, operative medicine"},
    {"code": "RG", "label": "Gynecology", "description": "Gynecology, obstetrics, women's health, pregnancy, childbirth, reproductive health, female medicine, maternal care"},
    {"code": "RJ", "label": "Pediatrics", "description": "Pediatrics, children's health, infant care, adolescent medicine, child development, pediatric diseases, childhood conditions"},
    {"code": "RM", "label": "Therapeutics", "description": "Therapeutics, pharmacology, drugs, medications, treatment methods, therapy, pharmaceutical science, drug therapy, medicine"},
    {"code": "RT", "label": "Nursing", "description": "Nursing, nursing practice, patient care, nursing education, clinical nursing, healthcare delivery, nursing theory"},

    {"code": "SB", "label": "Plant Culture", "description": "Plant culture, horticulture, gardening, crop cultivation, plant breeding, pest control, agronomy, agricultural botany"},
    {"code": "SF", "label": "Animal Culture", "description": "Animal culture, livestock, animal husbandry, veterinary medicine, pet care, animal breeding, farm animals, domestication"},

    {"code": "TA", "label": "Engineering General", "description": "Engineering, civil engineering, structural engineering, engineering mechanics, materials engineering, technical design"},
    {"code": "TJ", "label": "Mechanical Engineering", "description": "Mechanical engineering, machinery, mechanical design, power generation, engines, thermodynamics, manufacturing engineering"},
    {"code": "TK", "label": "Electrical Engineering & Computing", "description": "Electrical engineering, electronics, telecommunications, power systems, computer engineering, digital systems, signal processing"},
    {"code": "TL", "label": "Transportation", "description": "Transportation, motor vehicles, automotive engineering, aerospace engineering, railways, ships, transportation systems"},
    {"code": "TP", "label": "Chemical Technology", "description": "Chemical technology, chemical engineering, industrial chemistry, processing, biotechnology, food technology, materials production"},
    {"code": "TS", "label": "Manufacturing", "description": "Manufacturing, production engineering, industrial engineering, fabrication, assembly, quality control, production processes"},

    {"code": "ZA", "label": "Information Resources", "description": "Information science, information resources, electronic resources, data management, information systems, digital information, knowledge management"},
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
    letter = code[0] if code else ""
    domains = {
        "A": "General Works",
        "B": "Philosophy & Religion",
        "C": "History Sciences",
        "D": "World History",
        "E": "US History",
        "F": "Regional History",
        "G": "Geography & Anthropology",
        "H": "Social Sciences",
        "J": "Political Science",
        "K": "Law",
        "L": "Education",
        "M": "Music",
        "N": "Fine Arts",
        "P": "Language & Literature",
        "Q": "Science",
        "R": "Medicine",
        "S": "Agriculture",
        "T": "Technology",
        "U": "Military Science",
        "V": "Naval Science",
        "Z": "Library Science",
    }
    return domains.get(letter, "General")


def _build_lineage(code: str, label: str) -> list[dict[str, Any]]:
    result = []
    for i in range(min(len(code), 3)):
        prefix = code[:i+1]
        cat = next((c for c in LCC_CATEGORIES if c["code"] == prefix), None)
        result.append({
            "tier": i + 1,
            "code": prefix,
            "label": cat["label"] if cat else (f"{prefix}..." if i < len(code)-1 else label),
        })
    return result


_embeddings_cache: dict[str, list[float]] | None = None


async def _compute_embedding(text: str) -> list[float]:
    base_url = config_manager.get_embedding_url()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{base_url}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text[:512]},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("embedding", [])


async def _get_category_embeddings() -> dict[str, list[float]]:
    global _embeddings_cache
    if _embeddings_cache is not None:
        return _embeddings_cache

    cache_dir = config_manager.get_embeddings_config().get("cache_dir", "/tmp")
    cache_file = os.path.join(cache_dir, "lcc_category_embeddings.json")
    try:
        with open(cache_file) as f:
            _embeddings_cache = json.load(f)
            logger.info("Loaded %d LCC category embeddings from cache", len(_embeddings_cache))
            return _embeddings_cache
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    _embeddings_cache = {}
    for cat in LCC_CATEGORIES:
        text = f"{cat['code']} {cat['label']}: {cat['description']}"
        emb = await _compute_embedding(text)
        _embeddings_cache[cat["code"]] = emb

    with open(cache_file, "w") as f:
        json.dump(_embeddings_cache, f)
    logger.info("Computed and cached %d LCC category embeddings", len(_embeddings_cache))
    return _embeddings_cache


async def _score_categories(text: str) -> list[tuple[float, str]] | None:
    """Compute cosine similarity scores for all LCC categories, sorted descending."""
    category_embs = await _get_category_embeddings()
    text_emb = await _compute_embedding(text)
    if not text_emb:
        return None
    scores: list[tuple[float, str]] = []
    for code, cat_emb in category_embs.items():
        score = _cosine_similarity(text_emb, cat_emb)
        scores.append((score, code))
    scores.sort(reverse=True, key=lambda x: x[0])
    return scores


def _build_top_scores(scores: list[tuple[float, str]], top_n: int = 5) -> list[dict]:
    """Build top_scores list from sorted (score, code) pairs."""
    result: list[dict] = []
    for score, code in scores[:top_n]:
        cat = next((c for c in LCC_CATEGORIES if c["code"] == code), None)
        result.append({"code": code, "label": cat["label"] if cat else "", "score": round(score, 4)})
    return result


async def classify_multi(text: str, top_n: int = 3, is_empty: bool = False) -> list[LccEntry]:
    """Return top-N LCC classifications above threshold."""
    if is_empty or not text or len(text.strip()) < 10:
        return []

    scores = await _score_categories(text)
    if scores is None:
        return []

    results: list[LccEntry] = []
    for score, code in scores:
        if score < 0.10:
            break
        cat = next((c for c in LCC_CATEGORIES if c["code"] == code), None)
        if not cat:
            continue
        results.append(LccEntry(
            code=code,
            label=cat["label"],
            action=_infer_action(text),
            domain=_infer_domain(code),
            lineage=_build_lineage(code, cat["label"]),
            score=round(score, 4),
            margin=round(score - (scores[0][0] if scores else 0), 4),
            top_scores=_build_top_scores(scores),
        ))
        if len(results) >= top_n:
            break
    return results


async def classify(text: str, is_empty: bool = False) -> LccEntry | None:
    if is_empty or not text or len(text.strip()) < 10:
        return None

    scores = await _score_categories(text)
    if not scores:
        return None

    best_score, best_code = scores[0]

    if best_score < 0.10:
        return None

    cat = next((c for c in LCC_CATEGORIES if c["code"] == best_code), None)
    if not cat:
        return None

    margin = best_score - (scores[1][0] if len(scores) > 1 else 0.0)

    action = _infer_action(text)
    domain = _infer_domain(best_code)
    lineage = _build_lineage(best_code, cat["label"])

    return LccEntry(
        code=best_code,
        label=cat["label"],
        action=action,
        domain=domain,
        lineage=lineage,
        score=round(best_score, 4),
        margin=round(margin, 4),
        top_scores=_build_top_scores(scores),
    )


async def classify_lcc(prompt: str, output: str | None) -> LccMetadata:
    prompt_entry = await classify(prompt)
    output_text = (output or "").strip()
    response_entry = await classify(output_text, is_empty=not output_text)
    return LccMetadata(prompt=prompt_entry, response=response_entry)
