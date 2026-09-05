import asyncio
import contextlib
import json
import logging
import math
import os
import uuid
from collections import deque
from datetime import UTC, datetime
from time import perf_counter
from typing import Any

import httpx
import psutil

logger = logging.getLogger("conductor")

from models.trace import LlmInsight, TelemetryImpact, TokenEntropy, TraceSession, TraceStep
from services import config_manager
from services.ddc_embeddings import classify_ddc
from services.ddc_embeddings import classify_multi as classify_multi_ddc
from services.lcc_embeddings import classify_lcc
from services.lcc_embeddings import classify_multi as classify_multi_lcc

# Set to "local" to use the primary server's CPU, "worker" for a remote GPU machine
# Use set_model_provider() to change at runtime
_model_provider_cfg = config_manager.get_model_provider_config()
_MODEL_PROVIDER: str = os.environ.get("ORCHESTRATOR_MODEL", _model_provider_cfg.get("provider", "local")).lower()

def get_model_provider() -> str:
    return _MODEL_PROVIDER

def _set_model_provider_internal(value: str) -> None:
    """Update the in-memory provider global without writing to disk."""
    global _MODEL_PROVIDER
    value = value.lower()
    if value not in ("local", "worker"):
        raise ValueError(f"Invalid model provider: {value!r}. Must be 'local' or 'worker'.")
    _MODEL_PROVIDER = value

def set_model_provider(value: str) -> None:
    global _MODEL_PROVIDER
    value = value.lower()
    if value not in ("local", "worker"):
        raise ValueError(f"Invalid model provider: {value!r}. Must be 'local' or 'worker'.")
    _MODEL_PROVIDER = value
    config_manager.set_model_provider_config(value)
    logger.info("Model provider switched to: %s", value)

LLM_TIMEOUT = 300.0  # 5 min for CPU inference; model-too-large hangs surface in ~60s

# Memory delivery: a chunk is "used" (content injected into the generator's
# context) when its relevance meets this floor; the top-ranked chunk always wins.
MEMORY_USE_THRESHOLD = float(os.environ.get("MEMORY_USE_THRESHOLD", "0.15"))
CHUNK_INJECT_CHARS = int(os.environ.get("CHUNK_INJECT_CHARS", "700"))
CHAT_HISTORY_EXCHANGES = int(os.environ.get("CHAT_HISTORY_EXCHANGES", "20"))
CHAT_HISTORY_CHARS = int(os.environ.get("CHAT_HISTORY_CHARS", "2500"))

MAX_HISTORY = 500
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "traces.jsonl")


STAGES: list[dict[str, Any]] = [
    {"id": "step-1", "label": "Request Received", "model": None, "system": None},
    {"id": "step-2", "label": "Intent Classification", "model": "worker", "system": None},
    {"id": "step-3", "label": "Model Routing", "model": None, "system": None},
    {"id": "step-4", "label": "Memory Retrieval", "model": None, "system": None},
    {"id": "step-5", "label": "Context Assembly", "model": None, "system": None},
    {"id": "step-6", "label": "Response Generation", "model": "worker",
     "system": "You are a wise and knowledgeable AI oracle. Provide a thoughtful, clear response to the user."},
    {"id": "step-7", "label": "Output Packaging", "model": None, "system": None},
]

LOCAL_MODEL: str = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")

def get_local_model() -> str:
    return LOCAL_MODEL

def set_local_model(value: str) -> None:
    global LOCAL_MODEL
    value = value.strip()
    if not value:
        raise ValueError("Model name cannot be empty")
    LOCAL_MODEL = value
    logger.info("Local model switched to: %s", value)

_analysis_persisted = False

def _init_analysis_from_config() -> None:
    global ANALYSIS_MODEL, ANALYSIS_PROVIDER, _analysis_persisted
    if _analysis_persisted:
        return
    try:
        ac = config_manager.get_analysis_config()
        ANALYSIS_MODEL = ac.get("model", os.environ.get("ANALYSIS_MODEL", "qwen2.5:3b"))
        ANALYSIS_PROVIDER = ac.get("provider", os.environ.get("ANALYSIS_PROVIDER", "local")).lower()
    except Exception:
        ANALYSIS_MODEL = os.environ.get("ANALYSIS_MODEL", "qwen2.5:3b")
        ANALYSIS_PROVIDER = os.environ.get("ANALYSIS_PROVIDER", "local").lower()
    _analysis_persisted = True

ANALYSIS_MODEL: str = "qwen2.5:3b"
ANALYSIS_PROVIDER: str = "local"
_init_analysis_from_config()

def _sync_analysis_from_config() -> None:
    global ANALYSIS_MODEL, ANALYSIS_PROVIDER
    try:
        ac = config_manager.get_analysis_config()
        ANALYSIS_MODEL = ac["model"]
        ANALYSIS_PROVIDER = ac["provider"]
    except Exception:
        pass

def get_analysis_model() -> str:
    _sync_analysis_from_config()
    return ANALYSIS_MODEL

def set_analysis_model(value: str) -> None:
    global ANALYSIS_MODEL
    value = value.strip()
    if not value:
        raise ValueError("Analysis model name cannot be empty")
    ANALYSIS_MODEL = value
    config_manager.set_analysis_config(value, ANALYSIS_PROVIDER)
    logger.info("Analysis model switched to: %s", value)

def get_analysis_provider() -> str:
    _sync_analysis_from_config()
    return ANALYSIS_PROVIDER

def set_analysis_provider(value: str) -> None:
    global ANALYSIS_PROVIDER
    value = value.lower()
    if value not in ("local", "worker"):
        raise ValueError(f"Invalid analysis provider: {value!r}. Must be 'local' or 'worker'.")
    ANALYSIS_PROVIDER = value
    config_manager.set_analysis_config(ANALYSIS_MODEL, value)
    logger.info("Analysis provider switched to: %s", value)


