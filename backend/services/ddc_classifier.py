import json
import logging
import re

import httpx

from models.trace import DdcEntry, DdcMetadata

logger = logging.getLogger("conductor")

DDC_SYSTEM_PROMPT = (
    "You are a Dewey Decimal Classification specialist. "
    "Given two texts (PROMPT and RESPONSE), classify each one into a DDC code. "
    "Reply with ONLY a JSON object with two keys (no markdown, no code fences).\n"
    '{"prompt": {"code": "XXX.X", "label": "...", '
    '"action": "verb", "domain": "subject", '
    '"lineage": [{"tier": 1, "code": "000", "label": "Main class"}]}, '
    '"response": {"code": "XXX.X", "label": "...", '
    '"action": "verb", "domain": "subject", '
    '"lineage": [{"tier": 1, "code": "000", "label": "Main class"}]}}\n\n'
    "DDC Main Classes:\n"
    "000 Computer Science, Information & General Works\n"
    "100 Philosophy & Psychology\n"
    "200 Religion\n"
    "300 Social Sciences\n"
    "400 Language\n"
    "500 Pure Science\n"
    "600 Technology & Applied Sciences\n"
    "700 Arts & Recreation\n"
    "800 Literature\n"
    "900 History & Geography\n\n"
    "Assign the most specific DDC code you can. "
    "Action = what the text DOES. Domain = what it is ABOUT."
)

EXAMPLE_JSON = (
    '{"prompt": {"code": "005.1", "label": "Computer Programming", '
    '"action": "Writing code", "domain": "Computer Science", '
    '"lineage": [{"tier": 1, "code": "000", "label": "Computer Science"}, '
    '{"tier": 2, "code": "005", "label": "Computer Programming"}, '
    '{"tier": 3, "code": "005.1", "label": "Programming Languages"}]}, '
    '"response": {"code": "332.6", "label": "Investment Analysis", '
    '"action": "Explaining", "domain": "Economics", '
    '"lineage": [{"tier": 1, "code": "300", "label": "Social Sciences"}, '
    '{"tier": 2, "code": "330", "label": "Economics"}, '
    '{"tier": 3, "code": "332.6", "label": "Investment"}]}}'
)


def _extract_json(raw: str) -> dict | None:
    raw = raw.strip()
    if not raw:
        return None

    # Remove markdown code fences and reasoning preamble
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    raw = re.sub(r"^.*?(\{|$)", r"\1", raw, flags=re.DOTALL).strip()
    raw = raw.strip()

    # Strategy 1: strict parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Strategy 2: lenient parse (allow control chars)
    try:
        return json.loads(raw, strict=False)
    except json.JSONDecodeError:
        pass

    # Strategy 3: find first { ... } block
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        candidate = m.group(0)
        try:
            return json.loads(candidate, strict=False)
        except json.JSONDecodeError:
            pass

    # Strategy 4: try to fix broken JSON
    try:
        fixed = re.sub(r",\s*}", "}", raw)  # trailing commas
        fixed = re.sub(r",\s*]", "]", fixed)
        fixed = re.sub(r"(?<=[}\"])\s+(?=\")", ", ", fixed)  # missing commas between fields
        return json.loads(fixed, strict=False)
    except (json.JSONDecodeError, ValueError):
        pass

    return None


def _entry_from_obj(obj: dict | None) -> DdcEntry | None:
    if not obj:
        return None
    return DdcEntry(
        code=str(obj.get("code", "000.0")),
        label=str(obj.get("label", "Unclassified")),
        action=obj.get("action"),
        domain=obj.get("domain"),
        lineage=obj.get("lineage", []),
    )


async def classify_ddc(
    prompt: str,
    output: str | None,
    ollama_url: str,
    model: str,
) -> DdcMetadata:
    output_text = (output or "").strip()
    if not prompt or len(prompt.strip()) < 10:
        return DdcMetadata(prompt=None, response=None)

    classification_prompt = (
        f"PROMPT:\n{prompt[:2000]}\n\n"
        f"RESPONSE:\n{output_text[:2000] if output_text else '(empty)'}\n\n"
        f"Example output:\n{EXAMPLE_JSON}"
    )
    payload = {
        "model": model,
        "prompt": classification_prompt,
        "system": DDC_SYSTEM_PROMPT,
        "stream": False,
        "options": {"num_ctx": 4096, "num_predict": 512},
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{ollama_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("response", "").strip()
            if not raw:
                raw = data.get("thinking", "").strip()
            obj = _extract_json(raw)
            if obj is None:
                logger.warning("DDC: could not parse response: %.100s", raw)
                return DdcMetadata(prompt=None, response=None)
            return DdcMetadata(
                prompt=_entry_from_obj(obj.get("prompt")),
                response=_entry_from_obj(obj.get("response")),
            )
    except Exception as e:
        logger.warning("DDC classification failed: %s", e)
        return DdcMetadata(prompt=None, response=None)