async def warmup_model() -> None:
    """Preload model into inference server memory so first real trace doesn't pay cold-start cost."""
    base_url = config_manager.get_ollama_url()
    if not base_url:
        logger.warning("No Ollama URL configured — skipping model warm-up")
        return
    model_name = LOCAL_MODEL
    # Try Ollama-style warm-up first; fall back to OpenAI-compatible
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{base_url}/api/generate", json={
                "model": model_name, "prompt": "hello", "stream": False,
                "options": {"num_ctx": 4096},
            })
            resp.raise_for_status()
            logger.info("Model warm-up complete: %s (%s)", model_name, resp.status_code)
            return
    except Exception:
        pass
    # Fallback: try OpenAI-compatible endpoint
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{base_url}/v1/chat/completions", json={
                "model": model_name, "messages": [{"role": "user", "content": "hello"}],
                "max_tokens": 8,
            })
            resp.raise_for_status()
            logger.info("Model warm-up complete (OpenAI compat): %s (%s)", model_name, resp.status_code)
    except Exception as e:
        logger.warning("Model warm-up failed (non-fatal): %s", e)

    # Warm up analysis model only if it differs from the execution model.
    # The worker DMR is single-runner: warming a non-resident analysis model
    # would try to spawn a second runner and hang startup ~60s (CUDA busy).
    exec_model = model_name
    if ANALYSIS_PROVIDER == "worker":
        with contextlib.suppress(Exception):
            exec_model = config_manager.get_service("worker_llm").get("model", "") or exec_model
    if ANALYSIS_MODEL and exec_model != ANALYSIS_MODEL:
        an_url = config_manager.get_worker_url() if ANALYSIS_PROVIDER == "worker" else base_url
        an_protocol = config_manager.get_worker_protocol() if ANALYSIS_PROVIDER == "worker" else "ollama"
        if an_url:
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    if an_protocol == "openai":
                        resp = await client.post(f"{an_url}/v1/chat/completions", json={
                            "model": ANALYSIS_MODEL,
                            "messages": [{"role": "user", "content": "hello"}],
                            "max_tokens": 8,
                        })
                    else:
                        resp = await client.post(f"{an_url}/api/generate", json={
                            "model": ANALYSIS_MODEL, "prompt": "hello", "stream": False,
                            "options": {"num_ctx": 4096},
                        })
                    resp.raise_for_status()
                    logger.info("Analysis model warm-up complete: %s (%s)", ANALYSIS_MODEL, resp.status_code)
            except Exception as e:
                logger.warning("Analysis model warm-up failed (non-fatal): %s", e)


def _strip_registry_prefix(name: str) -> str:
    """'docker.io/ai/gpt-oss:20B' -> 'gpt-oss:20B' (server API expects short)."""
    return name.split("/")[-1] if "/" in name else name


_NODE_PREFIXES = ("backoffice/", "primary/")


def _strip_node_prefix(name: str) -> str:
    """'backoffice/qwen3:latest' -> 'qwen3:latest'.

    Node prefixes (backoffice/, primary/) are routing metadata set by
    orchestrate() for identity tracking. The inference server expects the
    bare model name or full registry path, not the node qualifier.
    """
    for prefix in _NODE_PREFIXES:
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def _resolve_model_endpoint(model_key: str) -> tuple[str, str, str]:
    """Resolve the execution-model endpoint from the node registry.

    'local' prefers the logprobs-capable local_llm node (llama.cpp-server) when
    enabled and reachable, falling back to Ollama. 'worker' uses the worker_llm
    node with its configured protocol. Returns (base_url, model_name, protocol).
    """
    if _MODEL_PROVIDER == "local":
        llm = config_manager.get_local_llm_config()
        if llm["enabled"] and llm["url"]:
            return llm["url"], llm["model"] or LOCAL_MODEL, llm["protocol"]
        return config_manager.get_ollama_url(), LOCAL_MODEL, "ollama"
    return (
        config_manager.get_worker_url(),
        config_manager.get_worker_model() or LOCAL_MODEL,
        config_manager.get_worker_protocol(),
    )


def _current_execution_model() -> tuple[str, str]:
    """Return (model_name, node_id) for the active execution provider.

    Node-qualified identity (e.g. 'primary/qwen2.5:3b', 'backoffice/gpt-oss:20B')
    keeps per-model profiles and entropy comparisons distinct per machine.
    """
    if _MODEL_PROVIDER == "local":
        llm = config_manager.get_local_llm_config()
        if llm["enabled"] and llm["url"]:
            node = config_manager.get_service_node("local_llm") or "primary"
            return (llm["model"] or LOCAL_MODEL), node
        return LOCAL_MODEL, (config_manager.get_service_node("ollama") or "primary")
    wm = config_manager.get_worker_model()
    node = config_manager.get_service_node("worker_llm") or "worker"
    return (wm or LOCAL_MODEL), node


async def _call_model(model: str, prompt: str, system: str | None = None, *, model_name_override: str | None = None, provider_override: str | None = None) -> tuple[str, int | None, int | None, dict | None]:
    if model_name_override:
        provider = provider_override or ANALYSIS_PROVIDER
        if provider == "local":
            llm = config_manager.get_local_llm_config()
            if llm["enabled"] and llm["url"]:
                base_url = llm["url"]
                protocol = llm["protocol"]
                # Use the config model name (llama.cpp GGUF path) instead of
                # the probe's override — llama.cpp only recognizes its own path.
                model_name = llm["model"] or _strip_node_prefix(model_name_override)
            else:
                base_url = config_manager.get_ollama_url()
                protocol = "ollama"
                model_name = _strip_node_prefix(model_name_override)
        else:
            base_url = config_manager.get_worker_url()
            protocol = config_manager.get_worker_protocol()
            # Strip node prefix (e.g. "backoffice/" or "primary/") — it's
            # routing metadata, not part of the model name the server recognizes.
            model_name = _strip_node_prefix(model_name_override)
    else:
        base_url, model_name, protocol = _resolve_model_endpoint(model)

    # Send the configured model name unchanged. The Docker Model Runner resolves
    # FULL registry identifiers (e.g. docker.io/ai/qwen3:latest); stripping to
    # the last path component ("qwen3:latest") fails with "model not found" for
    # any model that isn't already resident. Ollama and llama.cpp use the name
    # as configured too, so there is no runner that wants the stripped form.
    provider_for_ctx = provider_override or (ANALYSIS_PROVIDER if model_name_override else _MODEL_PROVIDER)

    if protocol == "openai":
        return await _call_openai(base_url, model_name, prompt, system, provider_for_ctx)
    else:
        return await _call_ollama(base_url, model_name, prompt, system, provider_for_ctx)


def _compute_token_entropy(logprobs_content: list[dict], top_k: int = 5, threshold: float = 1.5) -> dict | None:
    """Compute entropy stats from an OpenAI-style logprobs.content array.

    Each item: {token, logprob, top_logprobs: [{token, logprob, ...}...]}.
    Entropy is estimated by normalizing the returned top-k distribution over
    the observed candidates (the full vocab mass is not observable).
    Special tokens (id >= 200000, e.g. <|channel|>) are skipped.
    The downsampled 'series' preserves temporal order for sparkline rendering.
    """
    per_token: list[float] = []
    surprisals: list[float] = []
    for item in logprobs_content:
        if not isinstance(item, dict):
            continue
        token_id = item.get("id")
        if isinstance(token_id, int) and token_id >= 200000:
            continue
        tops = item.get("top_logprobs") or []
        probs: list[float] = []
        for t in tops:
            if not isinstance(t, dict):
                continue
            lp = t.get("logprob")
            if isinstance(lp, (int, float)):
                probs.append(math.exp(lp))
        if not probs:
            continue
        total = sum(probs)
        if total <= 0:
            continue
        probs = [p / total for p in probs]
        entropy = -sum(p * math.log2(p) for p in probs)
        per_token.append(entropy)
        sampled = item.get("logprob")
        if isinstance(sampled, (int, float)):
            surprisals.append(-sampled * math.log2(math.e))
    if not per_token:
        return None
    ordered = [round(v, 4) for v in per_token]
    sorted_vals = sorted(per_token)
    p95 = sorted_vals[min(len(sorted_vals) - 1, int(0.95 * len(sorted_vals)))]
    # Branching factor: 2**H per token = effective number of competing
    # continuations implied by that token's entropy. Median across the whole
    # generation is the headline "how many paths were live" number.
    branching = [2.0 ** e for e in per_token]
    branch_sorted = sorted(branching)
    median_branching = branch_sorted[len(branch_sorted) // 2] if branch_sorted else 0.0
    # Downsample temporal series to a bounded length for the sparkline.
    series: list[float] = []
    branching_series: list[float] = []
    n = len(ordered)
    max_points = 60
    if n <= max_points:
        series = ordered
        branching_series = [round(b, 4) for b in branching]
    else:
        step = n / max_points
        for i in range(max_points):
            lo = min(n - 1, int(i * step))
            hi = min(n - 1, int((i + 1) * step) or lo + 1)
            window = ordered[lo:hi + 1]
            series.append(round(sum(window) / len(window), 4))
            bwin = branching[lo:hi + 1]
            branching_series.append(round(sum(bwin) / len(bwin), 4))
    return {
        "mean_entropy": round(sum(per_token) / len(per_token), 4),
        "p95_entropy": round(p95, 4),
        "mean_surprisal": round(sum(surprisals) / len(surprisals), 4) if surprisals else None,
        "high_entropy_count": sum(1 for e in per_token if e > threshold),
        "token_count": len(per_token),
        "top_k": top_k,
        "series": series,
        "median_branching": round(median_branching, 4),
        "branching_series": branching_series,
    }


async def _call_ollama(base_url: str, model_name: str, prompt: str, system: str | None, provider_for_ctx: str) -> tuple[str, int | None, int | None, dict | None]:
    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
    }
    if provider_for_ctx == "local":
        payload["options"] = {"num_ctx": 4096}
    else:
        payload["options"] = {"num_ctx": 16384}

    if system:
        payload["system"] = system

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        try:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            result = data.get("response", "").strip()
            if not result:
                result = data.get("thinking", "").strip()
            eval_count = data.get("eval_count")
            eval_duration = data.get("eval_duration")
            return result, eval_count, eval_duration, None
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                msg = f"Model '{model_name}' not found on {base_url}. Use 'ollama pull {model_name}' to download it."
            else:
                msg = f"{model_name} error: {e}"
            logger.error("Model call failed: %s", msg)
            return f"[{model_name} error: {msg}]", None, None, None
        except Exception as e:
            err_str = str(e) or repr(e) or f"type={type(e).__name__}"
            logger.error("Model call failed (%s -> %s): %s", model_name, base_url, err_str)
            return f"[{model_name} error: {err_str}]", None, None, None


async def _call_openai(base_url: str, model_name: str, prompt: str, system: str | None, provider_for_ctx: str) -> tuple[str, int | None, int | None, dict | None]:
    """Call an OpenAI-compatible endpoint (vLLM, TGI, LM Studio, etc.).

    Requests top-k logprobs and computes token-entropy stats from the
    response. Handles reasoning models whose answer lands in
    'reasoning_content' (mirrors the Ollama path's 'thinking' fallback) and
    derives eval_duration_ns from the server's 'timings' block when present.
    """
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    num_ctx = 4096 if provider_for_ctx == "local" else 16384
    payload: dict[str, Any] = {
        "model": model_name,
        "messages": messages,
        "max_tokens": num_ctx,
        "temperature": 0.7,
        "logprobs": True,
        "top_logprobs": 5,
    }

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        try:
            resp = await client.post(f"{base_url}/v1/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()
            choice = data.get("choices", [{}])[0]
            message = choice.get("message", {})
            result = (message.get("content") or "").strip()
            if not result:
                result = (message.get("reasoning_content") or "").strip()
            usage = data.get("usage", {})
            eval_count = usage.get("completion_tokens")
            # OpenAI API doesn't expose prompt/eval duration directly; derive
            # it from llama.cpp-style 'timings' when present.
            eval_duration = None
            timings = data.get("timings") or {}
            predicted_ms = timings.get("predicted_ms")
            if isinstance(predicted_ms, (int, float)):
                eval_duration = int(predicted_ms * 1_000_000)
            # Token entropy from logprobs when the server returns them.
            entropy = None
            lp = choice.get("logprobs") or {}
            content = lp.get("content") if isinstance(lp, dict) else None
            if isinstance(content, list) and content:
                entropy = _compute_token_entropy(content)
            return result, eval_count, eval_duration, entropy
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                msg = f"Model '{model_name}' not found on {base_url}. Check the model name for your inference server."
            else:
                msg = f"{model_name} error: {e}"
            logger.error("OpenAI-compatible call failed: %s", msg)
            return f"[{model_name} error: {msg}]", None, None, None
        except Exception as e:
            err_str = str(e) or repr(e) or f"type={type(e).__name__}"
            logger.error("OpenAI-compatible call failed (%s -> %s): %s", model_name, base_url, err_str)
            return f"[{model_name} error: {err_str}]", None, None, None


def _compute_confidence(session: TraceSession) -> float:
    if not session.steps:
        return 0.0
    total = len(session.steps)
    completed = sum(1 for s in session.steps if s.status == "complete")
    stage_ratio = completed / total

    response_len_score = 0.0
    if session.output and len(session.output) > 20:
        length = len(session.output)
        response_len_score = min(length / 500, 1.0) * 0.25

    consistency = 0.0
    errors = sum(1 for s in session.steps if s.status == "error")
    if errors == 0:
        consistency = 0.25
    elif errors < total / 2:
        consistency = 0.15

    refinement_quality = 0.0
    if len(session.steps) >= 2:
        last_step = session.steps[-1]
        if last_step.status == "complete":
            refinement_quality = 0.15

    raw = stage_ratio * 0.35 + response_len_score + consistency + refinement_quality
    return round(min(raw, 0.99), 3)


def _detect_insights(session: TraceSession) -> list[str]:
    tags: list[str] = []
    if session.confidence and session.confidence > 0.85:
        tags.append("high_confidence")
    if session.output and len(session.output) > 300:
        tags.append("rich_response")
    if session.steps and all(s.status == "complete" for s in session.steps):
        tags.append("perfect_pipeline")
    return tags


async def _build_architecture_context() -> str:
    lines: list[str] = []
    machines = config_manager.get_machines_config()
    services = config_manager.get_services()
    for mid, m in machines.items():
        desc = m.get("insight", m.get("desc", ""))
        host = m.get("host", "?")
        svc_list = [s for s in m.get("services", []) if s in services]
        svc_names = []
        for sid in svc_list:
            svc = services[sid]
            svc_names.append(svc.get("label", sid))

        reachable = await _check_machine_reachable(m, services)
        status = "reachable" if reachable else "unreachable"
        lines.append(f"- {m.get('name', mid)} ({host}, {status}): {desc}")
        if svc_names:
            lines.append(f"  Services: {', '.join(svc_names)}")

    return "\n".join(lines)


async def _check_machine_reachable(machine: dict, services: dict) -> bool:
    host = machine.get("host", "")
    if host in ("127.0.0.1", "localhost", ""):
        return True
    svc_ids = machine.get("services", [])
    if not svc_ids:
        return False
    targets = []
    for sid in svc_ids:
        svc = services.get(sid)
        if svc and svc.get("enabled", True):
            svc_host = svc.get("host", host)
            svc_port = svc.get("port", 80)
            targets.append((svc_host, svc_port))
    if not targets:
        return False
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            for svc_host, svc_port in targets:
                try:
                    r = await c.get(f"http://{svc_host}:{svc_port}/health", timeout=1.5)
                    if r.status_code < 500:
                        return True
                except Exception:
                    continue
    except Exception:
        pass
    return False
def _fmt_ms(ms: int | float) -> str:
    if ms < 1000:
        return f"{int(ms)}ms"
    return f"{ms / 1000:.1f}s"

async def _generate_llm_insights(session: TraceSession) -> list[LlmInsight]:
    if not session.steps:
        return []

    step_map = {s.label: s.duration_ms for s in session.steps if s.label and s.duration_ms}
    total_ms = sum(step_map.values())

    insights: list[LlmInsight] = []

    # Slowest stage
    if step_map:
        slowest_label, slowest_ms = max(step_map.items(), key=lambda x: x[1] or 0)
        pct = f"{(slowest_ms / total_ms * 100):.0f}" if total_ms > 0 else "?"
        if slowest_ms and slowest_ms > 5000:
            insights.append(LlmInsight(
                type="info",
                title=f"{slowest_label} dominates",
                body=f"{slowest_label} took {_fmt_ms(slowest_ms)} ({pct}% of run). "
                     f"This is the primary bottleneck."
            ))

    # Error detection
    for s in session.steps:
        if s.status == "error":
            err_out = (s.metadata.get("output") or "")[:120] if s.metadata else ""
            insights.append(LlmInsight(
                type="recommendation",
                title=f"{s.label} failed",
                body=f"Stage errored: {err_out or 'unknown reason'}. Review pipeline logs."
            ))

    # Total pipeline time
    if total_ms > 120000:
        insights.append(LlmInsight(
            type="info",
            title="Slow pipeline",
            body=f"Total time {_fmt_ms(total_ms)}. Consider using a GPU-backed model or reducing retrieval depth."
        ))
    elif total_ms < 5000:
        insights.append(LlmInsight(
            type="info",
            title="Fast pipeline",
            body=f"Completed in {_fmt_ms(total_ms)} — likely prompt caching or warm model."
        ))

    # Cold start heuristic: if first stage is much slower than the rest
    steps_with_time = [s for s in session.steps if s.duration_ms]
    if len(steps_with_time) >= 3:
        first_ms = steps_with_time[0].duration_ms or 0
        median_of_rest = sorted([s.duration_ms or 0 for s in steps_with_time[1:]])
        rest_med = median_of_rest[len(median_of_rest) // 2] if median_of_rest else 0
        if first_ms > rest_med * 3 and first_ms > 5000:
            insights.append(LlmInsight(
                type="info",
                title="Cold start detected",
                body=f"First stage ({steps_with_time[0].label}) took {_fmt_ms(first_ms)} — "
                     f"{int(first_ms / (rest_med or 1))}x the median of subsequent stages. "
                     f"Model was likely paged out of RAM."
            ))

    # Network architecture context
    arch = await _build_architecture_context()
    unreachable = [line for line in arch.split("\n") if "unreachable" in line.lower()]
    if unreachable:
        service_names = [u.split(":")[0].strip() for u in unreachable if ":" in u]
        if service_names:
            insights.append(LlmInsight(
                type="recommendation",
                title="Unreachable services",
                body=f"Could not reach: {', '.join(service_names)}. Check network connectivity."
            ))

    return insights[:6]


async def _generate_response_rationale(session: TraceSession) -> str | None:
    if not session.output or not session.steps:
        return None

    intent_step = next((s for s in session.steps if s.label == "Intent Classification"), None)
    intent_info = ""
    if intent_step and intent_step.metadata:
        intent_info = intent_step.metadata.get("output", "") or ""

    mem_step = next((s for s in session.steps if s.label == "Memory Retrieval"), None)
    mem_info = ""
    if mem_step and mem_step.metadata:
        chunks = mem_step.metadata.get("retrieved_chunks", [])
        used = sum(1 for c in chunks if c.get("used"))
        if chunks:
            mem_info = f"Based on {len(chunks)} past trace(s), {used} directly relevant. "

    model_name = session.model_used or LOCAL_MODEL or "the AI model"
    out_len = len(session.output)
    if out_len < 100:
        style = "concise"
    elif out_len < 500:
        style = "moderate-length"
    else:
        style = "detailed"

    prompt_first_line = (session.prompt or "").split("\n")[0][:80]

    parts = [
        f"The user asked: \"{prompt_first_line}\".",
    ]
    if intent_info:
        parts.append(f"The system classified this request under '{intent_info}'.")
    if mem_info:
        parts.append(mem_info)
    parts.append(
        f"The model ({model_name}) produced a {style} response ({out_len} characters), "
        f"tailored to the user's request as interpreted through the orchestration pipeline."
    )

    return " ".join(parts)


async def _generate_trace_explanation(session: TraceSession) -> str | None:
    if not session.steps:
        return None
    parts: list[str] = []

    # Step 1: what user asked
    parts.append(f"The user asked: \"{session.prompt}\"")

    # Intent classification
    intent_step = next((s for s in session.steps if s.label == "Intent Classification"), None)
    if intent_step and intent_step.metadata:
        intent_out = intent_step.metadata.get("output", "")
        if intent_out:
            parts.append(f"The system classified this as: {intent_out}")

    # Memory retrieval
    mem_step = next((s for s in session.steps if s.label == "Memory Retrieval"), None)
    if mem_step and mem_step.metadata:
        chunks = mem_step.metadata.get("retrieved_chunks", [])
        used = sum(1 for c in chunks if c.get("used"))
        if chunks:
            top_rel = max((c.get("relevance", 0) for c in chunks), default=0)
            parts.append(
                f"Memory Retrieval found {len(chunks)} relevant past trace(s) "
                f"(top relevance: {top_rel:.2f}), of which {used} were used to inform the response."
            )
        else:
            parts.append("Memory Retrieval found no relevant past traces.")
    else:
        parts.append("Memory Retrieval was not invoked.")

    # Context synthesis
    ctx_step = next((s for s in session.steps if s.label == "Context Assembly"), None)
    if ctx_step and ctx_step.context_assembled:
        ctx_len = len(ctx_step.context_assembled)
        parts.append(f"Context Assembly built a {ctx_len}-character context from retrieved data and system instructions.")
    elif ctx_step:
        parts.append("Context Assembly passed through the primary intent without additional context.")

    # Response generation
    gen_step = next((s for s in session.steps if s.label == "Response Generation"), None)
    model_used = (gen_step.model_used or session.model_used or LOCAL_MODEL) if gen_step else (session.model_used or LOCAL_MODEL)
    if session.output:
        out_len = len(session.output)
        parts.append(f"The model ({model_used}) generated a {out_len}-character response.")
    elif session.status == "error":
        parts.append("The pipeline errored before producing a final response.")
    else:
        parts.append("No output was generated.")

    # Stage timing summary
    timed_steps = [(s.label, s.duration_ms) for s in session.steps if s.label and s.duration_ms]
    if timed_steps:
        total = sum(ms for _, ms in timed_steps)
        timing = ", ".join(f"{label}: {_fmt_ms(ms)}" for label, ms in timed_steps)
        parts.append(f"Pipeline completed in {_fmt_ms(total)}: {timing}.")

    # Error summary
    errors = [s for s in session.steps if s.status == "error"]
    if errors:
        err_detail = "; ".join(f"{s.label}: {(s.metadata.get('output') or '')[:100]}" for s in errors)
        parts.append(f"Errors occurred: {err_detail}.")

    return "\n\n".join(parts)


# ── Activity event bus ────────────────────────────────────────────
_activity_events: deque[dict[str, Any]] = deque(maxlen=200)
_event_counter = 0

def emit_event(kind: str, label: str, session_id: str | None = None, detail: str | None = None) -> None:
    global _event_counter
    _event_counter += 1
    event = {
        "id": f"evt-{_event_counter}",
        "kind": kind,
        "label": label,
        "session_id": session_id,
        "detail": detail,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    _activity_events.append(event)


def get_activity_events(since: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    events = list(_activity_events)
    if since:
        if since.startswith("evt-"):
            try:
                num = int(since[4:])
                events = [e for e in events if int(e["id"][4:]) > num]
            except ValueError:
                pass
        else:
            events = [e for e in events if e["timestamp"] > since]
    return events[-limit:]


# ── Telemetry snapshot ────────────────────────────────────────────
def _snapshot_cpu_mem() -> tuple[float, float]:
    return psutil.cpu_percent(interval=0), psutil.virtual_memory().percent


# ── Agent / model inference ───────────────────────────────────────
_AGENT_MAP: dict[str, str] = {
    "step-2": "Intent Classifier",
    "step-3": "Model Router",
    "step-4": "Memory Retriever",
    "step-5": "Context Assembler",
    "step-6": "Response Generator",
}


# ── In-memory store ───────────────────────────────────────────────
_store: dict[str, TraceSession] = {}


def _persist(session: TraceSession) -> None:
    try:
        data_dir = os.path.dirname(HISTORY_FILE)
        os.makedirs(data_dir, exist_ok=True)
        with open(HISTORY_FILE, "a") as f:
            f.write(session.model_dump_json() + "\n")
        if os.path.getsize(HISTORY_FILE) > 5_000_000:
            _trim_history()
    except Exception as e:
        logger.error("Failed to persist trace: %s", e)


def _update_persist(session: TraceSession) -> None:
    """Replace the last line for this trace_id in-place (avoids file bloat)."""
    try:
        if not os.path.exists(HISTORY_FILE):
            _persist(session)
            return
        with open(HISTORY_FILE) as f:
            lines = f.readlines()
        replaced = False
        for i in range(len(lines) - 1, -1, -1):
            if lines[i].strip():
                try:
                    entry = TraceSession.model_validate_json(lines[i])
                    if entry.id == session.id:
                        lines[i] = session.model_dump_json() + "\n"
                        replaced = True
                        break
                except Exception:
                    continue
        if replaced:
            with open(HISTORY_FILE, "w") as f:
                f.writelines(lines)
        else:
            _persist(session)
    except Exception as e:
        logger.error("Failed to update trace in-place: %s", e)
        _persist(session)


def _trim_history() -> None:
    try:
        if not os.path.exists(HISTORY_FILE):
            return
        with open(HISTORY_FILE) as f:
            lines = f.readlines()
        if len(lines) > MAX_HISTORY:
            with open(HISTORY_FILE, "w") as f:
                f.writelines(lines[-MAX_HISTORY:])
    except Exception as e:
        logger.error("Failed to trim history: %s", e)


def load_history(limit: int = 50) -> list[TraceSession]:
    sessions: list[TraceSession] = []
    try:
        if not os.path.exists(HISTORY_FILE):
            return sessions
        with open(HISTORY_FILE) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        sessions.append(TraceSession.model_validate_json(line))
                    except Exception:
                        continue
        # Deduplicate: keep last occurrence of each trace_id
        seen: set[str] = set()
        deduped: list[TraceSession] = []
        for s in reversed(sessions):
            if s.id not in seen:
                seen.add(s.id)
                deduped.append(s)
        deduped.reverse()
        sessions = deduped
    except Exception as e:
        logger.error("Failed to load history: %s", e)
    return sessions[-limit:]


_embed_cache: dict[str, list[float]] = {}
def _get_embed_model() -> str:
    return config_manager.get_embedding_model()


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na < 1e-12 or nb < 1e-12:
        return 0.0
    return round(dot / (na * nb), 4)


async def _embed(text: str) -> list[float]:
    if text in _embed_cache:
        return _embed_cache[text]
    url, payload = config_manager.embedding_endpoint_and_payload(text)
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, timeout=30)
        emb = config_manager.embedding_response_vector(resp.json())
        _embed_cache[text] = emb
        return emb


async def orchestrate(prompt: str, trace_id: str | None = None, headless: bool = False,
                       model_override: str | None = None, provider_override: str | None = None) -> TraceSession:
    trace_id = trace_id or uuid.uuid4().hex[:12]
    session = _store.get(trace_id) or TraceSession(id=trace_id, prompt=prompt)
    _store[trace_id] = session

    context: list[str] = []
    cpu_samples: list[float] = []
    mem_samples: list[float] = []

    # Carry prior exchanges of this chat into context so the model can actually
    # resolve references like "the topic we were discussing". Oldest first.
    if session.chat_id and session.exchange_index is not None and session.exchange_index > 0:
        prior = [
            s for s in load_history(limit=500)
            if s.chat_id == session.chat_id
            and s.exchange_index is not None
            and s.exchange_index < session.exchange_index
        ]
        prior.sort(key=lambda s: s.exchange_index)
        prior = prior[-CHAT_HISTORY_EXCHANGES:]
        if prior:
            # Keep the NEWEST exchanges that fit the char budget (displayed oldest first).
            selected: list[tuple[TraceSession, str]] = []
            used = 0
            for s in reversed(prior):
                block = f"[User]: {s.prompt[:500]}\n[Assistant]: {(s.output or '')[:800]}"
                if used + len(block) > CHAT_HISTORY_CHARS:
                    continue
                selected.append((s, block))
                used += len(block)
            if selected:
                selected.reverse()
                lines = ["[Chat History]: Prior exchanges in this conversation (oldest first):"]
                lines += [b for _, b in selected]
                context.append("\n".join(lines))


    if not headless:
        emit_event("session_start", "Orchestration started", trace_id, prompt[:80])
    if model_override:
        resolved_model = model_override
        if _MODEL_PROVIDER == "worker":
            node_id = config_manager.get_service_node("worker_llm") or "worker"
        else:
            node_id = config_manager.get_service_node("local_llm") or config_manager.get_service_node("ollama") or "primary"
    else:
        resolved_model, node_id = _current_execution_model()
    # Node-qualified identity: profiles/entropy aggregate per model×node.
    qualified_model = f"{node_id}/{_strip_registry_prefix(resolved_model)}"
    session.model_used = qualified_model

    for i, stage in enumerate(STAGES):
        stage_id = stage["id"]
        label = stage["label"]
        model = stage["model"]
        system = stage["system"]
        agent_name = _AGENT_MAP.get(stage_id, label)

        cpu_before, mem_before = _snapshot_cpu_mem()

        step = TraceStep(
            id=stage_id,
            label=label,
            status="processing",
            timestamp=datetime.now(UTC).isoformat(),
            model_used=qualified_model if model else None,
            agent_used=agent_name,
            cpu_before=cpu_before,
            mem_before=mem_before,
        )
        session.steps.append(step)

        if not headless:
            emit_event("stage_start", f"{label} started", trace_id, agent_name)

        start = perf_counter()

        if model:
            combined = "\n".join(context + [prompt])
            step.context_assembled = combined

            # Step 2: use embedding-based intent classifier instead of LLM
            if stage_id == "step-2":
                from services.intent_classifier import classify_intent
                intent_result = await classify_intent(prompt)
                output = json.dumps(intent_result)
                eval_count = None
                eval_duration_ns = None
            else:
                if stage_id == "step-6" and not headless:
                    step.metadata["gen_started_at"] = datetime.now(UTC).isoformat()
                output, eval_count, eval_duration_ns, entropy = await _call_model(
                    model, combined, system,
                    model_name_override=model_override if model_override else None,
                    provider_override=provider_override if provider_override else None,
                )
                if stage_id == "step-6" and entropy:
                    step.metadata["token_entropy"] = entropy

            step.eval_count = eval_count
            step.eval_duration_ns = eval_duration_ns
            # Parse structured output for Intent Classification (step-2)
            if stage_id == "step-2":
                try:
                    parsed = json.loads(output)
                    classification = parsed.get("classification", "").strip()
                    intents = parsed.get("intents", [])
                    if classification:
                        context.append(f"[{label}]: {classification}")
                    else:
                        context.append(f"[{label}]: {output}")
                    if intents and isinstance(intents, list):
                        step.metadata["intent_probs"] = intents[:3]
                    step.metadata["output"] = (classification or output)[:2000]
                except (json.JSONDecodeError, TypeError):
                    context.append(f"[{label}]: {output}")
                    step.metadata["output"] = output[:2000]
            else:
                context.append(f"[{label}]: {output}")
                step.metadata["output"] = output[:2000]
            if not headless:
                emit_event("inference", f"Inference: {label}", trace_id, resolved_model)
        else:
            step.context_assembled = None
            if stage_id == "step-4":
                past_sessions = load_history(limit=20)
                query_emb = await _embed(prompt)
                chunks = []
                for ps in past_sessions:
                    if ps.id == trace_id or not ps.output or len(ps.output) < 20:
                        continue
                    if ps.embedding is None:
                        ps.embedding = await _embed(ps.prompt)
                    sim = _cosine_similarity(query_emb, ps.embedding)
                    chunks.append({
                        "trace_id": ps.id,
                        "content": ps.output[:2000],
                        "relevance": sim,
                    })
                chunks.sort(key=lambda c: c["relevance"], reverse=True)
                top_chunks = chunks[:5]
                for ci, chunk in enumerate(top_chunks):
                    chunk["used"] = ci == 0 or chunk["relevance"] >= MEMORY_USE_THRESHOLD

                # Build pairwise similarity matrix for vector graph
                vector_points: list[dict] = []
                query_label = prompt[:60]
                vector_points.append({
                    "id": "query",
                    "label": query_label,
                    "is_query": True,
                })
                for chunk in top_chunks:
                    vector_points.append({
                        "id": chunk["trace_id"],
                        "label": chunk["content"][:60],
                        "content": chunk["content"],
                        "relevance": chunk["relevance"],
                        "used": chunk["used"],
                        "is_query": False,
                    })
                # Pairwise edges: query to each chunk, and chunk-to-chunk
                edges: list[dict] = []
                # query -> all chunks
                for chunk in top_chunks:
                    edges.append({
                        "source": "query",
                        "target": chunk["trace_id"],
                        "similarity": chunk["relevance"],
                    })
                # chunk-to-chunk
                for vi in range(len(top_chunks)):
                    for vj in range(vi + 1, len(top_chunks)):
                        # Find the actual past sessions to compute pairwise similarity
                        ps_i = next((ps for ps in past_sessions if ps.id == top_chunks[vi]["trace_id"]), None)
                        ps_j = next((ps for ps in past_sessions if ps.id == top_chunks[vj]["trace_id"]), None)
                        if ps_i and ps_j and ps_i.embedding and ps_j.embedding:
                            sim = _cosine_similarity(ps_i.embedding, ps_j.embedding)
                            edges.append({
                                "source": top_chunks[vi]["trace_id"],
                                "target": top_chunks[vj]["trace_id"],
                                "similarity": sim,
                            })

                step.metadata["retrieved_chunks"] = top_chunks
                step.metadata["vector_graph"] = {"points": vector_points, "edges": edges}
                used_count = sum(1 for c in top_chunks if c.get("used"))
                if used_count > 0:
                    scores = ", ".join(f"{c['relevance']:.2f}" for c in top_chunks)
                    context.append(
                        f"[Memory Retrieval]: Found {len(top_chunks)} candidate past traces; "
                        f"{used_count} above relevance threshold (≥ {MEMORY_USE_THRESHOLD:.2f}) and "
                        f"incorporated into context. Semantic similarity scores: {scores}"
                    )
                    for chunk in top_chunks:
                        if chunk.get("used"):
                            content = (chunk.get("content") or "").strip().replace("\n", " ")
                            context.append(
                                f"[Memory Retrieval · rel {chunk['relevance']:.2f}]: "
                                f"{content[:CHUNK_INJECT_CHARS]}"
                            )
                else:
                    context.append(
                        f"[Memory Retrieval]: Found {len(top_chunks)} candidate chunks but none used "
                        f"(best cosine similarity: {top_chunks[0]['relevance']:.3f}, below threshold)"
                        if top_chunks else "[Memory Retrieval]: No semantically similar memories found"
                    )
                emit_event("memory_retrieval", f"Retrieved {len(top_chunks)} chunks, {used_count} used", trace_id)
            else:
                await asyncio.sleep(0.05)
                if stage_id == "step-5":
                    output = f"[{label}]: Primary intent is {next((c for c in context if c.startswith('[Intent')), 'unknown')}"
                    step.metadata["output"] = output[:2000]
                    context.append(output)
                elif stage_id == "step-7":
                    step.metadata["output"] = ""
                else:
                    step.metadata["output"] = ""

        elapsed_ms = int((perf_counter() - start) * 1000)
        cpu_after, mem_after = _snapshot_cpu_mem()
        cpu_samples.extend([cpu_before, cpu_after])
        mem_samples.extend([mem_before, mem_after])

        is_error = model and output.startswith("[") and "error:" in output
        if is_error:
            session.steps[i].status = "error"
        else:
            session.steps[i].status = "complete"
        session.steps[i].duration_ms = elapsed_ms
        session.steps[i].cpu_after = cpu_after
        session.steps[i].mem_after = mem_after
        session.steps[i].context_assembled = step.context_assembled

        emit_event("stage_complete", f"{label} {'error' if is_error else 'completed'}", trace_id, f"{elapsed_ms}ms")

    session.status = "error" if any(s.status == "error" for s in session.steps) else "complete"
    session.output = context[-1] if context else prompt
    session.completed_at = datetime.now(UTC).isoformat()
    session.confidence = _compute_confidence(session)
    session.insight_tags = _detect_insights(session)

    # Promote stage-6 token entropy to the session level for fingerprinting.
    gen_step = next((s for s in session.steps if s.id == "step-6"), None)
    if gen_step and gen_step.metadata.get("token_entropy"):
        try:
            session.token_entropy = TokenEntropy(**gen_step.metadata["token_entropy"])
        except Exception as e:
            logger.warning("Failed to attach token entropy for %s: %s", trace_id, e)

    peak_cpu = round(max(cpu_samples), 1) if cpu_samples else 0.0
    peak_mem = round(max(mem_samples), 1) if mem_samples else 0.0
    avg_cpu = round(sum(cpu_samples) / len(cpu_samples), 1) if cpu_samples else 0.0
    avg_mem = round(sum(mem_samples) / len(mem_samples), 1) if mem_samples else 0.0
    session.telemetry_impact = TelemetryImpact(
        peak_cpu=peak_cpu, peak_mem=peak_mem, avg_cpu=avg_cpu, avg_mem=avg_mem,
    )

    emit_event("session_complete", "Orchestration completed", trace_id,
               f"peak CPU: {peak_cpu}%, peak RAM: {peak_mem}%")

    _persist(session)

    # ══ Post-complete async insight generation ═══════════════════
    try:
        insights = await _generate_llm_insights(session)
        if insights:
            session.llm_insights = insights
            _update_persist(session)
            logger.info("LLM insights generated for %s: %d insights", trace_id, len(insights))
    except Exception as e:
        logger.warning("LLM insight step failed for %s: %s", trace_id, e)

    try:
        session.embedding = await _embed(session.prompt)
    except Exception as e:
        logger.warning("Embedding computation failed for %s: %s", trace_id, e)

    try:
        rationale = await _generate_response_rationale(session)
        if rationale:
            session.response_rationale = rationale
            logger.info("Response rationale generated for %s", trace_id)
    except Exception as e:
        logger.warning("Response rationale failed for %s: %s", trace_id, e)

    try:
        explanation = await _generate_trace_explanation(session)
        if explanation:
            session.trace_explanation = explanation
            logger.info("Trace explanation generated for %s", trace_id)
    except Exception as e:
        logger.warning("Trace explanation failed for %s: %s", trace_id, e)

    try:
        ddc = await classify_ddc(session.prompt, session.output)
        if ddc.prompt or ddc.response:
            ddc_alt = await classify_multi_ddc(session.prompt, top_n=3)
            if ddc.prompt:
                ddc.prompt_alternatives = [a for a in ddc_alt if a.code != ddc.prompt.code][:2]
            ddc_resp_alt = await classify_multi_ddc(session.output or "", is_empty=not session.output)
            if ddc.response and ddc_resp_alt:
                ddc.response_alternatives = [a for a in ddc_resp_alt if a.code != ddc.response.code][:2]
            session.ddc = ddc
            logger.info("DDC classification complete for %s", trace_id)
    except Exception as e:
        logger.warning("DDC classification failed for %s: %s", trace_id, e)

    try:
        lcc = await classify_lcc(session.prompt, session.output)
        if lcc.prompt or lcc.response:
            lcc_alt = await classify_multi_lcc(session.prompt, top_n=3)
            if lcc.prompt:
                lcc.prompt_alternatives = [a for a in lcc_alt if a.code != lcc.prompt.code][:2]
            lcc_resp_alt = await classify_multi_lcc(session.output or "", is_empty=not session.output)
            if lcc.response and lcc_resp_alt:
                lcc.response_alternatives = [a for a in lcc_resp_alt if a.code != lcc.response.code][:2]
            session.lcc = lcc
            logger.info("LCC classification complete for %s", trace_id)
    except Exception as e:
        logger.warning("LCC classification failed for %s: %s", trace_id, e)

    _update_persist(session)

    return session


STALE_THRESHOLD_S = 60  # steps running longer than this are flagged as potentially stuck

def _annotate_staleness(session: TraceSession) -> None:
    """Mark steps that have been 'processing' for >STALE_THRESHOLD_S as stale."""
    now = datetime.now(UTC)
    for step in session.steps:
        if step.status != "processing":
            step.metadata.pop("stale", None)
            continue
        try:
            started = datetime.fromisoformat(step.timestamp)
            elapsed = (now - started).total_seconds()
            if elapsed > STALE_THRESHOLD_S:
                step.metadata["stale"] = True
                step.metadata["stale_seconds"] = round(elapsed)
            else:
                step.metadata.pop("stale", None)
                step.metadata.pop("stale_seconds", None)
        except (ValueError, TypeError):
            pass


def get_trace(trace_id: str) -> TraceSession | None:
    if trace_id in _store:
        _annotate_staleness(_store[trace_id])
        return _store[trace_id]
    for session in load_history(limit=500):
        if session.id == trace_id:
            return session
    return None


def list_traces(limit: int = 50) -> list[TraceSession]:
    traces = load_history(limit)
    for t in traces:
        _annotate_staleness(t)
    return traces


# Metadata keys too heavy for the list/summary view. They're only consumed by
# per-trace detail panels (IntelligencePanel, DualTimeline, SynthesisBridge,
# RelationshipsPanel, Chat components) which fetch the full trace or the full
# list explicitly.
_SUMMARY_HEAVY_META_KEYS = {
    "retrieved_chunks", "vector_graph", "output", "model_response",
    "prompt", "intent_probs", "token_entropy", "entropy_series",
    "branching_series",
}


def summarize_trace(t: TraceSession) -> TraceSession:
    """Light copy of a trace for list endpoints (drops per-token + per-step bulk).

    Keeps everything the constellation/galaxy/history/status panels read: DDC/LCC
    (incl. alternatives), synesth, token_entropy aggregates, step durations,
    output, timestamps. Drops the heavy payloads that only detail views need:
    embeddings, entropy/branching series, retrieved chunks, vector graph,
    context assemblies, rationales, LLM insights, per-step model output.
    """
    token_entropy = None
    if t.token_entropy is not None:
        token_entropy = t.token_entropy.model_copy(
            update={"series": [], "branching_series": []}
        )
    steps = [
        s.model_copy(
            update={
                "metadata": {
                    k: v for k, v in s.metadata.items()
                    if k not in _SUMMARY_HEAVY_META_KEYS
                },
                "context_assembled": None,
            }
        )
        for s in t.steps
    ]
    return t.model_copy(
        update={
            "embedding": None,
            "response_rationale": None,
            "trace_explanation": None,
            "llm_insights": [],
            "token_entropy": token_entropy,
            "steps": steps,
        }
    )


def next_exchange_index(chat_id: str) -> int:
    """Next exchange_index for a chat: max existing + 1, or 0 if none yet."""
    indices = [
        s.exchange_index for s in _store.values()
        if s.chat_id == chat_id and s.exchange_index is not None
    ]
    indices += [
        s.exchange_index for s in load_history(limit=500)
        if s.chat_id == chat_id and s.exchange_index is not None
    ]
    return (max(indices) + 1) if indices else 0


def delete_trace(trace_id: str) -> bool:
    removed = False
    if trace_id in _store:
        del _store[trace_id]
        removed = True
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE) as f:
                lines = f.readlines()
            kept = [line for line in lines if trace_id not in line]
            if len(kept) < len(lines):
                with open(HISTORY_FILE, "w") as f:
                    f.writelines(kept)
                removed = True
    except Exception as e:
        logger.error("Failed to delete trace %s from history: %s", trace_id, e)
    return removed


def bulk_delete_traces(trace_ids: list[str]) -> int:
    count = 0
    for tid in trace_ids:
        if tid in _store:
            del _store[tid]
            count += 1
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE) as f:
                lines = f.readlines()
            id_set = set(trace_ids)
            kept = [line for line in lines if not any(tid in line for tid in id_set)]
            if len(kept) < len(lines):
                with open(HISTORY_FILE, "w") as f:
                    f.writelines(kept)
    except Exception as e:
        logger.error("Failed to bulk delete from history: %s", e)
    return count
